/**
 * How long somebody has been in the squadron, said the way a person would say it.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "add a member for column that shows how long a member has been in the Grim's Squad Discord server
 * ... the length of time in squadron should be presented in days, months years etc"
 *
 * ★ WHY THE DISCORD JOIN DATE IS THE ANSWER ★
 *
 * The owner asked whether it could come from the Inara squadron roster instead. It cannot, and it
 * is worth writing down why so nobody spends an afternoon looking again:
 *
 *   Inara      `getcommanderprofile` is the only commander endpoint, and it returns
 *              `squadronName` and `squadronMemberRank`. No dates. There is no roster endpoint.
 *   The game   the journal's `SquadronStartup` carries a squadron name and the commander's rank
 *              in it. Also no date — Elite never writes when you joined.
 *
 * Nowhere in the Elite ecosystem is "when did this commander join this squadron" readable. Discord
 * records it exactly, and this squadron recruits through Discord, so the server join date is both
 * the best available answer and, in practice, the true one.
 *
 * ★ CALENDAR MONTHS, NOT 30-DAY BLOCKS ★
 *
 * Somebody who joined on 3 March should read "5 months" on 3 August, not "5 months" for a few days
 * and then "5 months" again after a drift. Dividing by 30.44 gets the arithmetic right and the
 * anniversaries wrong, and the anniversary is the thing an officer is actually looking at.
 */

/** A tenure, broken into the units it will be shown in. */
export interface Tenure {
  readonly years: number;
  readonly months: number;
  readonly days: number;
  /** Total days, for sorting and for thresholds. Always exact. */
  readonly totalDays: number;
}

const DAY_MS = 86_400_000;

/**
 * `from` advanced by whole months, with the day clamped to the end of the target month.
 *
 * 31 January plus one month is 28 February, because there is no 31st to land on. Clamping is what
 * everybody means by "a month later" and what makes the anniversary of a 31st fall on the last day
 * of every shorter month rather than skidding into the next one.
 */
function addMonths(from: Date, months: number): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth() + months;
  // Day 0 of month m+1 is the last day of month m.
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

  return new Date(
    Date.UTC(
      y,
      m,
      Math.min(from.getUTCDate(), lastDay),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
}

/**
 * Splits an elapsed span into years, months and days by the calendar.
 *
 * ★ IT COUNTS MONTHS FORWARD RATHER THAN SUBTRACTING FIELDS ★
 *
 * The obvious implementation subtracts year, month and day separately and borrows when the day goes
 * negative. It is wrong whenever the join day is longer than the intervening month: 31 January to
 * 2 March borrows 28 from February and lands on MINUS ONE day. The answer is 1 month 2 days, and no
 * amount of adjusting the borrow makes that fall out of a subtraction.
 *
 * Advancing instead — take the largest number of clamped months that does not overshoot, then count
 * the remaining days — is correct by construction and needs no special cases at all.
 */
export function tenureBetween(from: Date, to: Date): Tenure {
  const totalDays = Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));

  // A future join date is a clock disagreement between two hosts, not a negative tenure.
  if (to.getTime() <= from.getTime()) return { years: 0, months: 0, days: 0, totalDays: 0 };

  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  // One step back is always enough: the estimate is never more than a month over.
  if (addMonths(from, months).getTime() > to.getTime()) months -= 1;
  if (months < 0) months = 0;

  const days = Math.max(0, Math.floor((to.getTime() - addMonths(from, months).getTime()) / DAY_MS));

  return { years: Math.floor(months / 12), months: months % 12, days, totalDays };
}

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

/**
 * The tenure as a phrase, at most two units.
 *
 * ★ TWO UNITS, NOT THREE ★
 *
 * "2 years 3 months 14 days" is a measurement. "2 years 3 months" is an answer. The third unit
 * changes daily, is never what the question was about, and makes a column that has to be read
 * rather than scanned — in a table where fifty rows carry one each.
 *
 * Under a month it stays in days, because for a new recruit the days ARE the answer.
 */
export function formatTenure(t: Tenure): string {
  if (t.years > 0) {
    return t.months > 0 ? `${plural(t.years, 'year')} ${plural(t.months, 'month')}` : plural(t.years, 'year');
  }
  if (t.months > 0) {
    return t.days > 0 ? `${plural(t.months, 'month')} ${plural(t.days, 'day')}` : plural(t.months, 'month');
  }
  // "today", not "0 days" — a number that reads as a missing value when it is the most precise
  // answer there is.
  return t.totalDays === 0 ? 'today' : plural(t.totalDays, 'day');
}

/** Both steps, for the common case of an ISO string against now. */
export function tenureFrom(iso: string | null, now: number = Date.now()): string | null {
  if (iso === null) return null;
  const from = new Date(iso);
  if (!Number.isFinite(from.getTime())) return null;
  return formatTenure(tenureBetween(from, new Date(now)));
}
