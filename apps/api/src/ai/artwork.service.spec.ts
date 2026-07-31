import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import {
  BANNER_HEIGHT,
  BANNER_WIDTH,
  IMAGE_GEN_HEIGHT,
  IMAGE_GEN_WIDTH,
  IMAGE_BATCH_BUDGET_MS,
  IMAGE_OPTIONS,
  IMAGE_RATE_LIMITS,
} from '@grims/shared';
import { ArtworkService, ArtworkQuota, toBannerSize } from './artwork.service.js';
import type { ImageClient, RawImage } from './image.client.js';
import { AiLog, type AiCallRecord } from './ai-log.port.js';

/**
 * Generating banner artwork on a card somebody is playing a game on.
 *
 * ★ THE TWO THINGS THIS SERVICE EXISTS TO GET RIGHT ★
 *
 * Rate limiting, because each generation is roughly thirty seconds of the owner's GPU; and partial
 * results, because a member who waited forty seconds for three images should get the two that
 * worked rather than an error about the third.
 */

class FakeQuota extends ArtworkQuota {
  constructor(
    private member = 0,
    private all = 0,
  ) {
    super();
  }
  async byMember(): Promise<number> {
    return this.member;
  }
  async global(): Promise<number> {
    return this.all;
  }
}

class RecordingLog extends AiLog {
  readonly entries: AiCallRecord[] = [];
  async record(entry: AiCallRecord): Promise<void> {
    this.entries.push(entry);
  }
}

