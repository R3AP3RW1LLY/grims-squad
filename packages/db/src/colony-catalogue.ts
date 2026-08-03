import type { PrismaClient } from '@prisma/client';

/**
 * The build catalogue: what a construction site of a given kind costs.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "ensure our baseline colonization setup we have now meets and exceeds the current feature and
 * system of raven colonial ... include the ability to pre plan entire system colonization."
 *
 * Nothing could be planned or pre-costed without this. A project had no needs at all until somebody
 * physically flew to the site and docked, so "what will this cost me" — the question worth asking
 * BEFORE committing to a system — could not be answered.
 *
 * ★ WHERE THE NUMBERS COME FROM ★
 *
 * Frontier publishes none of it. Every figure in circulation was gathered by players out of
 * Frontier's own forum threads, and the community lists disagree at the edges. The seed carries
 * those figures; the `source` column says so on every row; and our own depot readings are treated
 * as the better authority the moment one arrives.
 *
 * That is the part a hand-curated list cannot do, and it is why this table is ours rather than
 * borrowed: the more the squadron builds, the more of it stops being somebody's spreadsheet.
 */

export interface BuildTypeSeed {
  readonly id: string;
  readonly displayName: string;
  readonly category: string;
  readonly tier: number;
  readonly location: string;
  readonly padSize: string;
  readonly layouts: readonly string[];
  readonly totalTonnes: number;
  readonly costs: ReadonlyArray<{ readonly commodity: string; readonly tonnes: number }>;
}

export interface SeedReport {
  readonly types: number;
  readonly costs: number;
  /** Rows left alone because one of our own builds had already confirmed them. */
  readonly preserved: number;
}

/**
 * Loads the community figures, without overwriting anything we have measured ourselves.
 *
 * ★ AN OBSERVED ROW IS NEVER REPLACED BY A COMMUNITY ONE ★
 *
 * This runs on deploy, and it would otherwise undo the whole point: a build type confirmed against
 * six of our own sites would be quietly reset to somebody's spreadsheet figure every release. So
 * confirmed rows are skipped and counted, and the count is reported rather than left implicit.
 */
export async function seedBuildCatalogue(
  db: PrismaClient,
  seed: readonly BuildTypeSeed[],
): Promise<SeedReport> {
  const confirmed = new Set(
    (
      await db.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM colony_build_types WHERE source = 'observed'`,
      )
    ).map((r) => r.id),
  );

  let types = 0;
  let costs = 0;

  for (const type of seed) {
    if (confirmed.has(type.id)) continue;

    /*
     * Costs are REPLACED rather than merged. A build type's bill of materials is a whole thing —
     * merging a corrected list into an old one would leave behind any commodity the new list
     * dropped, and a build asking for something the game no longer wants is worse than one figure
     * being out of date.
     */
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO colony_build_types
           (id, display_name, category, tier, location, pad_size, layouts, total_tonnes, source, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, 'community', now())
         ON CONFLICT (id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           category     = EXCLUDED.category,
           tier         = EXCLUDED.tier,
           location     = EXCLUDED.location,
           pad_size     = EXCLUDED.pad_size,
           layouts      = EXCLUDED.layouts,
           total_tonnes = EXCLUDED.total_tonnes,
           updated_at   = now()`,
        type.id,
        type.displayName,
        type.category,
        type.tier,
        type.location,
        type.padSize,
        [...type.layouts],
        type.totalTonnes,
      );

      await tx.$executeRawUnsafe(
        `DELETE FROM colony_build_costs WHERE build_type_id = $1`,
        type.id,
      );

      for (const cost of type.costs) {
        await tx.$executeRawUnsafe(
          `INSERT INTO colony_build_costs (build_type_id, commodity, tonnes) VALUES ($1, $2, $3)`,
          type.id,
          cost.commodity,
          cost.tonnes,
        );
        costs += 1;
      }
    });

    types += 1;
  }

  return { types, costs, preserved: confirmed.size };
}

