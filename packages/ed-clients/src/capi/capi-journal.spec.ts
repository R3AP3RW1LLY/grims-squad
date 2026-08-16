import { describe, expect, it } from 'vitest';
import { CapiAuthError } from './capi-token.js';
import { fetchJournalDay, journalPathFor, parseJournalDay } from './capi-journal.js';

/**
 * Reading a commander's journal out of Frontier's Companion API.
 *
 * ★ THE FILE IS ALIVE WHILE WE ARE READING IT ★
 *
 * The current day's journal is PARTIAL and grows. Frontier regenerates it on a schedule nobody has
 * published, so a request can land halfway through a write and return a final line that stops in
 * the middle of a string. That is the NORMAL case, not the exceptional one — it will happen to
 * every actively flying member several times an hour.
 *
 * Two wrong answers are available and both are silent:
 *
 *   THROW on the partial line       and the whole day is lost every time a member is mid-session,
 *                                    which is the only time any of this matters.
 *   INGEST the partial line         and a truncated payload is stored as though it were an event,
 *                                    with a hash that will never match the complete one when it
 *                                    arrives — so it is kept forever AND re-stored later, which is
 *                                    a double count nothing reports.
 *
 * So the tail is dropped, said out loud, and the rest of the day is returned. Everything below is
 * that rule, and the failure vocabulary that keeps "Frontier is down" apart from "this member's
 * grant is dead".
 */

/** A complete journal line, as Frontier writes them: newline-delimited JSON, one event per line. */
const line = (timestamp: string, event: string, rest: Record<string, unknown> = {}): string =>
  JSON.stringify({ timestamp, event, ...rest });

const bodyOf = (text: string, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  }) as unknown as Response;

const INPUT = {
  apiBase: 'https://companion.orerve.net',
  accessToken: 'the-access-token',
};

describe('the journal URL', () => {
  it('★ MANDATORY: pads month and day to two digits ★', () => {
    /*
     * `/journal/2026/8/1` is not the same path as `/journal/2026/08/01`, and the wrong one 404s.
     * A 404 is a legitimate answer here — a day the commander did not play — so getting this wrong
     * would not look like a bug. It would look like a member who never flies, forever.
     */
    expect(journalPathFor(new Date('2026-08-01T12:00:00Z'))).toBe('/journal/2026/08/01');
    expect(journalPathFor(new Date('2026-12-25T00:00:00Z'))).toBe('/journal/2026/12/25');
  });

  it('★ MANDATORY: the day is UTC, not the server’s local day ★', () => {
    /*
     * Journal timestamps are UTC and so is Frontier's filing of them. A worker running in a
     * timezone behind UTC would otherwise ask for yesterday's file for the first hours of every
     * day — losing every entry written between midnight UTC and midnight local, every single day,
     * with nothing to see but a member who seems to stop playing at the same hour each night.
     */
    expect(journalPathFor(new Date('2026-08-02T00:30:00Z'))).toBe('/journal/2026/08/02');
    expect(journalPathFor(new Date('2026-08-01T23:30:00Z'))).toBe('/journal/2026/08/01');
  });
});

