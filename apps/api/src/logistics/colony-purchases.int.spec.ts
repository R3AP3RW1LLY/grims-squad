import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@grims/db';
import { ColonyCarrierService } from './colony-carrier.service.js';
import { ColonyPurchasesService, stationKey } from './colony-purchases.service.js';

/**
 * The shopping route, against real Postgres.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * "do not show fleet carriers in here at all! and the stations shown where weve bought it from
 * should only show materials for the specific project at hand ... so we dont have people buying
 * duplicte materials etc and showing up and they already exist etc!"
 *
 * ★ WHY INTEGRATION AND NOT UNIT ★
 *
 * The RANKING is pure and is spec-tested next door without a database. Everything else here is SQL:
 * a carrier exclusion by station type, an EXISTS against the projects table, a distance operator, and
 * the subtraction of what is already aboard. None of it typechecks, and the one bug found while
 * building the first version — a JOIN that multiplied every purchase by the number of projects its
 * buyer had in the system — produced a plausible number rather than an error. Only running it against
 * a database catches that shape.
 */

const db = new PrismaClient();
const service = new ColonyPurchasesService(db, new ColonyCarrierService(db));

const TAG = 'colony-purchases-int-spec';
const SYSTEM = `${TAG} system`;
const CARRIER_MARKET = 4900000000900n;

async function seedMember(handle: string): Promise<string> {
  const [row] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO users (handle, display_name) VALUES ($1, $1)
     ON CONFLICT (handle) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
    handle,
  );
  return (row as { id: string }).id;
}

async function seedProject(userId: string, marketId: bigint, title: string): Promise<string> {
  const [row] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO colony_projects (market_id, system_name, title, owner, posted_by_id, updated_at)
     VALUES ($1::bigint, $2, $3, 'squadron', $4::uuid, now())
     ON CONFLICT (market_id) DO UPDATE SET title = EXCLUDED.title
     RETURNING id`,
    String(marketId),
    SYSTEM,
    title,
    userId,
  );
  return (row as { id: string }).id;
}

/** What the build still wants. `remaining` is already net of everything delivered. */
async function seedNeeds(projectId: string, needs: ReadonlyArray<[string, number]>): Promise<void> {
  for (const [commodity, remaining] of needs) {
    await db.$executeRawUnsafe(
      `INSERT INTO colony_needs (project_id, commodity, remaining, required, observed_at)
       VALUES ($1::uuid, $2, $3, $3, now())
       ON CONFLICT (project_id, commodity) DO UPDATE SET remaining = EXCLUDED.remaining`,
      projectId,
      commodity,
      remaining,
    );
  }
}

/**
 * Puts a system on the map so distance can actually be measured.
 *
 * ★ TEST-ONLY NAMES, DELIBERATELY ★
 *
 * The obvious thing is to seed the real system the owner named. That would write coordinates over
 * a live catalogue row on a database this suite shares with real squadron data — and every later
 * run would be measuring against whatever the last test decided. Both ends of the trip are
 * TAG-prefixed and are deleted with everything else.
 */
async function placeSystem(name: string, x: number, y: number, z: number): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO knowledge_items (source, kind, ext_key, name, coords, data)
     VALUES ('galaxy', 'system', $1, $1, cube(array[$2::float8, $3::float8, $4::float8]), '{}'::jsonb)
     ON CONFLICT (source, kind, ext_key) DO UPDATE SET coords = EXCLUDED.coords, name = EXCLUDED.name`,
    name,
    x,
    y,
    z,
  );
}

