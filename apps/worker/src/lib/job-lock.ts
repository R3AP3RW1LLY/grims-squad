import { Client } from 'pg';

/**
 * The cross-process lock that stops two copies of one job running together.
 *
 * ★ EXTRACTED FROM daemon.ts, 2026-08-02 ★
 *
 * Squadron owner: a button to "trigger an inara update manually ... pressing this should not
 * interupt the daily job."
 *
 * That is only true if BOTH paths contend for the same lock, and they did not. The daemon held one
 * around the jobs it spawns; the nightly commander audit runs from cron in its own container
 * (`docker compose run --rm worker node apps/worker/dist/daily-audit.js`) and held nothing. A
 * button that reached the daemon would have started a second audit on top of the running one —
 * two processes renaming the same members and writing the same audit rows.
 *
 * So the lock id lives here, and both agree on it because they import the same function.
 *
 * ★ WHY ADVISORY AND NOT A ROW ★
 *
 * It spans processes, and it is released automatically when the holder dies. A row in a table
 * would survive a container being killed and would need a heartbeat and a reaper to tell a crashed
 * job from a slow one.
 */

/** "gmsd", so these cannot collide with another feature's advisory locks. */
export const LOCK_NAMESPACE = 0x67_6d_73_64;

/**
 * A stable per-job lock id. Same string, same number, in every process.
 *
 * Kept positive and inside int4: `pg_try_advisory_lock(int, int)` takes two 32-bit keys.
 */
export function lockIdFor(job: string): number {
  let hash = 0;
  for (const ch of job) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(hash) % 2_147_483_647;
}

export interface HeldLock {
  /** Releases it and closes the connection. Safe to call more than once. */
  release(): Promise<void>;
}

/**
 * Takes the lock for a job, or returns null if somebody else holds it.
 *
 * ★ TRY, NOT WAIT ★
 *
 * `pg_try_advisory_lock` returns false rather than blocking. That is the behaviour a button needs:
 * a second request while one is running should be declined and SAID, not queued to surprise
 * somebody twenty minutes later.
 *
 * ★ A DEDICATED CONNECTION ★
 *
 * The lock is held by the SESSION. Borrowing Prisma's pooled connection would release it the
 * moment the pool handed that connection back — while the job was still running.
 */
export async function takeJobLock(job: string, connectionString?: string): Promise<HeldLock | null> {
  const client = new Client({ connectionString: connectionString ?? process.env['DATABASE_URL'] });

  try {
    await client.connect();
  } catch {
    return null;
  }

  const claimed = await client
    .query<{ ok: boolean }>(`SELECT pg_try_advisory_lock($1, $2) AS ok`, [LOCK_NAMESPACE, lockIdFor(job)])
    .then((r) => r.rows[0]?.ok === true)
    .catch(() => false);

  if (!claimed) {
    await client.end().catch(() => undefined);
    return null;
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      // Ending the connection releases the lock on its own; the explicit unlock is for the case
      // where the pool is reused before the socket closes.
      await client
        .query(`SELECT pg_advisory_unlock($1, $2)`, [LOCK_NAMESPACE, lockIdFor(job)])
        .catch(() => undefined);
      await client.end().catch(() => undefined);
    },
  };
}

/*
 * The job name lives in the CONTRACT, not here.
 *
 * The admin console names it, the daemon looks it up, and this file derives the lock id from it. A
 * second definition in the worker would be the one that drifts, and the symptom would be a button
 * press starting a job the lock did not cover.
 */
export { COMMANDER_AUDIT_JOB } from '@grims/shared';
