import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@grims/db';
import { ColonyCarrierService } from './colony-carrier.service.js';

/**
 * Finding a fleet carrier by its callsign, against a real Postgres.
 *
 * ★ THE BUG THIS EXISTS FOR — SQUADRON OWNER, 2026-08-04 ★
 *
 * "we are trying to find a fleet carrier in the Fleet Carriers on this build section of the
 * companion app, it is in system in game! its not coming back when searching by name or ID number".
 *
 * Their carrier was W8K-W1Y. It was in the galaxy catalogue, its market had been reported that
 * morning, and it was parked in the same system as the build. Two things were wrong at once and
 * neither was visible from the screen:
 *
 *   1. `data->>'type'` said `"FleetCarrier"` — the journal's word, written over the galaxy dump's
 *      `"Drake-Class Carrier"` by a live Docked event — and every carrier query asked for the
 *      dump's spelling exactly.
 *   2. The search INNER JOINed the build's outstanding needs, so a named carrier that was not
 *      already selling something this build wanted came back empty, which reads as "no such
 *      carrier" rather than "that carrier is not selling any of this".
 *
 * ★ WHY INTEGRATION AND NOT UNIT ★
 *
 * Every line of this is hand-written SQL — a CTE, a DISTINCT ON, a LATERAL left join, a bound text
 * array. Typecheck cannot see inside a query string and a mocked client accepts anything. The
 * colonisation GROUP BY incident already proved that: it passed every unit test and 500'd every
 * screen. The value here is the real queries running on the real schema and returning the right
 * rows.
 *
 * Fixtures use ids far outside Frontier's range so a live collector writing real sightings in
 * parallel can never collide with them, and everything is cleaned up afterwards.
 */

const db = new PrismaClient();
const service = new ColonyCarrierService(db);

/** Frontier market ids are < 2^48; these are test-only. */
const DUMP_SPELLING = '900000000000101';
const JOURNAL_SPELLING = '900000000000102';
const NO_MARKET = '900000000000103';

/** The build site itself needs a market id, and it is unique. Also test-only. */
const FIXTURE_SITE = '900000000000100';

const SYS = '990000000001';
const KEY_DUMP = `${SYS}/T3D-D3D`;
const KEY_JOURNAL = `${SYS}/T3J-J3J`;
const KEY_NO_MARKET = `${SYS}/T3N-N3N`;

/** The carrier that has jumped: one market id, two catalogue keys, two sets of market rows. */
const MOVED = '900000000000104';
const KEY_MOVED_OLD = '990000000002/T3M-M3M';
const KEY_MOVED_NEW = '990000000003/T3M-M3M';

/*
 * ★ COMMODITIES NOTHING ELSE TRADES ★
 *
 * The dev mirror holds 49,444 real carriers and 25,277 real carrier markets. A fixture holding
 * 5,000 t of CMM Composite is nowhere near the top twenty of a blank search against real data —
 * the assertions failed on the RANKING WORKING, which is the least useful kind of red. Naming the
 * fixture commodities something no real market carries makes this project's ranking answerable
 * from the fixtures alone, without weakening what is asserted.
 */
const FIXTURE_A = 'Fixture Composite';
const FIXTURE_B = 'Fixture Alloy';

let projectId = '';

/** Setup and teardown budget. Generous on purpose — see the note on the beforeAll below. */
const HOOK_MS = 60_000;

/** The fixture's own owner. Created and removed by this spec so an empty database is enough. */
const FIXTURE_HANDLE = 'carrier-search-fixture-owner';

