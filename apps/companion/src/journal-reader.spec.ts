import { describe, it, expect } from 'vitest';
import { readJournalChunk, eventKeyFor, journalFilesInOrder } from './journal-reader.js';

/**
 * Reading journals on the member's own machine (P1.11).
 *
 * ★ EVERYTHING DROPPED HERE IS DROPPED BEFORE IT LEAVES THE PC ★
 *
 * That ordering is the privacy design. Filtering server-side would mean the
 * data had already been transmitted, and "we promise to discard it" is a much
 * weaker promise than never having received it.
 */

const DEVICE = 'device-1';
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
    const r = readJournalChunk(DEVICE, text);

    expect(r.events).toHaveLength(1);
    expect(r.events[0]?.name).toBe('LoadGame');
    expect(r.events[0]?.data['Commander']).toBe('GRIM');
  });

  it('MANDATORY: skips everything not on the allowlist', () => {
    // These are ordinary journal lines. None of them is our business, and none
    // is parsed, buffered or counted.
    const text =
      line({ timestamp: '2026-07-27T12:00:00Z', event: 'SendText', Message: 'private message' }) +
      line({ timestamp: '2026-07-27T12:00:01Z', event: 'Bounty', Reward: 100000 }) +
      line({ timestamp: '2026-07-27T12:00:02Z', event: 'FSDJump', StarSystem: 'Sol' }) +
      line({ timestamp: '2026-07-27T12:00:03Z', event: 'Died', KillerName: 'someone' });

    expect(readJournalChunk(DEVICE, text).events).toEqual([]);
  });

  it('MANDATORY: strips the credit balance from an allowed event', () => {
    // LoadGame carries Credits, Loan and the Frontier account ID alongside the
    // commander name. We need to know they played, not what they are worth.
    const text = line({
      timestamp: '2026-07-27T12:00:00Z',
      event: 'LoadGame',
      Commander: 'GRIM',
      Credits: 1_204_998_221,
      Loan: 0,
      FID: 'F1234567',
      Odyssey: true,
    });
    const sent = JSON.stringify(readJournalChunk(DEVICE, text).events);

    expect(sent).not.toContain('1204998221');
    expect(sent).not.toContain('F1234567');
    expect(sent).toContain('GRIM');
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

    const r = readJournalChunk(DEVICE, text);
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

    const r = readJournalChunk(DEVICE, text);
    expect(r.events).toHaveLength(1);
    expect(r.malformed).toBe(0);
  });

  it('re-reads the partial line once it is complete', () => {
    // The offset stops at the last COMPLETE line, so the next pass picks the
    // rest up rather than losing it.
    const first = line({ timestamp: '2026-07-27T12:00:00Z', event: 'LoadGame', Commander: 'GRIM' });
    const r1 = readJournalChunk(DEVICE, first + '{"partial');
    expect(r1.offset).toBe(Buffer.byteLength(first, 'utf8'));

    const rest = line({ timestamp: '2026-07-27T12:00:01Z', event: 'Rank', Combat: 7 });
    expect(readJournalChunk(DEVICE, rest).events).toHaveLength(1);
  });

  it('handles a file with no complete line at all', () => {
    const r = readJournalChunk(DEVICE, '{"just started writing');
    expect(r.events).toEqual([]);
    expect(r.offset).toBe(0);
  });

  it('counts malformed JSON rather than throwing', () => {
    // A corrupt line must not stop the whole read — one bad line would
    // otherwise cost the member every event after it.
    const text =
      'not json at all\n' +
      line({ timestamp: '2026-07-27T12:00:00Z', event: 'LoadGame', Commander: 'GRIM' });
    const r = readJournalChunk(DEVICE, text);

    expect(r.malformed).toBe(1);
    expect(r.events).toHaveLength(1);
  });

  it('rejects an event with no timestamp', () => {
    // Without the journal's own timestamp we cannot order or dedupe it, and
    // substituting "now" would attribute an old session to today.
    const r = readJournalChunk(DEVICE, line({ event: 'LoadGame', Commander: 'GRIM' }));
    expect(r.events).toEqual([]);
    expect(r.malformed).toBe(1);
  });
});

describe('the idempotency key', () => {
  it('MANDATORY: distinguishes events sharing a timestamp', () => {
    /*
     * Elite's timestamps have WHOLE-SECOND resolution. Handing in eighteen
     * massacre missions emits eighteen events across three timestamps — a key
     * without the payload collapses fifteen into "duplicates" and silently
     * under-counts the exact activity we are measuring (INV-017).
     */
    const at = '2026-07-27T12:00:00Z';
    const a = eventKeyFor(DEVICE, at, 'Rank', { Combat: 7 });
    const b = eventKeyFor(DEVICE, at, 'Rank', { Combat: 8 });
    expect(a).not.toBe(b);
  });

  it('a genuine retry produces the SAME key', () => {
    // Which is the whole point: a crash-and-resend must not double-count.
    const at = '2026-07-27T12:00:00Z';
    expect(eventKeyFor(DEVICE, at, 'Rank', { Combat: 7 })).toBe(
      eventKeyFor(DEVICE, at, 'Rank', { Combat: 7 }),
    );
  });

  it('ignores key ORDER in the payload', () => {
    // Two identical events must hash identically regardless of the order the
    // game emitted the fields in.
    const at = '2026-07-27T12:00:00Z';
    expect(eventKeyFor(DEVICE, at, 'Rank', { Combat: 7, Trade: 4 })).toBe(
      eventKeyFor(DEVICE, at, 'Rank', { Trade: 4, Combat: 7 }),
    );
  });

  it('MANDATORY: differs per device', () => {
    // Two of a member's PCs replaying the same journal are two observations,
    // not one — and one device must not be able to suppress another's events.
    const at = '2026-07-27T12:00:00Z';
    expect(eventKeyFor('device-1', at, 'Rank', { Combat: 7 })).not.toBe(
      eventKeyFor('device-2', at, 'Rank', { Combat: 7 }),
    );
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
