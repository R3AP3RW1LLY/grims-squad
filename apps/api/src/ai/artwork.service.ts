import sharp from 'sharp';
import {
  BANNER_HEIGHT,
  BANNER_WIDTH,
  IMAGE_BATCH_BUDGET_MS,
  IMAGE_OPTIONS,
  IMAGE_RATE_LIMITS,
  MAX_PROMPT_LENGTH,
} from '@grims/shared';
import type { ImageClient } from './image.client.js';
import type { AiLog } from './ai-log.port.js';

/**
 * Generating banner artwork for a member's signature.
 *
 * ★ SQUADRON OWNER, 2026-07-30 ★
 *
 * "add a feature to this page that creates the signature for them or generates 3 options they can
 * choose from etc. also give them a prompt to describe what they want".
 *
 * ★ WHAT THIS PRODUCES, SAID PLAINLY ★
 *
 * A BACKDROP. Not a signature. The commander name, the ranks and the badge are drawn by the
 * signature renderer as real SVG on top of whatever comes out of here — because diffusion models
 * cannot render legible text and never could. See `ssot/04-contracts/ai-image.ts` for the long
 * version; the short version is that this is the sky behind the writing, and the writing stays ours.
 *
 * ★ NOTHING HERE IS STORED UNTIL THE MEMBER CHOOSES ★
 *
 * Three options are returned to the browser as bytes. Two of them are about to be thrown away, and
 * writing all three to the media store would mean two orphans per attempt to garbage-collect later
 * — a background job, a retention policy, and a bug waiting to happen, in exchange for nothing. The
 * one the member picks is uploaded through the ordinary banner path, hardened like any other image.
 */

export interface ArtworkOption {
  /** PNG at BANNER_WIDTH × BANNER_HEIGHT, ready to preview. */
  readonly png: Uint8Array;
  readonly seed: number;
  readonly tookMs: number;
}

export type ArtworkOutcome =
  | { readonly ok: true; readonly options: readonly ArtworkOption[] }
  | { readonly ok: false; readonly reason: 'unconfigured' | 'unavailable' | 'rate-limited' };

/** Counts recent generations, so the limits above can be enforced. */
export abstract class ArtworkQuota {
  /** Generations by this member in the last hour. */
  abstract byMember(userId: string): Promise<number>;
  /** Generations by everybody in the last hour. */
  abstract global(): Promise<number>;
}

export class ArtworkService {
  constructor(
    private readonly images: ImageClient,
    private readonly log: AiLog,
    private readonly quota: ArtworkQuota,
    /** Optional: a unit test of quotas has no interest in the admin log stream. */
    private readonly stream: {
      emit(line: { level: 'info' | 'warn' | 'error'; kind: string; message: string }): void;
    } | null = null,
  ) {}

  /**
   * Generates the member's options.
   *
   * ★ SEQUENTIAL, AND A PARTIAL RESULT IS STILL A RESULT ★
   *
   * The three run one after another — see `ImageClient.generate` for why peak VRAM decides this,
   * not throughput. A consequence worth stating: if the second one fails, the member gets the
   * first rather than an error. Somebody who waited forty seconds should not be handed nothing
   * because the GPU got busy on the last of three.
   */
  async generate(
    prompt: string,
    userId: string,
    seed: number | null = null,
  ): Promise<ArtworkOutcome> {
    if (!this.images.configured) return { ok: false, reason: 'unconfigured' };

    const overLimit = await this.#overLimit(userId);
    if (overLimit !== null) {
      void this.log
        .record({
          userId,
          kind: 'signature',
          surface: 'web',
          prompt: prompt.slice(0, MAX_PROMPT_LENGTH),
          response: null,
          refusedReason: overLimit,
        })
        .catch(() => undefined);
      return { ok: false, reason: 'rate-limited' };
    }

    const options: ArtworkOption[] = [];
    const deadline = Date.now() + IMAGE_BATCH_BUDGET_MS;

    for (let i = 0; i < IMAGE_OPTIONS; i += 1) {
      /*
       * The budget is checked before STARTING an option, never during one. Aborting a generation
       * half way through wastes the GPU time already spent and returns nothing for it; declining to
       * begin a fourth minute of work returns everything that finished.
       *
       * `i > 0` so a slow machine still produces one image rather than an empty success.
       */
      if (i > 0 && Date.now() > deadline) {
        this.#warnBudget(options.length);
        break;
      }

      /*
       * Only the FIRST option honours a requested seed. The whole point of asking for three is that
       * they differ; reusing one seed across all three returns the same image three times, and
       * reusing it for a "make this one bluer" request is exactly what the member wants for the
       * first slot and not for the rest.
       */
      const raw = await this.images.generate(prompt, i === 0 ? seed : null);
      if (raw === null) break;

      options.push({
        png: await toBannerSize(raw.png),
        seed: raw.seed,
        tookMs: raw.tookMs,
      });
    }

    void this.log
      .record({
        userId,
        kind: 'signature',
        surface: 'web',
        prompt: prompt.slice(0, MAX_PROMPT_LENGTH),
        /*
         * The seeds, not the images. The log is for an officer reviewing what the AI was asked to
         * draw — bytes would make it unreadable and unbounded, and a seed plus the prompt is enough
         * to reproduce any of them exactly.
         */
        response: options.length === 0 ? null : `seeds: ${options.map((o) => o.seed).join(', ')}`,
        tookMs: options.reduce((sum, o) => sum + o.tookMs, 0),
      })
      .catch(() => undefined);

    if (options.length === 0) return { ok: false, reason: 'unavailable' };
    return { ok: true, options };
  }

