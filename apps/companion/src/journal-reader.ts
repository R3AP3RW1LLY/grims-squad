import {
  isSendable,
  isJournalFile,
  isLiveGameVersion,
} from '@grims/shared';

/**
 * Turning journal files into the handful of events we are allowed to send.
 *
 * ★ THE FILTERING HAPPENS HERE, ON THE MEMBER'S MACHINE ★
 *
 * Everything this module drops is dropped BEFORE it leaves the PC. That
 * ordering is the whole privacy design: filtering on the server would mean the
 * data had already been transmitted, and "we promise to discard it" is a much
 * weaker promise than never having received it.
 *
 * A journal line that is not on the allowlist is not parsed, not buffered, and
 * not counted. It is skipped.
 */

export interface ParsedEvent {
  /**
   * The journal's own event name, whatever it is.
   *
   * ★ A STRING, NOT THE ALLOWLIST UNION (2026-07-29) ★
   *
   * The app no longer decides what is sent, so it cannot type the name as one
   * of twenty-two known events. Frontier adds events with every game update,
   * and a union here would silently drop each new one until somebody edited a
   * TypeScript file — which is exactly the kind of quiet loss the opt-out model
   * exists to avoid.
   */
  readonly name: string;
  /** The journal's own timestamp, not the time we read it. */
  readonly occurredAt: string;
  readonly data: Record<string, unknown>;
}

export interface ReadResult {
  readonly events: ParsedEvent[];
  /** Byte offset to resume from. Persisted so a restart re-reads nothing. */
  readonly offset: number;
  /** Lines that were not valid JSON. Counted, never sent. */
  readonly malformed: number;
  /**
   * Whether this file is the LIVE galaxy, once its Fileheader has said so.
   *
   * `null` until one is seen. The caller carries it forward between chunks of
   * the same file, because Fileheader is the FIRST line and later chunks would
   * otherwise have no idea which galaxy they belong to.
   */
  readonly sessionIsLive: boolean | null;
}

/**
 * Parses journal text from a byte offset.
 *
 * Journals are newline-delimited JSON, appended to while the game runs. Reading
 * from an offset means a restart does not re-send the whole file — which for a
 * long session is thousands of lines the server would have to dedupe.
 */
export function readJournalChunk(
  text: string,
  startOffset = 0,
  sessionIsLive: boolean | null = null,
): ReadResult {
  const events: ParsedEvent[] = [];
  let malformed = 0;
  let live = sessionIsLive;

  /*
   * The last line may be HALF-WRITTEN — the game appends while we read. Parsing
   * it would either fail or, worse, succeed against truncated JSON. So the
   * offset advances only to the end of the last COMPLETE line, and the partial
   * one is re-read next pass when it is whole.
   */
  const lastNewline = text.lastIndexOf('\n');
  if (lastNewline === -1) {
    return { events: [], offset: startOffset, malformed: 0, sessionIsLive };
  }

  const complete = text.slice(0, lastNewline);

  for (const line of complete.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // Counted so a member can be told "your journal has odd lines" rather
      // than the app simply going quiet.
      malformed += 1;
      continue;
    }

    const name = raw['event'];

    /*
     * ★ LEGACY IS A DIFFERENT GALAXY, AND MUST NOT BE MIXED IN ★
     *
     * Read from Fileheader — the first line of every journal — and NEVER sent.
     * It exists here purely to decide whether the rest of the file is worth
     * reading, so it needs no consent category and costs the member nothing.
     *
     * Deliberately not LoadGame.Odyssey, which reports whether the player owns
     * the expansion rather than which galaxy they are in. A Horizons 4.0 player
     * is on Live and reports `Odyssey: false`, so reading that as a Legacy
     * signal would silently discard everything sent by every member without
     * Odyssey — and the symptom would be those members never qualifying for a
     * promotion, for reasons nobody could see.
     */
    if (name === 'Fileheader') {
      live = isLiveGameVersion(raw);
      continue;
    }
    /*
     * ★ THE APP NO LONGER DECIDES WHAT IS SENT (2026-07-29) ★
     *
     * This skipped anything off the allowlist, and `pickAllowedFields` then
     * stripped the rest down to named columns. Both are gone on the squadron
     * owner's instruction: the app sends what it reads, and the WEBSITE is
     * where a member decides what is kept (INV-013, amended).
     *
     * The consequence is real and is written down rather than glossed: a
     * declined event now leaves the member's machine and is discarded by the
     * server. It used to never travel at all. That is the price of having one
     * place that shows a member everything collected and lets them switch any
     * of it off, and it is why the settings page names every event and says
     * what each reveals.
     *
     * Only the SHAPE is still checked — an event needs a name to be routed and
     * a timestamp to be ordered — plus the four events in NEVER_SENT, which
     * carry somebody ELSE'S private words. A member can consent to sharing
     * their own data; they cannot consent on behalf of the commander who
     * messaged them, and the server rejects those events anyway, so sending
     * them would be risk with no purpose.
     */
    if (typeof name !== 'string' || !isSendable(name)) continue;

    const occurredAt = typeof raw['timestamp'] === 'string' ? raw['timestamp'] : null;
    if (occurredAt === null) {
      // Without the journal's own timestamp we cannot order or dedupe it, and
      // substituting "now" would attribute an old session to today.
      malformed += 1;
      continue;
    }

    // Until a Fileheader has said otherwise we do not skip: refusing everything
    // would throw away a whole session on the strength of a guess, and reading
    // may well have started mid-file.
    if (live === false) continue;

    /*
     * The whole event, unaltered. `pickAllowedFields` used to reduce this to a
     * per-event column list and strip money at every depth; the server applies
     * the member's preferences now, and a second, quieter filter here would
     * mean the settings page did not describe what actually happens.
     *
     * `timestamp` is dropped from the body because it travels as `occurredAt` —
     * keeping both would store the same instant twice under two names.
     */
    const { timestamp: _timestamp, event: _event, ...data } = raw;
    events.push({ name, occurredAt, data });
  }

  return {
    events,
    offset: startOffset + Buffer.byteLength(complete, 'utf8') + 1,
    malformed,
    sessionIsLive: live,
  };
}

/**
 * Picks the journal files worth reading, newest last.
 *
 * Filenames sort chronologically because Frontier put the timestamp in them,
 * which is the one convenient thing about the format.
 */
export function journalFilesInOrder(names: readonly string[]): string[] {
  return names.filter(isJournalFile).sort();
}
