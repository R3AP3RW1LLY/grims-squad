import { describe, it, expect } from 'vitest';
import { readJournalChunk, journalFilesInOrder } from './journal-reader.js';

/**
 * Reading journals on the member's own machine (P1.11).
 *
 * ★ EVERYTHING DROPPED HERE IS DROPPED BEFORE IT LEAVES THE PC ★
 *
 * That ordering is the privacy design. Filtering server-side would mean the
 * data had already been transmitted, and "we promise to discard it" is a much
 * weaker promise than never having received it.
 */

const line = (o: Record<string, unknown>): string => `${JSON.stringify(o)}\n`;

describe('what gets sent', () => {
  it('reads an allowed event', () => {
    const text = line({
      timestamp: '2026-07-27T12:00:00Z',
      event: 'LoadGame',
      Commander: 'GRIM',
      Ship: 'Anaconda',
      Odyssey: true,
    });
    const r = readJournalChunk(text);

    expect(r.events).toHaveLength(1);
    expect(r.events[0]?.name).toBe('LoadGame');
    expect(r.events[0]?.data['Commander']).toBe('GRIM');
  });

  it('MANDATORY: skips everything not on the allowlist', () => {
    /*
     * These are ordinary journal lines. None of them is our business, and none
     * is parsed, buffered or counted.
     *
     * ★ THE ONE FILTER THAT SURVIVED THE OPT-OUT CHANGE (2026-07-29) ★
     *
     * The app no longer filters by category — it sends what it reads and the
     * server applies the member's choices. These four are the exception, and
     * the reason is not squeamishness:
     *
     * They carry the CONTENT of private messages and a friends list. A member
     * can consent to sharing their own data; they cannot consent on behalf of
     * the commander who messaged them. They belong to no category, so nobody
     * could opt in to them, and the server rejects them as unknown — so
     * transmitting them would be risk with no purpose at all.
     *
     * `Died` was among these and was removed on 2026-07-29: it names another
     * commander, but so does `PVPKill`, and a killboard needs both sides of a
     * fight. See NEVER_SENT.
     */
    const text =
      line({ timestamp: '2026-07-27T12:00:00Z', event: 'SendText', Message: 'private message' }) +
      line({ timestamp: '2026-07-27T12:00:01Z', event: 'ReceiveText', From: 'CMDR X' }) +
      line({ timestamp: '2026-07-27T12:00:03Z', event: 'Friends', Name: 'someone' });

    const out = readJournalChunk(text);
    expect(out.events).toEqual([]);
    // And the message body is nowhere in what would be uploaded.
    expect(JSON.stringify(out.events)).not.toContain('private message');
  });

  it('sends the whole event, including the balance it used to strip', () => {
    /*
     * ★ THIS ASSERTION IS THE REVERSE OF WHAT IT WAS ★
     *
     * It used to prove the app stripped Credits from LoadGame before sending.
     * Telemetry is opt-out now (INV-013, amended 2026-07-29): the app sends
     * what it reads and the WEBSITE decides what is kept.
     *
     * The consequence is real and is the price of the change — the balance now
     * leaves the member's machine. What happens to it is a server-side
     * decision, and the settings page names every event and says what each
     * reveals so that decision is an informed one.
     */
    const text = line({
      timestamp: '2026-07-27T12:00:00Z',
      event: 'LoadGame',
      Commander: 'GRIM',
      Credits: 1_204_998_221,
      Loan: 0,
      FID: 'F1234567',
      Odyssey: true,
    });
    const sent = JSON.stringify(readJournalChunk(text).events);

    // The balance and the Frontier account id now travel. What is KEPT is the
    // server's decision, applied from the member's settings.
    expect(sent).toContain('1204998221');
    expect(sent).toContain('GRIM');

    /*
     * The routing fields do NOT travel inside the body: `timestamp` goes up as
     * `occurredAt` and `event` as `name`, so keeping them here would store the
     * same two facts twice under four names.
     */
    const first = readJournalChunk(text).events[0];
    expect(first?.name).toBe('LoadGame');
    expect(Object.keys(first?.data ?? {})).not.toContain('timestamp');
    expect(Object.keys(first?.data ?? {})).not.toContain('event');
  });

  it('MANDATORY: a private message never survives, even mixed among allowed events', () => {
    // The realistic case: chat interleaved with everything else in one file.
    const text =
      line({ timestamp: '2026-07-27T12:00:00Z', event: 'LoadGame', Commander: 'GRIM' }) +
      line({
        timestamp: '2026-07-27T12:00:01Z',
        event: 'ReceiveText',
        From: 'CMDR Someone',
        Message: 'meet me at the usual place',
      }) +
      line({ timestamp: '2026-07-27T12:00:02Z', event: 'Rank', Combat: 7 });

    const r = readJournalChunk(text);
    expect(r.events).toHaveLength(2);
    expect(JSON.stringify(r)).not.toContain('usual place');
  });
});

