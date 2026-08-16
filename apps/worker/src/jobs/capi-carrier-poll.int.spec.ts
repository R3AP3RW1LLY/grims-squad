import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@grims/db';
import { PrismaCarrierPollStore } from './capi-carrier-poll.wiring.js';
import type { TokenCipher } from '@grims/shared/server';

/**
 * The carrier poller's store, against real Postgres.
 *
 * ★ WHY THIS NEEDS A DATABASE ★
 *
 * Every method here is hand-written SQL across five tables, a JSONB expression index and a bigint
 * cast. None of it typechecks. This exact class of mistake has shipped from this repo before — a
 * query against `colony_roster`, a table that does not exist and never did, sailed through
 * typecheck and lint and failed only at runtime inside a try/catch.
 *
 * ★ AND ONE BEHAVIOUR THAT CANNOT BE TESTED ANY OTHER WAY ★
 *
 * `replaceCapiCargo` must REPLACE. An upsert would update what is present and leave behind every
 * commodity that has since been sold — turning the one source that can prove a hold empty into
 * another floor, which is precisely the failure it was brought in to fix. That is a property of the
 * DELETE, and only a database can be asked whether the row is gone.
 */

const db = new PrismaClient();
const TAG = 'capi-carrier-int-spec';
const MARKET = '3999000001';
const CALLSIGN = 'ZZ9-ZZ9';

/** No token is ever decrypted here: every test drives the store's SQL, never its token path. */
const cipher = { decrypt: () => '', encrypt: () => '' } as unknown as TokenCipher;

const store = new PrismaCarrierPollStore(db, cipher, {
  authBase: 'https://auth.example.invalid',
  clientId: 'x',
  clientSecret: 'x',
  redirectUri: 'https://example.invalid/cb',
});

