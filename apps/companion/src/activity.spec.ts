import { EMPTY_PROSPECTING } from './prospector.js';
import { EMPTY_REFINING } from './refinery.js';
import { EMPTY_BGS } from './bgs-session.js';
import { describe, expect, it } from 'vitest';
import { ACTIVITY_MAX, append, bytes, gameLine, linesFor, pairingLine } from './activity.js';
import type { WatchOutcome } from './watcher.js';

/**
 * The feature is the FILTER, not the list.
 *
 * A log that records every pass looks identical in a screenshot and is useless in use: the watcher
 * runs every twenty seconds, Elite writes nothing during most of them, and three useful lines an
 * hour would sit under a hundred and seventy saying nothing happened.
 */

const QUIET: WatchOutcome = {
  // Not docked: these cases are about which lines get logged, not about where the ship is.
  dockedAt: null,
  // An empty trip, for the same reason — the activity log says nothing about money.
  trip: { lots: {}, lastSale: null, since: 'start' },
  // And an empty carrier hold: the log has no carrier lines either.
  carrierHold: { carrier: null, hold: {}, dockedCarrierId: null, totalTonnes: null, totalAt: null },
  prospecting: EMPTY_PROSPECTING,
  refining: EMPTY_REFINING,
  // No influence moved: the activity log has no BGS lines either.
  bgs: EMPTY_BGS,
  gameRunning: false,
  filesRead: 0,
  newFilesRead: 0,
  txBytes: 0,
  rxBytes: 0,
  sent: 0,
  duplicates: 0,
  refused: {},
  unauthorised: false,
  error: null,
};

const AT = 1_754_000_000_000;

describe('linesFor', () => {
  it('MANDATORY: says nothing about a pass where nothing happened', () => {
    expect(linesFor(QUIET, AT)).toEqual([]);
  });

  it('reports a send, with where it came from and what it cost', () => {
    const lines = linesFor({ ...QUIET, sent: 42, filesRead: 1, txBytes: 4_300 }, AT);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('42 events from your journal · 4.2 KB sent');
  });

  it('pluralises the journals it read', () => {
    const lines = linesFor({ ...QUIET, sent: 9, filesRead: 3, txBytes: 900 }, AT);
    expect(lines[0]?.text).toContain('from 3 journals');
  });

  it('MANDATORY: stays quiet about duplicates when real events went too', () => {
    /*
     * The app re-reads the tail of a growing file every pass, so a few already-seen events is the
     * normal healthy case. Reported beside a real send it is noise; reported alone it answers "why
     * is the counter not moving".
     */
    const withSend = linesFor({ ...QUIET, sent: 5, duplicates: 30, filesRead: 1 }, AT);
    expect(withSend.some((l) => l.text.includes('already had'))).toBe(false);

    const alone = linesFor({ ...QUIET, duplicates: 30 }, AT);
    expect(alone[0]?.text).toBe('30 events the squadron already had');
  });

  it('names what was discarded and why, as a warning', () => {
    const lines = linesFor({ ...QUIET, refused: { combat: 4, exploration: 2 } }, AT);
    expect(lines[0]?.level).toBe('warn');
    expect(lines[0]?.text).toContain('combat (4)');
    expect(lines[0]?.text).toContain('exploration (2)');
  });

  it('MANDATORY: puts a failure first, even on a pass that also sent', () => {
    // A partial upload is both. The error is why somebody opened the panel, so it goes on top.
    const lines = linesFor({ ...QUIET, sent: 10, filesRead: 1, error: 'ETIMEDOUT' }, AT);
    expect(lines[0]?.level).toBe('error');
    expect(lines[0]?.text).toContain('ETIMEDOUT');
    expect(lines[1]?.text).toContain('10 events');
  });

  it('says plainly when the device has been disconnected', () => {
    const lines = linesFor({ ...QUIET, unauthorised: true }, AT);
    expect(lines[0]?.level).toBe('error');
    expect(lines[0]?.text).toContain('Sign in again');
  });

  it('does not report reading the same growing file over and over', () => {
    // filesRead counts the current journal on every pass; only newFilesRead is news.
    expect(linesFor({ ...QUIET, filesRead: 1 }, AT)).toEqual([]);
    expect(linesFor({ ...QUIET, filesRead: 1, newFilesRead: 1 }, AT)[0]?.text).toContain(
      '1 new journal picked up',
    );
  });
});

