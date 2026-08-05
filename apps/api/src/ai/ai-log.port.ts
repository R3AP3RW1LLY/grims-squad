/**
 * Recording what the AI was asked and what it said.
 *
 * ★ SQUADRON OWNER, 2026-07-30 ★
 *
 * "Every conversation logged for officer review ... it also need to be visible to the webmaster
 * role! this is non-negotiable as the webmaster is the AI developer."
 *
 * ★ WHY A PORT RATHER THAN A DIRECT WRITE ★
 *
 * The screener runs on the post path, which is the hottest write in the forum. Making it depend on
 * a concrete store would mean every test of posting needs a database — and, worse, a log write
 * failing would be able to fail a post. An interface keeps the dependency one line wide and makes
 * "logging is best-effort" enforceable rather than aspirational.
 */

export interface AiCallRecord {
  /** Null for an anonymous caller on the public recruiting or guides pages. */
  readonly userId: string | null;
  /**
   * `signature` is an ARTWORK generation and counts against the image quota. `signature-design` is
   * the text-model brief behind the AI designer — a few seconds of the language model, no GPU
   * picture — and deliberately does not.
   *
   * `support` is GMSD AI answering the help chat from the help corpus. Its own kind rather than
   * `assistant`, so the assistant review screen (which filters on kind) does not interleave two
   * different products — and its threadId is the SUPPORT CONVERSATION's id, whose transcript is
   * already readable in the console.
   */
  readonly kind: 'screen' | 'assistant' | 'signature' | 'signature-design' | 'support';
  /** `web`, `discord`, or `public`. */
  readonly surface: string;
  readonly prompt: string;
  /** Null when the AI was unreachable — which is itself the thing worth recording. */
  readonly response: string | null;
  /** Set when the call was refused before reaching the model: a rate limit, or being off-scope. */
  readonly refusedReason?: string;
  readonly tookMs?: number;
  /**
   * Groups the turns of one assistant conversation. Null for screening and signature calls.
   *
   * Without it the review screen can only group by member and a time gap, which misreads exactly
   * the cases somebody is reviewing — two unrelated questions close together, or one conversation
   * resumed an hour later.
   */
  readonly threadId?: string | null;
}

export abstract class AiLog {
  abstract record(entry: AiCallRecord): Promise<void>;
}

/**
 * A log that keeps nothing.
 *
 * ★ FOR TESTS, AND SAID OUT LOUD ★
 *
 * Not a default for production. If this were silently wired up in a real deployment, every promise
 * made about officer review would be false while every code path still worked — which is precisely
 * the class of failure this project keeps finding. The module wires the real one; this exists so a
 * unit test of posting does not need a database.
 */
export class NullAiLog extends AiLog {
  async record(): Promise<void> {
    return undefined;
  }
}
