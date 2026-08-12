import { matchProjectToSite } from '@grims/shared';
import type { PrismaClient } from '@prisma/client';

/**
 * Linking real construction sites back to the plan that intended them.
 *
 * ★ SQUADRON OWNER, 2026-08-11 ★
 *
 * "we also need a way to update Build plans so that when we start one through the members or
 * squadron projects that it updates the build plan we have ... this should all be automatic and it
 * should backfill existing build plans based on projects the commander has started"
 *
 * ★ ONE FUNCTION IS BOTH THE LIVE LINKER AND THE BACKFILL ★
 *
 * It does not look for NEW projects; it looks for UNLINKED ones. Run after every identification it
 * is the automatic behaviour, and run once over an existing database it is the backfill — with no
 * second implementation that could disagree with the first about what counts as a match.
 *
 * That matters here more than usual. The backfill decides, once, what eighty-one rows in a
 * fortnight-old plan mean, and a backfill written separately from the live path is how a plan ends
 * up with two different notions of "already built".
 *
 * ★ WHY IT RUNS AFTER identifyBuildTypes ★
 *
 * A project cannot be matched until it is identified, and it is identified by fingerprinting its
 * bill of materials — twenty-odd commodities at exact tonnages, which no two build types share.
 * That only happens once a commander has docked there. Until then the project links nothing, and
 * says so rather than guessing from the free text somebody typed.
 *
 * ★ AND WHY IT MATCHES PER PLAN, NOT ACROSS ALL OF THEM ★
 *
 * Two plans can cover one system — a squadron plan and somebody's personal one. Each is a separate
 * intention and each should show its own progress, so the project links into both. Pooling their
 * sites would make one candidate per plan look like two candidates and refuse every time.
 */

export interface PlanLinkReport {
  readonly linked: ReadonlyArray<{
    readonly projectId: string;
    readonly planId: string;
    readonly siteId: string;
    readonly systemName: string;
    readonly buildType: string;
  }>;
  /** Several planned sites fit. A human picks; we never guess. */
  readonly ambiguous: ReadonlyArray<{
    readonly projectId: string;
    readonly planId: string;
    readonly systemName: string;
    readonly buildType: string;
    readonly siteIds: readonly string[];
  }>;
  readonly skipped: ReadonlyArray<{ readonly projectId: string; readonly why: string }>;
}

interface ProjectRow {
  id: string;
  system_name: string;
  system_id64: string | null;
  build_type_id: string | null;
  /** From the `Docked` journal event we already collect. Null when nobody has docked there. */
  arrival_ls: number | null;
}

interface SiteRow {
  id: string;
  plan_id: string;
  build_type_id: string | null;
  project_id: string | null;
  body_distance_ls: number | null;
  position: number;
}

/**
 * Links every unlinked, identified project to the planned site it fulfils.
 *
 * `dryRun` writes nothing and reports exactly what it would do — the owner's choice for the
 * backfill, and the same shape as the promotion engine beside it.
 */