/**
 * Which build type a site's requirement matches, if any.
 *
 * ★ A BILL OF MATERIALS IS A FINGERPRINT ★
 *
 * The journal never says what is being built. `ColonisationConstructionDepot` reports what the site
 * still wants and nothing about its kind, and the station name is whatever the architect typed.
 *
 * But a build type's requirement is a vector of nineteen-odd commodities with exact tonnages, and
 * no two build types share one. So the requirement identifies the build — which means a project
 * learns what it is without anybody choosing from a dropdown, and the catalogue gets checked
 * against reality on the same read.
 *
 * Matched on REQUIRED, never on remaining: remaining changes with every delivery, and required is
 * the constant the game set when the site was placed.
 */
export function matchBuildType(
  required: ReadonlyMap<string, number>,
  catalogue: readonly BuildTypeSeed[],
): BuildTypeSeed | null {
  if (required.size === 0) return null;

  for (const type of catalogue) {
    if (type.costs.length !== required.size) continue;

    /*
     * Exact on every commodity. Not "close enough": two settlement types can differ by a single
     * commodity, and a fuzzy match would confidently mislabel a build — which then pre-fills the
     * wrong shopping list and costs somebody a wasted trip.
     */
    const same = type.costs.every((c) => required.get(c.commodity) === c.tonnes);
    if (same) return type;
  }

  return null;
}

/**
 * Works out what each unidentified project is building, and confirms the catalogue against it.
 *
 * ★ TWO JOBS, ONE COMPARISON ★
 *
 * The project learns what it is, and the catalogue row learns it was right. Both fall out of the
 * same equality check, and doing them separately would mean reading the same vectors twice to
 * answer two halves of one question.
 *
 * ★ WHY IT RE-CHECKS PROJECTS THAT ALREADY HAVE A TYPE ★
 *
 * It does not. A project keeps the type it was matched to: the requirement the game set when the
 * site was placed does not change, so a second look can only ever reach the same answer or a wrong
 * one — and a wrong one would come from the catalogue having been edited underneath it.
 */
export async function identifyBuildTypes(db: PrismaClient): Promise<{
  identified: number;
  confirmed: number;
}> {
  const projects = await db.$queryRawUnsafe<Array<{ id: string; commodity: string; required: number }>>(
    `SELECT p.id, n.commodity, n.required
       FROM colony_projects p
       JOIN colony_needs n ON n.project_id = p.id
      WHERE p.build_type_id IS NULL AND n.required IS NOT NULL`,
  );

  if (projects.length === 0) return { identified: 0, confirmed: 0 };

  const wanted = new Map<string, Map<string, number>>();
  for (const row of projects) {
    const forProject = wanted.get(row.id) ?? new Map<string, number>();
    forProject.set(row.commodity, row.required);
    wanted.set(row.id, forProject);
  }

  const costs = await db.$queryRawUnsafe<
    Array<{ build_type_id: string; commodity: string; tonnes: number }>
  >(`SELECT build_type_id, commodity, tonnes FROM colony_build_costs`);

  const catalogue = new Map<string, Map<string, number>>();
  for (const row of costs) {
    const forType = catalogue.get(row.build_type_id) ?? new Map<string, number>();
    forType.set(row.commodity, row.tonnes);
    catalogue.set(row.build_type_id, forType);
  }

  let identified = 0;
  let confirmed = 0;

  for (const [projectId, want] of wanted) {
    for (const [typeId, costsFor] of catalogue) {
      if (costsFor.size !== want.size) continue;

      let same = true;
      for (const [commodity, tonnes] of costsFor) {
        if (want.get(commodity) !== tonnes) {
          same = false;
          break;
        }
      }
      if (!same) continue;

      await db.$executeRawUnsafe(
        `UPDATE colony_projects SET build_type_id = $1 WHERE id = $2::uuid`,
        typeId,
        projectId,
      );
      identified += 1;

      /*
       * The row stops being somebody's spreadsheet figure and becomes a measurement. `confirmations`
       * counts DISTINCT sites, so a build type six of our own projects have agreed with is visibly
       * not the same kind of claim as one nobody has checked.
       */
      await db.$executeRawUnsafe(
        `UPDATE colony_build_types
            SET source = 'observed', confirmed_at = now(), confirmations = confirmations + 1
          WHERE id = $1`,
        typeId,
      );
      confirmed += 1;
      break;
    }
  }

  return { identified, confirmed };
}