async function cleanUp(): Promise<void> {
  await db.$executeRawUnsafe(
    `DELETE FROM colony_carrier_cargo WHERE market_id = $1::bigint`,
    String(CARRIER_MARKET),
  );
  await db.$executeRawUnsafe(`DELETE FROM colony_purchases WHERE system_name LIKE $1`, `${TAG}%`);
  await db.$executeRawUnsafe(`DELETE FROM colony_projects WHERE system_name LIKE $1`, `${TAG}%`);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE handle LIKE $1`, `${TAG}%`);
  // The two systems `placeSystem` puts on the map. Left behind, they would silently change the
  // distance every later run measures against.
  await db.$executeRawUnsafe(
    `DELETE FROM knowledge_items WHERE kind = 'system' AND ext_key LIKE $1`,
    `${TAG}%`,
  );
  // The station fixture the orbital test seeds. Left behind it would collide on the next run and
  // fail a test that has nothing to do with what it is asserting.
  await db.$executeRawUnsafe(
    `DELETE FROM knowledge_items WHERE ext_key = 'purchases-int-orbital-dock'`,
  );
}

/** A project with three outstanding materials and one member. */
async function seedBuild(): Promise<{ owner: string; project: string }> {
  await cleanUp();
  const owner = await seedMember(`${TAG}-owner`);
  const project = await seedProject(owner, 4900000000001n, `${TAG} A`);
  await seedNeeds(project, [
    ['Titanium', 5000],
    ['Copper', 400],
    ['Superconductors', 120],
  ]);
  return { owner, project };
}

describe('the shopping route', () => {
  afterAll(async () => {
    await cleanUp();
    await db.$disconnect();
  });

  it('★ MANDATORY: it appears only when one commander is colonising the system ★', async () => {
    /*
     * "only for projects in systems that are being colonized by the commander that started the
     * colonization project". No ownership column exists; every system on production has exactly one
     * poster, so the poster IS the coloniser and a second poster means it is not one person's system.
     */
    const { owner, project } = await seedBuild();
    expect((await service.visibleFor(project))?.systemName).toBe(SYSTEM);

    // A second commander posts into the same system: it is nobody's private catalogue now.
    const other = await seedMember(`${TAG}-other`);
    await seedProject(other, 4900000000002n, `${TAG} B`);

    expect(
      await service.visibleFor(project),
      'a system with two posters is not one commander colonising it, so no catalogue',
    ).toBeNull();
    expect(owner).not.toBe(other);
  });

  it('★ MANDATORY: only what THIS build still needs — nothing else the squadron bought ★', async () => {
    /*
     * "should only show materials for the specific project at hand". A member's Palladium run is a
     * real purchase and it is not this build's problem; showing it is how somebody ends up hauling
     * something nobody asked for.
     */
    const { owner, project } = await seedBuild();

    for (const commodity of ['Titanium', 'Palladium']) {
      await service.declare({
        systemName: SYSTEM,
        stationName: 'Armstrong Legacy',
        stationSystem: 'Col 285 Sector US-Q b6-5',
        commodity,
        tonnes: 900,
        price: null,
        note: null,
        userId: owner,
      });
    }

    const route = await service.forProject(project);
    const listed = route.stations.flatMap((s) => s.lines.map((l) => l.commodity));

    expect(listed).toContain('Titanium');
    expect(listed, 'bought here, but not on this build’s list').not.toContain('Palladium');
  });

  it('★ MANDATORY: the station’s KIND reaches the route, orbital or ground ★', async () => {
    /*
     * ★ MUTATION TESTING FOUND THIS UNTESTED ★
     *
     * `rankBuySources` puts orbital stations ahead of ground ones because a descent and a launch on
     * every run costs more than the light years between two stops. All of that reasoning is dead
     * weight if the flag never arrives — and replacing `isOrbitalStation(type)` with a bare `null`
     * broke nothing in any unit test, because they build candidates by hand.
     *
     * This is the only path where a real station type is read out of `knowledge_items` and turned
     * into the flag the ordering depends on.
     */
    const { owner, project } = await seedBuild();

    await db.$executeRawUnsafe(
      `INSERT INTO knowledge_items (source, kind, ext_key, name, data)
       VALUES ('galaxy', 'station', $5, $1, jsonb_build_object('system', $2, 'type', $3, 'marketId', $4))
       ON CONFLICT (source, kind, ext_key) DO UPDATE SET data = EXCLUDED.data, name = EXCLUDED.name`,
      'Orbital Test Dock',
      'Col 285 Sector US-Q b6-5',
      'Coriolis Starport',
      '9900001',
      'purchases-int-orbital-dock',
    );

    await service.declare({
      systemName: SYSTEM,
      stationName: 'Orbital Test Dock',
      stationSystem: 'Col 285 Sector US-Q b6-5',
      commodity: 'Titanium',
      tonnes: 900,
      price: null,
      note: null,
      userId: owner,
    });

    const route = await service.forProject(project);
    const stop = route.stations.find((s) => s.stationName === 'Orbital Test Dock');

    expect(stop, 'the declared stop is on the route').toBeDefined();
    expect(stop?.isOrbital, 'a Coriolis Starport is in orbit').toBe(true);
  });

  it('★ MANDATORY: where the squadron bought it is SQUADRON knowledge, not this project’s ★', async () => {
    /*
     * ★ SQUADRON OWNER, 2026-08-18 ★
     *
     * "stuff like this needs to be shared from other projects they should not be member specific
     * this is information that should be shared, in this case this project is right next door to me
     * so it should be showing the same or very similar results everywhere"
     *
     * ★ WHAT THE TWO SOURCES USED TO ASK ★
     *
     * The journal source required `EXISTS (... p.posted_by_id = t.user_id AND p.system_name = $1)`
     * — only members who had themselves posted a project in THIS system — and the declared source
     * required `c.system_name = $1`. So a member who bought 900 t of Copper at a dock eight light
     * years away, for a build one system over, contributed nothing at all to this project's page.
     *
     * That is not a fact about a project. "This station sells Copper" is a fact about the galaxy,
     * discovered by somebody in the squadron, and it was being thrown away because the person who
     * discovered it was building somewhere else. Every project started from nothing while the
     * platform already held the answer.
     *
     * The section still only appears for a system with one coloniser — `visibleFor` is unchanged
     * and is a different question. What feeds it is squadron-wide.
     */
    const { project } = await seedBuild();

    // Somebody else entirely, building somewhere else entirely.
    const neighbour = await seedMember(`${TAG}-neighbour`);
    await db.$executeRawUnsafe(
      `INSERT INTO colony_projects (market_id, system_name, title, owner, posted_by_id, updated_at)
       VALUES ($1::bigint, $2, $3, 'squadron', $4::uuid, now())
       ON CONFLICT (market_id) DO UPDATE SET title = EXCLUDED.title`,
      String(4900000000777n),
      `${TAG} elsewhere`,
      `${TAG} NEIGHBOUR`,
      neighbour,
    );

    /*
     * Both ends on the map, eight light years apart — "right next door", in the owner's words. The
     * sharing is bounded by DISTANCE, so a test that leaves either end uncatalogued is not
     * exercising the rule; it is exercising the fallback.
     */
    await placeSystem(SYSTEM, 0, 0, 0);
    await placeSystem(`${TAG} nextdoor`, 8, 0, 0);

    await service.declare({
      // Filed against THEIR system, not ours. This is the whole point.
      systemName: `${TAG} elsewhere`,
      stationName: 'Wescott Platform',
      stationSystem: `${TAG} nextdoor`,
      commodity: 'Copper',
      tonnes: 400,
      price: null,
      note: null,
      userId: neighbour,
    });

    const route = await service.forProject(project);
    const listed = route.stations.flatMap((s) => s.lines.map((l) => l.commodity));

    expect(
      listed,
      'a neighbour’s purchase of something THIS build needs belongs on this route',
    ).toContain('Copper');
    expect(route.uncovered, 'and it must no longer be reported as nobody having bought it').not.toContain(
      'Copper',
    );
  });

  it('★ MANDATORY: sharing does not import things this build does not need ★', async () => {
    /*
     * The guard on the rule above. Widening the source from "this project" to "the squadron" must
     * not widen WHAT is listed — `wanted` is still the gate, and a neighbour's Palladium run is
     * still nobody's problem here. Losing this would turn every project page into a catalogue of
     * everything the squadron has ever bought.
     */
    const { project } = await seedBuild();
    const neighbour = await seedMember(`${TAG}-neighbour2`);

    /*
     * ★ WITHOUT THESE TWO LINES THIS TEST PASSED FOR THE WRONG REASON ★
     *
     * seedBuild() calls cleanUp(), which deletes the systems the previous test placed. With neither
     * end on the map the proximity door is NULL and the Palladium row never reaches the route at
     * all — so the assertion held whether or not the `wanted` filter existed. Mutation testing
     * caught it: deleting `if (!wanted.has(...)) return;` broke nothing.
     *
     * The row has to be ADMITTED for its exclusion to mean anything.
     */
    await placeSystem(SYSTEM, 0, 0, 0);
    await placeSystem(`${TAG} nextdoor`, 8, 0, 0);

    await service.declare({
      systemName: `${TAG} elsewhere`,
      stationName: 'Wescott Platform',
      stationSystem: `${TAG} nextdoor`,
      commodity: 'Palladium',
      tonnes: 400,
      price: null,
      note: null,
      userId: neighbour,
    });

    const route = await service.forProject(project);
    const listed = route.stations.flatMap((s) => s.lines.map((l) => l.commodity));

    expect(listed, 'not on this build’s list, wherever it was bought').not.toContain('Palladium');
  });

  it('★ MANDATORY: what is already aboard a carrier is not on the shopping list ★', async () => {
    /*
     * "Hide what is aboard your carriers" — the owner's own answer. 5,000 t of Titanium is wanted and
     * 5,000 t is staged on the attached carrier: there is nothing left to buy, and a row saying
     * otherwise is how two people fly for cargo that is already parked at the build site.
     */
    const { owner, project } = await seedBuild();

    await db.$executeRawUnsafe(
      `INSERT INTO colony_carriers (project_id, market_id, name, callsign, is_squadron, added_by_id)
       VALUES ($1::uuid, $2::bigint, 'B2W-04T', 'B2W-04T', true, $3::uuid)
       ON CONFLICT (project_id, market_id) DO NOTHING`,
      project,
      String(CARRIER_MARKET),
      owner,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO colony_carrier_cargo (market_id, commodity, source, tonnes, updated_by_id, updated_at)
       VALUES ($1::bigint, 'Titanium', 'manual', 5000, $2::uuid, now())
       ON CONFLICT (market_id, commodity, source) DO UPDATE SET tonnes = EXCLUDED.tonnes`,
      String(CARRIER_MARKET),
      owner,
    );

    for (const commodity of ['Titanium', 'Copper']) {
      await service.declare({
        systemName: SYSTEM,
        stationName: 'Armstrong Legacy',
        stationSystem: 'Col 285 Sector US-Q b6-5',
        commodity,
        tonnes: 900,
        price: null,
        note: null,
        userId: owner,
      });
    }

    const route = await service.forProject(project);
    const listed = route.stations.flatMap((s) => s.lines.map((l) => l.commodity));

    expect(listed, 'all 5,000 t of it is already at the build site').not.toContain('Titanium');
    expect(listed, 'and Copper still needs buying').toContain('Copper');
  });

  it('★ MANDATORY: a partly-covered material is still on the list ★', async () => {
    // 400 t wanted, 100 t aboard. Somebody still has to buy 300 t, so hiding the row would be wrong.
    const { owner, project } = await seedBuild();

    await db.$executeRawUnsafe(
      `INSERT INTO colony_carriers (project_id, market_id, name, callsign, is_squadron, added_by_id)
       VALUES ($1::uuid, $2::bigint, 'B2W-04T', 'B2W-04T', true, $3::uuid)
       ON CONFLICT (project_id, market_id) DO NOTHING`,
      project,
      String(CARRIER_MARKET),
      owner,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO colony_carrier_cargo (market_id, commodity, source, tonnes, updated_by_id, updated_at)
       VALUES ($1::bigint, 'Copper', 'manual', 100, $2::uuid, now())
       ON CONFLICT (market_id, commodity, source) DO UPDATE SET tonnes = EXCLUDED.tonnes`,
      String(CARRIER_MARKET),
      owner,
    );

    await service.declare({
      systemName: SYSTEM,
      stationName: 'Armstrong Legacy',
      stationSystem: 'Col 285 Sector US-Q b6-5',
      commodity: 'Copper',
      tonnes: 900,
      price: null,
      note: null,
      userId: owner,
    });

    const route = await service.forProject(project);
    expect(route.stations.flatMap((s) => s.lines.map((l) => l.commodity))).toContain('Copper');
  });

  it('★ MANDATORY: a fleet carrier cannot be declared as a place to fly to ★', async () => {
    /*
     * "do not show fleet carriers in here at all!" — refused at the door rather than stored and then
     * hidden, which would look to the member who typed it like the save had silently failed.
     */
    const { owner } = await seedBuild();

    await expect(
      service.declare({
        systemName: SYSTEM,
        stationName: 'B2W-04T',
        stationSystem: 'Xinca',
        commodity: 'Titanium',
        tonnes: 5000,
        price: null,
        note: null,
        userId: owner,
      }),
      'a carrier is somewhere else tomorrow',
    ).rejects.toThrow(/fleet carrier/i);
  });

  it('★ MANDATORY: each material appears at ONE station across the whole route ★', async () => {
    /*
     * The owner's complaint in one assertion: "dont show duplicate materials ... so we dont have
     * people buying duplicte materials". Two stations both stock Copper; only one is asked for it.
     */
    const { owner, project } = await seedBuild();

    for (const [station, system, commodity] of [
      ['Armstrong Legacy', 'Col 285 Sector US-Q b6-5', 'Copper'],
      ['Armstrong Legacy', 'Col 285 Sector US-Q b6-5', 'Titanium'],
      ['Whedon Landing', 'HIP 42612', 'Copper'],
    ] as const) {
      await service.declare({
        systemName: SYSTEM,
        stationName: station,
        stationSystem: system,
        commodity,
        tonnes: 500,
        price: null,
        note: null,
        userId: owner,
      });
    }

    const route = await service.forProject(project);
    const listed = route.stations.flatMap((s) => s.lines.map((l) => l.commodity));

    expect(listed).toHaveLength(new Set(listed).size);
    expect(listed.sort()).toEqual(['Copper', 'Titanium']);
    expect(
      route.stations.map((s) => s.stationName),
      'the station covering both is the only one worth the trip',
    ).toEqual(['Armstrong Legacy']);
  });

  it('★ MANDATORY: a material nothing stocks is named, not quietly left off ★', async () => {
    const { owner, project } = await seedBuild();
    await service.declare({
      systemName: SYSTEM,
      stationName: 'Armstrong Legacy',
      stationSystem: 'Col 285 Sector US-Q b6-5',
      commodity: 'Copper',
      tonnes: 500,
      price: null,
      note: null,
      userId: owner,
    });

    const route = await service.forProject(project);
    expect([...route.uncovered].sort()).toEqual(['Superconductors', 'Titanium']);
  });

  it('MANDATORY: a stop carries the STATION’s own system, for pasting into the map', async () => {
    const { owner, project } = await seedBuild();
    await service.declare({
      systemName: SYSTEM,
      stationName: 'Armstrong Legacy',
      stationSystem: 'Col 285 Sector US-Q b6-5',
      commodity: 'Titanium',
      tonnes: 900,
      price: null,
      note: null,
      userId: owner,
    });

    const [stop] = (await service.forProject(project)).stations;
    expect(
      stop?.systemName,
      'the STATION system, never the build system — this is what a member pastes into the galaxy map',
    ).toBe('Col 285 Sector US-Q b6-5');
  });

  it('MANDATORY: re-declaring updates rather than duplicating', async () => {
    /*
     * A member correcting yesterday's figure must not leave both numbers on the page — that is a
     * catalogue nobody can trust, which is worse than one nobody has filled in.
     */
    const { owner, project } = await seedBuild();

    for (const [tonnes, note] of [
      [900, null],
      [40, 'nearly gone'],
    ] as const) {
      await service.declare({
        systemName: SYSTEM,
        stationName: 'Armstrong Legacy',
        stationSystem: 'Col 285 Sector US-Q b6-5',
        commodity: 'Titanium',
        tonnes,
        price: 1200,
        note,
        userId: owner,
      });
    }

    const [stop] = (await service.forProject(project)).stations;
    const titanium = stop?.lines.filter((l) => l.commodity === 'Titanium') ?? [];
    expect(titanium).toHaveLength(1);
    expect(titanium[0]?.tonnes).toBe(40);
    expect(titanium[0]?.note).toBe('nearly gone');
  });

  it('MANDATORY: a member can withdraw only their own entry', async () => {
    const { owner, project } = await seedBuild();
    const other = await seedMember(`${TAG}-other-2`);

    await service.declare({
      systemName: SYSTEM,
      stationName: 'Armstrong Legacy',
      stationSystem: 'Col 285 Sector US-Q b6-5',
      commodity: 'Titanium',
      tonnes: 900,
      price: null,
      note: null,
      userId: owner,
    });

    const has = async (): Promise<boolean> =>
      (await service.forProject(project)).stations.some((s) =>
        s.lines.some((l) => l.commodity === 'Titanium'),
      );

    // Somebody else's withdrawal must not remove it — a catalogue anybody can delete from is one
    // nobody can rely on.
    await service.withdraw({
      systemName: SYSTEM,
      stationName: 'Armstrong Legacy',
      commodity: 'Titanium',
      userId: other,
    });
    expect(await has()).toBe(true);

    await service.withdraw({
      systemName: SYSTEM,
      stationName: 'Armstrong Legacy',
      commodity: 'Titanium',
      userId: owner,
    });
    expect(await has()).toBe(false);
  });

  it('refuses an entry with no station or no system to fly to', async () => {
    const { owner } = await seedBuild();
    await expect(
      service.declare({
        systemName: SYSTEM,
        stationName: 'Somewhere',
        stationSystem: '   ',
        commodity: 'Steel',
        tonnes: null,
        price: null,
        note: null,
        userId: owner,
      }),
      'a station name with no system is a place nobody can navigate to',
    ).rejects.toThrow();
  });

  it('a build that needs nothing gets no route rather than an error', async () => {
    await cleanUp();
    const owner = await seedMember(`${TAG}-owner`);
    const project = await seedProject(owner, 4900000000001n, `${TAG} A`);

    const route = await service.forProject(project);
    expect(route.stations).toEqual([]);
    expect(route.uncovered).toEqual([]);
    expect(route.systemName).toBe(SYSTEM);
  });
});

/**
 * ★ THE CARRIER THAT WAS TWO PLACES — CAUGHT IN PRODUCTION, 2026-08-10 ★
 *
 * The first version shipped, and the live data showed `B2W-04T` listed twice: seventeen materials
 * under Xinca and the same seventeen under ICZ EW-V b2-4. A fleet carrier is the one station that
 * changes system, so its market id matches a station record per place we have seen it, and a plain
 * join produced one entry per sighting.
 *
 * Carriers are off the route entirely now, but the rule stands for anything else we hold twice.
 */
describe('a station is keyed by identity, not by where it was last seen', () => {
  it('★ MANDATORY: one market id is one place, whatever system it was in ★', () => {
    expect(stationKey('B2W-04T', 'Xinca', '3708694784')).toBe(
      stationKey('B2W-04T', 'ICZ EW-V b2-4', '3708694784'),
    );
  });

  it('MANDATORY: two different stations never collapse into one', () => {
    expect(stationKey('Armstrong Legacy', 'Xinca', '3708694784')).not.toBe(
      stationKey('Whedon Landing', 'Xinca', '3713238272'),
    );
  });

  it('a hand-typed row has no market id and keys on name and system', () => {
    /*
     * Right for declarations: a member naming a station we have never catalogued is exactly the case
     * the manual half exists for, and it has no id to key on.
     */
    expect(stationKey('Armstrong Legacy', 'Col 285 Sector US-Q b6-5')).toBe(
      'Col 285 Sector US-Q b6-5 Armstrong Legacy',
    );
    expect(stationKey('Armstrong Legacy', 'Somewhere Else')).not.toBe(
      stationKey('Armstrong Legacy', 'Col 285 Sector US-Q b6-5'),
    );
  });
});
