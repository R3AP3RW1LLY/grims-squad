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

  // TWO commodities, so a carrier can hold both and each can carry its own reading date. With one,
  // source precedence collapses the carrier to a single row and "first" and "newest" are the same
  // value — which is exactly why the first version of the date test could not fail.
  for (const commodity of ['Steel', 'Copper']) {
    await db.$executeRawUnsafe(
      `INSERT INTO colony_needs (project_id, commodity, remaining, required, observed_at)
       VALUES ($1::uuid, $2, 500, 500, now())
       ON CONFLICT (project_id, commodity) DO UPDATE SET remaining = EXCLUDED.remaining`,
      projectId,
      commodity,
    );
  }

  return { projectId, userId };
}

async function hold(
  source: 'journal' | 'capi' | 'manual',
  tonnes: number,
  userId: string,
  at: Date,
  commodity = 'Steel',
): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO colony_carrier_cargo (market_id, commodity, source, tonnes, updated_by_id, updated_at)
     VALUES ($1::bigint, $6, $2, $3, $4::uuid, $5)
     ON CONFLICT (market_id, commodity, source) DO UPDATE SET
       tonnes = EXCLUDED.tonnes, updated_by_id = EXCLUDED.updated_by_id, updated_at = EXCLUDED.updated_at`,
    String(MARKET),
    source,
    tonnes,
    userId,
    at,
    commodity,
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

  it('★ MANDATORY: the prompt is dated, because "is holding" is a claim about now ★', async () => {
    /*
     * The reading behind this prompt may be four minutes or a fortnight old, and the sentence read
     * identically either way — so a member who loaded cargo, closed the app, and later sold it
     * elsewhere was told in the present tense that the carrier still had it.
     *
     * The date is the NEWEST reading across the carrier's lines: the prompt speaks about the
     * carrier as a whole, so anything older would understate how current the claim is and have
     * members distrusting a prompt that was right.
     */
    const { projectId, userId } = await seed();
    /*
     * ★ TWO COMMODITIES, READ AT DIFFERENT TIMES — AND THE FIRST DRAFT HAD ONE ★
     *
     * With a single commodity, source precedence reduces the carrier to one row, so "the first
     * reading" and "the newest reading" are the same value and the assertion cannot fail. Mutation
     * testing proved it: replacing the newest-wins comparison with "keep whatever arrived first"
     * broke nothing.
     *
     * ★ AND THE OLD ONE MUST SORT FIRST, WHICH TOOK A SECOND ATTEMPT ★
     *
     * The query orders by usable tonnage descending. Giving the fresh commodity the larger figure
     * put it at the head of the list, so "first" and "newest" were the same row AGAIN and the
     * mutation still survived.
     *
     * Steel is OLDER and LARGER, so it arrives first; Copper is fresher and smaller. The carrier's
     * date must be Copper's, which is only true if the code compares rather than takes what it saw
     * first.
     */
    await hold('journal', 400, userId, EARLIER, 'Steel');
    await hold('journal', 300, userId, LATER, 'Copper');

    const [holding] = await service.unattachedHoldingFor(projectId, userId);

    expect(holding?.seenAt, 'the prompt carries a date at all').not.toBeNull();
    expect(
      holding?.seenAt?.toISOString(),
      'and it is the newest reading, not the first one seen',
    ).toBe(LATER.toISOString());
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
