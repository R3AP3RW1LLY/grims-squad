import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@grims/db';
import { ColonyCarrierService } from './colony-carrier.service.js';

/**
 * The aggregated manifest, against real Postgres.
 *
 * ★ SQUADRON OWNER, 2026-08-09 ★
 *
 * "it can be active on many projects and it will give me an aggregated total of all materials needed
 * to get all the builds completed if i am buying and storing on a fleet carrier"
 *
 * ★ THE ONE THING THIS HAS TO GET RIGHT ★
 *
 * A carrier attached to several builds holds ONE hold. Each project page correctly reports the whole
 * of it as cover, because each is answering "what do the carriers attached to me hold". Add those
 * pages up and the same cargo is counted once per build.
 *
 * So the assertion that matters is not "the totals add up" — it is that the carrier's tonnes are
 * subtracted EXACTLY ONCE from the summed need, however many builds want that commodity.
 *
 * Integration rather than unit, because the summing is a GROUP BY across a join and the merge is
 * three tables deep. None of that typechecks, and a wrong join would produce a plausible number.
 */

const db = new PrismaClient();
const service = new ColonyCarrierService(db);

/** Ids nobody has, so seeded rows cannot collide with a real build. */
const TAG = 'carrier-manifest-int-spec';
const MARKET_ID = 3700000000009n;

async function seed(): Promise<{ userId: string; projectA: string; projectB: string }> {
  const [user] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO users (handle, display_name) VALUES ($1, $1)
     ON CONFLICT (handle) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
    TAG,
  );
  const userId = (user as { id: string }).id;

  const project = async (suffix: string, marketId: bigint): Promise<string> => {
    const [row] = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO colony_projects (market_id, system_name, station_name, title, owner, posted_by_id, updated_at)
       VALUES ($1::bigint, $2, $3, $4, 'squadron', $5::uuid, now())
       ON CONFLICT (market_id) DO UPDATE SET title = EXCLUDED.title
       RETURNING id`,
      String(marketId),
      `${TAG} system`,
      `${TAG} ${suffix}`,
      `${TAG} ${suffix}`,
      userId,
    );
    return (row as { id: string }).id;
  };

  const projectA = await project('A', 3700000000001n);
  const projectB = await project('B', 3700000000002n);

  for (const id of [projectA, projectB]) {
    await db.$executeRawUnsafe(
      `INSERT INTO colony_carriers (project_id, market_id, name, callsign, is_squadron, added_by_id)
       VALUES ($1::uuid, $2::bigint, $3, 'TST-1XX', true, $4::uuid)
       ON CONFLICT (project_id, market_id) DO NOTHING`,
      id,
      String(MARKET_ID),
      `${TAG} carrier`,
      userId,
    );
  }

  return { userId, projectA, projectB };
}

async function need(projectId: string, commodity: string, remaining: number): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO colony_needs (project_id, commodity, remaining, observed_at)
     VALUES ($1::uuid, $2, $3, now())
     ON CONFLICT (project_id, commodity) DO UPDATE SET remaining = EXCLUDED.remaining`,
    projectId,
    commodity,
    remaining,
  );
}

