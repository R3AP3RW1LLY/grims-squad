/**
 * How a build type is written wherever a member has to recognise one.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "when we are planning and selecting orbital or surface structures from the dropdown, the
 * build_type_id should be provided in that list so we know what we're choosing! ex If we're building
 * a refinery hub the id silenus should be provided in the dropdown and on the build list and planner"
 *
 * ★ THE ID IS THE PART THAT WORKS ★
 *
 * "Refinery Hub" is what a structure DOES; `silenus` is what the game calls it. A member plans on
 * this platform and then types the id into the in-game architect view, so a list showing only the
 * description makes them go and look it up — which is the work the planner exists to remove. The
 * build books have printed the id on every row since they were written, for exactly this reason;
 * the planner simply never did.
 *
 * ★ VERBATIM, AND LOWERCASE ★
 *
 * Rendered exactly as it is typed in game. Capitalising it to read more like a name would put the
 * planner and the books one keystroke apart, which is worse than not showing it: a member would
 * have to know which of the two to trust.
 *
 * ★ AND WHY IT LIVES IN SHARED ★
 *
 * It is rendered on the website and in the companion, in a picker, a build list, a plan tree and an
 * economy table. Two copies of a format string is how the two surfaces drift, and they have drifted
 * three times this month already.
 */

/**
 * `Refinery Hub (silenus)` — description first, id in brackets.
 *
 * The description leads so a dropdown stays scannable by what a structure is FOR; the id follows so
 * it can be matched against the game without leaving the page.
 *
 * Falls back to the id alone when there is no description, and to the description alone when there
 * is no id — a bracketed empty string is worse than either.
 */
export function buildTypeLabel(
  displayName: string | null | undefined,
  buildTypeId: string | null | undefined,
): string {
  const name = (displayName ?? '').trim();
  const id = (buildTypeId ?? '').trim();

  if (name === '' && id === '') return '';
  if (id === '') return name;
  if (name === '') return id;
  return `${name} (${id})`;
}

/**
 * The same, for a site that may not have chosen a build yet.
 *
 * An unchosen site is the ordinary state of a plan somebody is still filling in, so it gets a
 * sentence rather than an empty cell — the planner should never render a blank where a member is
 * expecting to see their own decision reflected back.
 */
export function siteBuildLabel(
  displayName: string | null | undefined,
  buildTypeId: string | null | undefined,
  unchosen = 'nothing chosen yet',
): string {
  const label = buildTypeLabel(displayName, buildTypeId);
  return label === '' ? unchosen : label;
}
