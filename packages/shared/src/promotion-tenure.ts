/**
 * How long somebody has actually been in the squadron's Discord, and whether it is long enough.
 *
 * ★ SQUADRON OWNER, 2026-08-11 ★
 *
 * "for the initial promotion from cadet to sargeant, the member needs to be in the discord server
 * for 1 calender month ... then add this as a requirement for all other ranks"
 *
 * ★ WHY THIS IS A SEPARATE TEST FROM ACTIVITY ★
 *
 * The ladder already counts QUALIFYING MONTHS — months in which somebody talked and played. That
 * measures participation and says nothing about belonging: a member who joins on the 28th, talks
 * for three days and plays can bank a qualifying month while having been in the server less than a
 * week.
 *
 * Tenure is the other half. Both must hold, and they answer different questions — "have they taken
 * part" and "have they been here long enough for that to mean anything".
 *
 * ★ SAME DAY NEXT MONTH, WHICH IS HOW PEOPLE SAY IT ★
 *
 * The owner's choice. Joined 16 July, eligible 16 August. Not 30 days, which drifts against the
 * calendar, and not "a whole calendar month must elapse", which would make somebody who joined on
 * the 2nd wait nearly two.
 *
 * The awkward case is a day that does not exist in the target month — 31 January plus one month.
 * That clamps to the last day of the month (28 or 29 February) rather than rolling into March,
 * because rolling forward would quietly add three days to the requirement for anybody who joined at
 * the end of a long month.
 */

/** The last day of the month `date` lands in, in UTC. */
function daysInMonth(year: number, monthIndex: number): number {
  // Day 0 of the NEXT month is the last day of this one.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * `joinedAt` advanced by `months` calendar months, clamped to a real date.
 *
 * UTC throughout. A member who joined at 23:40 local on the 15th must not become eligible a day
 * early or late depending on which side of Greenwich the server happens to be — the same reasoning
 * the activity rollup already uses for month boundaries.
 */
export function tenureReachedAt(joinedAt: Date, months: number): Date {
  const y = joinedAt.getUTCFullYear();
  const m = joinedAt.getUTCMonth();
  const d = joinedAt.getUTCDate();

  const targetMonth = m + months;
  const targetYear = y + Math.floor(targetMonth / 12);
  const normalisedMonth = ((targetMonth % 12) + 12) % 12;

  // 31 January + 1 month is 28 (or 29) February, not 3 March. Rolling over would silently add days
  // to the requirement for anybody who joined at the end of a long month.
  const day = Math.min(d, daysInMonth(targetYear, normalisedMonth));

  return new Date(
    Date.UTC(
      targetYear,
      normalisedMonth,
      day,
      joinedAt.getUTCHours(),
      joinedAt.getUTCMinutes(),
      joinedAt.getUTCSeconds(),
      joinedAt.getUTCMilliseconds(),
    ),
  );
}

export interface TenureVerdict {
  readonly met: boolean;
  /** When they become eligible. Null when we have no join date to reason from. */
  readonly eligibleAt: Date | null;
  /** A sentence for the skipped list. Empty when the requirement is met. */
  readonly reason: string;
}

/**
 * Whether somebody has been in the server long enough for this rung.
 *
 * ★ NO JOIN DATE BLOCKS, AND SAYS SO ★
 *
 * The owner's choice, and the right one: a promotion granted on an unknown is one nobody can
 * defend afterwards. It refuses loudly enough for an officer to go and fix the record, rather than
 * failing open and making the rule unenforceable for exactly the people it cannot see.
 *
 * That is deliberately the opposite of the game-activity check, which counts `assumed` — there,
 * failing open costs a member a month they earned; here, failing open grants a rank they did not.
 */
export function tenureMet(
  joinedAt: Date | null,
  monthsRequired: number,
  now: Date,
): TenureVerdict {
  if (monthsRequired <= 0) return { met: true, eligibleAt: null, reason: '' };

  if (joinedAt === null) {
    return {
      met: false,
      eligibleAt: null,
      reason:
        'No Discord join date on record, so time in the server cannot be checked. An officer can ' +
        'refresh the roster to fix this.',
    };
  }

  const eligibleAt = tenureReachedAt(joinedAt, monthsRequired);
  if (now.getTime() >= eligibleAt.getTime()) {
    return { met: true, eligibleAt, reason: '' };
  }

  const label = monthsRequired === 1 ? '1 month' : `${monthsRequired} months`;
  return {
    met: false,
    eligibleAt,
    reason:
      `Needs ${label} in the Discord server for this rank — joined ` +
      `${joinedAt.toISOString().slice(0, 10)}, eligible ${eligibleAt.toISOString().slice(0, 10)}.`,
  };
}
