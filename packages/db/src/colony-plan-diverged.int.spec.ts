import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from './index.js';
import { correctLinkedDivergences, findLinkedDivergences } from './colony-plan-diverged.js';

/**
 * Correcting a plan row to the structure that actually stands there.
 *
 * ★ SQUADRON OWNER, 2026-08-12 ★
 *
 * "were still missing build status on: 02 Extraction Settlement - Medium ... 03 Military
 * Settlement - Small" — "these projects are both fully completed so not sure what the problem is
 * here."
 *
 * They were completed. Identity, not completion, was the problem: the plan named structures nobody
 * built, so it went on asking for thousands of tonnes of hauling that would never happen and gave
 * no credit for the hauling that did.
 *
 * ★ WHY INTEGRATION ★
 *
 * Every assertion here is about SQL: an `IS DISTINCT FROM` that has to treat NULL as a difference,
 * a join that must not fire on unlinked rows, and a single UPDATE that copies a column into another
 * column in the same statement. None of it typechecks, and the one failure that matters — a
 * correction that lands with no record of what it changed — produces a perfectly plausible row.
 */

const db = new PrismaClient();

const TAG = 'plan-diverged-int-spec';

async function cleanUp(): Promise<void> {
  await db.$executeRawUnsafe(
    `DELETE FROM colony_plan_sites WHERE plan_id IN (SELECT id FROM colony_plans WHERE title LIKE $1)`,
    `${TAG}%`,
  );
  await db.$executeRawUnsafe(`DELETE FROM colony_plans WHERE title LIKE $1`, `${TAG}%`);
  await db.$executeRawUnsafe(`DELETE FROM colony_projects WHERE title LIKE $1`, `${TAG}%`);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE handle LIKE $1`, `${TAG}%`);
  await db.$executeRawUnsafe(
    `DELETE FROM audit_log WHERE target_type = 'colony_plan_site'
       AND target_id NOT IN (SELECT id::text FROM colony_plan_sites)`,
  );
}

/** Two catalogue rows that really exist, so the tonnage joins have something to find. */
async function twoBuildTypes(): Promise<{ a: string; b: string }> {
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM colony_build_types ORDER BY id LIMIT 2`,
  );
  const a = rows[0]?.id;
  const b = rows[1]?.id;
  if (a === undefined || b === undefined) throw new Error('the build-type catalogue is empty');
  return { a, b };
}

/** `colony_plans.posted_by_id` is NOT NULL, so a plan needs somebody to have posted it. */
async function seedMember(): Promise<string> {
  const [row] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO users (handle, display_name) VALUES ($1, $1)
     ON CONFLICT (handle) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
    `${TAG}-owner`,
  );
  return (row as { id: string }).id;
}

async function seedPlan(): Promise<string> {
  const owner = await seedMember();
  const [plan] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO colony_plans (owner, title, system_name, posted_by_id)
     VALUES ('squadron', $1, $2, $3::uuid) RETURNING id`,
    `${TAG} plan`,
    `${TAG} system`,
    owner,
  );
  return (plan as { id: string }).id;
}

async function seedProject(marketId: bigint, title: string, built: string | null): Promise<string> {
  const owner = await seedMember();
  const [project] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO colony_projects
       (market_id, system_name, title, owner, posted_by_id, visibility, build_type_id, updated_at)
     VALUES ($1::bigint, $2, $3, 'squadron', $4::uuid, 'squadron', $5, now())
     ON CONFLICT (market_id) DO UPDATE SET build_type_id = EXCLUDED.build_type_id
     RETURNING id`,
    String(marketId),
    `${TAG} system`,
    title,
    owner,
    built,
  );
  return (project as { id: string }).id;
}

