import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@grims/db';
import { ColonyCarrierService } from './colony-carrier.service.js';

/**
 * "Your carrier is holding 800 t this build needs — attach it?", and when it must not say that.
 *
 * ★ THE DEFECT THIS PINS — FOUND BY AUDIT, 2026-08-18 ★
 *
 * `unattachedHoldingFor` filtered `g.tonnes > 0` INSIDE the CTE, above the `DISTINCT ON` that
 * resolves source precedence. Postgres therefore removed zero rows as candidates BEFORE deciding
 * which source wins — so a zero from a higher-precedence source could never win, and the
 * lower-precedence positive row was promoted in its place.
 *
 * Both zero-writers are real and reachable. `setManual` writes one when a member says "none of this
 * is aboard", and its own docblock calls that "the entire point of a manual row". The cAPI carrier
 * poller writes one for every commodity another source still claims that Frontier's complete
 * manifest omits — the one thing that source exists to do.
 *
 * So the prompt offered cargo that Frontier, or the member's own hand, had already declared gone.
 * Worse, the SAME carrier read 0 t for that commodity on the build it was attached to, because
 * `effectiveTonnes` honours the zero: two numbers for one hold, from two rules.
 *
 * ★ WHY INTEGRATION ★
 *
 * The bug is the ORDER OF TWO CLAUSES in one SQL statement. It typechecks, every unit test passes,
 * and it produces a perfectly plausible number. Only a real Postgres can tell the two orderings
 * apart.
 */

const db = new PrismaClient();
const service = new ColonyCarrierService(db);

const TAG = 'attach-prompt-int-spec';
const MARKET = 4_900_000_009_10n;

async function member(): Promise<string> {
  const [row] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO users (handle, display_name) VALUES ($1, $1)
     ON CONFLICT (handle) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
    `${TAG}-owner`,
  );
  return (row as { id: string }).id;
}

async function cleanUp(): Promise<void> {
  await db.$executeRawUnsafe(
    `DELETE FROM colony_carrier_cargo WHERE market_id = $1::bigint`,
    String(MARKET),
  );
  await db.$executeRawUnsafe(
    `DELETE FROM colony_needs WHERE project_id IN (SELECT id FROM colony_projects WHERE title LIKE $1)`,
    `${TAG}%`,
  );
  await db.$executeRawUnsafe(
    `DELETE FROM colony_carriers WHERE project_id IN (SELECT id FROM colony_projects WHERE title LIKE $1)`,
    `${TAG}%`,
  );
  await db.$executeRawUnsafe(`DELETE FROM colony_projects WHERE title LIKE $1`, `${TAG}%`);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE handle LIKE $1`, `${TAG}%`);
}

/** A live build wanting 500 t of Steel, and a member who owns a carrier. */
async function seed(): Promise<{ projectId: string; userId: string }> {
  await cleanUp();
  const userId = await member();

  const [project] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO colony_projects
       (market_id, system_name, title, owner, posted_by_id, visibility, updated_at)
     VALUES ($1::bigint, $2, $3, 'squadron', $4::uuid, 'squadron', now())
     ON CONFLICT (market_id) DO UPDATE SET title = EXCLUDED.title
     RETURNING id`,
    String(4_900_000_009_11n),
    `${TAG} system`,
    `${TAG} project`,
    userId,
  );
  const projectId = (project as { id: string }).id;

  await db.$executeRawUnsafe(
    `INSERT INTO colony_needs (project_id, commodity, remaining, required, observed_at)
     VALUES ($1::uuid, 'Steel', 500, 500, now())
     ON CONFLICT (project_id, commodity) DO UPDATE SET remaining = EXCLUDED.remaining`,
    projectId,
  );

  return { projectId, userId };
}

