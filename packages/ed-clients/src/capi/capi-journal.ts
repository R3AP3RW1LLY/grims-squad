import { CapiAuthError } from './capi-token.js';

/**
 * A commander's journal, read out of Frontier's Companion API.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "the primary feature must be so that players that are playing on Geforce Now and cloud platforms
 * can use the companion app like everyone else"
 *
 * This is that feature. A commander streaming the game has no filesystem to watch, no folder to
 * point at and no process they are allowed to install — the companion app cannot exist for them.
 * Frontier serves the same journal over HTTP, and it does not care where the game is running, so
 * this endpoint is the ONLY route by which a cloud player contributes anything at all: no jumps,
 * no docks, no colonisation deliveries, no proof they played this month. Every one of those
 * absences is indistinguishable from a member who has quit.
 *
 * ★ THE FILE IS ALIVE WHILE WE ARE READING IT ★
 *
 * `GET /journal/{YYYY}/{MM}/{DD}` returns that day as newline-delimited JSON — one event per line,
 * exactly the format the game writes locally. The CURRENT day is partial and grows, and Frontier
 * regenerates it on a schedule they have never published. So a response can land mid-write and end
 * halfway through a line. That is the ordinary case for any member who is actually flying, which
 * is the only member this exists to serve.
 *
 * Both obvious handlings of that are silent failures:
 *
 *   THROW on it     and every actively-flying member loses their whole day, every poll, for as
 *                    long as they keep playing. The log would show a healthy job doing nothing.
 *   INGEST it       and a truncated payload is stored as an event. Its idempotency hash is
 *                    computed over the truncated data, so it can never match the complete line
 *                    when that arrives — the event is kept forever AND stored a second time.
 *                    That is a double count, and on a `ColonisationContribution` it silently
 *                    inflates a project total the squadron steers by.
 *
 * So a torn final line is DROPPED, REPORTED, and everything before it is returned. There is no
 * third option that is safe.
 *
 * ★ IT FILTERS NOTHING ★
 *
 * Entries come back exactly as Frontier wrote them. The allowlist that decides what may be stored
 * about a member lives in `@grims/shared` (`isAllowedEvent`, `pickAllowedFields`) and is applied
 * once, by the ingest, for every source. A client that quietly pre-filtered would be a second
 * privacy rule in a place nobody looks — and the two would drift.
 *
 * ★ THE FAILURE VOCABULARY IS capi-token's, DELIBERATELY ★
 *
 * A journal call fails the same ways a token call does, and they still mean opposite things: a
 * network blip is worth retrying, a 401 means the grant is dead and retrying is the bug, a 429 is
 * shared across every member at once and means stop the whole run. Reusing `CapiAuthError` means
 * the poller has one vocabulary to reason about instead of two.
 */

export interface JournalEntry {
  /** The journal event name, e.g. `FSDJump`. Never empty. */
  readonly event: string;
  /** Frontier's own timestamp string, kept verbatim for diagnostics. */
  readonly timestamp: string;
  /** The parsed instant. Ordering and half the idempotency key. */
  readonly occurredAt: Date;
  /** The WHOLE line, unfiltered, including `event` and `timestamp`. See the note above. */
  readonly data: Record<string, unknown>;
}

export interface JournalDay {
  /** Complete, usable entries, in the order Frontier wrote them. */
  readonly entries: readonly JournalEntry[];
  /**
   * The final line was torn mid-write and was dropped.
   *
   * EXPECTED on the current day, and not a fault. Surfaced so a caller can tell "the file is being
   * written into right now" — which is a strong signal the commander is flying — apart from "the
   * file was complete".
   */
  readonly partialTail: boolean;
  /**
   * Lines that were not usable and were NOT the tail.
   *
   * Reported separately BECAUSE it is a different thing. A tear in the middle means Frontier
   * regenerated the file under us or sent something malformed, which is worth seeing; the tail is
   * routine. Folding them together would bury the real signal in the noise of normal operation.
   */
  readonly malformed: number;
  /** Frontier had no journal for that day at all. An ordinary answer, not a failure. */
  readonly absent: boolean;
  /** How many bytes we parsed. Lets a caller notice a file that has not grown. */
  readonly bytes: number;
  /** The newest entry's instant, or null for an empty day. */
  readonly newestAt: Date | null;
}

const EMPTY: JournalDay = {
  entries: [],
  partialTail: false,
  malformed: 0,
  absent: true,
  bytes: 0,
  newestAt: null,
};

/**
 * The path for a day, in UTC, zero-padded.
 *
 * ★ BOTH HALVES OF THIS HAVE A SILENT FAILURE BEHIND THEM ★
 *
 * `/journal/2026/8/1` is not `/journal/2026/08/01`; the unpadded one 404s, and a 404 here is a
 * legitimate answer (a day the commander did not play). So the bug would not look like a bug — it
 * would look like a member who never flies.
 *
 * And the day must be UTC. Journal timestamps are UTC and so is Frontier's filing of them. A
 * worker in a timezone behind UTC asking for its LOCAL day would request yesterday's file for the
 * first hours of every day, losing everything written after midnight UTC — the same hours missing
 * every night, looking exactly like a member who stops playing at a fixed time.
 */
