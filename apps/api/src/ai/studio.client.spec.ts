import { describe, it, expect, vi } from 'vitest';
import { MAX_INPUT_EDGE, STRUCTURE_STRENGTH, fitInputSize, toValidSize } from '@grims/shared';
import { StudioClient, studioConfigFrom, type StudioConfig } from './studio.client.js';

/**
 * The fan art graphs.
 *
 * ★ WHAT THESE CAN AND CANNOT PROVE ★
 *
 * They prove the graph we SEND is the one intended: the right model per operation, the source image
 * actually referenced, the settings each model needs. They cannot prove ComfyUI accepts it — node
 * and input names live on the far side of an HTTP boundary. `tools/ai-studio-smoke.ts` covers that,
 * and it is not optional: the same gap once let the API ship unable to boot with 1,044 tests green.
 */

const CONFIG: StudioConfig = {
  baseUrl: 'http://127.0.0.1:8188',
  schnell: 'flux1-schnell-Q4_K_S.gguf',
  dev: 'flux1-dev-Q4_K_S.gguf',
  kontext: 'flux1-kontext-dev-Q4_K_M.gguf',
  controlnet: 'flux-controlnet-union-pro-2.safetensors',
  upscaler: '4x-UltraSharp.pth',
  clipT5: 't5xxl_fp8_e4m3fn.safetensors',
  clipL: 'clip_l.safetensors',
  vae: 'ae.safetensors',
};

const noSleep = async (): Promise<void> => undefined;
const SOURCE = new Uint8Array([137, 80, 78, 71]);

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

/** Runs one job against a fake ComfyUI and returns the graph it was sent. */
async function capture(
  req: Parameters<StudioClient['run']>[0],
  opts: { uploadName?: string | null } = {},
): Promise<Graph> {
  let sent: Graph = {};
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/upload/image')) {
      const name = opts.uploadName === undefined ? 'grims-src.png' : opts.uploadName;
      return {
        ok: name !== null,
        json: async () => (name === null ? {} : { name }),
      } as unknown as Response;
    }
    if (url.endsWith('/prompt')) {
      sent = JSON.parse(String(init?.body)).prompt;
      return { ok: true, json: async () => ({ prompt_id: 'p1' }) } as unknown as Response;
    }
    if (url.includes('/view')) {
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as unknown as Response;
    }
    return {
      ok: true,
      json: async () => ({
        p1: { status: { completed: true }, outputs: { out: { images: [{ filename: 'a.png' }] } } },
      }),
    } as unknown as Response;
  });

  await new StudioClient(CONFIG, fetchImpl as unknown as typeof fetch, null, noSleep).run(req);
  return sent;
}