  /**
   * Says out loud that the batch was cut short.
   *
   * A silent truncation reads as "three options were all we could make", and the next person
   * debugging why members only ever get two would have nothing to go on. The stream is where
   * somebody is already looking when the AI feels slow.
   */
  #warnBudget(made: number): void {
    this.stream?.emit({
      level: 'warn',
      kind: 'image',
      message: `Stopped after ${made} of ${IMAGE_OPTIONS} — the batch ran out of time.`,
    });
  }

  /** Which limit was hit, or null. Member first: it is the cheaper query and the likelier trip. */
  async #overLimit(userId: string): Promise<string | null> {
    if ((await this.quota.byMember(userId)) >= IMAGE_RATE_LIMITS.memberPerHour) {
      return `member limit (${IMAGE_RATE_LIMITS.memberPerHour}/hour)`;
    }
    if ((await this.quota.global()) >= IMAGE_RATE_LIMITS.globalPerHour) {
      return `global limit (${IMAGE_RATE_LIMITS.globalPerHour}/hour)`;
    }
    return null;
  }
}

/**
 * Downscales a generated image to the banner size.
 *
 * ★ THIS IS WHERE THE QUALITY COMES FROM ★
 *
 * The model draws at 1200×320 and this halves it to 600×160. Diffusion output is grainy at the
 * pixel level — generating directly at banner size looks soft and speckled — and averaging four
 * pixels into one removes that noise while sharpening every edge. It is the cheapest quality win
 * available, and it is why the generation size is not simply the banner size.
 *
 * `fit: 'fill'` is safe ONLY because the two sizes are exactly 2:1 by construction, so there is
 * nothing to crop and nothing to letterbox. That is a real constraint on those four constants, not
 * a coincidence — `image-size.spec.ts` asserts it, because a generation size that is merely close
 * would stretch every banner by a percent or two, which reviews fine and ships wrong.
 */
export async function toBannerSize(png: Uint8Array): Promise<Uint8Array> {
  const out = await sharp(png)
    .resize({ width: BANNER_WIDTH, height: BANNER_HEIGHT, fit: 'fill', kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return new Uint8Array(out);
}

/**
 * What a member is told when artwork cannot be generated.
 *
 * ★ EACH ONE SAYS WHAT TO DO NEXT ★
 *
 * "Something went wrong" leaves somebody pressing the button again for a minute. These say whether
 * waiting helps, and none of them mention a GPU, a game, or whose machine it is — that is the
 * owner's business, not a status page.
 */
export const ARTWORK_MESSAGES = {
  unconfigured: 'Artwork generation is not switched on yet. Upload your own banner for now.',
  unavailable: 'The artwork generator is busy or offline. Try again in a few minutes.',
  'rate-limited': 'You have generated a lot of artwork this hour. Try again later.',
} as const;