async function seed(opts: { live: boolean }): Promise<{ userId: string; projectId: string }> {
  const [u] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO users (handle, display_name) VALUES ($1, $1)
     ON CONFLICT (handle) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
    TAG,
  );
  const userId = (u as { id: string }).id;

  const [p] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO colony_projects (owner, posted_by_id, market_id, system_name, title, completed_at)
     VALUES ('squadron', $1::uuid, $2::bigint, $3, $3, $4)
     RETURNING id`,
    userId,
    '3999000999',
    TAG,
    // A completed build is the negative case: attached, but not a reason to spend a request.
    opts.live ? null : new Date(),
  );
  const projectId = (p as { id: string }).id;

  await db.$executeRawUnsafe(
    `INSERT INTO colony_carriers (project_id, market_id, name, callsign, added_by_id)
     VALUES ($1::uuid, $2::bigint, $3, $3, $4::uuid)
     ON CONFLICT (project_id, market_id) DO NOTHING`,
    projectId,
    MARKET,
    CALLSIGN,
    userId,
  );

  return { userId, projectId };
}

async function clean(): Promise<void> {
  await db.$executeRawUnsafe(
    `DELETE FROM colony_carrier_cargo WHERE market_id = $1::bigint`,
    MARKET,
  );
  await db.$executeRawUnsafe(`DELETE FROM colony_carriers WHERE market_id = $1::bigint`, MARKET);
  await db.$executeRawUnsafe(`DELETE FROM colony_projects WHERE title = $1`, TAG);
  await db.$executeRawUnsafe(
    `DELETE FROM knowledge_items WHERE source = 'galaxy' AND kind = 'station' AND name = $1`,
    CALLSIGN,
  );
  await db.$executeRawUnsafe(`DELETE FROM users WHERE handle = $1`, TAG);
}

const heldNow = (): Promise<Array<{ commodity: string; tonnes: number; source: string }>> =>
  db.$queryRawUnsafe(
    `SELECT commodity, tonnes::int AS tonnes, source FROM colony_carrier_cargo
      WHERE market_id = $1::bigint ORDER BY commodity`,
    MARKET,
  );

afterAll(async () => {
  await clean();
  await db.$disconnect();
});

describe('the carrier poll store, against Postgres', () => {
  it('★ MANDATORY: every query runs — the table and column names are real ★', async () => {
    /*
     * The whole point of an integration spec here. `candidates` alone touches five tables and two
     * nested EXISTS clauses, and a wrong name in any of them is invisible until the daemon swallows
     * it every ten minutes for ever.
     */
    await clean();
    const { userId } = await seed({ live: true });

    await expect(store.candidates()).resolves.toBeInstanceOf(Array);
    await expect(store.isAttachedToLiveBuild(MARKET)).resolves.toBe(true);
    await expect(store.marketIdForCallsign(CALLSIGN)).resolves.toBeNull();

    await store.replaceCapiCargo({
      marketId: MARKET,
      ownerId: userId,
      lines: [{ commodity: 'Titanium', tonnes: 480 }],
      at: new Date(),
    });

    expect(await heldNow()).toEqual([{ commodity: 'Titanium', tonnes: 480, source: 'capi' }]);
  });

  it('★ MANDATORY: a manifest REPLACES — a sold commodity is REMOVED, not left behind ★', async () => {
    /*
     * The behaviour the whole feature rests on. The carrier held Titanium and Steel; Frontier now
     * reports only Steel, which means the Titanium is gone. An upsert would leave the Titanium row
     * standing and the board would go on asking members to fly to a hold that no longer has it.
     */
    await clean();
    const { userId } = await seed({ live: true });
    const at = new Date();

    await store.replaceCapiCargo({
      marketId: MARKET,
      ownerId: userId,
      lines: [
        { commodity: 'Titanium', tonnes: 480 },
        { commodity: 'Steel', tonnes: 900 },
      ],
      at,
    });
    expect((await heldNow()).map((r) => r.commodity)).toEqual(['Steel', 'Titanium']);

    await store.replaceCapiCargo({
      marketId: MARKET,
      ownerId: userId,
      lines: [{ commodity: 'Steel', tonnes: 900 }],
      at,
    });

    expect(await heldNow()).toEqual([{ commodity: 'Steel', tonnes: 900, source: 'capi' }]);
  });

  it('★ MANDATORY: an EMPTY manifest empties the cAPI rows ★', async () => {
    // The statement no other source can make. It has to reach the table, not stop at the job.
    await clean();
    const { userId } = await seed({ live: true });
    const at = new Date();

    await store.replaceCapiCargo({
      marketId: MARKET,
      ownerId: userId,
      lines: [{ commodity: 'Titanium', tonnes: 480 }],
      at,
    });
    await store.replaceCapiCargo({ marketId: MARKET, ownerId: userId, lines: [], at });

    expect(await heldNow()).toEqual([]);
  });

  it('★ MANDATORY: it touches only its OWN source ★', async () => {
    /*
     * A crew member's hand and the owner's journal are other sources' statements. A DELETE that
     * forgot its `source = 'capi'` clause would wipe both — silently, and every ten minutes.
     */
    await clean();
    const { userId } = await seed({ live: true });
    const at = new Date();

    await db.$executeRawUnsafe(
      `INSERT INTO colony_carrier_cargo (market_id, commodity, source, tonnes, updated_by_id, updated_at)
       VALUES ($1::bigint, 'Steel', 'manual', 1234, $2::uuid, now())`,
      MARKET,
      userId,
    );

    await store.replaceCapiCargo({ marketId: MARKET, ownerId: userId, lines: [], at });

    expect(await heldNow()).toEqual([{ commodity: 'Steel', tonnes: 1234, source: 'manual' }]);
  });

  it('★ MANDATORY: a COMPLETED build is not a live one ★', async () => {
    // The scope the owner chose. A finished build is not a reason to spend a request against a
    // limit the whole squadron shares.
    await clean();
    await seed({ live: false });

    await expect(store.isAttachedToLiveBuild(MARKET)).resolves.toBe(false);
  });

  it('resolves a callsign to a market id through the catalogue', async () => {
    /*
     * Through the catalogue and not from Frontier's payload, because every other carrier query in
     * the platform keys on the catalogue's market id. A row written under any other is a row no
     * board can join to — invisible, and silently so.
     */
    await clean();
    await seed({ live: true });

    await db.$executeRawUnsafe(
      `INSERT INTO knowledge_items (source, kind, ext_key, name, data, text)
       VALUES ('galaxy', 'station', $1, $2, jsonb_build_object('marketId', $3::text), $2)
       ON CONFLICT (source, kind, ext_key) DO UPDATE SET data = EXCLUDED.data`,
      `${TAG}/${CALLSIGN}`,
      CALLSIGN,
      MARKET,
    );

    await expect(store.marketIdForCallsign(CALLSIGN)).resolves.toBe(MARKET);
    // The boxed forms a member might type resolve to the same carrier.
    await expect(store.marketIdForCallsign('zz9zz9')).resolves.toBe(MARKET);
    // And a partial one resolves to nothing rather than to whatever sorts first.
    await expect(store.marketIdForCallsign('ZZ9')).resolves.toBeNull();
  });
});
