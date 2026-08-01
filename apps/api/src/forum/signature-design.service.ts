import { Injectable, Inject } from '@nestjs/common';
import {
  backplatePrompt,
  readBrief,
  specFor,
  SIGNATURE_MOODS,
  type BannerSpec,
  type SignatureMood,
} from '@grims/shared';
import { AiClient } from '../ai/ai.client.js';
import { AiLog } from '../ai/ai-log.port.js';

/**
 * Designing five signatures from what a member told us.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "generate signature with GMSD AI which should be a prompt based and Q&A based signature
 * generator ... 5 options to choose from" and "let the AI generate images for the backplate".
 *
 * ★ THE DESIGNS COME BACK IMMEDIATELY. THE ARTWORK FOLLOWS. ★
 *
 * Both were asked for, and doing them in one request would be the wrong reading of it. Image
 * generation runs about fifty seconds an image on the squadron's card — five is four minutes of a
 * member watching a spinner with nothing on screen, and `IMAGE_BATCH_BUDGET_MS` is already 150
 * seconds for three.
 *
 * So this returns five complete, renderable designs in the time the text model takes — a few
 * seconds — each with a gradient backplate and an `imageryPrompt`. The page then asks the EXISTING
 * artwork endpoint for a backplate one option at a time and swaps it in as it lands. The member is
 * choosing between five real signatures within seconds and watching them get better, instead of
 * staring at nothing for four minutes.
 *
 * No artwork call is made here, on purpose: `POST /v1/ai/artwork` already owns the quota, the
 * budget and the member-facing messages, and a second caller would be a second place for those to
 * drift.
 */

/** How many designs to offer. The owner asked for five. */
export const DESIGN_OPTIONS = 5;

/** Bounded — this is free text from a member that reaches the model. */
const MAX_PROMPT = 400;

export interface DesignAnswers {
  /** What they mainly do: mining, combat, exploration, trading, hauling. Free text, bounded. */
  readonly activity: string;
  /** What they fly. */
  readonly ship: string;
  /** Colours or a feeling, in their words. */
  readonly vibe: string;
  /** Anything else. This is the "prompt based" half. */
  readonly prompt: string;
}

export interface DesignOption {
  readonly name: string;
  readonly spec: BannerSpec;
  /** What to send the image generator if the member asks for artwork on this one. */
  readonly imageryPrompt: string;
}

/**
 * The instruction the model answers, for ONE design.
 *
 * ★ ONE AT A TIME, AND THE MEASUREMENT SAYS WHY ★
 *
 * The first version asked for all five in a single reply, with a rule telling it to make them
 * different. Against the real model that produced NOTHING usable — five padded defaults — and a
 * shorter probe of the same request returned exactly one object where five were asked for.
 *
 * A 7B does one small job well and a five-part job badly. So this asks for one design, five times,
 * in parallel — and the variety that the model was being told to provide is now structural: there
 * are exactly five moods and each call is given a different one. "Five variations of orange" is not
 * something the model can produce any more, because it is never choosing the spread.
 */
function promptFor(mood: SignatureMood): string {
  return [
    "You design one forum signature banner for an Elite Dangerous squadron called Grim's Squad.",
    '',
    'Reply with ONE JSON object and nothing else. No prose, no markdown, no code fence.',
    '',
    'Keys:',
    '  name         two or three words naming the look, e.g. "Void Miner"',
    `  mood         must be exactly "${mood}"`,
    '  tagline      a short line in their voice, under 60 characters',
    '  showRank     true or false',
    '  imagery      one sentence describing a space scene, no text in it',
  ].join('\n');
}

@Injectable()
export class SignatureDesignService {
  constructor(
    @Inject(AiClient) private readonly ai: AiClient,
    @Inject(AiLog) private readonly log: AiLog,
  ) {}