/** A real PNG at generation size, so the resize under test is doing real work. */
async function genSizedPng(): Promise<Uint8Array> {
  const buf = await sharp({
    create: {
      width: IMAGE_GEN_WIDTH,
      height: IMAGE_GEN_HEIGHT,
      channels: 3,
      background: { r: 20, g: 30, b: 60 },
    },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

function fakeClient(
  generate: (prompt: string, seed: number | null) => Promise<RawImage | null>,
  configured = true,
): ImageClient {
  return { configured, generate } as unknown as ImageClient;
}

describe('when generation is not available', () => {
  it('an unconfigured generator says so, and does not pretend to be busy', async () => {
    /*
     * A distinct reason from `unavailable` because the member-facing wording differs: one says
     * "upload your own for now", the other says "try again in a few minutes". Telling somebody to
     * wait for a feature that was never switched on wastes their afternoon.
     */
    const svc = new ArtworkService(
      fakeClient(async () => null, false),
      new RecordingLog(),
      new FakeQuota(),
    );
    expect(await svc.generate('a nebula', 'u1')).toEqual({ ok: false, reason: 'unconfigured' });
  });

  it('every attempt failing reads as unavailable', async () => {
    const svc = new ArtworkService(
      fakeClient(async () => null),
      new RecordingLog(),
      new FakeQuota(),
    );
    expect(await svc.generate('a nebula', 'u1')).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('rate limits', () => {
  it('MANDATORY: a member over their limit never reaches the GPU', async () => {
    const generate = vi.fn(async () => null);
    const svc = new ArtworkService(
      fakeClient(generate),
      new RecordingLog(),
      new FakeQuota(IMAGE_RATE_LIMITS.memberPerHour, 0),
    );

    expect(await svc.generate('a nebula', 'u1')).toEqual({ ok: false, reason: 'rate-limited' });
    // The point of a limit is the work not happening, not the answer being different.
    expect(generate).not.toHaveBeenCalled();
  });

  it('MANDATORY: the global backstop holds even for a member under their own limit', async () => {
    /*
     * One member with quota left must not be able to occupy the machine when the squadron
     * collectively already has. Checking only the per-member limit makes the global one decorative.
     */
    const generate = vi.fn(async () => null);
    const svc = new ArtworkService(
      fakeClient(generate),
      new RecordingLog(),
      new FakeQuota(0, IMAGE_RATE_LIMITS.globalPerHour),
    );

    expect(await svc.generate('a nebula', 'u1')).toEqual({ ok: false, reason: 'rate-limited' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('a refusal is logged with its reason, so an officer can see who is hitting it', async () => {
    const log = new RecordingLog();
    const svc = new ArtworkService(
      fakeClient(async () => null),
      log,
      new FakeQuota(IMAGE_RATE_LIMITS.memberPerHour),
    );

    await svc.generate('a nebula', 'u1');
    await new Promise((r) => setImmediate(r)); // the log write is deliberately not awaited

    expect(log.entries[0]?.kind).toBe('signature');
    expect(log.entries[0]?.refusedReason).toMatch(/member limit/);
  });

  it('one under the limit is allowed through', async () => {
    const png = await genSizedPng();
    const svc = new ArtworkService(
      fakeClient(async () => ({ png, seed: 1, tookMs: 10 })),
      new RecordingLog(),
      new FakeQuota(IMAGE_RATE_LIMITS.memberPerHour - 1, IMAGE_RATE_LIMITS.globalPerHour - 1),
    );
    const out = await svc.generate('a nebula', 'u1');
    expect(out.ok).toBe(true);
  });
});

describe('generating the options', () => {
  it('returns the agreed number of options', async () => {
    const png = await genSizedPng();
    let n = 0;
    const svc = new ArtworkService(
      fakeClient(async () => ({ png, seed: (n += 1), tookMs: 10 })),
      new RecordingLog(),
      new FakeQuota(),
    );

    const out = await svc.generate('a nebula', 'u1');
    expect(out.ok && out.options.length).toBe(IMAGE_OPTIONS);
  });

  it('MANDATORY: a partial result is returned rather than discarded', async () => {
    /*
     * The GPU getting busy on the third of three must not cost the member the first two. They have
     * already waited; handing back an error for work that succeeded is the worst of both.
     */
    const png = await genSizedPng();
    let calls = 0;
    const svc = new ArtworkService(
      fakeClient(async () => {
        calls += 1;
        return calls === 1 ? { png, seed: 7, tookMs: 10 } : null;
      }),
      new RecordingLog(),
      new FakeQuota(),
    );

    const out = await svc.generate('a nebula', 'u1');
    expect(out.ok).toBe(true);
    expect(out.ok && out.options.length).toBe(1);
  });

  it('MANDATORY: stops starting options once the batch budget is gone', async () => {
    /*
     * Measured variance is real: generation was timed at 24–30s typically and once at 66. Three
     * bad ones is a request over three minutes long, which an intermediary may abandon. Returning
     * two banners beats timing out with three in flight.
     */
    const png = await genSizedPng();
    let now = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const svc = new ArtworkService(
        fakeClient(async () => {
          // Strictly MORE than the budget: consuming exactly the budget is not over it, and the
          // check is a `>`. That off-by-one is the whole reason to pin the behaviour in a test.
          now += IMAGE_BATCH_BUDGET_MS + 1;
          return { png, seed: 1, tookMs: IMAGE_BATCH_BUDGET_MS };
        }),
        new RecordingLog(),
        new FakeQuota(),
      );

      const out = await svc.generate('a nebula', 'u1');
      expect(out.ok).toBe(true);
      expect(out.ok && out.options.length).toBe(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('MANDATORY: always produces at least one option, however slow the machine', async () => {
    /*
     * The budget check is skipped for the first option on purpose. Checking it there would let a
     * machine that is merely slow return an empty success — which reads to the caller as "generated
     * nothing, but fine", the worst possible answer.
     */
    const png = await genSizedPng();
    let now = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      now += IMAGE_BATCH_BUDGET_MS * 10; // already over budget before anything starts
      return now;
    });
    try {
      const svc = new ArtworkService(
        fakeClient(async () => ({ png, seed: 1, tookMs: 1 })),
        new RecordingLog(),
        new FakeQuota(),
      );
      const out = await svc.generate('a nebula', 'u1');
      expect(out.ok && out.options.length).toBe(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('says out loud when a batch was cut short', async () => {
    // A silent truncation reads as "three was all it could make", and leaves the next person
    // debugging "why do members only get two" with nothing to go on.
    const png = await genSizedPng();
    let now = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const lines: string[] = [];
    try {
      const svc = new ArtworkService(
        fakeClient(async () => {
          now += IMAGE_BATCH_BUDGET_MS + 1;
          return { png, seed: 1, tookMs: 1 };
        }),
        new RecordingLog(),
        new FakeQuota(),
        { emit: (l) => lines.push(l.message) },
      );
      await svc.generate('a nebula', 'u1');
      expect(lines.join(' ')).toMatch(/ran out of time/i);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('MANDATORY: only the first option honours a requested seed', async () => {
    /*
     * Three options exist so they DIFFER. Passing one seed to all three returns the same image
     * three times — while the first slot honouring it is what makes "this one, but bluer" work.
     */
    const png = await genSizedPng();
    const seeds: Array<number | null> = [];
    const svc = new ArtworkService(
      fakeClient(async (_p, seed) => {
        seeds.push(seed);
        return { png, seed: seed ?? 99, tookMs: 10 };
      }),
      new RecordingLog(),
      new FakeQuota(),
    );

    await svc.generate('a nebula', 'u1', 555);
    expect(seeds[0]).toBe(555);
    expect(seeds.slice(1).every((s) => s === null)).toBe(true);
  });

  it('logs the seeds rather than the images', async () => {
    /*
     * A seed and the prompt reproduce any image exactly. Bytes in the log make the review screen
     * unreadable and the table unbounded, for information nobody reviewing it wants.
     */
    const png = await genSizedPng();
    let n = 100;
    const log = new RecordingLog();
    const svc = new ArtworkService(
      fakeClient(async () => ({ png, seed: (n += 1), tookMs: 10 })),
      log,
      new FakeQuota(),
    );

    await svc.generate('an orange gas giant', 'u1');
    await new Promise((r) => setImmediate(r));

    expect(log.entries[0]?.response).toBe('seeds: 101, 102, 103');
    expect(log.entries[0]?.prompt).toBe('an orange gas giant');
  });
});

describe('downscaling to banner size', () => {
  it('MANDATORY: produces exactly the banner dimensions', async () => {
    const out = await toBannerSize(await genSizedPng());
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(BANNER_WIDTH);
    expect(meta.height).toBe(BANNER_HEIGHT);
  });

  it('every returned option is banner-sized, not generation-sized', async () => {
    /*
     * The browser previews these directly. Returning generation-sized images would work, look
     * fine, and quietly send four times the bytes to every member on a phone.
     */
    const png = await genSizedPng();
    const svc = new ArtworkService(
      fakeClient(async () => ({ png, seed: 1, tookMs: 10 })),
      new RecordingLog(),
      new FakeQuota(),
    );

    const out = await svc.generate('a nebula', 'u1');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    for (const option of out.options) {
      const meta = await sharp(option.png).metadata();
      expect(meta.width).toBe(BANNER_WIDTH);
      expect(meta.height).toBe(BANNER_HEIGHT);
    }
  });

  it('still writes a PNG, so alpha and sharp edges survive', async () => {
    const meta = await sharp(await toBannerSize(await genSizedPng())).metadata();
    expect(meta.format).toBe('png');
  });
});
