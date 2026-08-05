import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from './index.js';
import {
  COMPANION_ANNOUNCED_KEY,
  announceCompanionRelease,
} from './announce.js';

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