export async function linkProjectsToPlans(
  db: PrismaClient,
  opts: { readonly dryRun?: boolean } = {},
): Promise<PlanLinkReport> {
  const dryRun = opts.dryRun ?? true;

  /*
   * Unlinked ANYWHERE. A project already attached to a site in one plan may still be missing from
   * another plan of the same system, so this is not "has no link at all" — the per-plan match below
   * settles it, and `matchProjectToSite` returns the existing link unchanged when there is one.
   */
  const projects = await db.$queryRawUnsafe<ProjectRow[]>(
    /*
     * ★ THE ARRIVAL DISTANCE IS WHAT MAKES THIS WORK AT ALL — 2026-08-11 ★
     *
     * The first dry run linked nothing: GL-W c2-12 plans twenty-five identical Satellite
     * Installations, and Elite names construction sites with generated names ("Tan Prospect"), so
     * neither the build type nor the name singles one out.
     *
     * `Docked` carries DistFromStarLS and we have been storing it all along. A site at 1,302.78 Ls
     * is orbiting the body planned at 1,301, and no other. Newest sighting wins — a site does not
     * move, so any of them would do, and the newest is the one most likely to be complete.
     */
    `SELECT p.id, p.system_name, p.system_id64::text AS system_id64, p.build_type_id,
            (SELECT (t.payload->>'DistFromStarLS')::numeric
               FROM telemetry_events t
              WHERE t.event_type = 'Docked'
                AND (t.payload->>'MarketID')::bigint = p.market_id
              ORDER BY t.occurred_at DESC
              LIMIT 1)::float8 AS arrival_ls
       FROM colony_projects p`,
  );

  /*
   * ★ A DRY RUN MUST SEE ITS OWN PENDING WRITES — 2026-08-12 ★
   *
   * The sites query runs per project, fresh from the database. Live that is correct: the first
   * project writes its link and the second then sees that site taken. A DRY RUN writes nothing, so
   * every project saw the same site free and the report showed two projects claiming one row —
   * alarming to read, and a misrepresentation of what --live would actually do.
   *
   * The two must agree, because this report is what a human approves.
   */
  const claimed = new Set<string>();

  const linked: Array<PlanLinkReport['linked'][number]> = [];
  const ambiguous: Array<PlanLinkReport['ambiguous'][number]> = [];
  const skipped: Array<{ projectId: string; why: string }> = [];

  for (const project of projects) {
    if (project.build_type_id === null) {
      skipped.push({
        projectId: project.id,
        why: 'Nobody has docked here yet, so what it is being built as is unknown. It links itself once the first commander reports its requirements.',
      });
      continue;
    }

    /*
     * Matched on the system, by id where we have one and by name otherwise. The id is the reliable
     * key — a system name is typed by a human and Elite's are long — but plans created before the
     * id was captured have only the name, and refusing those would exclude the very plans this
     * exists to backfill.
     */
    const sites = await db.$queryRawUnsafe<SiteRow[]>(
      `SELECT s.id, s.plan_id, s.build_type_id, s.project_id::text AS project_id, s.position,
              b.distance_ls::float8 AS body_distance_ls
         FROM colony_plan_sites s
         JOIN colony_plans pl ON pl.id = s.plan_id
         LEFT JOIN colony_bodies b
                ON b.system_id64 = s.system_id64 AND b.body_id = s.body_id
        WHERE ($1::text IS NOT NULL AND pl.system_id64::text = $1::text)
           OR lower(pl.system_name) = lower($2)`,
      project.system_id64,
      project.system_name,
    );

    if (sites.length === 0) {
      skipped.push({ projectId: project.id, why: 'No plan covers this system.' });
      continue;
    }

    const byPlan = new Map<string, SiteRow[]>();
    for (const s of sites) {
      byPlan.set(s.plan_id, [...(byPlan.get(s.plan_id) ?? []), s]);
    }

    for (const [planId, planSites] of byPlan) {
      const outcome = matchProjectToSite(
        { id: project.id, buildTypeId: project.build_type_id, arrivalLs: project.arrival_ls },
        planSites.map((s) => ({
          id: s.id,
          buildTypeId: s.build_type_id,
          // Claimed earlier in THIS run counts as taken, or a dry run contradicts the live one.
          projectId: s.project_id ?? (claimed.has(s.id) ? '(claimed in this run)' : null),
          bodyDistanceLs: s.body_distance_ls,
          position: s.position,
        })),
      );

      if (outcome.kind === 'ambiguous') {
        ambiguous.push({
          projectId: project.id,
          planId,
          systemName: project.system_name,
          buildType: project.build_type_id,
          siteIds: outcome.siteIds,
        });
        continue;
      }

      if (outcome.kind === 'none') {
        skipped.push({ projectId: project.id, why: outcome.why });
        continue;
      }

      // Already ours — nothing to write, and nothing to report as new work.
      const site = planSites.find((s) => s.id === outcome.siteId);
      if (site?.project_id === project.id) continue;

      claimed.add(outcome.siteId);
      linked.push({
        projectId: project.id,
        planId,
        siteId: outcome.siteId,
        systemName: project.system_name,
        buildType: project.build_type_id,
      });

      if (dryRun) continue;

      await db.$executeRawUnsafe(
        `UPDATE colony_plan_sites SET project_id = $1::uuid WHERE id = $2::uuid AND project_id IS NULL`,
        project.id,
        outcome.siteId,
      );

      /*
       * Audited, because this changes what a plan CLAIMS about itself. A site that starts reporting
       * "built" needs an answer to "since when, and on what evidence" — and the row is what makes
       * an incorrect link something an officer can find and undo.
       */
      await db.auditLog.create({
        data: {
          actorId: null,
          actorType: 'system',
          action: 'colony.plan_site.linked',
          targetType: 'colony_plan_site',
          targetId: outcome.siteId,
          before: { projectId: null } as never,
          after: {
            projectId: project.id,
            planId,
            systemName: project.system_name,
            buildTypeId: project.build_type_id,
            reason:
              project.arrival_ls === null
                ? 'Matched on system and identified build type; exactly one planned site fitted.'
                : `Matched on system, identified build type, and arrival distance ${project.arrival_ls} Ls against the planned body. Where several identical structures sit on that body they are interchangeable and the earliest in build order was taken.`,
            arrivalLs: project.arrival_ls,
          } as never,
        },
      });
    }
  }

  return { linked, ambiguous, skipped };
}