export function journalPathFor(day: Date): string {
  const yyyy = day.getUTCFullYear().toString().padStart(4, '0');
  const mm = (day.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = day.getUTCDate().toString().padStart(2, '0');
  return `/journal/${yyyy}/${mm}/${dd}`;
}

/** One line, or null when it cannot be trusted. Never guesses at a missing field. */
function readEntry(raw: string): JournalEntry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  // `null`, `[1,2]` and `"hello"` are all valid JSON and none of them is an event. Reading fields
  // off them would throw somewhere much further downstream, where the cause is far harder to see.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;
  const event = typeof obj['event'] === 'string' ? obj['event'] : '';
  const timestamp = typeof obj['timestamp'] === 'string' ? obj['timestamp'] : '';
  if (event === '' || timestamp === '') return null;

  const occurredAt = new Date(timestamp);
  /*
   * ★ NEVER DEFAULT A MISSING TIMESTAMP TO NOW ★
   *
   * `occurredAt` is half the idempotency key. An entry stamped with the receipt time gets a
   * different key on every poll, so it is stored again every sixty seconds for as long as the
   * member keeps flying — thousands of copies of one event, and every count derived from them
   * wrong, with nothing anywhere reporting a problem.
   */
  if (Number.isNaN(occurredAt.getTime())) return null;

  return { event, timestamp, occurredAt, data: obj };
}

/**
 * Splits a day's body into entries.
 *
 * Exported so the tearing rule can be tested without a network, which is the only way to test it
 * exhaustively — the live endpoint will not tear on demand.
 */
export function parseJournalDay(body: string): JournalDay {
  const entries: JournalEntry[] = [];
  let malformed = 0;
  let partialTail = false;
  let newestAt: Date | null = null;

  /*
   * Split, then find the LAST line that had any content. Only that one may be excused as a tear —
   * a blank line after it is just a trailing newline, which every complete file has.
   */
  const lines = body.split('\n');
  let lastMeaningful = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if ((lines[i] ?? '').trim() !== '') lastMeaningful = i;
  }

  for (let i = 0; i < lines.length; i += 1) {
    // `\r` survives the split on Windows-written files and on some proxies. A stray carriage
    // return makes JSON.parse fail, which would report a healthy file as corrupt.
    const raw = (lines[i] ?? '').trim();
    if (raw === '') continue;

    const entry = readEntry(raw);
    if (entry !== null) {
      entries.push(entry);
      if (newestAt === null || entry.occurredAt.getTime() > newestAt.getTime()) {
        newestAt = entry.occurredAt;
      }
      continue;
    }

    if (i === lastMeaningful) {
      // The tail. Expected on the current day; see the module note. Dropped whole — there is no
      // safe way to salvage part of it.
      partialTail = true;
    } else {
      malformed += 1;
    }
  }

  return { entries, partialTail, malformed, absent: false, bytes: body.length, newestAt };
}

export interface JournalInput {
  readonly apiBase: string;
  readonly accessToken: string;
  /** Which day to read. Interpreted in UTC — see `journalPathFor`. */
  readonly day: Date;
  readonly fetchImpl?: typeof fetch | undefined;
}

/**
 * Fetches and parses one day.
 *
 * ★ WHAT IS AN ERROR AND WHAT IS AN EMPTY DAY ★
 *
 * Most members do not play most days, so 404 is the commonest response there is. Raising it would
 * fill the log with failures from perfectly healthy members and bury the one that matters.
 *
 * A 500 is the opposite and must never be quiet: "Frontier is broken" and "nothing happened today"
 * are indistinguishable downstream — both are "no new entries" — and that is precisely how this
 * platform has already gone on presenting a member's last known state as current while nothing
 * errored.
 */
export async function fetchJournalDay(input: JournalInput): Promise<JournalDay> {
  const url = new URL(journalPathFor(input.day), input.apiBase).toString();

  let res: Response;
  try {
    res = await (input.fetchImpl ?? fetch)(url, {
      headers: { Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json' },
    });
  } catch (e) {
    throw new CapiAuthError('network', `could not reach Frontier: ${(e as Error).message}`);
  }

  if (res.status === 401 || res.status === 403) {
    // The grant is gone. Deliberately the non-retryable kind: a loop around a dead token is a
    // member disconnected in silence, because nothing ever tells them to reauthorise.
    throw new CapiAuthError('invalid_grant', 'Frontier rejected the token', res.status);
  }
  if (res.status === 429) {
    /*
     * Shared across every linked member at once — the limit is per CLIENT ID, not per commander.
     * The caller is expected to abandon the WHOLE run on this, not just this member: marching
     * through the rest of the squadron would spend the exhausted budget proving it is exhausted,
     * and can extend the ban.
     */
    throw new CapiAuthError('rate_limited', 'Frontier is rate limiting us', res.status);
  }
  if (res.status === 404 || res.status === 204) {
    /*
     * 404: no journal for that day. 204: Frontier has the day but is still assembling the file —
     * @unverified against the live API, handled because the alternative (treating no content as
     * malformed) would mark a healthy grant as broken.
     */
    return EMPTY;
  }
  if (!res.ok) {
    throw new CapiAuthError('refused', `Frontier returned http ${res.status}`, res.status);
  }

  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    // A body that dies mid-read is a network failure, not a malformed journal — the difference
    // decides whether the caller retries shortly or gives up on this member.
    throw new CapiAuthError('network', `could not read the journal: ${(e as Error).message}`, res.status);
  }

  return parseJournalDay(text);
}
