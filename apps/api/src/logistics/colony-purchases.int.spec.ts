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

async function cleanUp(): Promise<void> {
  await db.$executeRawUnsafe(
    `DELETE FROM colony_carrier_cargo WHERE market_id = $1::bigint`,
    String(CARRIER_MARKET),
  );
  await db.$executeRawUnsafe(`DELETE FROM colony_purchases WHERE system_name = $1`, SYSTEM);
  await db.$executeRawUnsafe(`DELETE FROM colony_projects WHERE system_name = $1`, SYSTEM);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE handle LIKE $1`, `${TAG}%`);
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
