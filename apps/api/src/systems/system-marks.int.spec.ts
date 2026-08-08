import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@grims/db';
import { RECENT_KEEP } from '@grims/shared/system-picker';
import { SystemMarksService } from './system-marks.service.js';

/**
 * A member's saved systems, against Postgres.
 *
 * ★ THE TRIM IS THE ONLY PART THAT CAN LOSE SOMEBODY'S DATA ★
 *
 * Everything else here is an upsert. The trim DELETES, and the rule it has to honour — that a pin
 * is never sacrificed to make room for a recent — is expressed in one `kind <> 'pinned'` inside a
 * subquery. That is exactly the sort of clause that survives a refactor by luck, so it is pinned
 * down here rather than trusted.
 */

const db = new PrismaClient();
const svc = new SystemMarksService(db);
const TAG = 'system-marks-int-spec';

async function freshUser(): Promise<string> {
  const [row] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO users (handle, display_name) VALUES ($1, $1)
     ON CONFLICT (handle) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
    TAG,
  );
  const id = (row as { id: string }).id;
  await db.$executeRawUnsafe(`DELETE FROM member_system_marks WHERE user_id = $1::uuid`, id);
  return id;
}

afterAll(async () => {
  // The marks go with the user: the foreign key is ON DELETE CASCADE.
  await db.$executeRawUnsafe(`DELETE FROM users WHERE handle = $1`, TAG);
  await db.$disconnect();
});

describe('a member’s saved systems, against Postgres', () => {
  it('records a use once and counts a repeat rather than duplicating it', async () => {
    const me = await freshUser();

    await svc.use(me, 'Sol', '10477373803');
    await svc.use(me, 'Sol');

    const list = await svc.list(me);
    expect(list).toHaveLength(1);
    expect(list[0]?.useCount).toBe(2);
    // INV-006: the address comes back as a string, never a number.
    expect(list[0]?.systemId64).toBe('10477373803');
  });

  it('learns an address later and never unlearns it', async () => {
    /*
     * The freight office knows the id64; the scout box often does not. A second search from the
     * page that does not know it must not blank a good value.
     */
    const me = await freshUser();

    await svc.use(me, 'Deciat');
    expect((await svc.list(me))[0]?.systemId64).toBeNull();

    await svc.use(me, 'Deciat', '6681123623626');
    expect((await svc.list(me))[0]?.systemId64).toBe('6681123623626');

    await svc.use(me, 'Deciat');
    expect((await svc.list(me))[0]?.systemId64).toBe('6681123623626');
  });

  it('★ MANDATORY: trimming recents never sacrifices a pin ★', async () => {
    const me = await freshUser();

    await svc.pin(me, 'Col 285 Sector GL-W c2-12', 'Home');
    for (let i = 0; i < RECENT_KEEP + 10; i++) await svc.use(me, `${TAG} System ${i}`);

    const list = await svc.list(me);
    const pinned = list.filter((c) => c.source === 'pinned');
    const recents = list.filter((c) => c.source !== 'pinned');

    expect(
      pinned.map((c) => c.name),
      'the pinned system was deleted to make room for recents, which is the one behaviour that ' +
        'would make this feature untrustworthy',
    ).toEqual(['Col 285 Sector GL-W c2-12']);
    expect(pinned[0]?.label).toBe('Home');
    expect(recents.length).toBeLessThanOrEqual(RECENT_KEEP);
    // And it dropped the OLDEST recents, not the newest.
    expect(recents.some((c) => c.name === `${TAG} System ${RECENT_KEEP + 9}`)).toBe(true);
    expect(recents.some((c) => c.name === `${TAG} System 0`)).toBe(false);
  });

  it('using a pinned system does not quietly unpin it', async () => {
    const me = await freshUser();

    await svc.pin(me, 'Shinrarta Dezhra', 'The Pilots Federation');
    await svc.use(me, 'Shinrarta Dezhra');

    const list = await svc.list(me);
    expect(list[0]?.source).toBe('pinned');
    expect(list[0]?.label).toBe('The Pilots Federation');
    expect(list[0]?.useCount).toBe(2);
  });

  it('unpinning demotes to a recent rather than deleting the shortcut', async () => {
    const me = await freshUser();

    await svc.pin(me, 'Deciat', 'Engineers');
    await svc.unpin(me, 'Deciat');

    const list = await svc.list(me);
    expect(list).toHaveLength(1);
    expect(list[0]?.source).toBe('recent');
    expect(list[0]?.label).toBeNull();
  });

  it('keeps one member’s systems entirely out of another’s', async () => {
    const mine = await freshUser();
    const [other] = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO users (handle, display_name) VALUES ($1, $1)
       ON CONFLICT (handle) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
      `${TAG}-other`,
    );
    const theirs = (other as { id: string }).id;

    try {
      await svc.use(mine, 'Sol');
      await svc.use(theirs, 'Deciat');

      expect((await svc.list(mine)).map((c) => c.name)).toEqual(['Sol']);
      expect((await svc.list(theirs)).map((c) => c.name)).toEqual(['Deciat']);
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM users WHERE handle = $1`, `${TAG}-other`);
    }
  });
});