async function cleanUp(userId: string): Promise<void> {
  await db.$executeRawUnsafe(`DELETE FROM colony_carrier_cargo WHERE market_id = $1::bigint`, String(MARKET_ID));
  await db.$executeRawUnsafe(`DELETE FROM carrier_cargo WHERE market_id = $1::bigint`, String(MARKET_ID));
  // colony_carriers and colony_needs cascade from the projects.
  await db.$executeRawUnsafe(`DELETE FROM colony_projects WHERE title LIKE $1`, `${TAG}%`);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE id = $1::uuid`, userId);
}

describe('one carrier, several builds', () => {
  let userId = '';

  afterAll(async () => {
    if (userId !== '') await cleanUp(userId);
    await db.$disconnect();
  });

  it(
    '★ MANDATORY: shared cargo is subtracted once, not once per build ★',
    async () => {
      const seeded = await seed();
      userId = seeded.userId;

      // Both builds want Steel; only one wants Titanium.
      await need(seeded.projectA, 'Steel', 400);
      await need(seeded.projectB, 'Steel', 600);
      await need(seeded.projectA, 'Titanium', 200);

      // 100 t of Steel aboard, from the journal. Each project page would call this 100 t of cover.
      await db.$executeRawUnsafe(
        `INSERT INTO colony_carrier_cargo (market_id, commodity, source, tonnes, updated_at)
         VALUES ($1::bigint, 'Steel', 'journal', 100, now())
         ON CONFLICT (market_id, commodity, source) DO UPDATE SET tonnes = EXCLUDED.tonnes`,
        String(MARKET_ID),
      );

      const manifest = await service.manifest(MARKET_ID);

      expect(manifest.carrier?.callsign).toBe('TST-1XX');
      expect(manifest.projects).toHaveLength(2);

      const steel = manifest.lines.find((l) => l.commodity === 'Steel');
      expect(steel?.needed, 'the two builds should sum to 1000 t').toBe(1000);
      expect(steel?.aboard, 'the hold holds 100 t whoever is asking').toBe(100);
      expect(
        steel?.toBuy,
        'the 100 t aboard was counted once per build — 1000 - 100 - 100 - it can only be delivered once',
      ).toBe(900);

      const titanium = manifest.lines.find((l) => l.commodity === 'Titanium');
      expect(titanium?.needed).toBe(200);
      expect(titanium?.aboard, 'nothing aboard for a commodity with no cargo row').toBe(0);
      expect(titanium?.toBuy).toBe(200);
    },
    60_000,
  );

  it('MANDATORY: a manual figure beats the journal, as it does on the project page', async () => {
    const seeded = await seed();
    userId = seeded.userId;
    await need(seeded.projectA, 'Steel', 400);
    await need(seeded.projectB, 'Steel', 600);

    // Crew counted it by hand and say 250, the app watched 100. The person wins — same rule as
    // `effectiveTonnes`, which this deliberately reuses rather than restating.
    for (const [source, tonnes] of [
      ['journal', 100],
      ['manual', 250],
    ] as const) {
      await db.$executeRawUnsafe(
        `INSERT INTO colony_carrier_cargo (market_id, commodity, source, tonnes, updated_at)
         VALUES ($1::bigint, 'Steel', $2, $3, now())
         ON CONFLICT (market_id, commodity, source) DO UPDATE SET tonnes = EXCLUDED.tonnes`,
        String(MARKET_ID),
        source,
        tonnes,
      );
    }

    const manifest = await service.manifest(MARKET_ID);
    const steel = manifest.lines.find((l) => l.commodity === 'Steel');
    expect(steel?.aboard).toBe(250);
    expect(steel?.toBuy).toBe(750);
  });

  it('surplus covers the need, it does not credit against anything else', async () => {
    const seeded = await seed();
    userId = seeded.userId;
    await need(seeded.projectA, 'Steel', 100);
    await need(seeded.projectA, 'Titanium', 300);

    await db.$executeRawUnsafe(
      `INSERT INTO colony_carrier_cargo (market_id, commodity, source, tonnes, updated_at)
       VALUES ($1::bigint, 'Steel', 'manual', 5000, now())
       ON CONFLICT (market_id, commodity, source) DO UPDATE SET tonnes = EXCLUDED.tonnes`,
      String(MARKET_ID),
    );

    const manifest = await service.manifest(MARKET_ID);
    expect(manifest.lines.find((l) => l.commodity === 'Steel')?.toBuy).toBe(0);
    expect(
      manifest.lines.find((l) => l.commodity === 'Titanium')?.toBuy,
      '5000 t of Steel must not reduce the Titanium that still has to be bought',
    ).toBe(300);
  });

  it('a carrier nobody has attached answers empty rather than throwing', async () => {
    const manifest = await service.manifest(3799999999999n);
    expect(manifest.carrier).toBeNull();
    expect(manifest.lines).toEqual([]);
  });
});