describe('partial lines', () => {
  it('MANDATORY: does not parse a half-written last line', () => {
    /*
     * The game appends WHILE we read. Parsing a truncated line either fails or,
     * far worse, succeeds against half an object — and we would send it.
     */
    const text =
      line({ timestamp: '2026-07-27T12:00:00Z', event: 'LoadGame', Commander: 'GRIM' }) +
      '{"timestamp":"2026-07-27T12:00:01Z","event":"Ra';

    const r = readJournalChunk(text);
    expect(r.events).toHaveLength(1);
    expect(r.malformed).toBe(0);
  });

  it('re-reads the partial line once it is complete', () => {
    // The offset stops at the last COMPLETE line, so the next pass picks the
    // rest up rather than losing it.
    const first = line({ timestamp: '2026-07-27T12:00:00Z', event: 'LoadGame', Commander: 'GRIM' });
    const r1 = readJournalChunk(first + '{"partial');
    expect(r1.offset).toBe(Buffer.byteLength(first, 'utf8'));

    const rest = line({ timestamp: '2026-07-27T12:00:01Z', event: 'Rank', Combat: 7 });
    expect(readJournalChunk(rest).events).toHaveLength(1);
  });

  it('handles a file with no complete line at all', () => {
    const r = readJournalChunk('{"just started writing');
    expect(r.events).toEqual([]);
    expect(r.offset).toBe(0);
  });

  it('counts malformed JSON rather than throwing', () => {
    // A corrupt line must not stop the whole read — one bad line would
    // otherwise cost the member every event after it.
    const text =
      'not json at all\n' +
      line({ timestamp: '2026-07-27T12:00:00Z', event: 'LoadGame', Commander: 'GRIM' });
    const r = readJournalChunk(text);

    expect(r.malformed).toBe(1);
    expect(r.events).toHaveLength(1);
  });

  it('rejects an event with no timestamp', () => {
    // Without the journal's own timestamp we cannot order or dedupe it, and
    // substituting "now" would attribute an old session to today.
    const r = readJournalChunk(line({ event: 'LoadGame', Commander: 'GRIM' }));
    expect(r.events).toEqual([]);
    expect(r.malformed).toBe(1);
  });
});

describe('file selection', () => {
  it('takes journals in chronological order and ignores everything else', () => {
    const files = journalFilesInOrder([
      'Status.json',
      'Journal.2026-07-27T120000.02.log',
      'Market.json',
      'Journal.2026-07-26T090000.01.log',
      'notes.txt',
    ]);

    expect(files).toEqual([
      'Journal.2026-07-26T090000.01.log',
      'Journal.2026-07-27T120000.02.log',
    ]);
  });
});

describe('Legacy sessions are not mixed with Live', () => {
  const line = (o: Record<string, unknown>) => `${JSON.stringify(o)}
`;
  const header = (gameversion: string) =>
    line({ event: 'Fileheader', timestamp: '2026-07-27T10:00:00Z', gameversion, part: 1 });
  const rank = line({ event: 'Rank', timestamp: '2026-07-27T10:00:01Z', Combat: 7 });

  it('MANDATORY: skips everything in a Legacy (3.8) journal', () => {
    /*
     * Horizons 3.8 was split off in 2022 and its galaxy has diverged ever since.
     * Its squadron ranks and ship locations are all real, and all wrong about
     * the game everybody else is playing — confidently incorrect data rather
     * than merely missing, which is much worse.
     */
    expect(readJournalChunk(header('3.8.0.407') + rank).events).toEqual([]);
  });

  it('MANDATORY: keeps everything in a Live (4.x) journal', () => {
    expect(readJournalChunk(header('4.0.0.1904') + rank).events.map((e) => e.name)).toEqual(['Rank']);
  });

  it('MANDATORY: keeps a Live journal from a member who does NOT own Odyssey', () => {
    /*
     * ★ THE BUG THIS EXISTS TO PREVENT ★
     *
     * `LoadGame.Odyssey` reports whether the player owns the EXPANSION, not
     * which galaxy they are in. A Horizons 4.0 player is on Live and reports
     * `Odyssey: false`.
     *
     * Reading that as a Legacy signal would silently discard everything sent by
     * every member without Odyssey — and the symptom would be those members
     * never qualifying for a promotion, for reasons nobody could see.
     */
    const text =
      header('4.0.0.1904') +
      line({ event: 'LoadGame', timestamp: '2026-07-27T10:00:00Z', Commander: 'GRIM', Odyssey: false }) +
      rank;

    expect(readJournalChunk(text).events.map((e) => e.name)).toEqual(['LoadGame', 'Rank']);
  });

  it('MANDATORY: carries the verdict forward to the NEXT chunk of the same file', () => {
    // Fileheader is the FIRST line. A later chunk contains no clue which galaxy
    // it belongs to, so the caller carries the answer forward — otherwise
    // everything after the first read would be treated as unknown and sent.
    const first = readJournalChunk(header('3.8.0.407'));
    expect(first.sessionIsLive).toBe(false);

    expect(readJournalChunk(rank, 0, first.sessionIsLive).events).toEqual([]);
  });

  it('MANDATORY: the Fileheader itself is never sent', () => {
    // It is read to make a decision and then discarded. It carries no personal
    // data, and storing it would need a consent category for no benefit.
    const r = readJournalChunk(header('4.0.0.1904') + rank);
    expect(r.events.map((e) => e.name)).not.toContain('Fileheader');
  });

  it('treats a pre-Update-14 journal with no gameversion as Live', () => {
    // Those journals pre-date the split, so they WERE Live when written.
    // Refusing them would throw away real history; the milder error is to
    // accept a handful of genuinely old sessions.
    const noVersion = line({ event: 'Fileheader', timestamp: '2019-01-01T00:00:00Z', part: 1 });
    expect(readJournalChunk(noVersion + rank).events.map((e) => e.name)).toEqual(['Rank']);
  });

  it('does NOT skip before a Fileheader has said either way', () => {
    // Refusing everything on the strength of a guess would throw away a whole
    // session because we happened to start reading mid-file.
    expect(readJournalChunk(rank).events.map((e) => e.name)).toEqual(['Rank']);
  });
});
