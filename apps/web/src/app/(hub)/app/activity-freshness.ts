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
