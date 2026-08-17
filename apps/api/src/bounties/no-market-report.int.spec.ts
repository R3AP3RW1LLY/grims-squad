import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@grims/db';
import { BountiesService } from './bounties.service.js';

/**
 * "I flew there and there is no market."
 *
 * ★ SQUADRON OWNER, 2026-08-16 ★
 *
 * Paid the same as a market report, and trusted on one report from a verified commander.
 *
 * ★ WHAT THIS IS ACTUALLY FOR ★
 *
 * Measured on production that morning: 72 of the 496 bounties on the board were on stations with no
 * market. The filters shipped alongside this remove the ones our catalogue KNOWS about — but the
 * catalogue is a galaxy dump and it is wrong about some stations. The member in the cockpit is the
 * only source that can settle it, and until now they had no way to say so.
 *
 * ★ AND WHY IT NEEDS A DATABASE TO TEST ★
 *
 * The whole feature is one statement across three tables — a DELETE feeding two INSERTs — plus a
 * verification lookup. None of it typechecks, and the interesting halves (that it pays exactly
 * once, and that the row OUTLIVES the board rebuild) are properties only Postgres can be asked
 * about.
 */

const db = new PrismaClient();
const svc = new BountiesService(db);

const TAG = 'no-market-int-spec';
const STATION = `${TAG}/Wasted Trip`;

async function member(verified: boolean): Promise<string> {
  const [u] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO users (handle, display_name) VALUES ($1, $1)
     ON CONFLICT (handle) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
    verified ? TAG : `${TAG}-unverified`,
  );
  const id = (u as { id: string }).id;

  await db.$executeRawUnsafe(
    `DELETE FROM cmdr_verifications WHERE user_id = $1::uuid`,
    id,
  );
  if (verified) {
    await db.$executeRawUnsafe(
      // `trust_tier` is NOT NULL and has no default — officer_manual is tier 1, per the enum's
      // own comment on the schema.
      `INSERT INTO cmdr_verifications (user_id, cmdr_name, method, trust_tier, verified_at)
       VALUES ($1::uuid, $2, 'officer_manual', 1, now())`,
      id,
      TAG,
    );
  }
  return id;
}

async function bountyOnTheBoard(): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO data_bounties
       (station_key, station_name, system_name, station_type, points, jackpot, in_ops, computed_at)
     VALUES ($1, 'Wasted Trip', $2, 'Outpost', 3650, false, true, now())
     ON CONFLICT (station_key) DO UPDATE SET points = EXCLUDED.points`,
    STATION,
    TAG,
  );
}

const onBoard = async (): Promise<boolean> =>
  (
    await db.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM data_bounties WHERE station_key = $1`,
      STATION,
    )
  )[0]!.n > 0;

const remembered = async (): Promise<number> =>
  (
    await db.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM station_no_market
        WHERE station_key = $1 AND cleared_at IS NULL`,
      STATION,
    )
  )[0]!.n;

async function cleanUp(): Promise<void> {
  await db.$executeRawUnsafe(`DELETE FROM station_no_market WHERE station_key = $1`, STATION);
  await db.$executeRawUnsafe(`DELETE FROM data_bounties WHERE station_key = $1`, STATION);
  await db.$executeRawUnsafe(`DELETE FROM bounty_claims WHERE station_key = $1`, STATION);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE handle IN ($1, $2)`, TAG, `${TAG}-unverified`);
}

afterAll(async () => {
  await cleanUp();
  await db.$disconnect();
});

describe('reporting a station with no market', () => {
  it('★ MANDATORY: it pays, and it pays what the bounty promised ★', async () => {
    /*
     * The member did the work the bounty asked for: they flew out and found out. That the answer
     * was "nothing here" is the fault of the board that sent them, and a report costing a trip and
     * paying nothing is a report nobody files — which leaves the bounty there for the next member
     * to waste the same evening on.
     */
    await cleanUp();
    const userId = await member(true);
    await bountyOnTheBoard();

    const out = await svc.reportNoMarket({ stationKey: STATION, userId });

    expect(out.paid).toBe(true);
    expect(out.points, 'the same as a market report — what the board promised').toBe(3650);

    const [claim] = await db.$queryRawUnsafe<Array<{ points: number }>>(
      `SELECT points FROM bounty_claims WHERE station_key = $1 AND user_id = $2::uuid`,
      STATION,
      userId,
    );
    expect(claim?.points, 'and it reaches the ledger the leaderboard sums').toBe(3650);
  });

  it('★ MANDATORY: the station is REMEMBERED, so the rebuild cannot put it back ★', async () => {
    /*
     * The half that makes the report mean anything. A market upload clears a bounty by making the
     * data fresh, and the rebuild reads that freshness. This writes NO market data — so without a
     * row that outlives the board, the bounty returns within thirty minutes, the next member flies
     * the same wasted trip, and all the report bought was one payment.
     */
    await cleanUp();
    const userId = await member(true);
    await bountyOnTheBoard();

    await svc.reportNoMarket({ stationKey: STATION, userId });

    expect(await onBoard(), 'off the board now').toBe(false);
    expect(await remembered(), 'and remembered, which is what keeps it off').toBe(1);
  });

  it('★ MANDATORY: it pays exactly ONCE ★', async () => {
    /*
     * The same first-come-first-served shape as a market claim, deliberately. A second member
     * reporting five minutes later finds nothing left to report — and must not be paid for it,
     * because a bounty pays once however it is cleared.
     */
    await cleanUp();
    const userId = await member(true);
    await bountyOnTheBoard();

    const first = await svc.reportNoMarket({ stationKey: STATION, userId });
    const second = await svc.reportNoMarket({ stationKey: STATION, userId });

    expect(first.paid).toBe(true);
    expect(second.paid, 'nothing left to report, so nothing to pay').toBe(false);

    const [n] = await db.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM bounty_claims WHERE station_key = $1`,
      STATION,
    );
    expect(n?.n, 'one trip, one payment').toBe(1);
  });

  it('★ MANDATORY: an UNVERIFIED member cannot take a station off the board ★', async () => {
    /*
     * One report is enough, which is only a safe rule if the report is attached to a proved
     * identity. The refusal names the reason — a member who is told "no" without being told what
     * would make it a yes simply stops trying.
     */
    await cleanUp();
    const userId = await member(false);
    await bountyOnTheBoard();

    await expect(svc.reportNoMarket({ stationKey: STATION, userId })).rejects.toThrow(
      /verify your commander/i,
    );

    expect(await onBoard(), 'still on the board').toBe(true);
    expect(await remembered(), 'and nothing remembered').toBe(0);
  });

  it('a station that was never bountied pays nothing and is not an error', async () => {
    // Somebody reporting a station nobody asked about has not done anything wrong. There is simply
    // no bounty to clear and nothing to pay.
    await cleanUp();
    const userId = await member(true);

    const out = await svc.reportNoMarket({ stationKey: STATION, userId });

    expect(out.paid).toBe(false);
    expect(await remembered(), 'and nothing is recorded about a station nobody asked about').toBe(0);
  });
});
