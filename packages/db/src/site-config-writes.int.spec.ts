import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from './index.js';
import {
  COMPANION_ANNOUNCED_KEY,
  announceCompanionRelease,
} from './announce.js';
import { BOUNTY_ANCHOR_COUNT_KEY } from '@grims/shared';

/**
 * Writing to `site_config`, against a real database.
 *
 * ★ WHY THIS FILE EXISTS — I SHIPPED THE BUG IT CATCHES ★
 *
 * `site_config.value` is `jsonb`, not `text`. Two writes went out passing a bare string: the
 * companion release announcement here, and the bounty board's anchor count in the worker. Postgres
 * refused both casts, both callers swallowed the error by design — an announcement must never fail
 * the thing it describes — and so the release announced nothing and the bounty page went on
 * reporting "no active projects" while three were running.
 *
 * Every unit test passed throughout, because none of them touch a database. A `$executeRaw` string
 * is opaque to the type system: nothing about `${version}` says whether the column will take it.
 *
 * That is the whole case for this file. These assertions are worthless without a real Postgres and
 * decisive with one.
 */

const db = new PrismaClient();

afterAll(async () => {
  await db.siteConfig.deleteMany({ where: { key: COMPANION_ANNOUNCED_KEY } });
  await db.$disconnect();
});

beforeEach(async () => {
  await db.siteConfig.deleteMany({ where: { key: COMPANION_ANNOUNCED_KEY } });
  await db.$executeRaw`DELETE FROM announcements WHERE kind = 'app-release'`;
});

describe('announcing a companion release', () => {
  it('MANDATORY: actually writes — the jsonb cast is real, not assumed', async () => {
    /*
     * The bug, as an assertion. Without `to_jsonb` this returns false, having thrown inside and
     * caught, and nothing anywhere says so.
     */
    const announced = await announceCompanionRelease(db, '9.9.9', 'https://grims-squad.com');
    expect(announced).toBe(true);

    const stored = await db.siteConfig.findUnique({ where: { key: COMPANION_ANNOUNCED_KEY } });
    expect(stored?.value).toBe('9.9.9');

    const rows = await db.$queryRaw<Array<{ content: string }>>`
      SELECT content FROM announcements WHERE kind = 'app-release'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toContain('v9.9.9');
    expect(rows[0]?.content).toContain('/companion');
  });

  it('MANDATORY: announces a version exactly once, however many callers arrive', async () => {
    /*
     * Dozens of paired apps poll within the same minute and every one of them sees the new version.
     * The claim is the INSERT itself, so the first through wins — a read-then-write would post the
     * same release a dozen times.
     */
    const results = await Promise.all([
      announceCompanionRelease(db, '9.9.9', 'https://grims-squad.com'),
      announceCompanionRelease(db, '9.9.9', 'https://grims-squad.com'),
      announceCompanionRelease(db, '9.9.9', 'https://grims-squad.com'),
      announceCompanionRelease(db, '9.9.9', 'https://grims-squad.com'),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);

    const rows = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM announcements WHERE kind = 'app-release'`;
    expect(Number(rows[0]?.n ?? 0)).toBe(1);
  });

  it('a NEW version announces again', async () => {
    await announceCompanionRelease(db, '9.9.9', 'https://grims-squad.com');
    const second = await announceCompanionRelease(db, '9.9.10', 'https://grims-squad.com');

    expect(second).toBe(true);
    const stored = await db.siteConfig.findUnique({ where: { key: COMPANION_ANNOUNCED_KEY } });
    expect(stored?.value).toBe('9.9.10');
  });

  it('nothing to announce is not an error', async () => {
    expect(await announceCompanionRelease(db, null, 'https://grims-squad.com')).toBe(false);
    expect(await announceCompanionRelease(db, '9.9.9', '')).toBe(false);

    const stored = await db.siteConfig.findUnique({ where: { key: COMPANION_ANNOUNCED_KEY } });
    expect(stored).toBeNull();
  });
});


/**
 * The other write that failed the same way, on the same day.
 *
 * ★ TWO OF THESE SHIPPED, AND BOTH WERE SILENT ★
 *
 * The bounty board writes how many project anchors it built from — a plain integer, into the same
 * `jsonb` column, through the same kind of raw INSERT, with the same catch-and-carry-on around it
 * because a board rebuild must not die over a statistic.
 *
 * It failed identically and nobody could tell: the key was simply never there, so `/bounties` went
 * on telling members "there are no active projects" while three were running. The companion
 * release announcement above is its twin; this is the half that had no test even after the first
 * one got one.
 *
 * The WORKER owns that INSERT, so this asserts the property the worker depends on rather than
 * importing it: that this column accepts an integer written the way `bounty-board.ts` writes it,
 * and refuses it written the way it used to.
 */
describe('the bounty anchor count survives its column', () => {
  afterAll(async () => {
    await db.siteConfig.deleteMany({ where: { key: BOUNTY_ANCHOR_COUNT_KEY } });
  });

  it('MANDATORY: an integer written with to_jsonb lands and reads back as a number', async () => {
    await db.$executeRawUnsafe(
      `INSERT INTO site_config (key, value) VALUES ($1, to_jsonb($2::int))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      BOUNTY_ANCHOR_COUNT_KEY,
      3,
    );

    const row = await db.siteConfig.findUnique({ where: { key: BOUNTY_ANCHOR_COUNT_KEY } });
    expect(Number(row?.value)).toBe(3);
  });

  it('MANDATORY: the shape that shipped broken is still rejected by the database', async () => {
    /*
     * The regression, stated as the thing that actually happened: a bare string into a jsonb
     * column. Postgres refuses it, the caller's catch swallowed the refusal, and the feature was
     * quietly dead. If this ever stops throwing, the guard above has stopped meaning anything.
     */
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO site_config (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        BOUNTY_ANCHOR_COUNT_KEY,
        '3',
      ),
    ).rejects.toThrow();
  });
});
