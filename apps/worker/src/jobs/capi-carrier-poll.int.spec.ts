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
  it('★ MANDATORY: a linked member with NO recorded carrier ownership is still polled ★', async () => {
    /*
     * ★ THE FILTER THAT REDUCED THIS FEATURE TO NOTHING — 2026-08-17 ★
     *
     * `candidates()` used to require the member to be "plausibly connected" to a carrier on a live
     * build — either they had pushed a manifest for it (`colony_carrier_cargo.updated_by_id`) or
     * they had attached it (`colony_carriers.added_by_id`).
     *
     * The first half is empty by construction: `updated_by_id` was NULL on the journal path until
     * the day before this, so 31 of production's 34 rows carry no owner — and no amount of polling
     * fills that in, because filling it in is what the polling was for.
     *
     * Measured on production: 7 members with a live cAPI link, ONE candidate, ZERO cAPI rows ever
     * written. Members with full carriers watched the boards show a fraction of their cargo.
     *
     * The scope the squadron owner chose — only carriers attached to LIVE builds — is unchanged and
     * is enforced where it belongs, in `isAttachedToLiveBuild` before anything is stored. This list
     * is only "whose carrier may we ask about", and Frontier answers that itself: /fleetcarrier
     * returns the caller's own carrier and nobody else's.
     */
    await clean();
    const [u] = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO users (handle, display_name) VALUES ($1, $1)
       ON CONFLICT (handle) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
      `${TAG}-lonely`,
    );
    const userId = (u as { id: string }).id;

    // A live Frontier link, and NOTHING ELSE. No carrier attached by them, no manifest pushed by
    // them — exactly the state six of production's seven linked members are in.
    await db.$executeRawUnsafe(
      // `decode(...)` rather than a bytea literal: the escaped form has to survive a template
      // literal, a JS string and Postgres's own parser, and it did not.
      `INSERT INTO cmdr_verifications (user_id, cmdr_name, method, trust_tier, verified_at, fdev_refresh_enc)
       VALUES ($1::uuid, $2, 'fdev_capi', 3, now(), decode('00', 'hex'))`,
      userId,
      `${TAG}-lonely`,
    );

    const who = await store.candidates();

    expect(
      who.map((c) => c.userId),
      'a member whose carrier nobody has recorded is exactly the member worth asking Frontier about',
    ).toContain(userId);

    await db.$executeRawUnsafe(`DELETE FROM cmdr_verifications WHERE user_id = $1::uuid`, userId);
    await db.$executeRawUnsafe(`DELETE FROM users WHERE id = $1::uuid`, userId);
  });

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

  it('★ MANDATORY: an omitted commodity READS as zero, not as "no reading" ★', async () => {
    /*
     * ★ THE BUG THAT DEFEATED THE WHOLE FEATURE — 2026-08-17 ★
     *
     * Deleting the rows and writing only what Frontier reported LOOKS like it says "the rest is
     * gone". It does not. `effectiveTonnes` reads `capi` as `pick(commodity, 'capi')`, which is
     * NULL when there is no row, and null falls straight through to `max(journal, mirror)`. So
     * "Frontier says there is no Steel aboard" arrived as "cAPI has never mentioned Steel", and the
     * fortnight-old journal figure won.
     *
     * The one thing this source exists to do — prove a hold empty — was the one thing it could not
     * do, and every test above passed the whole time. They asserted what the TABLE holds. This one
     * asserts what the BOARD READS, which is the only claim that was ever worth making.
     */
    await clean();
    const { userId } = await seed({ live: true });
    const at = new Date();

    // The journal watched 5,000 t of Steel go aboard a fortnight ago and has not run since.
    await db.$executeRawUnsafe(
      `INSERT INTO colony_carrier_cargo (market_id, commodity, source, tonnes, updated_by_id, updated_at)
       VALUES ($1::bigint, 'Steel', 'journal', 5000, $2::uuid, now() - interval '14 days')`,
      MARKET,
      userId,
    );

    // Frontier now reports a manifest holding Titanium and NO Steel. The Steel is sold.
    await store.replaceCapiCargo({
      marketId: MARKET,
      ownerId: userId,
      lines: [{ commodity: 'Titanium', tonnes: 480 }],
      at,
    });

    const [steel] = await db.$queryRawUnsafe<Array<{ tonnes: number }>>(
      `SELECT tonnes::int AS tonnes FROM colony_carrier_cargo
        WHERE market_id = $1::bigint AND commodity = 'Steel' AND source = 'capi'`,
      MARKET,
    );

    expect(
      steel?.tonnes,
      'Frontier omitting Steel must be recorded as a ZERO, or the stale journal figure wins',
    ).toBe(0);

    // And the journal's own row is untouched — this corrects the READING, it does not rewrite
    // somebody else's statement.
    const [journal] = await db.$queryRawUnsafe<Array<{ tonnes: number }>>(
      `SELECT tonnes::int AS tonnes FROM colony_carrier_cargo
        WHERE market_id = $1::bigint AND commodity = 'Steel' AND source = 'journal'`,
      MARKET,
    );
    expect(journal?.tonnes, "the journal's own claim is not this job's to edit").toBe(5000);
  });

  it('★ MANDATORY: an EMPTY manifest zeroes what other sources still claim ★', async () => {
    // The strongest form of the same statement, and the case with no reported lines to compare
    // against — a carrier Frontier says is completely empty.
    await clean();
    const { userId } = await seed({ live: true });

    await db.$executeRawUnsafe(
      `INSERT INTO colony_carrier_cargo (market_id, commodity, source, tonnes, updated_by_id, updated_at)
       VALUES ($1::bigint, 'Steel', 'journal', 5000, $2::uuid, now() - interval '14 days')`,
      MARKET,
      userId,
    );

    await store.replaceCapiCargo({ marketId: MARKET, ownerId: userId, lines: [], at: new Date() });

    const rows = await db.$queryRawUnsafe<Array<{ commodity: string; tonnes: number; source: string }>>(
      `SELECT commodity, tonnes::int AS tonnes, source FROM colony_carrier_cargo
        WHERE market_id = $1::bigint AND source = 'capi'`,
      MARKET,
    );
    expect(rows).toEqual([{ commodity: 'Steel', tonnes: 0, source: 'capi' }]);
  });

  it('a commodity NOBODY has claimed gets no invented row', async () => {
    // Bounded on purpose. Writing a zero for every commodity in the game would fill the table with
    // statements about cargo nobody ever said was aboard.
    await clean();
    const { userId } = await seed({ live: true });

    await store.replaceCapiCargo({ marketId: MARKET, ownerId: userId, lines: [], at: new Date() });

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

    /*
     * ★ THE ASSERTION WAS TIGHTER THAN ITS INTENT — 2026-08-17 ★
     *
     * This read `toEqual([the manual row])`, which said "no other row may exist". Its actual claim
     * is narrower and is the one worth keeping: THIS JOB MUST NOT EDIT ANOTHER SOURCE'S STATEMENT.
     *
     * A cAPI zero now sits beside the manual figure, because Frontier reported an empty hold and
     * that silence has to be written down or it reads as "cAPI never spoke". It changes nothing a
     * member sees: manual outranks cAPI, so the board still reads 1,234 t. The crew member's hand
     * is untouched, which is the whole point of the test.
     */
    const held = await heldNow();
    const manual = held.filter((r) => r.source === 'manual');

    expect(manual, "a crew member's own figure is not this job's to edit").toEqual([
      { commodity: 'Steel', tonnes: 1234, source: 'manual' },
    ]);
    expect(
      held.filter((r) => r.source === 'capi'),
      'and Frontier’s "none aboard" is recorded rather than left as an absence',
    ).toEqual([{ commodity: 'Steel', tonnes: 0, source: 'capi' }]);
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
