import { describe, it, expect, vi } from 'vitest';
import { IMAGE_CFG, IMAGE_GEN_HEIGHT, IMAGE_GEN_WIDTH, IMAGE_STEPS } from '@grims/shared';
import { ImageClient, firstImage, imageConfigFrom, isFinished } from './image.client.js';

/**
 * Talking to ComfyUI without a GPU in the room.
 *
 * ★ WHAT THESE TESTS ARE ACTUALLY DEFENDING ★
 *
 * This client crosses an SSH tunnel to a home PC that may be off, asleep, or running a game on the
 * card in question. Every failure mode below is one that WILL happen in normal operation — none of
 * them are exotic — and the requirement in each case is the same: return null, log something a
 * human can act on, and never throw into a member's request.
 */

const CONFIG = {
  baseUrl: 'http://127.0.0.1:8188',
  unet: 'flux1-schnell-Q4_K_S.gguf',
  clipT5: 't5xxl_fp8_e4m3fn.safetensors',
  clipL: 'clip_l.safetensors',
  vae: 'ae.safetensors',
};

/** No real waiting: the client polls every two seconds and these tests must not. */
const noSleep = async (): Promise<void> => undefined;

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function bytesResponse(bytes: Uint8Array): Response {
  return {
    ok: true,
    json: async () => ({}),
    arrayBuffer: async () => bytes.buffer.slice(0),
  } as unknown as Response;
}

describe('configuration', () => {
  it('is unconfigured without a base URL, and says so rather than half-working', () => {
    expect(imageConfigFrom({})).toBeNull();
    expect(imageConfigFrom({ IMAGE_BASE_URL: '' })).toBeNull();
  });

  it('MANDATORY: model filenames have defaults, so one env var is enough to run', () => {
    /*
     * The filenames are an installation detail, not a deployment decision. Requiring four of them
     * means somebody standing up a second instance gets a validation error at generation time —
     * long after the mistake — rather than a working service.
     */
    const c = imageConfigFrom({ IMAGE_BASE_URL: 'http://host:8188/' });
    expect(c?.baseUrl).toBe('http://host:8188');
    expect(c?.unet).toMatch(/\.gguf$/);
    expect(c?.clipT5).toMatch(/\.safetensors$/);
  });

  it('an unconfigured client generates nothing rather than calling a nonexistent host', async () => {
    const fetchSpy = vi.fn();
    const client = new ImageClient(null, fetchSpy as unknown as typeof fetch, null, noSleep);
    expect(client.configured).toBe(false);
    expect(await client.generate('a nebula', null)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('the graph it sends', () => {
  /** Submits once and hands back the graph ComfyUI was given. */
  async function capture(prompt = 'a blue nebula', seed: number | null = 42) {
    let sent: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {};
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/prompt')) {
        sent = JSON.parse(String(init?.body)).prompt;
        return jsonResponse({ prompt_id: 'p1' });
      }
      return jsonResponse({
        p1: { status: { completed: true }, outputs: { out: { images: [{ filename: 'a.png' }] } } },
      });
    });
    const client = new ImageClient(CONFIG, fetchImpl as unknown as typeof fetch, null, noSleep);
    await client.generate(prompt, seed);
    return sent;
  }

  it('MANDATORY: batch_size stays 1 — peak VRAM is what protects the game', async () => {
    /*
     * This card runs Elite Dangerous. A batch of three is three times the latents and three times
     * the VAE decode resident at once, for the same total work as three sequential jobs. The only
     * thing a batch changes is the peak, and the peak is what crashes the game.
     */
    const g = await capture();
    expect(g['latent']?.inputs['batch_size']).toBe(1);
  });

  it('MANDATORY: generates at the contract size, not the banner size', async () => {
    const g = await capture();
    expect(g['latent']?.inputs['width']).toBe(IMAGE_GEN_WIDTH);
    expect(g['latent']?.inputs['height']).toBe(IMAGE_GEN_HEIGHT);
  });

  it('MANDATORY: keeps the guidance that suppresses lettering in the artwork', async () => {
    const g = await capture('CMDR GRIM in huge chrome letters');
    expect(String(g['positive']?.inputs['text'])).toContain('no text');
  });

  it('uses the distilled settings schnell is trained for', async () => {
    const g = await capture();
    expect(g['sampler']?.inputs['cfg']).toBe(IMAGE_CFG);
    expect(g['sampler']?.inputs['steps']).toBe(IMAGE_STEPS);
  });

  it('honours a requested seed, so "the same but bluer" reproduces', async () => {
    const g = await capture('bluer', 12345);
    expect(g['sampler']?.inputs['seed']).toBe(12345);
  });

  it('picks a safe-integer seed when none is given', async () => {
    const g = await capture('anything', null);
    const seed = g['sampler']?.inputs['seed'] as number;
    // A seed above 2^53 does not survive JSON, so "reproduce this" would quietly stop working.
    expect(Number.isSafeInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
  });

  it('writes to temp rather than filling the owner’s disk forever', async () => {
    /*
     * SaveImage would leave three PNGs per attempt in `output/` permanently — on somebody's
     * personal machine, with nothing that ever deletes them. Only the chosen one is kept, in our
     * own media store.
     */
    const g = await capture();
    expect(g['out']?.class_type).toBe('PreviewImage');
  });
});

describe('failures that will actually happen', () => {
  it('ComfyUI not running: returns null and logs something actionable', async () => {
    const lines: string[] = [];
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const client = new ImageClient(
      CONFIG,
      fetchImpl as unknown as typeof fetch,
      { emit: (l) => lines.push(l.message) },
      noSleep,
    );

    expect(await client.generate('a nebula', null)).toBeNull();
    expect(lines.join(' ')).toMatch(/is it running/i);
  });

  it('MANDATORY: a finished job with no image stops polling instead of spinning to the timeout', async () => {
    /*
     * This is the out-of-memory case, and the one worth getting right: the job completed, there is
     * no image, and every further poll returns the same answer. Without the finished check the
     * member waits the full three minutes for a failure that was known in two seconds.
     */
    let polls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/prompt')) return jsonResponse({ prompt_id: 'p1' });
      polls += 1;
      return jsonResponse({ p1: { status: { status_str: 'error' }, outputs: {} } });
    });
    const client = new ImageClient(CONFIG, fetchImpl as unknown as typeof fetch, null, noSleep);

    expect(await client.generate('a nebula', null)).toBeNull();
    expect(polls).toBe(1);
  });

  it('keeps polling while the job is still running', async () => {
    let polls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/prompt')) return jsonResponse({ prompt_id: 'p1' });
      polls += 1;
      if (polls < 3) return jsonResponse({}); // not in history yet — still queued
      if (url.includes('/view')) return bytesResponse(new Uint8Array([1, 2, 3]));
      return jsonResponse({
        p1: { status: { completed: true }, outputs: { out: { images: [{ filename: 'a.png' }] } } },
      });
    });
    const client = new ImageClient(CONFIG, fetchImpl as unknown as typeof fetch, null, noSleep);

    const out = await client.generate('a nebula', null);
    expect(out?.png).toEqual(new Uint8Array([1, 2, 3]));
    expect(polls).toBeGreaterThan(1);
  });

  it('a rejected graph is null, not an exception in a member’s request', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'bad node' }, false));
    const client = new ImageClient(CONFIG, fetchImpl as unknown as typeof fetch, null, noSleep);
    expect(await client.generate('a nebula', null)).toBeNull();
  });

  it('health is false when nothing answers, and never throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down');
    });
    const client = new ImageClient(CONFIG, fetchImpl as unknown as typeof fetch, null, noSleep);
    await expect(client.health()).resolves.toMatchObject({ reachable: false });
  });
});