describe('configuration', () => {
  it('MANDATORY: the studio is off unless switched on explicitly', () => {
    /*
     * A base URL alone enables BANNER generation, which needs one model. The studio needs three
     * more on disk, so it has its own switch — otherwise a machine with only schnell installed
     * would offer members four operations and fail three of them at generation time.
     */
    expect(studioConfigFrom({ IMAGE_BASE_URL: 'http://x:8188' })).toBeNull();
    expect(
      studioConfigFrom({ IMAGE_BASE_URL: 'http://x:8188', STUDIO_ENABLED: 'true' }),
    ).not.toBeNull();
  });

  it('an unconfigured studio runs nothing rather than calling a nonexistent host', async () => {
    const fetchSpy = vi.fn();
    const client = new StudioClient(null, fetchSpy as unknown as typeof fetch, null, noSleep);
    expect(client.configured).toBe(false);
    expect(
      await client.run({
        op: 'upscale',
        source: SOURCE,
        width: 100,
        height: 100,
        factor: 2,
      }),
    ).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('the source image', () => {
  it('MANDATORY: the graph refers to the name ComfyUI returned, not the one we sent', async () => {
    /*
     * ComfyUI renames on collision. Two members uploading `screenshot.png` in the same minute would
     * otherwise have one job silently render the other's picture — a data leak dressed as a bug.
     */
    const g = await capture(
      { op: 'restyle', source: SOURCE, width: 1920, height: 1080, prompt: 'x', strength: 0.5, seed: 1 },
      { uploadName: 'screenshot_00042_.png' },
    );
    expect(g['load']?.inputs['image']).toBe('screenshot_00042_.png');
  });

  it('a failed upload abandons the job rather than rendering something unrelated', async () => {
    const g = await capture(
      { op: 'restyle', source: SOURCE, width: 100, height: 100, prompt: 'x', strength: 0.5, seed: 1 },
      { uploadName: null },
    );
    expect(g).toEqual({});
  });
});

describe('restyle keeps the composition', () => {
  it('MANDATORY: starts from the encoded source, not from noise', async () => {
    /*
     * This is the whole operation. Feeding an EmptyLatent here would ignore the member's screenshot
     * entirely and generate an unrelated picture — which is exactly what it would look like.
     */
    const g = await capture({
      op: 'restyle', source: SOURCE, width: 1920, height: 1080, prompt: 'concept art', strength: 0.5, seed: 7,
    });
    expect(g['sampler']?.inputs['latent_image']).toEqual(['encode', 0]);
    expect(g['encode']?.class_type).toBe('VAEEncode');
  });

  it('MANDATORY: passes the chosen strength through as denoise', async () => {
    // The named stops in the UI are meaningless if this does not arrive intact.
    const g = await capture({
      op: 'restyle', source: SOURCE, width: 800, height: 600, prompt: 'x', strength: 0.72, seed: 1,
    });
    expect(g['sampler']?.inputs['denoise']).toBe(0.72);
  });

  it('uses the fast distilled model at its distilled settings', async () => {
    const g = await capture({
      op: 'restyle', source: SOURCE, width: 800, height: 600, prompt: 'x', strength: 0.5, seed: 1,
    });
    expect(g['unet']?.inputs['unet_name']).toBe(CONFIG.schnell);
    expect(g['sampler']?.inputs['cfg']).toBe(1.0);
  });

  it('MANDATORY: scales the source down BEFORE encoding it', async () => {
    /*
     * VAE-encoding a 4K screenshot under --lowvram is minutes of GPU for detail the sampler
     * discards, and on a card running a game it is the allocation most likely to fail outright.
     */
    const g = await capture({
      op: 'restyle', source: SOURCE, width: 3840, height: 2160, prompt: 'x', strength: 0.5, seed: 1,
    });
    expect(g['encode']?.inputs['pixels']).toEqual(['scale', 0]);
    expect(g['scale']?.inputs['width']).toBeLessThanOrEqual(MAX_INPUT_EDGE);
  });

  it('keeps the guidance that stops lettering appearing in the art', async () => {
    const g = await capture({
      op: 'restyle', source: SOURCE, width: 800, height: 600, prompt: 'my name in big letters', strength: 0.5, seed: 1,
    });
    expect(String(g['positive']?.inputs['text'])).toContain('no text');
  });
});

describe('structure keeps the shapes — the operation that solves the ship problem', () => {
  it('MANDATORY: uses dev, because the ControlNet is trained against dev', async () => {
    /*
     * Not a quality preference. Union Pro's conditioning does not land the same way on a distilled
     * model, and pairing it with schnell produces visibly weaker adherence — which reads as "the
     * ControlNet does not work" rather than "the wrong base model".
     */
    const g = await capture({
      op: 'structure', source: SOURCE, width: 1920, height: 1080, prompt: 'concept art', mode: 'depth', seed: 1,
    });
    expect(g['unet']?.inputs['unet_name']).toBe(CONFIG.dev);
  });

  it('MANDATORY: dev gets real guidance, not schnell’s 1.0', async () => {
    // dev is NOT guidance-distilled. At 1.0 it produces washed-out output that reads as a broken
    // model rather than a misconfigured one.
    const g = await capture({
      op: 'structure', source: SOURCE, width: 800, height: 600, prompt: 'x', mode: 'depth', seed: 1,
    });
    expect(g['guided']?.class_type).toBe('FluxGuidance');
    expect(g['guided']?.inputs['guidance']).toBeGreaterThan(1);
  });

  it('MANDATORY: the control hint comes from the member’s screenshot', async () => {
    // If the hint were built from anything else, the ship would not be theirs — which is the entire
    // reason this operation exists.
    const g = await capture({
      op: 'structure', source: SOURCE, width: 800, height: 600, prompt: 'x', mode: 'depth', seed: 1,
    });
    expect(g['hint']?.inputs['image']).toEqual(['scale', 0]);
    expect(g['control']?.inputs['image']).toEqual(['hint', 0]);
  });

  it('depth for ships, edges for flat subjects', async () => {
    const depth = await capture({
      op: 'structure', source: SOURCE, width: 800, height: 600, prompt: 'x', mode: 'depth', seed: 1,
    });
    const edges = await capture({
      op: 'structure', source: SOURCE, width: 800, height: 600, prompt: 'x', mode: 'edges', seed: 1,
    });
    expect(depth['hint']?.class_type).toMatch(/Depth/);
    expect(edges['hint']?.class_type).toBe('Canny');
  });

  it('does not hold the control all the way to the end', async () => {
    /*
     * Holding to 100% fights the model during the final detail steps and leaves a faint ghost of
     * the depth map in the output. Releasing early keeps the composition and lets it finish clean.
     */
    const g = await capture({
      op: 'structure', source: SOURCE, width: 800, height: 600, prompt: 'x', mode: 'depth', seed: 1,
    });
    expect(g['control']?.inputs['end_percent']).toBeLessThan(1);
    expect(g['control']?.inputs['strength']).toBe(STRUCTURE_STRENGTH);
  });
});

describe('instruct edits in words', () => {
  it('MANDATORY: supplies the source as reference conditioning — that is what makes it an edit', async () => {
    const g = await capture({
      op: 'instruct', source: SOURCE, width: 1920, height: 1080, instruction: 'make it sunset', seed: 1,
    });
    expect(g['reference']?.class_type).toBe('ReferenceLatent');
    expect(g['reference']?.inputs['latent']).toEqual(['encode', 0]);
  });

  it('MANDATORY: does NOT append art guidance to an instruction', async () => {
    /*
     * "no text, no watermark" is right for a restyle and contradictory here: the member asked the
     * editing model to change one thing, and bolting on unrelated negatives muddies the request.
     */
    const g = await capture({
      op: 'instruct', source: SOURCE, width: 800, height: 600, instruction: 'make it sunset', seed: 1,
    });
    expect(g['instruction']?.inputs['text']).toBe('make it sunset');
  });

  it('uses Kontext’s own scaler, which snaps to the buckets it was trained on', async () => {
    // An arbitrary size degrades the edit noticeably — and looks like a bad model rather than an
    // off-grid input.
    const g = await capture({
      op: 'instruct', source: SOURCE, width: 1234, height: 567, instruction: 'x', seed: 1,
    });
    expect(g['scale']?.class_type).toBe('FluxKontextImageScale');
  });

  it('loads the instruction-editing model, not a generator', async () => {
    const g = await capture({
      op: 'instruct', source: SOURCE, width: 800, height: 600, instruction: 'x', seed: 1,
    });
    expect(g['unet']?.inputs['unet_name']).toBe(CONFIG.kontext);
  });
});

describe('upscale invents nothing', () => {
  it('MANDATORY: runs no diffusion model at all', async () => {
    /*
     * If a sampler appeared here the operation would start changing the picture, which is the one
     * thing somebody choosing "upscale" has explicitly not asked for.
     */
    const g = await capture({ op: 'upscale', source: SOURCE, width: 800, height: 600, factor: 4 });
    expect(Object.values(g).some((n) => n.class_type === 'KSampler')).toBe(false);
    expect(g['up']?.class_type).toBe('ImageUpscaleWithModel');
  });

  it('2x is the 4x model followed by a downscale', async () => {
    // Sharper than a native 2x pass: the detail the big model recovers survives the reduction.
    const g = await capture({ op: 'upscale', source: SOURCE, width: 800, height: 600, factor: 2 });
    expect(g['down']?.inputs['width']).toBe(1600);
    expect(g['down']?.inputs['height']).toBe(1200);
    expect(g['out']?.inputs['images']).toEqual(['down', 0]);
  });

  it('4x returns the model output directly', async () => {
    const g = await capture({ op: 'upscale', source: SOURCE, width: 800, height: 600, factor: 4 });
    expect(g['out']?.inputs['images']).toEqual(['up', 0]);
    expect(g['down']).toBeUndefined();
  });
});

describe('input sizing', () => {
  it('MANDATORY: every size handed to FLUX is on its grid', () => {
    /*
     * FLUX downscales by 8 then patches by 2. An off-grid size is silently rounded, so the result
     * comes back a slightly different shape to the source — which for a restyle means it no longer
     * lines up with the picture the member is comparing it against.
     */
    for (const [w, h] of [
      [1920, 1080],
      [3840, 2160],
      [1234, 567],
      [800, 600],
      [17, 9],
    ]) {
      const out = fitInputSize(w!, h!);
      expect(out.width % 16).toBe(0);
      expect(out.height % 16).toBe(0);
      expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(MAX_INPUT_EDGE);
    }
  });

  it('never enlarges a small source', () => {
    // Upscaling before generating spends GPU time on pixels the source never had. That is what the
    // upscale operation is for, deliberately as a separate step.
    const out = fitInputSize(640, 480);
    expect(out.width).toBeLessThanOrEqual(640 + 16);
  });

  it('keeps the aspect ratio close', () => {
    const out = fitInputSize(3840, 2160);
    expect(out.width / out.height).toBeCloseTo(16 / 9, 1);
  });

  it('never rounds a dimension to zero', () => {
    // A 4px-tall input rounding to 0 would produce a graph ComfyUI rejects with an opaque error.
    expect(toValidSize(4)).toBeGreaterThan(0);
    expect(toValidSize(0)).toBeGreaterThan(0);
  });
});
