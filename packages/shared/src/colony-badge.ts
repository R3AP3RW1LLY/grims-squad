/**
 * How many colonisation projects still want hauling.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "when a colonization project is complete, we need to remove it from the badge that appears in the
 * navmenu on the companion app, we also need to add this notification/badge to the web site too
 * showing completed projects is confusing!"
 *
 * ★ ONE RULE, TWO SURFACES ★
 *
 * The count is about to appear on the website as well as in the app. Written twice they would
 * drift, and the half that drifted would be whichever nobody re-reads — leaving a member looking at
 * "4" in one place and "6" in the other with no way to tell which was lying. So the rule lives here
 * and both import it.
 */

/** The only two fields the count needs, so both surfaces can pass their own project shape. */
export interface CountableProject {
  readonly owner: 'squadron' | 'personal';
  /** ISO timestamp when the build was finished, or null while it still wants hauling. */
  readonly completedAt: string | null;
}

export interface OpenProjectCounts {
  readonly squadron: number;
  readonly personal: number;
}

/**
 * Is this build finished?
 *
 * An EMPTY STRING is not a date. `completedAt` arrives as JSON through two different doors, and
 * treating a blank as "finished" would hide a live build from the people meant to be hauling for
 * it — the opposite of the bug this fixes, and the worse of the two.
 */
function finished(project: CountableProject): boolean {
  return typeof project.completedAt === 'string' && project.completedAt.trim() !== '';
}

/** Projects still wanting hauling, split by who owns them. */
export function openProjectCounts(
  projects: readonly CountableProject[],
): OpenProjectCounts {
  let squadron = 0;
  let personal = 0;

  for (const project of projects) {
    if (finished(project)) continue;
    if (project.owner === 'squadron') squadron += 1;
    else personal += 1;
  }

  return { squadron, personal };
}