async function hold(
  source: 'journal' | 'capi' | 'manual',
  tonnes: number,
  userId: string,
  at: Date,
): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO colony_carrier_cargo (market_id, commodity, source, tonnes, updated_by_id, updated_at)
     VALUES ($1::bigint, 'Steel', $2, $3, $4::uuid, $5)
     ON CONFLICT (market_id, commodity, source) DO UPDATE SET
       tonnes = EXCLUDED.tonnes, updated_by_id = EXCLUDED.updated_by_id, updated_at = EXCLUDED.updated_at`,
    String(MARKET),
    source,
    tonnes,
    userId,
    at,
  );
}

const EARLIER = new Date('2026-08-01T00:00:00.000Z');
const LATER = new Date('2026-08-02T00:00:00.000Z');

afterAll(async () => {
  await cleanUp();
  await db.$disconnect();
});

describe('the attach prompt and a hold that is empty', () => {
  it('offers a carrier that really is holding something', async () => {
    // The control. Without it every assertion below could pass because the prompt is simply broken.
    const { projectId, userId } = await seed();
    await hold('journal', 800, userId, EARLIER);

    const holdings = await service.unattachedHoldingFor(projectId, userId);
    expect(holdings.map((h) => h.marketId)).toContain(String(MARKET));
  });

  it('★ MANDATORY: a member’s own "none of this is aboard" is not overruled by a stale journal row ★', async () => {
    /*
     * `setManual`: "ZERO is a real figure (none of this is aboard) and overrides journal and mirror
     * alike — that is the entire point of a manual row."
     *
     * With the positivity test inside the CTE, the manual zero was never a candidate and the
     * journal's 800 t won — so the prompt offered cargo the member had personally said was gone.
     */
    const { projectId, userId } = await seed();
    await hold('journal', 800, userId, EARLIER);
    await hold('manual', 0, userId, LATER);

    const holdings = await service.unattachedHoldingFor(projectId, userId);
    expect(
      holdings.map((h) => h.marketId),
      'the hand beats the journal, and the hand said empty',
    ).not.toContain(String(MARKET));
  });

  it('★ MANDATORY: a fresher cAPI zero retires a stale journal figure ★', async () => {
    /*
     * Frontier's manifest is COMPLETE, so a commodity it omits is a commodity that is not aboard.
     * The poller writes that as an explicit zero precisely because "an absent row is not a zero" —
     * and this query threw the zero away, which is the one thing that source exists to prevent.
     */
    const { projectId, userId } = await seed();
    await hold('journal', 800, userId, EARLIER);
    await hold('capi', 0, userId, LATER);

    const holdings = await service.unattachedHoldingFor(projectId, userId);
    expect(holdings.map((h) => h.marketId)).not.toContain(String(MARKET));
  });

  it('★ MANDATORY: a fresher journal reading beats an older cAPI one ★', async () => {
    /*
     * The second half of the same defect. The CTE ranked capi above journal ALWAYS, while
     * `effectiveTonnes` — which every other surface reads — decides between them by RECENCY, with
     * the journal taking ties.
     *
     * So a member watching cargo load onto their carrier right now could be told the carrier was
     * empty, on the strength of a Frontier manifest from hours earlier, while the carriers tab
     * showed the cargo. Two rules, one hold, two numbers.
     */
    const { projectId, userId } = await seed();
    await hold('capi', 0, userId, EARLIER);
    await hold('journal', 800, userId, LATER);

    const holdings = await service.unattachedHoldingFor(projectId, userId);
    expect(
      holdings.map((h) => h.marketId),
      'the newer reading wins, whichever source it came from',
    ).toContain(String(MARKET));
  });

  it('a zero from a LOWER-precedence source does not retire a manual figure', async () => {
    // Precedence still runs in the right direction: manual is the member's own statement and a
    // journal zero from afterwards must not quietly overrule it.
    const { projectId, userId } = await seed();
    await hold('manual', 800, userId, EARLIER);
    await hold('journal', 0, userId, LATER);

    const holdings = await service.unattachedHoldingFor(projectId, userId);
    expect(holdings.map((h) => h.marketId)).toContain(String(MARKET));
  });
});
