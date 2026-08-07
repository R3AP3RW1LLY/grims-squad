import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@grims/db';
import { OpsService } from './ops.service.js';

/**
 * Operations, actually run.
 *
 * ★ CAPACITY AND STANDBY ARE THE WHOLE RISK ★
 *
 * Everything else here is CRUD. The part that can go wrong quietly is the seat count: two members
 * committing to the last place, and a drop-out that has to promote somebody. Both are hand-written
 * SQL against enums that fail only at runtime, and both are invisible until an op night when a wing
 * turns up one over or one short.
 */

const db = new PrismaClient();
const TAG = 'ops-int-spec';

async function member(suffix: string): Promise<string> {
  const [row] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO users (handle, display_name) VALUES ($1, $1)
     ON CONFLICT (handle) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
    `${TAG}-${suffix}`,
  );
  return (row as { id: string }).id;
}

async function cleanUp(ids: readonly string[]): Promise<void> {
  await db.$executeRawUnsafe(`DELETE FROM operations WHERE title LIKE $1`, `${TAG}%`);
  for (const id of ids) {
    await db.$executeRawUnsafe(`DELETE FROM users WHERE id = $1::uuid`, id);
  }
}

describe('operations, against Postgres', () => {
  it(
    'fills the seats, overflows to standby, and promotes on a withdrawal',
    async () => {
      const lead = await member('lead');
      const a = await member('a');
      const b = await member('b');
      const svc = new OpsService(db);

      try {
        // Capacity of one, so the second commitment has nowhere to go but standby.
        const { id } = await svc.create({
          title: `${TAG} Thursday push`,
          opType: 'bgs',
          startsAt: new Date(Date.now() + 3_600_000),
          description: 'Testing the seat count.',
          capacity: 1,
          createdById: lead,
        });

        await svc.signUp(id, a, 'yes', null);
        await svc.signUp(id, b, 'yes', null);

        const full = await svc.one(id);
        expect(full?.op.going, 'more members were seated than the op has room for').toBe(1);
        expect(full?.op.standby, 'the overflow did not become standby').toBe(1);

        /*
         * ★ THE PROMOTION ★
         *
         * Without it standby is a list that never moves, members stop joining it, and a full op
         * becomes a closed one. Promotion is by commitment order so it is explicable to whoever was
         * next and did not get in.
         */
        await svc.withdraw(id, a);

        const after = await svc.one(id);
        expect(after?.op.going, 'nobody was promoted off standby').toBe(1);
        expect(after?.op.standby).toBe(0);
        expect(
          after?.roster.find((r) => r.state === 'yes')?.name,
          'the wrong person was promoted',
        ).toBe(`${TAG}-b`);
      } finally {
        await cleanUp([lead, a, b]);
      }
    },
    60_000,
  );

  it(
    'takes everybody when the op is uncapped',
    async () => {
      const lead = await member('lead2');
      const a = await member('a2');
      const b = await member('b2');
      const svc = new OpsService(db);

      try {
        /*
         * Null capacity is a real choice — "everyone welcome" — not a missing value. Treating it as
         * zero would turn every open op into one nobody may join.
         */
        const { id } = await svc.create({
          title: `${TAG} open night`,
          opType: 'social',
          startsAt: new Date(Date.now() + 3_600_000),
          description: null,
          capacity: null,
          createdById: lead,
        });

        await svc.signUp(id, a, 'yes', null);
        await svc.signUp(id, b, 'yes', null);

        const out = await svc.one(id);
        expect(out?.op.going).toBe(2);
        expect(out?.op.standby).toBe(0);
      } finally {
        await cleanUp([lead, a, b]);
      }
    },
    60_000,
  );

  it(
    'lets a member change their mind without taking a seat twice',
    async () => {
      const lead = await member('lead3');
      const a = await member('a3');
      const svc = new OpsService(db);

      try {
        const { id } = await svc.create({
          title: `${TAG} mind changed`,
          opType: 'combat',
          startsAt: new Date(Date.now() + 3_600_000),
          description: null,
          capacity: 2,
          createdById: lead,
        });

        await svc.signUp(id, a, 'yes', null);
        await svc.signUp(id, a, 'maybe', 'not sure now');
        await svc.signUp(id, a, 'yes', null);

        const out = await svc.one(id);
        expect(out?.roster, 'changing state created a second row').toHaveLength(1);
        expect(out?.op.going, 'one member held two seats').toBe(1);
      } finally {
        await cleanUp([lead, a]);
        await db.$disconnect();
      }
    },
    60_000,
  );
});