async function cleanup(): Promise<void> {
  await db.$executeRawUnsafe(
    `DELETE FROM market_entries WHERE station_key LIKE '99000000000%/T3%'`,
  );
  await db.$executeRawUnsafe(
    `DELETE FROM knowledge_items WHERE kind = 'station' AND ext_key LIKE '99000000000%/T3%'`,
  );
  /*
   * ★ BY THE FIXTURE'S OWN MARKET ID, NOT BY `projectId` ★
   *
   * This deleted the project only when `projectId` was set — module state, and therefore empty on
   * every fresh process. So a run that died between the INSERT and the teardown left its project
   * behind, and `market_id` is UNIQUE: every later run failed in `beforeAll` with a duplicate key,
   * naming a constraint rather than the leftover. A test that cannot run twice is a test that
   * reports the state of the last crash instead of the state of the code.
   *
   * The site's market id identifies the fixture on its own, so cleanup no longer needs to remember
   * anything across processes.
   */
  const stale = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text AS id FROM colony_projects WHERE market_id = $1::bigint`,
    FIXTURE_SITE,
  );
  for (const row of stale) {
    await db.$executeRawUnsafe(`DELETE FROM colony_needs WHERE project_id = $1::uuid`, row.id);
    await db.$executeRawUnsafe(`DELETE FROM colony_carriers WHERE project_id = $1::uuid`, row.id);
    await db.$executeRawUnsafe(`DELETE FROM colony_projects WHERE id = $1::uuid`, row.id);
  }

  // Last, because the projects above point at it.
  await db.$executeRawUnsafe(`DELETE FROM users WHERE handle = $1`, FIXTURE_HANDLE);
}

async function catalogue(
  key: string,
  name: string,
  marketId: string,
  type: string,
  system: string,
): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO knowledge_items (source, kind, ext_key, name, data, text, ingested_at)
     VALUES ('galaxy', 'station', $1, $2,
             jsonb_build_object('marketId', $3::text, 'type', $4::text, 'system', $5::text),
             $2, now())
     ON CONFLICT (source, kind, ext_key) DO UPDATE SET data = EXCLUDED.data`,
    key,
    name,
    marketId,
    type,
    system,
  );
}

