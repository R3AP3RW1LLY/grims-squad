import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@grims/db';
import { ColonyPurchasesService } from './colony-purchases.service.js';

/**
 * The purchase catalogue, against real Postgres.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * "a way to declare what station a commander purchased various materials from ... group all
 * materials bought at each station by the station name and system name please! so its easy for us to
 * identify where to go!"
 *
 * ★ WHY INTEGRATION AND NOT UNIT ★
 *
 * Every interesting part is SQL: an EXISTS against the projects table, a join from a journal
 * payload's MarketID to a station, and a merge of two sources with different precedence. None of it
 * typechecks, and the one bug found while building this — a JOIN that multiplied every purchase by
 * the number of projects its buyer had in the system — produced a plausible number rather than an
 * error. Only running it against a database catches that shape.
 */

const db = new PrismaClient();
const service = new ColonyPurchasesService(db);

const TAG = 'colony-purchases-int-spec';
const SYSTEM = `${TAG} system`;

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

async function cleanUp(): Promise<void> {
  await db.$executeRawUnsafe(`DELETE FROM colony_purchases WHERE system_name = $1`, SYSTEM);
  await db.$executeRawUnsafe(`DELETE FROM colony_projects WHERE system_name = $1`, SYSTEM);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE handle LIKE $1`, `${TAG}%`);
}

describe('the purchase catalogue', () => {
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
    await cleanUp();
    const owner = await seedMember(`${TAG}-owner`);
    const mine = await seedProject(owner, 4900000000001n, `${TAG} A`);

    expect((await service.visibleFor(mine))?.systemName).toBe(SYSTEM);

    // A second commander posts into the same system: it is nobody's private catalogue now.
    const other = await seedMember(`${TAG}-other`);
    await seedProject(other, 4900000000002n, `${TAG} B`);

    expect(
      await service.visibleFor(mine),
      'a system with two posters is not one commander colonising it, so no catalogue',
    ).toBeNull();
  });

  it('★ MANDATORY: materials are grouped by station and its own system ★', async () => {
    await cleanUp();
    const owner = await seedMember(`${TAG}-owner`);
    const project = await seedProject(owner, 4900000000001n, `${TAG} A`);
    const scope = await service.visibleFor(project);
    expect(scope).not.toBeNull();

    for (const [commodity, tonnes] of [
      ['Titanium', 923],
      ['Copper', 85],
      ['Superconductors', 60],
    ] as const) {
      await service.declare({
        systemName: SYSTEM,
        stationName: 'Armstrong Legacy',
        stationSystem: 'Col 285 Sector US-Q b6-5',
        commodity,
        tonnes,
        price: null,
        note: null,
        userId: owner,
      });
    }
    await service.declare({
      systemName: SYSTEM,
      stationName: 'Whedon Landing',
      stationSystem: 'HIP 42612',
      commodity: 'Micro Controllers',
      tonnes: 13,
      price: null,
      note: null,
      userId: owner,
    });

    const stations = await service.forSystem(SYSTEM);

    expect(stations.map((s) => s.stationName)).toEqual(['Armstrong Legacy', 'Whedon Landing']);
    const [armstrong] = stations;
    expect(
      armstrong?.systemName,
      'the STATION system, not the build system — this is what a member pastes into the galaxy map',
    ).toBe('Col 285 Sector US-Q b6-5');
    expect(armstrong?.lines.map((l) => l.commodity)).toEqual([
      'Copper',
      'Superconductors',
      'Titanium',
    ]);
  });

  it('MANDATORY: the fullest station comes first, because that is the trip worth flying', async () => {
    // A stop that fills half a hold beats one with a single line, however recently somebody was there.
    const stations = await service.forSystem(SYSTEM);
    expect(stations[0]?.lines.length).toBeGreaterThan(stations[1]?.lines.length ?? 0);
  });

  it('MANDATORY: re-declaring updates rather than duplicating', async () => {
    /*
     * A member correcting yesterday's figure must not leave both numbers on the page — that is a
     * catalogue nobody can trust, which is worse than one nobody has filled in.
     */
    const owner = await seedMember(`${TAG}-owner`);
    await service.declare({
      systemName: SYSTEM,
      stationName: 'Armstrong Legacy',
      stationSystem: 'Col 285 Sector US-Q b6-5',
      commodity: 'Titanium',
      tonnes: 40,
      price: 1200,
      note: 'nearly gone',
      userId: owner,
    });

    const [armstrong] = await service.forSystem(SYSTEM);
    const titanium = armstrong?.lines.filter((l) => l.commodity === 'Titanium') ?? [];
    expect(titanium).toHaveLength(1);
    expect(titanium[0]?.tonnes).toBe(40);
    expect(titanium[0]?.note).toBe('nearly gone');
  });

  it('MANDATORY: a member can withdraw only their own entry', async () => {
    const owner = await seedMember(`${TAG}-owner`);
    const other = await seedMember(`${TAG}-other`);

    // Somebody else's withdrawal must not remove it — a catalogue anybody can delete from is one
    // nobody can rely on.
    await service.withdraw({
      systemName: SYSTEM,
      stationName: 'Armstrong Legacy',
      commodity: 'Titanium',
      userId: other,
    });
    let [armstrong] = await service.forSystem(SYSTEM);
    expect(armstrong?.lines.some((l) => l.commodity === 'Titanium')).toBe(true);

    await service.withdraw({
      systemName: SYSTEM,
      stationName: 'Armstrong Legacy',
      commodity: 'Titanium',
      userId: owner,
    });
    [armstrong] = await service.forSystem(SYSTEM);
    expect(armstrong?.lines.some((l) => l.commodity === 'Titanium')).toBe(false);
  });

  it('refuses an entry with no station or no system to fly to', async () => {
    const owner = await seedMember(`${TAG}-owner`);
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

  it('a system nobody has bought in answers empty rather than throwing', async () => {
    expect(await service.forSystem('a system with no purchases at all')).toEqual([]);
  });
});