async function seedLinkedSite(planned: string | null, built: string): Promise<string> {
  await cleanUp();
  const planId = await seedPlan();
  const projectId = await seedProject(4900000000501n, `${TAG} project`, built);

  const [site] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO colony_plan_sites (plan_id, location, build_type_id, position, project_id)
     VALUES ($1::uuid, 'orbital', $2, 0, $3::uuid) RETURNING id`,
    planId,
    planned,
    projectId,
  );

  return (site as { id: string }).id;
}

afterAll(async () => {
  await cleanUp();
  await db.$disconnect();
});

describe('a plan row that disagrees with the site linked to it', () => {
  it('★ MANDATORY: the correction says what it changed, not just that it changed ★', async () => {
    /*
     * The whole reason this may run automatically at all.
     *
     * `fixDivergedSites` above is deliberately manual — pairing a site with a planned row is the
     * fuzzy matching this codebase refuses. This one pairs nothing: `project_id` is already set, so
     * the only question is which of two build types is true, and the game's answer wins.
     *
     * What it must never be is silent. An automatic edit to somebody's plan that leaves no trace is
     * indistinguishable from the plan having been wrong all along — they would find a structure
     * they never chose and no way to tell whether the platform decided that or they misremembered.
     */
    const { a: planned, b: built } = await twoBuildTypes();
    const siteId = await seedLinkedSite(planned, built);

    await correctLinkedDivergences(db, { dryRun: false });

    const [row] = await db.$queryRawUnsafe<
      Array<{ build_type_id: string; corrected_from: string | null; corrected_at: Date | null }>
    >(
      `SELECT build_type_id, corrected_from_build_type_id AS corrected_from, corrected_at
         FROM colony_plan_sites WHERE id = $1::uuid`,
      siteId,
    );

    expect(row?.build_type_id, 'the plan now names what actually stands there').toBe(built);
    expect(row?.corrected_from, 'and still says what it used to ask for').toBe(planned);
    expect(row?.corrected_at, 'dated, so the plan page can say when').not.toBeNull();
  });

  it('★ MANDATORY: a dry run changes nothing ★', async () => {
    // The default, and it stays the default. Every correction in this codebase reports before it
    // writes, because this one moves a plan's tonnage and somebody should see it first.
    const { a: planned, b: built } = await twoBuildTypes();
    const siteId = await seedLinkedSite(planned, built);

    const found = await correctLinkedDivergences(db);
    expect(found.map((d) => d.siteId)).toContain(siteId);

    const [row] = await db.$queryRawUnsafe<Array<{ build_type_id: string; corrected_at: Date | null }>>(
      `SELECT build_type_id, corrected_at FROM colony_plan_sites WHERE id = $1::uuid`,
      siteId,
    );
    expect(row?.build_type_id, 'untouched').toBe(planned);
    expect(row?.corrected_at).toBeNull();
  });

  it('★ MANDATORY: a planned row with NO build type is still a divergence ★', async () => {
    /*
     * `!=` would miss this: in SQL, `NULL != 'anything'` is NULL, which is not true, so the row
     * would be skipped. A reserved slot somebody never filled in, against a site that has since
     * been built, is exactly the case the plan most needs correcting — and it is the one a plain
     * inequality silently drops. Hence `IS DISTINCT FROM`.
     */
    const { b: built } = await twoBuildTypes();
    const siteId = await seedLinkedSite(null, built);

    const found = await findLinkedDivergences(db);
    expect(found.map((d) => d.siteId), 'an empty slot disagrees with a real structure').toContain(
      siteId,
    );
  });

  it('leaves a row alone when the plan and the site already agree', async () => {
    const { b: built } = await twoBuildTypes();
    const siteId = await seedLinkedSite(built, built);

    const found = await findLinkedDivergences(db);
    expect(found.map((d) => d.siteId)).not.toContain(siteId);
  });

  it('★ MANDATORY: never corrects toward "unknown" ★', async () => {
    /*
     * A project nobody has docked at has no identified build type. Replacing a considered intention
     * with nothing is worse than leaving the disagreement visible, and it is how a plan quietly
     * loses the only record of what somebody meant to build.
     */
    const { a: planned } = await twoBuildTypes();
    await cleanUp();

    const planId = await seedPlan();
    const projectId = await seedProject(4900000000502n, `${TAG} project unidentified`, null);
    const [site] = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO colony_plan_sites (plan_id, location, build_type_id, position, project_id)
       VALUES ($1::uuid, 'orbital', $2, 0, $3::uuid) RETURNING id`,
      planId,
      planned,
      projectId,
    );

    const found = await findLinkedDivergences(db);
    expect(found.map((d) => d.siteId)).not.toContain((site as { id: string }).id);
  });
});
