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

/**
 * A plan row whose site is ALREADY LINKED to a project describing a different structure.
 *
 * ★ THIS IS A DIFFERENT OPERATION FROM THE ONE ABOVE, AND THE DIFFERENCE IS THE WHOLE ARGUMENT ★
 *
 * The header of this file says an edit to a plan "is not something a background sweep may do on its
 * own. It is offered, and a human takes it." That still stands, and it is about PAIRING: deciding
 * which construction site corresponds to which planned row is exactly the fuzzy matching this
 * codebase refuses, because Military-Small and Military-Medium are not close enough and treating
 * them so would misreport thousands of tonnes.
 *
 * This function pairs nothing. `colony_plan_sites.project_id` is already set — somebody, or the
 * linker under its exact-match rule, has already established that this site IS that build. The only
 * question left is which of the two build types is true, and that is not a judgement call: the
 * project's is what a commander docked at and the game reported. The plan's is an intention that
 * turned out to be wrong.
 *
 * ★ SQUADRON OWNER: AUTO-CORRECT, AND SAY SO ★
 *
 * So this one may run by itself. What it may not do is run silently: `corrected_from_build_type_id`
 * and `corrected_at` keep the previous answer beside the date, and the plan page says out loud that
 * the row was changed and what it used to be. An automatic edit that leaves no trace is
 * indistinguishable from the plan having been wrong all along — anybody who remembers laying it out
 * would find a structure they never chose and no way to tell who decided that.
 */
export interface LinkedDivergence {
  readonly siteId: string;
  readonly planId: string;
  readonly projectId: string;
  readonly planned: string | null;
  readonly built: string;
  readonly plannedTonnes: number | null;
  readonly builtTonnes: number | null;
}

export async function findLinkedDivergences(
  db: PrismaClient,
): Promise<readonly LinkedDivergence[]> {
  const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT s.id            AS site_id,
            s.plan_id       AS plan_id,
            p.id            AS project_id,
            s.build_type_id AS planned,
            p.build_type_id AS built,
            sbt.total_tonnes::float8 AS planned_tonnes,
            pbt.total_tonnes::float8 AS built_tonnes
       FROM colony_plan_sites s
       JOIN colony_projects p ON p.id = s.project_id
       LEFT JOIN colony_build_types sbt ON sbt.id = s.build_type_id
       LEFT JOIN colony_build_types pbt ON pbt.id = p.build_type_id
      /*
       * Refused rather than guessed at, exactly as the manual path refuses it: a project nobody has
       * docked at has no identified build type, and correcting a considered intention to "unknown"
       * is worse than leaving the disagreement visible.
       */
      WHERE p.build_type_id IS NOT NULL
        AND s.build_type_id IS DISTINCT FROM p.build_type_id
      ORDER BY s.id`,
  );

  return rows.map((r) => ({
    siteId: String(r['site_id']),
    planId: String(r['plan_id']),
    projectId: String(r['project_id']),
    planned: r['planned'] === null || r['planned'] === undefined ? null : String(r['planned']),
    built: String(r['built']),
    plannedTonnes: (r['planned_tonnes'] as number | null) ?? null,
    builtTonnes: (r['built_tonnes'] as number | null) ?? null,
  }));
}

/**
 * Corrects every already-linked plan row to the structure that actually stands there.
 *
 * `dryRun` defaults TRUE, like its neighbour above and every other correction in this codebase.
 * A caller that means it says so.
 */
export async function correctLinkedDivergences(
  db: PrismaClient,
  opts: { readonly dryRun?: boolean } = {},
): Promise<readonly LinkedDivergence[]> {
  const dryRun = opts.dryRun ?? true;
  const found = await findLinkedDivergences(db);
  if (dryRun) return found;

  for (const d of found) {
    await db.$transaction([
      /*
       * The previous build type is written in the SAME statement that replaces it. Two statements
       * would leave a window where the row has been changed and cannot say what it used to be —
       * and that window is precisely the state this feature exists to make impossible.
       *
       * `corrected_from` takes the value being overwritten, not whatever is already in the column:
       * a row corrected twice should say what it was before THIS correction, which is what somebody
       * comparing it against their memory of the plan needs.
       */
      db.$executeRawUnsafe(
        `UPDATE colony_plan_sites
            SET corrected_from_build_type_id = build_type_id,
                corrected_at = now(),
                build_type_id = $1
          WHERE id = $2::uuid`,
        d.built,
        d.siteId,
      ),
      db.auditLog.create({
        data: {
          actorId: null,
          actorType: 'system',
          action: 'colony.plan_site.build_type_corrected',
          targetType: 'colony_plan_site',
          targetId: d.siteId,
          before: { buildTypeId: d.planned, tonnes: d.plannedTonnes } as never,
          after: {
            buildTypeId: d.built,
            tonnes: d.builtTonnes,
            projectId: d.projectId,
            reason:
              'The site linked to this plan row is a different structure from the one planned. ' +
              'Corrected to what actually stands there, so the plan stops asking for tonnage ' +
              'nobody will haul and gives credit for the tonnage that was.',
          } as never,
        },
      }),
    ]);
  }

  return found;
}