describe('parsing a day', () => {
  it('reads newline-delimited JSON into entries, in order', () => {
    const day = parseJournalDay(
      [
        line('2026-08-15T10:00:00Z', 'LoadGame', { Commander: 'Grim' }),
        line('2026-08-15T10:05:00Z', 'FSDJump', { StarSystem: 'Deciat' }),
      ].join('\n'),
    );

    expect(day.entries.map((e) => e.event)).toEqual(['LoadGame', 'FSDJump']);
    expect(day.entries[0]?.occurredAt.toISOString()).toBe('2026-08-15T10:00:00.000Z');
    expect(day.entries[1]?.data['StarSystem']).toBe('Deciat');
    expect(day.partialTail).toBe(false);
    expect(day.malformed).toBe(0);
  });

  it('★ MANDATORY: a truncated FINAL line is dropped, flagged, and costs nothing else ★', () => {
    /*
     * THE CASE THIS MODULE EXISTS FOR. Everything before the tear is complete, was written by the
     * game, and is exactly the data a commander on GeForce Now has no other way of giving us.
     * Losing it because the last 40 bytes had not landed yet would mean a member mid-session — the
     * only member anybody cares about — contributes nothing at all.
     */
    const good = line('2026-08-15T10:00:00Z', 'LoadGame');
    const day = parseJournalDay(`${good}\n{"timestamp":"2026-08-15T10:05:00Z","event":"FSDJu`);

    expect(day.entries).toHaveLength(1);
    expect(day.entries[0]?.event).toBe('LoadGame');
    expect(day.partialTail).toBe(true);
    // Not counted as corruption. It is the expected shape of a file being written into.
    expect(day.malformed).toBe(0);
  });

  it('★ MANDATORY: a partial line is never half-ingested ★', () => {
    /*
     * The subtler half of the same rule. A truncated line can still be READ far enough to see an
     * event name, and a parser built out of string searching would happily emit an entry with a
     * payload missing whatever came after the tear. Its hash would differ from the complete line's,
     * so it would be stored now AND stored again when the file finished — the double count that
     * corrupts a colonisation total.
     */
    const day = parseJournalDay(
      '{"timestamp":"2026-08-15T10:05:00Z","event":"ColonisationContribution","Contributions":[{"Name":"steel","Amount":7',
    );

    expect(day.entries).toEqual([]);
    expect(day.partialTail).toBe(true);
  });

  it('a corrupt line in the MIDDLE is counted, not thrown, and the day survives', () => {
    /*
     * Different from the tail and deliberately reported differently. A tear in the middle means
     * Frontier regenerated the file under us or sent us something malformed — worth seeing in a
     * log — but discarding a whole day of a member's flying over one bad line is a far worse
     * answer than skipping it.
     */
    const day = parseJournalDay(
      [
        line('2026-08-15T10:00:00Z', 'LoadGame'),
        '{"timestamp":"2026-08-15T10:01:00Z","eve',
        line('2026-08-15T10:02:00Z', 'Docked'),
      ].join('\n'),
    );

    expect(day.entries.map((e) => e.event)).toEqual(['LoadGame', 'Docked']);
    expect(day.malformed).toBe(1);
    expect(day.partialTail).toBe(false);
  });

  it('tolerates CRLF, blank lines and a trailing newline', () => {
    // All three occur in the wild and none of them is an error. A blank line counted as malformed
    // would make every healthy response look damaged.
    const day = parseJournalDay(
      `${line('2026-08-15T10:00:00Z', 'LoadGame')}\r\n\r\n${line('2026-08-15T10:02:00Z', 'Docked')}\n`,
    );

    expect(day.entries).toHaveLength(2);
    expect(day.malformed).toBe(0);
    expect(day.partialTail).toBe(false);
  });

  it('★ MANDATORY: a line with no usable timestamp is skipped, never stored with an invented one ★', () => {
    /*
     * `occurredAt` is half the idempotency key and the whole of the ordering. Defaulting a missing
     * one to "now" would give the same event a different key on every poll, so it would be stored
     * again every sixty seconds for as long as the member kept flying.
     */
    const day = parseJournalDay(
      [
        '{"event":"LoadGame"}',
        '{"timestamp":"not-a-date","event":"Docked"}',
        line('2026-08-15T10:02:00Z', 'FSDJump'),
      ].join('\n'),
    );

    expect(day.entries.map((e) => e.event)).toEqual(['FSDJump']);
    expect(day.malformed).toBe(2);
  });

  it('a JSON line that is not an object is skipped', () => {
    // `null` and `[1,2]` are valid JSON and are not events. Reading fields off them would throw
    // somewhere further in, where the cause would be much harder to see.
    const day = parseJournalDay(['null', '[1,2]', '"hello"', line('2026-08-15T10:00:00Z', 'LoadGame')].join('\n'));

    expect(day.entries).toHaveLength(1);
    expect(day.malformed).toBe(3);
  });

  it('an empty body is an empty day, not a failure', () => {
    // A commander who has not started the game today. The commonest response there is.
    expect(parseJournalDay('').entries).toEqual([]);
    expect(parseJournalDay('   \n\n').entries).toEqual([]);
    expect(parseJournalDay('').partialTail).toBe(false);
  });

  it('keeps the whole line as the payload, including event and timestamp', () => {
    /*
     * The caller filters. This returns what Frontier said, verbatim, because the allowlist that
     * decides what may be stored lives in @grims/shared and is applied once, by the ingest, for
     * every source. A client that pre-filtered would be a second, quieter allowlist.
     */
    const day = parseJournalDay(line('2026-08-15T10:00:00Z', 'FSDJump', { StarSystem: 'Deciat', Body: 'Deciat A' }));

    expect(day.entries[0]?.data).toEqual({
      timestamp: '2026-08-15T10:00:00Z',
      event: 'FSDJump',
      StarSystem: 'Deciat',
      Body: 'Deciat A',
    });
  });
});

