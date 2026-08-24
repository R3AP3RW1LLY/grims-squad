import {
  identifyBuildTypes,
  linkProjectsToPlans,
  PrismaColonyStore,
  syncColonyProjects,
  type LiveNudge,
  type PrismaClient,
  type TrackedProject,
} from '@grims/db';

/**
 * Folding a member's delivery into the project the moment they upload it.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "i have made several deliveries to the project, but they are not seeming to register."
 *
 * They had. Nine `ColonisationContribution` events were sitting in telemetry and only six had
 * become ledger rows, because the only thing that converts them is a job in the worker daemon — and
 * the worker daemon was not running. The data was never lost; nothing was scheduled to read it.
 *
 * ★ THE API IS THE PROCESS THAT CANNOT BE DOWN WHEN THIS MATTERS ★
 *
 * If a colonisation event exists at all, the API accepted it. So the API is the right place to
 * apply it: a member who has just handed over cargo sees it on the page before they have finished
 * undocking, and it cannot depend on a second process being up.
 *
 * The daemon keeps its five-minute pass and the crontab entry keeps its place. They are no longer
 * how a delivery arrives — they are the backstop that catches anything this missed, such as events
 * ingested before the project existed.
 *
 * ★ THE SAME JOB, NARROWED — NOT A SECOND IMPLEMENTATION ★
 *
 * This runs `syncColonyProjects` exactly as the worker does, over a store whose `tracked()` returns
 * only the project at the site that was just delivered to. Writing a second, "lighter" apply path
 * here would be two pieces of code writing the same two tables, and the day they disagreed nobody
 * would be able to say which was right.
 */
export class ColonyLiveService {
  constructor(
    private readonly db: PrismaClient,
    /**
     * How a completion detected on THIS pass nudges live bell badges. The sync announces a
     * finished build from its markComplete transition (see completeColonyProject), and this
     * process reaches browsers through its own SSE service rather than the worker's Redis
     * bridge — so the caller supplies the translation. Optional: rows land without it.
     */
    private readonly nudge?: LiveNudge,
    /**
     * Tells every watching browser that this project moved.
     *
     * ★ SQUADRON OWNER, 2026-08-23 ★
     *
     * `telemetry` is published with the uploading member's id, and the fan-out rule sends a
     * user-scoped event to that member alone. So when one member delivered, every OTHER member
     * watching the same project sat on stale figures until they reloaded — and three members
     * hauling to one site is the ordinary case, not the exception.
     *
     * Optional, like the nudge above: rows land whether or not anybody is listening.
     */
    private readonly broadcast?: () => void,
  ) {}

  /**
   * Applies everything known about one construction site.
   *
   * Never throws. A member's upload must succeed whether or not we could fold it into a project —
   * the events are stored either way, and a site nobody has posted a project for is the normal
   * case rather than a failure.
   */
  async applyAt(marketId: bigint): Promise<void> {
    try {
      await syncColonyProjects(new OneSiteStore(this.db, marketId, this.nudge));

      /*
       * ★ AND WORK OUT WHAT IT IS ★
       *
       * Straight after the needs land, because that is the only moment the requirement is both
       * present and new. A build type's bill of materials is a fingerprint no two share, so this
       * tells the project what it is building without anybody choosing from a dropdown — and tells
       * the catalogue that its figures were right, which is what turns a community number into a
       * measurement.
       */
      await identifyBuildTypes(this.db);

      /*
       * Announced AFTER the fold, never before: a watcher told to re-read before the ledger row
       * exists re-reads the old figures and then hears nothing more, which is worse than a second
       * of staleness — it is a refresh that actively confirms the wrong number.
       */
      this.broadcast?.();

      /*
       * ★ AND TELL THE PLAN THAT INTENDED IT — SQUADRON OWNER, 2026-08-11 ★
       *
       * "when we start one through the members or squadron projects ... it updates the build plan
       * we have"
       *
       * Immediately after identification, because that is the first instant a project CAN be
       * matched: the link is made on the catalogue row its bill of materials fingerprints to, and
       * that row did not exist a line ago.
       *
       * `colony_plan_sites.project_id` has been read by the planner since it shipped. It was
       * written only when somebody posted a planned site from the plan page — and almost nobody
       * does, because a construction site's market id only exists while you are docked at it, which
       * is where the app posts from. 0 of 81 sites were linked in production.
       *
       * Not dry: this is the live path. The same function run with `dryRun` is the backfill.
       */
      await linkProjectsToPlans(this.db, { dryRun: false });
    } catch {
      // Swallowed deliberately. See above: the ingest has already stored the truth.
    }
  }
}

/**
 * The project store, narrowed to a single site.
 *
 * Only `tracked()` differs from the worker's. Everything else — reading the newest depot, replacing
 * needs, the unique-keyed ledger insert — is inherited unchanged, which is the entire point.
 */
class OneSiteStore extends PrismaColonyStore {
  constructor(
    db: PrismaClient,
    private readonly marketId: bigint,
    nudge?: LiveNudge,
  ) {
    // The nudge rides to the parent, whose markComplete is where a completion announces itself.
    super(db, nudge);
  }

  override async tracked(): Promise<readonly TrackedProject[]> {
    /*
     * Filtered in the query rather than by loading every project and discarding all but one. A
     * squadron with fifty live builds should not read fifty rows because somebody delivered to one.
     */
    const all = await super.tracked();
    return all.filter((p) => p.marketId === this.marketId);
  }
}
