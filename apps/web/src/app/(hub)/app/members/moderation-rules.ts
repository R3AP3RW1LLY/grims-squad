import type { SquadMemberRow } from '../../../../lib/api';

/**
 * What an officer may do to a member, and what the roster says about them.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "we need to create a full on member roster that shows every member in our discord with full
 * administrative tools for them, kick, ban, timeout blah blah blah"
 *
 * ★ WHY THE RULES ARE NOT IN THE COMPONENT ★
 *
 * Three of them are wrong in ways nobody would see: an expired timeout still reading as active, a
 * ban offered against somebody the bot cannot touch, and "kick" and "ban" looking similar enough on
 * a confirm dialog to be pressed interchangeably. Each is a few lines and each needs a test.
 */

export type Action = 'timeout' | 'untimeout' | 'kick' | 'ban' | 'unban';

/**
 * Is this member timed out RIGHT NOW?
 *
 * ★ THE COMPARISON IS AGAINST THE CLOCK, NOT AGAINST NULL ★
 *
 * Discord expires a timeout on its own and sends nothing when it does, so the stored value outlives
 * the timeout it describes. Testing for null would show every member who has ever been timed out as
 * still muted, for ever — a roster that quietly accuses people.
 */
export function isTimedOut(row: SquadMemberRow, now: number = Date.now()): boolean {
  if (row.timeoutUntil === null) return false;
  const until = new Date(row.timeoutUntil).getTime();
  return Number.isFinite(until) && until > now;
}

/** How much of a timeout is left, in whole minutes. Zero when it is not active. */
export function timeoutRemainingMinutes(row: SquadMemberRow, now: number = Date.now()): number {
  if (!isTimedOut(row, now)) return 0;
  return Math.ceil((new Date(row.timeoutUntil ?? '').getTime() - now) / 60_000);
}

/** The name to show, and to put in a confirmation. */
export function displayName(row: SquadMemberRow): string {
  return row.nick ?? row.globalName ?? row.username ?? row.discordId;
}

/** The timeout lengths offered, in minutes. Discord's own ceiling is 28 days. */
export const TIMEOUT_CHOICES: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 5, label: '5 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 60 * 6, label: '6 hours' },
  { minutes: 60 * 24, label: '1 day' },
  { minutes: 60 * 24 * 7, label: '1 week' },
  { minutes: 60 * 24 * 28, label: '28 days (maximum)' },
];

/** How much recent history a ban may delete. */
export const DELETE_CHOICES: ReadonlyArray<{ days: number; label: string }> = [
  // First, and the default. Deleting a week of somebody's messages takes conversations other
  // members were part of with it, and none of it comes back.
  { days: 0, label: 'Keep their messages' },
  { days: 1, label: 'Delete the last 24 hours' },
  { days: 7, label: 'Delete the last 7 days' },
];

export interface ActionOffer {
  readonly action: Action;
  readonly label: string;
  /** Null when the action is available. A sentence when it is not. */
  readonly blockedBecause: string | null;
  /** True for actions that remove somebody. Drives the confirmation. */
  readonly destructive: boolean;
}

/**
 * What can be done to this member, with a reason for anything that cannot.
 *
 * ★ EVERY UNAVAILABLE ACTION IS STILL LISTED ★
 *
 * Hiding a button an officer expects is how a page gets reported as broken. A disabled control that
 * says "their highest Discord role sits at or above the bot's own" sends them to Server Settings;
 * a missing control sends them to us.
 */
export function offersFor(row: SquadMemberRow, now: number = Date.now()): ActionOffer[] {
  const hierarchy = row.moderatable ? null : row.notModeratableBecause;
  const timedOut = isTimedOut(row, now);

  /*
   * A bot cannot be timed out, kicked or banned by another bot in any useful sense, and the ones in
   * this server are integrations somebody pays for. Removing one from here would look like
   * moderation and be an outage.
   */
  const isBot = row.isBot ? 'This is a bot integration, not a member. Manage it in Discord.' : null;

  return [
    {
      action: 'timeout',
      label: 'Timeout',
      blockedBecause: isBot ?? hierarchy ?? (timedOut ? 'They are already timed out.' : null),
      destructive: false,
    },
    {
      action: 'untimeout',
      label: 'Lift timeout',
      blockedBecause: isBot ?? hierarchy ?? (timedOut ? null : 'They are not timed out.'),
      destructive: false,
    },
    {
      action: 'kick',
      label: 'Kick',
      // Removed, but able to come back with a new invite. Not destructive in the sense that
      // matters here — it does not delete anything and it is not permanent.
      blockedBecause: isBot ?? hierarchy,
      destructive: true,
    },
    {
      action: 'ban',
      label: 'Ban',
      blockedBecause: isBot ?? hierarchy,
      destructive: true,
    },
  ];
}

/**
 * The sentence an officer has to agree with before a removal happens.
 *
 * ★ IT NAMES THE PERSON AND SAYS WHAT COMES BACK ★
 *
 * "Are you sure?" is a button people learn to click. The difference between kick and ban is whether
 * somebody can return, and that is the whole decision — so it is the thing the confirmation is
 * about, in the sentence, with the member's name in it.
 */
export function confirmText(action: Action, row: SquadMemberRow, deleteDays = 0): string {
  const who = displayName(row);

  if (action === 'kick') {
    return `Kick ${who} from the Discord server? They can be invited back.`;
  }
  if (action === 'ban') {
    const messages =
      deleteDays > 0
        ? ` Their messages from the last ${deleteDays === 1 ? '24 hours' : `${deleteDays} days`} will be deleted, and that cannot be undone.`
        : '';
    return `Ban ${who}? They will not be able to rejoin unless somebody unbans them.${messages}`;
  }
  return `Apply this to ${who}?`;
}
