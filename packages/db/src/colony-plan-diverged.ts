import type { PrismaClient } from '@prisma/client';

/**
 * A planned row and the thing that actually got built there, when they disagree.
 *
 * ★ FOUND IN PRODUCTION — SQUADRON OWNER, 2026-08-12 ★
 *
 * "were still missing build status on: 02 Extraction Settlement - Medium ... 03 Military
 * Settlement - Small" — followed by "these projects are both fully completed so not sure what the
 * problem is here."
 *
 * They were completed. Completion was never the question; IDENTITY was. At A 1 f the plan asked for
 * an Extraction Settlement — Medium (5,690 t) and a Military Settlement — Small (2,842 t). What
 * stands there is an Extraction Settlement — Small (2,845 t) and a Military Settlement — Medium
 * (5,684 t). The sizes are swapped, and those are four different catalogue rows with four different
 * bills of materials.
 *
 * So the linker refused, correctly: nothing in the plan intended either structure. The cost of
 * leaving it is not cosmetic — the plan goes on asking for 8,532 t of hauling that nobody will ever
 * do, and gives no credit for the 8,529 t that was.
 *
 * ★ WHY THIS IS A SEPARATE OPERATION FROM LINKING ★
 *
 * Linking says "this site IS that planned row". This says "the planned row was WRONG, and here is
 * what is really there". One is a discovery, the other is an edit to somebody's plan — and an edit
 * to a plan is not something a background sweep may do on its own. It is offered, and a human
 * takes it.
 *
 * ★ AND WHY IT IS NOT A FUZZY MATCH ★
 *
 * The obvious shortcut — treat Military-Small and Military-Medium as "close enough" — would make
 * the plan claim 2,842 t was hauled when it was 5,684, and would mislabel builds everywhere else
 * for the same reason. The exactness stays. What changes is that the disagreement is now VISIBLE
 * rather than silently unlinked.
 */

export interface DivergenceFix {
  /** The plan row to correct. */
  readonly siteId: string;
  /** The project that is really standing there. */
  readonly projectId: string;
}

export interface DivergenceResult {
  readonly siteId: string;
  readonly projectId: string;
  readonly from: { readonly buildTypeId: string | null; readonly tonnes: number | null };
  readonly to: { readonly buildTypeId: string | null; readonly tonnes: number | null };
}

/**
 * Corrects a planned row to the structure actually built there, and links the two.
 *
 * `dryRun` reports what it would change and writes nothing — the same contract as every other
 * correction in this codebase, because this moves a plan's tonnage and somebody should see it first.
 *
 * Both writes go in ONE transaction. A corrected row that failed to link would read as a plan that
 * quietly changed size for no reason anybody could explain.
 */
export async function fixDivergedSites(
  db: PrismaClient,
  fixes: readonly DivergenceFix[],
  opts: { readonly dryRun?: boolean } = {},
): Promise<readonly DivergenceResult[]> {
  const dryRun = opts.dryRun ?? true;
  const out: DivergenceResult[] = [];

  for (const fix of fixes) {
    const rows = await db.$queryRawUnsafe<
      Array<{
        site_build: string | null;
        site_tonnes: number | null;
        project_build: string | null;
        project_tonnes: number | null;
      }>
    >(
      `SELECT s.build_type_id           AS site_build,
              sbt.total_tonnes::float8  AS site_tonnes,
              p.build_type_id           AS project_build,
              pbt.total_tonnes::float8  AS project_tonnes
         FROM colony_plan_sites s
         JOIN colony_projects p ON p.id = $2::uuid
         LEFT JOIN colony_build_types sbt ON sbt.id = s.build_type_id
         LEFT JOIN colony_build_types pbt ON pbt.id = p.build_type_id
        WHERE s.id = $1::uuid`,
      fix.siteId,
      fix.projectId,
    );

    const row = rows[0];
    if (row === undefined) continue;

    /*
     * Refused rather than guessed at. A project nobody has docked at has no identified build type,
     * and correcting a plan row to "unknown" would replace a considered intention with nothing.
     */
    if (row.project_build === null) continue;

    out.push({
      siteId: fix.siteId,
      projectId: fix.projectId,
      from: { buildTypeId: row.site_build, tonnes: row.site_tonnes },
      to: { buildTypeId: row.project_build, tonnes: row.project_tonnes },
    });

    if (dryRun) continue;

    await db.$transaction([
      db.$executeRawUnsafe(
        `UPDATE colony_plan_sites SET build_type_id = $1, project_id = $2::uuid WHERE id = $3::uuid`,
        row.project_build,
        fix.projectId,
        fix.siteId,
      ),
      db.auditLog.create({
        data: {
          actorId: null,
          actorType: 'system',
          action: 'colony.plan_site.build_type_corrected',
          targetType: 'colony_plan_site',
          targetId: fix.siteId,
          before: { buildTypeId: row.site_build, tonnes: row.site_tonnes } as never,
          after: {
            buildTypeId: row.project_build,
            tonnes: row.project_tonnes,
            projectId: fix.projectId,
            reason:
              'The plan row described a structure that was never built. Corrected to what actually ' +
              'stands there, and linked, so the plan stops asking for tonnage nobody will haul.',
          } as never,
        },
      }),
    ]);
  }

  return out;
}
