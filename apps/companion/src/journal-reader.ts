import {
  isAllowedEvent,
  pickAllowedFields,
  isJournalFile,
  isLiveGameVersion,
  type JournalEventName,
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
  readonly name: JournalEventName;
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
    // NOT on the allowlist: skipped without being parsed further, buffered or
    // counted. This is the line that keeps chat, bounties and everything else
    // on the member's own disk.
    if (typeof name !== 'string' || !isAllowedEvent(name)) continue;

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

    events.push({ name, occurredAt, data: pickAllowedFields(name, raw) });
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