async function market(
  key: string,
  name: string,
  system: string,
  commodity: string,
  supply: number,
  seenAt: string,
): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO market_entries
       (station_key, station_name, system_name, station_type, large_pads, commodity,
        buy_price, sell_price, supply, demand, market_seen_at, source)
     VALUES ($1, $2, $3, 'Drake-Class Carrier', 8, $4, 100, 0, $5, 0, $6::timestamptz, 'test')`,
    key,
    name,
    system,
    commodity,
    supply,
    seenAt,
  );
}

beforeAll(async () => {
  await cleanup();

  /*
   * ★ THE FIXTURE BRINGS ITS OWN OWNER ★
   *
   * This borrowed the first row of `users` and threw when there was none — which is every CI run,
   * where the database is migrated but empty. So the spec passed on a developer's seeded machine
   * and failed the pull request, which is the worst way round: the machine that gates the merge
   * was the one that could not run it.
   *
   * A project needs an owner, so the fixture makes one and takes it away again (`cleanup` deletes
   * by the same handle). Borrowing a real member's row was never right either — a spec that writes
   * projects against whoever happens to be first in the table is a spec whose failures depend on
   * the seed.
   */
  await db.$executeRawUnsafe(
    `INSERT INTO users (id, handle, display_name, timezone, status, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, 'Carrier Search Fixture', 'UTC', 'active', now(), now())
     ON CONFLICT (handle) DO NOTHING`,
    FIXTURE_HANDLE,
  );
  const [owner] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text AS id FROM users WHERE handle = $1`,
    FIXTURE_HANDLE,
  );
  if (owner === undefined) throw new Error('could not create the fixture owner');

  const [project] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO colony_projects
       (id, owner, market_id, title, system_name, station_name, build_type, visibility,
        posted_by_id, created_at, updated_at)
     VALUES (gen_random_uuid(), 'personal', $2::bigint, 'Carrier search fixture', 'Test System',
             'Test Site', 'Outpost', 'squadron', $1::uuid, now(), now())
     RETURNING id::text AS id`,
    owner.id,
    FIXTURE_SITE,
  );
  projectId = project?.id ?? '';

  await db.$executeRawUnsafe(
    `INSERT INTO colony_needs (project_id, commodity, required, remaining, observed_at)
     VALUES ($1::uuid, $2, 40000, 40000, now()),
            ($1::uuid, $3, 30000, 30000, now())`,
    projectId,
    FIXTURE_A,
    FIXTURE_B,
  );

  // A carrier catalogued under the galaxy dump's spelling, holding one of the build's commodities.
  await catalogue(KEY_DUMP, 'T3D-D3D', DUMP_SPELLING, 'Drake-Class Carrier', 'Test System');
  await market(KEY_DUMP, 'T3D-D3D', 'Test System', FIXTURE_A, 900, '2026-08-01T00:00:00Z');

  // The owner's case: catalogued under the JOURNAL's spelling, holding more than the one above.
  await catalogue(KEY_JOURNAL, 'T3J-J3J', JOURNAL_SPELLING, 'FleetCarrier', 'Test System');
  await market(KEY_JOURNAL, 'T3J-J3J', 'Test System', FIXTURE_A, 5000, '2026-08-02T00:00:00Z');

  // Catalogued and real, but nobody has ever reported its market.
  await catalogue(KEY_NO_MARKET, 'T3N-N3N', NO_MARKET, 'Drake-Class Carrier', 'Test System');

  // One carrier, two berths. The mirror holds market rows under both keys.
  await catalogue(KEY_MOVED_OLD, 'T3M-M3M', MOVED, 'Drake-Class Carrier', 'Old Berth');
  await catalogue(KEY_MOVED_NEW, 'T3M-M3M', MOVED, 'FleetCarrier', 'New Berth');
  await market(KEY_MOVED_OLD, 'T3M-M3M', 'Old Berth', FIXTURE_B, 14520, '2026-07-30T16:40:00Z');
  await market(KEY_MOVED_NEW, 'T3M-M3M', 'New Berth', FIXTURE_B, 6600, '2026-08-05T02:43:00Z');
  /*
   * ★ THE HOOK NEEDS LONGER THAN THE DEFAULT TEN SECONDS ★
   *
   * Run alone this setup takes about six. Run as one of a hundred-odd spec files against a dev
   * mirror holding 49,444 carriers and 25,277 carrier markets, the same statements queue behind
   * everything else and overshoot — so the suite failed only in the full run, which is the shape
   * of flake that gets blamed on the code under test rather than on the clock.
   */
}, HOOK_MS);

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
}, HOOK_MS);

describe('finding a carrier by callsign', () => {
  it('★ finds a carrier catalogued under the JOURNAL spelling — the reported bug ★', async () => {
    const found = await service.search(projectId, 'T3J-J3J');

    // Before the fix this was an empty array, and the page said "no carrier we have seen…" about a
    // carrier sitting in the catalogue with a market reported the day before.
    expect(found).toHaveLength(1);
    expect(found[0]?.marketId).toBe(JOURNAL_SPELLING);
    expect(found[0]?.matchingTonnes).toBe(5000);
  });

  it('finds the same carrier however the callsign is typed', async () => {
    // Lower case, no dash, and stray whitespace are the three ways a real person gets it wrong,
    // and none of them is wrong. All four requests are the same carrier.
    for (const typed of ['T3J-J3J', 't3j-j3j', 'T3JJ3J', '  t3jj3j  ']) {
      const found = await service.search(projectId, typed);
      expect(found.map((c) => c.marketId), `typed as "${typed}"`).toEqual([JOURNAL_SPELLING]);
    }
  });

  it('★ finds a carrier the galaxy knows even when NOBODY has reported its market ★', async () => {
    /*
     * The old search could not return this row at all: it drove from `market_entries`, so a carrier
     * with no market rows did not exist as far as it was concerned. That is the case the
     * declared-hold feature exists for — the crew types what is aboard — and it was unreachable
     * because the carrier could never be attached in the first place.
     */
    const found = await service.search(projectId, 'T3N-N3N');

    expect(found).toHaveLength(1);
    expect(found[0]?.marketId).toBe(NO_MARKET);
    // Zero is a FACT here, not an absence of one: we hold the carrier and hold no market for it.
    expect(found[0]?.matchingTonnes).toBe(0);
    expect(found[0]?.matchingCommodities).toBe(0);
    expect(found[0]?.seenAt).toBeNull();
  });

  it('attaches that market-less carrier rather than refusing it', async () => {
    // The refusal used to say "Nobody has reported that carrier's market yet". The check was never
    // about the market, and a carrier the catalogue knows is attachable.
    await expect(
      service.attach({
        projectId,
        marketId: NO_MARKET,
        isSquadron: false,
        callerId: (await db.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id::text AS id FROM users LIMIT 1`,
        ))[0]!.id,
        callerMask: 0n,
      }),
    ).resolves.toEqual({ marketId: NO_MARKET });

    const [row] = await db.$queryRawUnsafe<Array<{ callsign: string }>>(
      `SELECT callsign FROM colony_carriers WHERE project_id = $1::uuid AND market_id = $2::bigint`,
      projectId,
      NO_MARKET,
    );
    expect(row?.callsign).toBe('T3N-N3N');
  });

  it('★ refuses an unknown callsign honestly, and does not invent a carrier from typed text ★', async () => {
    const found = await service.search(projectId, 'ZZZ-ZZZ');
    expect(found).toEqual([]);

    // And attaching a market id we hold no carrier for names the true condition and the true
    // remedy, rather than the old sentence's — which told somebody to dock at it, the exact act
    // that used to make a carrier disappear.
    await expect(
      service.attach({
        projectId,
        marketId: '900000000000999',
        isSquadron: false,
        callerId: (await db.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id::text AS id FROM users LIMIT 1`,
        ))[0]!.id,
        callerMask: 0n,
      }),
    ).rejects.toThrow(/We hold no fleet carrier under that identifier/);
  });

  it('★ narrows on a PARTIAL callsign, dash and all, for somebody still typing ★', async () => {
    /*
     * Four characters, so the stored dash sits INSIDE what was typed. The value arrives with the
     * dash stripped — `T3JJ` — and the catalogue name is `T3J-J3J`, so a pattern built from the
     * bare characters matches nothing. This is the assertion that catches that.
     */
    const found = await service.search(projectId, 'T3JJ');
    expect(found.map((c) => c.marketId)).toContain(JOURNAL_SPELLING);

    // And a partial short enough to sit inside the first group still works the plain way.
    const firstGroup = await service.search(projectId, 'T3N');
    expect(firstGroup.map((c) => c.marketId)).toContain(NO_MARKET);
  });
});

describe('a carrier that has jumped is ONE carrier', () => {
  it('★ lists it once, at the berth we saw most recently ★', async () => {
    const found = await service.search(projectId, 'T3M-M3M');

    // Two catalogue keys and two sets of market rows, one carrier. Listing it twice would offer
    // the same "Add" button under two different systems.
    expect(found).toHaveLength(1);
    expect(found[0]?.systemName).toBe('New Berth');
    // 6,600 t at the current berth — NOT 21,120 t, which is what summing both berths gives and
    // what the old query would have reported once the type filter stopped hiding it.
    expect(found[0]?.matchingTonnes).toBe(6600);
  });

  it('does not double-count its hold once it is on the build', async () => {
    const [owner] = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text AS id FROM users LIMIT 1`,
    );
    await service.attach({
      projectId,
      marketId: MOVED,
      isSquadron: false,
      callerId: owner!.id,
      callerMask: 0n,
    });

    const attached = await service.forProject(projectId);
    const moved = attached.find((c) => c.marketId === MOVED);

    expect(moved).toBeDefined();
    // The number a member plans a haul against. 21,120 is two real readings of the same hold added
    // together, and it looks entirely plausible — which is why it needs an assertion rather than
    // an eye.
    expect(moved?.totalTonnes).toBe(6600);
    expect(moved?.holds).toHaveLength(1);
    expect(moved?.systemName).toBe('New Berth');
  });
});

describe('the blank search — still the most useful one', () => {
  it('★ ranks every carrier by how much of THIS build it is holding ★', async () => {
    const found = await service.search(projectId, '');
    const ours = found.filter((c) =>
      [DUMP_SPELLING, JOURNAL_SPELLING, NO_MARKET, MOVED].includes(c.marketId),
    );

    // The carrier with no market at all is correctly absent: it is not an answer to "who can help".
    expect(ours.map((c) => c.marketId)).not.toContain(NO_MARKET);

    // And the ones that ARE holding something sort by tonnes, heaviest first.
    const tonnes = ours.map((c) => c.matchingTonnes);
    expect([...tonnes].sort((a, b) => b - a)).toEqual(tonnes);

    const journal = ours.find((c) => c.marketId === JOURNAL_SPELLING);
    const dump = ours.find((c) => c.marketId === DUMP_SPELLING);
    expect(journal?.matchingTonnes).toBe(5000);
    expect(dump?.matchingTonnes).toBe(900);
    // 5,000 t beats 900 t, and the journal-spelled carrier is in the ranking at all — it was
    // invisible to this query too, not just to the callsign one.
    expect(ours.indexOf(journal!)).toBeLessThan(ours.indexOf(dump!));
  });

  it('lists a jumped carrier once here too, at its newest berth', async () => {
    const found = await service.search(projectId, '');
    const moved = found.filter((c) => c.marketId === MOVED);
    expect(moved).toHaveLength(1);
    expect(moved[0]?.matchingTonnes).toBe(6600);
  });
});