describe('gameLine', () => {
  it('MANDATORY: reports the transition, never the state', () => {
    /*
     * `gameRunning` is a boolean on every pass. Logging its value would produce three lines a
     * minute for as long as somebody plays.
     */
    expect(gameLine(false, false, AT)).toBeNull();
    expect(gameLine(true, true, AT)).toBeNull();
    expect(gameLine(false, true, AT)?.text).toContain('is running');
    expect(gameLine(true, false, AT)?.text).toContain('closed');
  });
});

describe('append', () => {
  it('keeps the newest and drops the oldest', () => {
    const many = Array.from({ length: ACTIVITY_MAX + 50 }, (_, i) => ({
      at: AT + i,
      level: 'info' as const,
      text: `line ${i}`,
    }));
    const out = append([], many);
    expect(out).toHaveLength(ACTIVITY_MAX);
    expect(out[out.length - 1]?.text).toBe(`line ${ACTIVITY_MAX + 49}`);
  });

  it('returns the same log untouched when there is nothing to add', () => {
    // A quiet pass must not churn the array — the renderer re-draws on identity change.
    const log = [{ at: AT, level: 'info' as const, text: 'x' }];
    expect(append(log, [])).toBe(log);
  });
});

describe('bytes', () => {
  it('reads the way people say sizes', () => {
    expect(bytes(0)).toBe('0 B');
    expect(bytes(900)).toBe('900 B');
    expect(bytes(4_300)).toBe('4.2 KB');
    expect(bytes(15_000_000)).toBe('14 MB');
  });
});

/**
 * A log that never takes anything back is a log that lies.
 *
 * ★ REPORTED 2026-08-04 ★
 *
 * "even after unpairing and repairing the app to the web portal it still says this device is no
 * longer connected."
 *
 * It did, and the device was connected the whole time — the token checked in four minutes after it
 * was minted. One refusal wrote a line, the buffer only ever grew, and a quiet pass deliberately
 * writes nothing, so on an evening with the game closed that line could stay newest for days.
 */
describe('recovering from a refusal', () => {
  const REFUSED: WatchOutcome = { ...QUIET, unauthorised: true };

  it('says so when a good pass follows a refused one', () => {
    const lines = linesFor(QUIET, AT, true);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe('info');
    expect(lines[0]?.text).toContain('Reconnected');
  });

  it('says it only on the transition, not on every quiet pass afterwards', () => {
    /*
     * The whole module exists to keep a quiet pass silent. A "still fine" line every twenty seconds
     * would bury the errors it sits beside — which is the failure this log was built to avoid.
     */
    expect(linesFor(QUIET, AT, false)).toEqual([]);
  });

  it('does not claim recovery on a pass that is still refused', () => {
    const lines = linesFor(REFUSED, AT, true);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe('error');
  });

  it('does not claim recovery while some other failure is happening', () => {
    // Reachability and authorisation are different problems. A device that is still paired but
    // cannot reach the hub has not "reconnected", and saying so would be the same lie inverted.
    const lines = linesFor({ ...QUIET, error: 'network down' }, AT, true);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe('error');
    expect(lines[0]?.text).toContain('Could not reach');
  });
});

describe('pairing writes its own line', () => {
  it('marks a device connected', () => {
    expect(pairingLine('paired', AT).text).toContain('connected');
    expect(pairingLine('paired', AT).level).toBe('info');
  });

  it('warns that unpairing here does NOT revoke the token', () => {
    /*
     * The surprise worth naming. `unpair` forgets the token locally and deliberately does not
     * revoke it server-side — the usual reason to unpair is that it is already dead, and revoking
     * needs a valid token. A member who thinks they have withdrawn access has not.
     */
    const line = pairingLine('unpaired', AT);
    expect(line.text).toContain('revoke');
    expect(line.text).toContain('website');
  });
});