  /** Five designs. Empty when the model is unreachable, so the caller can say so plainly. */
  async design(userId: string, answers: DesignAnswers): Promise<DesignOption[]> {
    const startedAt = Date.now();
    const asked = describe(answers);

    /*
     * In parallel. Five sequential nine-second calls is forty-five seconds of blank screen; the
     * runtime serves them concurrently, so the wall clock is roughly one call.
     */
    const replies = await Promise.all(
      SIGNATURE_MOODS.map(async (mood) =>
        this.ai.ask(promptFor(mood), [{ role: 'user', content: asked }]).catch(() => null),
      ),
    );

    const reachable = replies.some((r) => r !== null);
    await this.log
      .record({
        userId,
        /*
         * NOT `signature`: that kind is the artwork quota, and this call draws nothing. Logging it
         * as artwork meant one press of "Design five for me" spent six of a five-an-hour allowance,
         * one of which never touched the GPU.
         */
        kind: 'signature-design',
        surface: 'web',
        prompt: asked.slice(0, MAX_PROMPT),
        response: reachable
          ? replies
              .filter((r) => r !== null)
              .join('\n---\n')
              .slice(0, 2_000)
          : null,
        tookMs: Date.now() - startedAt,
        ...(reachable ? {} : { refusedReason: 'model unreachable' }),
      })
      .catch(() => undefined);

    if (!reachable) return [];

    /*
     * ★ NAMES ARE MADE UNIQUE HERE, NOT ASKED FOR ★
     *
     * Each of the five calls is independent, so the model has no idea what the others named their
     * design — against the real one, all five came back "Void Miner". Correct answers, useless in a
     * chooser where the whole job is telling five cards apart.
     *
     * Telling it to vary the name cannot work: nothing in the request knows the other four. So a
     * repeat takes the mood as a qualifier, which is both unique and descriptive of the actual
     * difference between the two cards.
     */
    const used = new Set<string>();

    return SIGNATURE_MOODS.map((mood, i) => {
      /*
       * A call that failed or came back unparseable falls back to a plain design IN THAT MOOD.
       * The member still gets five distinct options — one weaker one is invisible to them, whereas
       * a grid of four would read as something having gone wrong.
       */
      const parsed = replies[i] === null ? null : parseOne(replies[i] as string);
      // `vibe` and the free prompt are what the palette is chosen from — see `paletteFor`.
      const brief = readBrief({ ...(parsed ?? {}), mood }, i, `${answers.vibe} ${answers.prompt}`);
      const name = used.has(brief.name.toLowerCase())
        ? `${brief.name} · ${mood}`
        : brief.name;
      used.add(brief.name.toLowerCase());

      return {
        name,
        spec: specFor(brief),
        // Their own background description leads; the model's scene varies it per option.
        imageryPrompt: backplatePrompt(brief, answers.prompt),
      };
    });
  }

}

/** What the member told us, as one paragraph for the model. */
function describe(a: DesignAnswers): string {
  const bits = [
    a.activity.trim() === '' ? '' : `They mainly do: ${a.activity.trim()}.`,
    a.ship.trim() === '' ? '' : `They fly: ${a.ship.trim()}.`,
    a.vibe.trim() === '' ? '' : `Colours and feel they want: ${a.vibe.trim()}.`,
    a.prompt.trim() === '' ? '' : `In their own words: ${a.prompt.trim()}`,
  ].filter((s) => s !== '');

  // Something to work from even when every box was left empty — an empty prompt produces five
  // identical defaults, which reads as the feature being broken.
  if (bits.length === 0) return 'No preferences given. Design five varied Elite Dangerous signatures.';
  return bits.join(' ').slice(0, MAX_PROMPT * 2);
}

/**
 * Pulls one object out of whatever the model said.
 *
 * ★ MODELS WRAP JSON IN THINGS ★
 *
 * Asked for an object and nothing else, a 7B still returns a markdown fence, a sentence of
 * preamble, or both — observed against the real model. Refusing those is technically correct and
 * practically means the member presses generate twice and decides the feature is flaky.
 *
 * Also handles an ARRAY containing the object, which is what it returns when it half-remembers an
 * earlier instruction.
 */
export function parseOne(reply: string): Record<string, unknown> | null {
  const opens = [reply.indexOf('{'), reply.indexOf('[')].filter((i) => i !== -1);
  if (opens.length === 0) return null;

  const start = Math.min(...opens);
  const closer = reply[start] === '[' ? ']' : '}';
  const end = reply.lastIndexOf(closer);
  if (end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }

  const one = Array.isArray(parsed) ? parsed[0] : parsed;
  return typeof one === 'object' && one !== null ? (one as Record<string, unknown>) : null;
}
