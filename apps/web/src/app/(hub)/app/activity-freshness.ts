/**
 * How long since a member was last seen, and when that becomes a problem.
 *
 * ★ WHY THIS IS NOT IN page.tsx ★
 *
 * A Next.js route file may only export a known set of names — `default`,
 * `metadata`, `dynamic` and so on. Exporting a helper from one is a build
 * error, and leaving it unexported makes it untestable. So it lives here, where
 * it can be both.
 *
 * ★ DISCORD, NOT THE WEBSITE ★
 *
 * Squadron owner, 2026-07-29. Somebody can read the site every day without
 * saying a word to anyone, so a sign-in says nothing about whether they are
 * still part of the squadron. The figure comes from `member_activity_months`
 * across EVERY month — scoped to the month on screen it could not describe
 * somebody who has been silent since May.
 */

/** Silent longer than this and the row is flagged. */
export const QUIET_AFTER_DAYS = 90;

/**
 * How long since they last did anything in Discord.
 *
 * Hours below two days, then days — the same shape the roster uses, so an
 * officer comparing the two screens does not have to convert between them.
 */
export function sinceSeen(iso: string, now: number = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  // A clock skewed ahead should not render "-3 hours".
  if (ms < 0) return 'just now';

  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'under an hour';
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;

  return `${Math.floor(ms / 86_400_000)} days`;
}

/**
 * Gone quiet: over ninety days, or never seen at all.
 *
 * ★ NULL IS THE QUIETEST CASE, NOT AN EXEMPTION ★
 *
 * A member with no recorded Discord activity whatsoever is exactly who this
 * column was asked for. Treating null as "not stale" would leave them
 * unflagged — and null is common, because voice occupancy was never
 * backfillable and somebody who only ever sat in a channel has nothing before
 * the bot started.
 */
export function goneQuiet(iso: string | null, now: number = Date.now()): boolean {
  if (iso === null) return true;
  const ms = now - new Date(iso).getTime();
  // An unparseable date is not evidence of silence.
  if (!Number.isFinite(ms)) return false;
  return ms > QUIET_AFTER_DAYS * 86_400_000;
}

/** What the Last Seen cell says, and how it should be coloured. */
export interface LastSeen {
  readonly label: string;
  /**
   * `live`   in voice right now
   * `quiet`  silent past the threshold, or never seen — the red row
   * `normal` everything else
   */
  readonly tone: 'live' | 'quiet' | 'normal';
}

/**
 * The Last Seen cell for one member.
 *
 * ★ IN VOICE BEATS EVERYTHING ELSE ★
 *
 * Squadron owner, 2026-07-29: a member active in Discord voice should say so
 * rather than showing a number of days.
 *
 * They are not merely fresh — they are HERE, and no timestamp can express that.
 * A member who sat in comms all evening without typing showed "3 days", which
 * was literally true of their last message and completely wrong as an answer to
 * "has this person gone quiet". Voice therefore takes precedence over the
 * message-derived figure and over the quiet flag, both of which are about the
 * past.
 *
 * ★ AND IT CANNOT LEAVE A ROW RED ★
 *
 * Somebody in voice is never flagged as gone quiet, even when their last
 * counted message is a year old. Highlighting a member in red while they are
 * sitting in comms is the single most obviously wrong thing this column could
 * do.
 */
export function lastSeen(
  row: { lastSeenAt: string | null; inVoiceSince: string | null },
  now: number = Date.now(),
): LastSeen {
  if (row.inVoiceSince !== null) {
    const ms = now - new Date(row.inVoiceSince).getTime();
    /*
     * How long they have been in, when it is worth saying. Under an hour is
     * just "in voice channel" — "in voice channel (0 hours)" is noise, and the
     * useful signal is the presence, not the duration.
     */
    const hours = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 3_600_000) : 0;
    return {
      label: hours < 1 ? 'in voice channel' : `in voice channel (${hours}h)`,
      tone: 'live',
    };
  }

  if (row.lastSeenAt === null) return { label: 'never seen', tone: 'quiet' };

  return {
    label: sinceSeen(row.lastSeenAt, now),
    tone: goneQuiet(row.lastSeenAt, now) ? 'quiet' : 'normal',
  };
}
