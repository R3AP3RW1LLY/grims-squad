/**
 * Correcting the rank grant dates that the website's own launch created.
 *
 * ★ SQUADRON OWNER, 2026-08-11 ★
 *
 * "we need to start the promotions today! and needs to be retroactive to july when the website
 * went live! based on the actual promotion criteria!"
 *
 * ★ THE ARTEFACT ★
 *
 * Every member's ladder rank is stamped `granted_at` between 2026-07-29 and 2026-08-08 — the ten
 * days in which the site went live and officers first built the roster. It records when somebody
 * clicked a button in a new system, not when the member held the rank.
 *
 * The engine counts qualifying months as `month >= grantedAt`. The month row is keyed to the FIRST
 * of the month, so for the eleven members granted in August even the August row is before their own
 * grant and does not count. They read "0 of 1 qualifying months" while sitting on hundreds of
 * messages — s913427 had 149 in July and 22 in August and was credited with none of it.
 *
 * Correcting the date IS what "retroactive to July" means. The alternative — a special flag that
 * only the promotion job understands — would leave every other surface still showing "Held Cadet
 * since 6 August" to a member for whom that is simply false.
 *
 * ★ TWO RULES MAKE IT SAFE TO LEAVE IN THE REPOSITORY ★
 *
 * It only ever moves a grant EARLIER, and only for grants inside the launch window. A promotion
 * genuinely earned in September has a CORRECT date that happens to be later than the go-live, and a
 * naive "move it back" would hand that member a free rank every time this ran.
 */

/** The month the website went live and activity recording began. */
export const GO_LIVE_AT = new Date('2026-07-01T00:00:00.000Z');

/**
 * Grants stamped before this are roster-building artefacts and may be corrected; grants on or after
 * it are real promotions and are left alone.
 *
 * The launch window ran 2026-07-29 to 2026-08-08 and the correction ran on the 11th, so midnight on
 * the 12th is comfortably clear of the artefacts and comfortably before any promotion this system
 * will ever award — the engine cannot promote anybody again until September, because a promotion
 * resets `granted_at` to now and the next qualifying month must start after it.
 */
export const ROSTER_ARTEFACT_BEFORE = new Date('2026-08-12T00:00:00.000Z');

/**
 * What `granted_at` should have said, or null when there is nothing to correct.
 *
 * Null means "leave this row alone" — already early enough, outside the launch window, or resting
 * on a join date we do not have.
 */
export function effectiveGrantAt(
  grantedAt: Date,
  joinedServerAt: Date | null,
  goLive: Date = GO_LIVE_AT,
  artefactBefore: Date = ROSTER_ARTEFACT_BEFORE,
): Date | null {
  // A real promotion, correctly dated. Never touch it.
  if (grantedAt.getTime() >= artefactBefore.getTime()) return null;

  /*
   * We would be guessing, and a corrected date nobody can justify is worse than an uncorrected one
   * somebody can explain. The tenure gate already refuses a member with no join date, so declining
   * costs them nothing they would otherwise have had.
   */
  if (joinedServerAt === null) return null;

  /*
   * Never earlier than the member actually arrived. Backdating past their join would credit them
   * with weeks they were not here for — inventing history rather than correcting it.
   */
  const candidate =
    joinedServerAt.getTime() > goLive.getTime() ? joinedServerAt : goLive;

  // Only ever earlier. Moving a grant later is the one direction that could cost somebody a month
  // they had already earned.
  if (candidate.getTime() >= grantedAt.getTime()) return null;

  return candidate;
}
