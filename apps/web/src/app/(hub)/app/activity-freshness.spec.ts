import { describe, it, expect } from 'vitest';
import {
  sinceSeen,
  goneQuiet,
  lastSeen,
  voicePresenceIsCredible,
  QUIET_AFTER_DAYS,
  VOICE_PRESENCE_TRUSTED_HOURS,
} from './activity-freshness';

/**
 * The "last seen" column on the activity tab.
 *
 * ★ DISCORD, NOT THE WEBSITE ★
 *
 * Squadron owner, 2026-07-29. Somebody can read the site every day without
 * saying a word to anyone, so a sign-in says nothing about whether they are
 * still part of the squadron.
 */
const NOW = new Date('2026-07-29T12:00:00Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const DAY = 86_400_000;

describe('how long since they were seen', () => {
  it('reads in hours for the first two days', () => {
    expect(sinceSeen(ago(3 * 3_600_000), NOW)).toBe('3 hours');
    expect(sinceSeen(ago(1 * 3_600_000), NOW)).toBe('1 hour');
    expect(sinceSeen(ago(47 * 3_600_000), NOW)).toBe('47 hours');
  });

  it('switches to days after that', () => {
    expect(sinceSeen(ago(2 * DAY), NOW)).toBe('2 days');
    expect(sinceSeen(ago(120 * DAY), NOW)).toBe('120 days');
  });

  it('MANDATORY: a clock skewed ahead does not render a negative age', () => {
    // It would otherwise read "-3 hours", which looks like a fault in the site
    // rather than in a clock.
    expect(sinceSeen(new Date(NOW + 3 * 3_600_000).toISOString(), NOW)).toBe('just now');
  });

  it('survives an unparseable value', () => {
    expect(sinceSeen('not a date', NOW)).toBe('');
  });
});

describe('gone quiet', () => {
  it('MANDATORY: flags over ninety days and not under', () => {
    expect(goneQuiet(ago(89 * DAY), NOW)).toBe(false);
    expect(goneQuiet(ago(91 * DAY), NOW)).toBe(true);
    expect(QUIET_AFTER_DAYS).toBe(90);
  });

  it('MANDATORY: NEVER seen counts as quiet', () => {
    /*
     * The quietest case there is, and exactly who the column was asked for.
     * Treating null as "not stale" would leave them unflagged — and null is
     * common, because voice occupancy was never backfillable, so somebody who
     * only ever sat in a channel has nothing recorded before the bot started.
     */
    expect(goneQuiet(null, NOW)).toBe(true);
  });

  it('an unparseable date is not evidence of silence', () => {
    // We do not know, and painting a row red on a parse failure would accuse
    // somebody of being absent on the strength of a bug.
    expect(goneQuiet('not a date', NOW)).toBe(false);
  });

  it('is exclusive at the boundary', () => {
    expect(goneQuiet(ago(QUIET_AFTER_DAYS * DAY), NOW)).toBe(false);
    expect(goneQuiet(ago(QUIET_AFTER_DAYS * DAY + 1), NOW)).toBe(true);
  });
});


/**
 * ★ IN VOICE IS A DIFFERENT KIND OF FACT ★
 *
 * Squadron owner, 2026-07-29: a member active in Discord voice should say so
 * rather than showing a number of days.
 *
 * Every other field on the row is a tally or a timestamp in the past. A member
 * who sat in comms all evening without typing showed "3 days" — true of their
 * last message, and the wrong answer to the question this column exists for.
 */
describe('lastSeen', () => {
  const quietRow = { lastSeenAt: ago(200 * DAY), inVoiceSince: null };

  it('says they are in a voice channel', () => {
    const r = lastSeen({ lastSeenAt: ago(3 * DAY), inVoiceSince: ago(10 * 60_000) }, NOW);
    expect(r.label).toBe('in voice channel');
    expect(r.tone).toBe('live');
  });

  it('adds the hours once there are hours worth mentioning', () => {
    // Under an hour is just "in voice channel" — "(0h)" is noise, and the
    // signal is the presence rather than the duration.
    expect(lastSeen({ lastSeenAt: null, inVoiceSince: ago(59 * 60_000) }, NOW).label).toBe(
      'in voice channel',
    );
    expect(lastSeen({ lastSeenAt: null, inVoiceSince: ago(3 * 3_600_000) }, NOW).label).toBe(
      'in voice channel (3h)',
    );
  });

  /*
   * ★ THE ONE THAT MATTERS ★
   *
   * Highlighting a member red for having gone quiet while they are sitting in
   * comms is the most obviously wrong thing this table could show — and it
   * would be showing it to an officer deciding who has left the squadron.
   */
  it('MANDATORY: somebody in voice is never flagged as gone quiet', () => {
    expect(goneQuiet(quietRow.lastSeenAt, NOW)).toBe(true);
    expect(lastSeen({ ...quietRow, inVoiceSince: ago(60_000) }, NOW).tone).toBe('live');
  });

  it('MANDATORY: somebody in voice with NO recorded activity at all is still live', () => {
    // Voice occupancy was never backfillable, so a member who only ever sits in
    // channels has nothing in `member_activity_months`. They are still present.
    const r = lastSeen({ lastSeenAt: null, inVoiceSince: ago(60_000) }, NOW);
    expect(r.tone).toBe('live');
    expect(r.label).toContain('voice');
  });

  it('falls back to the timestamp when they are not in voice', () => {
    const r = lastSeen({ lastSeenAt: ago(5 * DAY), inVoiceSince: null }, NOW);
    expect(r.label).toBe(sinceSeen(ago(5 * DAY), NOW));
    expect(r.tone).toBe('normal');
  });

  it('flags a genuinely quiet member', () => {
    expect(lastSeen(quietRow, NOW).tone).toBe('quiet');
  });

  it('says "never seen" rather than a blank when nothing was ever recorded', () => {
    const r = lastSeen({ lastSeenAt: null, inVoiceSince: null }, NOW);
    expect(r.label).toBe('never seen');
    expect(r.tone).toBe('quiet');
  });

  it('does not report a negative duration when the clock is skewed', () => {
    // A bot host running ahead of the web host must not produce "(-2h)".
    const r = lastSeen({ lastSeenAt: null, inVoiceSince: ago(-5 * 3_600_000) }, NOW);
    expect(r.label).toBe('in voice channel');
  });
});


/**
 * A voice-presence row the bot never got to clear.
 *
 * ★ ARCH-ADV FINDING AT P1 EXIT ★
 *
 * `in_voice_since` is set on join and cleared on leave. If the bot dies in
 * between, the leave fires into a dead process and is never replayed — so the
 * console showed "in voice channel (37h)" for somebody who went to bed on
 * Tuesday. The bot clears every row at startup, so it self-heals on restart;
 * that is not enough, because a bot down for a day leaves a day of confidently
 * wrong presence, and an officer scanning for who has gone quiet saw the exact
 * opposite of the truth.
 */
describe('stale voice presence', () => {
  const HOUR = 3_600_000;

  it('believes a plausible session', () => {
    expect(voicePresenceIsCredible(ago(3 * HOUR), NOW)).toBe(true);
    expect(voicePresenceIsCredible(ago(VOICE_PRESENCE_TRUSTED_HOURS * HOUR - 1), NOW)).toBe(true);
  });

  it('MANDATORY: stops believing a row the bot died holding', () => {
    expect(voicePresenceIsCredible(ago(VOICE_PRESENCE_TRUSTED_HOURS * HOUR + 1), NOW)).toBe(false);
    expect(voicePresenceIsCredible(ago(37 * HOUR), NOW)).toBe(false);
  });

  it('MANDATORY: a stale row falls back to the message timestamp, not to "present"', () => {
    const r = lastSeen({ lastSeenAt: ago(200 * 86_400_000), inVoiceSince: ago(37 * HOUR) }, NOW);
    expect(r.tone).toBe('quiet');
    expect(r.label).not.toContain('voice');
  });

  it('a stale row on an otherwise active member reads as their last message', () => {
    const r = lastSeen({ lastSeenAt: ago(5 * 86_400_000), inVoiceSince: ago(37 * HOUR) }, NOW);
    expect(r.tone).toBe('normal');
    expect(r.label).toBe(sinceSeen(ago(5 * 86_400_000), NOW));
  });

  it('refuses an unparseable timestamp rather than claiming presence', () => {
    expect(voicePresenceIsCredible('not a date', NOW)).toBe(false);
    expect(lastSeen({ lastSeenAt: null, inVoiceSince: 'not a date' }, NOW).label).toBe('never seen');
  });

  it('tolerates small clock skew but not a wildly wrong clock', () => {
    // A few minutes ahead is ordinary between two hosts.
    expect(voicePresenceIsCredible(ago(-5 * 60_000), NOW)).toBe(true);
    // Days ahead is a broken clock, and must not buy indefinite trust.
    expect(voicePresenceIsCredible(ago(-40 * HOUR), NOW)).toBe(false);
  });
});
