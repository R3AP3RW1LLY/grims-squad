/**
 * When to tell the squadron about a new build.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "we need to fix the discord annoucement that is made when we start a new colonization project, we
 * need this to announce with the type of build it is please. even if there is a short delay in this
 * information please. its very important."
 *
 * ★ THE TEMPLATE ALWAYS COULD PRINT IT — IT HAS NEVER HAD ONE TO PRINT ★
 *
 * `colonyProjectContent` has carried the build type since it was written, and falls back to "build
 * type not identified yet". That fallback is what the channel has shown every single time, because
 * the announcement fires from the create path and `build_type_id` is filled in later, by the sync
 * that matches the project's bill of materials against the catalogue.
 *
 * A hauler reading the message learns a system name and nothing about what is being built there —
 * and whether to commit to a Refinery Hub's 22,000 tonnes or a Satellite Installation's few hundred
 * is the whole decision they are being asked to make.
 *
 * ★ SO THE ANNOUNCEMENT MOVES OUT OF THE CREATE PATH ★
 *
 * It becomes a sweep: post when the type is known, or when waiting has stopped being reasonable.
 * That trade is exactly what the owner authorised — "even if there is a short delay".
 *
 * ★ WHICH COSTS THE ONE THING THE CREATE PATH GAVE FOR FREE ★
 *
 * `announce()` has no dedup key; it inserts into a queue the bot drains. Announcing exactly once
 * has always been a property of the call site being reached exactly once. A sweep runs repeatedly,
 * so that guarantee has to be rebuilt — `announcedAt`, checked here and stamped by the caller.
 */

/**
 * How long to wait for identification before posting without it.
 *
 * ★ BOTH ENDS OF THIS ARE LOAD-BEARING ★
 *
 * Too short and it posts "build type not identified yet" before the sync that would have answered
 * it has run — reintroducing the exact bug this exists to fix, just less often and far harder to
 * see.
 *
 * Too long and the announcement stops being news. A build posted to the channel three hours late is
 * an archive entry: the haulers who would have joined have logged off, and the member who posted it
 * has been building alone the whole time.
 *
 * Thirty minutes clears the colonisation sync's fifteen-minute cadence twice over, so a project
 * that CAN be identified nearly always has been.
 */
export const IDENTIFY_GRACE_MS = 30 * 60_000;

export interface PendingAnnouncement {
  readonly createdAt: Date;
  /** Null until the sync matches the bill of materials against the catalogue. */
  readonly buildTypeId: string | null;
  /** When the squadron was told. Null means never. */
  readonly announcedAt: Date | null;
  readonly visibility: string;
}

export type AnnounceReason =
  | 'identified'
  | 'gave-up-waiting'
  | 'waiting'
  | 'already-announced'
  | 'private';

export interface AnnounceDecision {
  readonly announce: boolean;
  readonly reason: AnnounceReason;
}

export function announcementDue(
  project: PendingAnnouncement,
  now: Date,
): AnnounceDecision {
  /*
   * Checked before anything else, including the deadline. A member who set their build to private
   * has already said who may see it, and a grace period that eventually posts everything would
   * quietly turn the privacy setting into a delay.
   */
  if (project.visibility === 'private') return { announce: false, reason: 'private' };

  if (project.announcedAt !== null) return { announce: false, reason: 'already-announced' };

  // The good path: we know what it is, so say so immediately. Holding an identified project for the
  // rest of the grace would be a delay that buys nothing.
  if (project.buildTypeId !== null) return { announce: true, reason: 'identified' };

  if (now.getTime() - project.createdAt.getTime() > IDENTIFY_GRACE_MS) {
    /*
     * Some builds never identify: a bill nobody has catalogued, a project posted with no opening
     * snapshot, a member who never opens the depot again. Waiting without a deadline would turn
     * "a delayed announcement" into "no announcement" — silently, and for exactly the unusual
     * builds most worth hearing about.
     */
    return { announce: true, reason: 'gave-up-waiting' };
  }

  return { announce: false, reason: 'waiting' };
}
