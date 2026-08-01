import { describe, expect, it } from 'vitest';
import {
  confirmText,
  displayName,
  isTimedOut,
  offersFor,
  timeoutRemainingMinutes,
  TIMEOUT_CHOICES,
  DELETE_CHOICES,
} from './moderation-rules';
import type { SquadMemberRow } from '../../../../lib/api';

const NOW = new Date('2026-08-01T12:00:00Z').getTime();

function row(over: Partial<SquadMemberRow> = {}): SquadMemberRow {
  return {
    discordId: '820808610073280512',
    nick: 'Rablefin',
    username: 'rablefin',
    globalName: null,
    isBot: false,
    roles: ['Cadet'],
    rank: 'Cadet',
    appointment: null,
    joinedAt: '2025-06-25T00:00:00Z',
    timeoutUntil: null,
    inVoiceSince: null,
    lastSeenAt: '2026-07-30T00:00:00Z',
    hasAccount: false,
    handle: null,
    cmdrName: null,
    moderatable: true,
    notModeratableBecause: null,
    ...over,
  };
}

describe('isTimedOut', () => {
  it('MANDATORY: an expired timeout is not a timeout', () => {
    /*
     * Discord expires a timeout on its own and sends nothing when it does, so the stored value
     * outlives what it describes. Testing for null would show everybody who has ever been timed out
     * as still muted — a roster that quietly accuses people, for ever.
     */
    expect(isTimedOut(row({ timeoutUntil: '2026-07-01T00:00:00Z' }), NOW)).toBe(false);
  });

  it('a future timeout is active', () => {
    expect(isTimedOut(row({ timeoutUntil: '2026-08-01T18:00:00Z' }), NOW)).toBe(true);
  });

  it('no timeout at all', () => {
    expect(isTimedOut(row({ timeoutUntil: null }), NOW)).toBe(false);
  });

  it('an unparseable value is not treated as a timeout', () => {
    // Never claim somebody is muted on the strength of a broken value.
    expect(isTimedOut(row({ timeoutUntil: 'not a date' }), NOW)).toBe(false);
  });

  it('reports how long is left, rounded up', () => {
    expect(timeoutRemainingMinutes(row({ timeoutUntil: '2026-08-01T13:30:00Z' }), NOW)).toBe(90);
    expect(timeoutRemainingMinutes(row({ timeoutUntil: '2026-07-01T00:00:00Z' }), NOW)).toBe(0);
  });
});

describe('offersFor', () => {
  it('offers timeout, kick and ban to an ordinary member', () => {
    const offers = offersFor(row(), NOW);
    const open = offers.filter((o) => o.blockedBecause === null).map((o) => o.action);
    expect(open).toEqual(['timeout', 'kick', 'ban']);
  });

  it('MANDATORY: every action stays listed, blocked rather than hidden', () => {
    /*
     * Hiding a control an officer expects is how a page gets reported as broken. A disabled one
     * that explains itself sends them to Server Settings instead of to us.
     */
    const offers = offersFor(row({ moderatable: false, notModeratableBecause: 'They outrank the bot.' }), NOW);
    expect(offers).toHaveLength(4);
    expect(offers.every((o) => o.blockedBecause === 'They outrank the bot.')).toBe(true);
  });

  it('swaps timeout for lift when they are already timed out', () => {
    const timedOut = row({ timeoutUntil: '2026-08-01T18:00:00Z' });
    const offers = offersFor(timedOut, NOW);

    expect(offers.find((o) => o.action === 'timeout')?.blockedBecause).toBe('They are already timed out.');
    expect(offers.find((o) => o.action === 'untimeout')?.blockedBecause).toBeNull();
  });

  it('MANDATORY: bots are not moderated from here', () => {
    // The bots in this server are integrations somebody pays for. Removing one would look like
    // moderation and be an outage.
    const offers = offersFor(row({ isBot: true }), NOW);
    expect(offers.every((o) => o.blockedBecause?.includes('bot integration') === true)).toBe(true);
  });

  it('the hierarchy reason wins over the timeout state', () => {
    // Both are true at once for a timed-out admin; the one an officer can act on is the hierarchy.
    const offers = offersFor(
      row({ moderatable: false, notModeratableBecause: 'They outrank the bot.', timeoutUntil: '2026-08-01T18:00:00Z' }),
      NOW,
    );
    expect(offers.find((o) => o.action === 'untimeout')?.blockedBecause).toBe('They outrank the bot.');
  });
});

describe('confirmText', () => {
  it('MANDATORY: kick and ban say what actually differs', () => {
    /*
     * "Are you sure?" is a button people learn to click. Whether somebody can come back IS the
     * decision, so it is what the sentence is about.
     */
    expect(confirmText('kick', row())).toContain('can be invited back');
    expect(confirmText('ban', row())).toContain('not be able to rejoin');
  });

  it('names the member', () => {
    expect(confirmText('ban', row({ nick: 'Rablefin' }))).toContain('Rablefin');
  });

  it('MANDATORY: message deletion is spelled out, and only when asked for', () => {
    // Deleting a week of somebody's messages takes conversations other members were part of with
    // it. It must never be a silent side effect of the ban button.
    expect(confirmText('ban', row(), 0)).not.toContain('deleted');
    expect(confirmText('ban', row(), 7)).toContain('last 7 days');
    expect(confirmText('ban', row(), 1)).toContain('24 hours');
  });
});

describe('displayName', () => {
  it('prefers the nickname, which is the in-game name here', () => {
    expect(displayName(row({ nick: 'Rablefin', username: 'rab' }))).toBe('Rablefin');
  });

  it('falls back through global name and username to the id', () => {
    expect(displayName(row({ nick: null, globalName: 'Rab', username: 'rab' }))).toBe('Rab');
    expect(displayName(row({ nick: null, globalName: null, username: 'rab' }))).toBe('rab');
    expect(displayName(row({ nick: null, globalName: null, username: null }))).toBe(
      '820808610073280512',
    );
  });
});

describe('the choices offered', () => {
  it('no timeout exceeds Discord’s 28-day ceiling', () => {
    // Discord rejects the whole request above 28 days rather than clamping it.
    expect(Math.max(...TIMEOUT_CHOICES.map((c) => c.minutes))).toBe(28 * 24 * 60);
  });

  it('MANDATORY: keeping messages is the first and default ban option', () => {
    // Deleting history has to be chosen, never arrived at by leaving a dropdown alone.
    expect(DELETE_CHOICES[0]?.days).toBe(0);
  });

  it('no ban deletes more than Discord allows', () => {
    expect(Math.max(...DELETE_CHOICES.map((c) => c.days))).toBeLessThanOrEqual(7);
  });
});
