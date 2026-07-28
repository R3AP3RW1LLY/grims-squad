import { createHash } from 'node:crypto';
import {
  isAllowedEvent,
  pickAllowedFields,
  isJournalFile,
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
  /** Idempotency key — see below. */
  readonly eventKey: string;
}

export interface ReadResult {
  readonly events: ParsedEvent[];
  /** Byte offset to resume from. Persisted so a restart re-reads nothing. */
  readonly offset: number;
  /** Lines that were not valid JSON. Counted, never sent. */
  readonly malformed: number;
}

/**
 * The idempotency key for one event.
 *
 * ★ WHY THE PAYLOAD IS PART OF IT ★
 *
 * Elite's journal timestamps have WHOLE-SECOND resolution. Handing in eighteen
 * massacre missions emits eighteen events sharing three timestamps — so a key
 * of (device, timestamp, eventName) collapses fifteen of them into
 * "duplicates" and silently under-counts the exact activity we are measuring,
 * with nothing visible in any metric.
 *
 * This mirrors the schema comment on TelemetryEvent.eventKey, which was written
 * for this reason long before there was an app to send anything (INV-017,
 * DATA-INTEGRITY B1). A genuine retry has an identical payload and still
 * dedupes correctly.
 */
export function eventKeyFor(
  deviceId: string,
  occurredAt: string,
  name: string,
  data: Record<string, unknown>,
): string {
  // Keys sorted, so two objects with the same content hash the same regardless
  // of the order the game happened to emit them in.
  const canonical = JSON.stringify(data, Object.keys(data).sort());
  return createHash('sha256')
    .update(`${deviceId}|${occurredAt}|${name}|${canonical}`)
    .digest('hex');
}

/**
 * Parses journal text from a byte offset.
 *
 * Journals are newline-delimited JSON, appended to while the game runs. Reading
 * from an offset means a restart does not re-send the whole file — which for a
 * long session is thousands of lines the server would have to dedupe.
 */
export function readJournalChunk(
  deviceId: string,
  text: string,
  startOffset = 0,
): ReadResult {
  const events: ParsedEvent[] = [];
  let malformed = 0;

  /*
   * The last line may be HALF-WRITTEN — the game appends while we read. Parsing
   * it would either fail or, worse, succeed against truncated JSON. So the
   * offset advances only to the end of the last COMPLETE line, and the partial
   * one is re-read next pass when it is whole.
   */
  const lastNewline = text.lastIndexOf('\n');
  if (lastNewline === -1) return { events: [], offset: startOffset, malformed: 0 };

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

    const data = pickAllowedFields(name, raw);
    events.push({
      name,
      occurredAt,
      data,
      eventKey: eventKeyFor(deviceId, occurredAt, name, data),
    });
  }

  return {
    events,
    offset: startOffset + Buffer.byteLength(complete, 'utf8') + 1,
    malformed,
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
