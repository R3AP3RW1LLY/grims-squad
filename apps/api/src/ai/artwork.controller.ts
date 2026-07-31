import { Body, Controller, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  MAX_PROMPT_LENGTH,
  MAX_SEED,
  PROMPT_EXAMPLES,
} from '@grims/shared';
import { User, type CurrentUser } from '../auth/current-user.js';
import { ArtworkService, ARTWORK_MESSAGES } from './artwork.service.js';

/**
 * Generating banner artwork for the signature builder.
 *
 * ★ NOT GATED ON AI_REVIEW ★
 *
 * `AiController` next door is an officer tool and is gated accordingly. This is a MEMBER feature —
 * anybody signed in may generate artwork for their own signature — so the only requirement is a
 * session. Putting both on one controller would have meant one of the two gates being wrong.
 *
 * ★ BUT IT IS NOT PUBLIC ★
 *
 * Signed in, always. Each request is roughly ninety seconds of somebody's home GPU across three
 * images; an anonymous endpoint that expensive is not a rate-limiting problem to solve, it is a
 * thing not to build. The signature builder is behind a login anyway.
 */

/** One code per outcome — see the throw site for why they are not collapsed. */
const ARTWORK_ERROR_CODES = {
  unconfigured: ErrorCode.AI_DISABLED,
  unavailable: ErrorCode.AI_OFFLINE,
  'rate-limited': ErrorCode.AI_RATE_LIMITED,
} as const;

const GenerateBody = z.object({
  prompt: z.string().max(MAX_PROMPT_LENGTH),
  /*
   * Optional, and bounded to what JSON can carry exactly. A seed above 2^53 arrives as a nearby
   * number and generates a different image, so "the same but bluer" would quietly stop working —
   * refusing it is better than honouring it approximately.
   */
  seed: z.number().int().min(0).max(MAX_SEED).nullish(),
});

interface GeneratedOption {
  /** Base64 PNG at banner size, previewed directly in the builder. */
  readonly png: string;
  readonly seed: number;
  readonly tookMs: number;
}

@Controller('v1/ai/artwork')
export class ArtworkController {
  constructor(@Inject(ArtworkService) private readonly artwork: ArtworkService) {}

  /**
   * Generates the member's options.
   *
   * ★ WHY THE BYTES COME BACK INLINE RATHER THAN AS URLS ★
   *
   * Three banner-sized PNGs are on the order of a hundred kilobytes each. Storing them to hand back
   * three URLs would mean two orphaned objects per attempt — every attempt, for every member —
   * needing a retention job nobody has written. The member picks one and THAT one is uploaded
   * through the ordinary banner path, hardened like any other image.
   *
   * ★ AND WHY THIS RESPONSE IS SLOW ON PURPOSE ★
   *
   * It waits for all three. The alternative is a job id and polling, which is a better design for a
   * queue that might be minutes deep and a worse one here: generation is sequential on a single
   * card, so a job id would poll for exactly as long while adding a state machine and a way for a
   * result to be orphaned. The builder shows a progress state and waits.
   */
  @Post()
  async generate(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
  ): Promise<{ options: GeneratedOption[]; examples: readonly string[] }> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to generate artwork.');
    }

    const parsed = GenerateBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `Describe what you want in ${MAX_PROMPT_LENGTH} characters or fewer.`,
      );
    }

    const outcome = await this.artwork.generate(
      parsed.data.prompt,
      caller.userId,
      parsed.data.seed ?? null,
    );

    if (!outcome.ok) {
      /*
       * Three distinct codes, because the front end acts differently on each: 429 means the button
       * stays disabled for a while, 503/AI_OFFLINE means offer a retry, and 503/AI_DISABLED means
       * hide the generate panel entirely and show the upload path instead. Collapsing them into one
       * code would make "not switched on" and "temporarily busy" indistinguishable to the caller.
       *
       * The messages come from ARTWORK_MESSAGES, which say what to do next and never mention a GPU,
       * a game, or whose machine it is — that is the owner's business, not a status page.
       */
      throw new AppError(ARTWORK_ERROR_CODES[outcome.reason], ARTWORK_MESSAGES[outcome.reason]);
    }

    return {
      options: outcome.options.map((o) => ({
        png: Buffer.from(o.png).toString('base64'),
        seed: o.seed,
        tookMs: o.tookMs,
      })),
      // Returned alongside so the builder's starting-point chips come from the contract, not a
      // second copy in the front end that drifts from it.
      examples: PROMPT_EXAMPLES,
    };
  }
}