describe('reading ComfyUI’s history', () => {
  it('MANDATORY: defaults the image type to temp, because output would 404', () => {
    // PreviewImage writes to temp/. Guessing `output` gives a 404 on a job that actually succeeded.
    expect(firstImage({ outputs: { n: { images: [{ filename: 'a.png' }] } } })?.type).toBe('temp');
  });

  it('finds the image whichever node produced it', () => {
    const ref = firstImage({
      outputs: { '9': { images: [] }, '12': { images: [{ filename: 'b.png', subfolder: 's' }] } },
    });
    expect(ref?.filename).toBe('b.png');
    expect(ref?.subfolder).toBe('s');
  });

  it('is null when there is nothing to fetch', () => {
    expect(firstImage({})).toBeNull();
    expect(firstImage({ outputs: { n: {} } })).toBeNull();
    expect(firstImage({ outputs: { n: { images: [{ filename: '' }] } } })).toBeNull();
  });

  it('MANDATORY: a history entry existing does not mean the job is done', () => {
    /*
     * ComfyUI creates the entry when the job starts. Treating its presence as completion would make
     * every generation look like it failed with no image.
     */
    expect(isFinished({})).toBe(false);
    expect(isFinished({ outputs: {} })).toBe(false);
    expect(isFinished({ status: {} })).toBe(false);
    expect(isFinished({ status: { completed: true } })).toBe(true);
    expect(isFinished({ status: { status_str: 'error' } })).toBe(true);
  });
});