describe('fetching a day', () => {
  it('asks the right URL with a Bearer token', async () => {
    let seen = '';
    let auth = '';
    const fetchImpl = (async (url: string, init?: { headers?: Record<string, string> }) => {
      seen = url;
      auth = init?.headers?.['Authorization'] ?? '';
      return bodyOf(line('2026-08-15T10:00:00Z', 'LoadGame'));
    }) as unknown as typeof fetch;

    await fetchJournalDay({ ...INPUT, day: new Date('2026-08-15T12:00:00Z'), fetchImpl });

    expect(seen).toBe('https://companion.orerve.net/journal/2026/08/15');
    expect(auth).toBe('Bearer the-access-token');
  });

  it('★ MANDATORY: 401 is a DEAD GRANT and is not retryable ★', async () => {
    /*
     * The distinction the whole poller is built on. Retrying a dead grant forever is a member
     * silently disconnected — their page keeps showing what we last knew, nothing errors, and
     * nobody ever tells them to reconnect.
     */
    const fetchImpl = (async () => bodyOf('', 401)) as unknown as typeof fetch;

    const err = await fetchJournalDay({ ...INPUT, day: new Date(), fetchImpl }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CapiAuthError);
    expect((err as CapiAuthError).kind).toBe('invalid_grant');
    expect((err as CapiAuthError).retryable).toBe(false);
  });

  it('★ MANDATORY: 429 is a rate limit, and IS retryable ★', async () => {
    // Shared across every member at once. The caller has to be able to tell this apart to stop the
    // whole run rather than march through the rest of the squadron proving it.
    const fetchImpl = (async () => bodyOf('', 429)) as unknown as typeof fetch;

    const err = await fetchJournalDay({ ...INPUT, day: new Date(), fetchImpl }).catch((e: unknown) => e);

    expect((err as CapiAuthError).kind).toBe('rate_limited');
    expect((err as CapiAuthError).retryable).toBe(true);
  });

  it('★ MANDATORY: 404 is an ordinary empty day, not an error ★', async () => {
    /*
     * Frontier answers 404 for a day the commander did not play, which for most of the squadron is
     * most days. Raising it would mean the log is nothing but errors from healthy members, and the
     * one real failure in it would never be seen.
     */
    const fetchImpl = (async () => bodyOf('', 404)) as unknown as typeof fetch;

    const day = await fetchJournalDay({ ...INPUT, day: new Date(), fetchImpl });

    expect(day.entries).toEqual([]);
    expect(day.absent).toBe(true);
  });

  it('204 while Frontier builds the file is an empty day, not an error', async () => {
    // @unverified against the live API. Documented here because the alternative — treating a
    // no-content response as malformed — would mark a healthy grant as broken.
    const fetchImpl = (async () => bodyOf('', 204)) as unknown as typeof fetch;

    const day = await fetchJournalDay({ ...INPUT, day: new Date(), fetchImpl });

    expect(day.entries).toEqual([]);
    expect(day.absent).toBe(true);
  });

  it('an unreachable Frontier is a NETWORK failure, and is retryable', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;

    const err = await fetchJournalDay({ ...INPUT, day: new Date(), fetchImpl }).catch((e: unknown) => e);

    expect((err as CapiAuthError).kind).toBe('network');
    expect((err as CapiAuthError).retryable).toBe(true);
  });

  it('a 500 is refused rather than mistaken for an empty day', async () => {
    /*
     * The one that must never be silent. An empty day and a broken Frontier look identical to
     * anything downstream — "no new entries" — and that is exactly how a platform goes on
     * presenting a member's last known state as current for a week.
     */
    const fetchImpl = (async () => bodyOf('oh dear', 500)) as unknown as typeof fetch;

    const err = await fetchJournalDay({ ...INPUT, day: new Date(), fetchImpl }).catch((e: unknown) => e);

    expect((err as CapiAuthError).kind).toBe('refused');
  });

  it('reports the newest entry and the byte size, so a caller can tell whether it grew', async () => {
    /*
     * The adaptive cadence needs one bit — did this file change — and both of these answer it
     * without the caller re-reading every entry it already holds.
     */
    const text = [line('2026-08-15T10:00:00Z', 'LoadGame'), line('2026-08-15T10:05:00Z', 'Docked')].join('\n');
    const fetchImpl = (async () => bodyOf(text)) as unknown as typeof fetch;

    const day = await fetchJournalDay({ ...INPUT, day: new Date('2026-08-15T12:00:00Z'), fetchImpl });

    expect(day.newestAt?.toISOString()).toBe('2026-08-15T10:05:00.000Z');
    expect(day.bytes).toBe(text.length);
  });
});
