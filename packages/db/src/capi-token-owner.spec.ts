import { describe, expect, it } from 'vitest';
import { CAPI_LOCK_NAMESPACE, capiLockKey, shouldRefresh } from './capi-token-owner.js';

/**
 * One owner for a Frontier refresh.
 *
 * ★ THE FAILURE THIS EXISTS TO PREVENT ★
 *
 * Frontier ROTATES the refresh token: the moment a new one is issued the old one is dead. So if two
 * processes refresh the same member at once, both send the same valid refresh token, Frontier
 * honours the first and invalidates it, and the loser then PERSISTS a token that is already dead.
 *
 * That member's link is gone. Nothing errors — the write succeeds, the row looks healthy, and the
 * next poll simply gets `invalid_grant`. It reads exactly like the 25-day ceiling expiring early,
 * and the members it hits first are the cloud players this whole feature was built for.
 *
 * It became reachable the moment a WORKER started polling journals, because the API already
 * refreshes on demand. Before that there was only ever one refresher and the hazard was theoretical.
 *
 * ★ WHY A LOCK RATHER THAN A RETRY ★
 *
 * A retry needs to know it lost, and the loser cannot tell: its write succeeds. There is no error to
 * catch and no row to compare against, because by then it has already overwritten the good token.
 * The race has to be prevented, not detected.
 */

describe('the lock key', () => {
  it('★ MANDATORY: the same member always maps to the same key ★', () => {
    /*
     * The entire guarantee. If one member produced two keys the lock would be held on one of them
     * while the other process refreshed freely — a lock that appears to work and prevents nothing.
     */
    const id = '3f0a5b7c-1d2e-4a5b-8c9d-0e1f2a3b4c5d';

    expect(capiLockKey(id)).toBe(capiLockKey(id));
  });

  it('★ MANDATORY: different members do not share a key ★', () => {
    /*
     * A collision is not a correctness bug — the loser waits and then refreshes correctly — but it
     * serialises two unrelated members behind each other on a job with a per-member cadence. Worth
     * asserting because a narrow hash would do it constantly.
     */
    const keys = new Set(
      [
        '3f0a5b7c-1d2e-4a5b-8c9d-0e1f2a3b4c5d',
        '4f0a5b7c-1d2e-4a5b-8c9d-0e1f2a3b4c5d',
        '5f0a5b7c-1d2e-4a5b-8c9d-0e1f2a3b4c5d',
        'ab000000-0000-0000-0000-000000000001',
        'ab000000-0000-0000-0000-000000000002',
      ].map(capiLockKey),
    );

    expect(keys.size).toBe(5);
  });

  it('★ MANDATORY: it fits in an int4, because that is what Postgres takes ★', () => {
    /*
     * `pg_advisory_lock(int, int)` takes two 32-bit keys. A value outside that range is not a
     * clamped lock, it is an ERROR from the database in the middle of a token refresh — and the same
     * mistake is already documented in `job-lock.ts` next door.
     */
    for (let i = 0; i < 400; i += 1) {
      const key = capiLockKey(`user-${i}-${'x'.repeat(i % 17)}`);

      expect(Number.isInteger(key)).toBe(true);
      expect(key).toBeGreaterThanOrEqual(0);
      expect(key).toBeLessThanOrEqual(2_147_483_647);
    }
  });

  it('MANDATORY: the namespace is distinct from the job locks beside it', () => {
    // `job-lock.ts` uses its own namespace so features cannot collide. Sharing one would let a
    // nightly reconcile block a member's token refresh, which is a deadlock nobody would look for.
    expect(CAPI_LOCK_NAMESPACE).not.toBe(0);
  });
});

describe('when a refresh is actually needed', () => {
  const now = new Date('2026-08-16T12:00:00Z');

  it('★ MANDATORY: a token with time left is used, not refreshed ★', () => {
    /*
     * Refreshing a live token is not harmless. Every refresh rotates, so a poller that refreshed on
     * every pass would spend the shared rate limit AND widen the window in which two processes are
     * mid-rotation together — manufacturing the race this file exists to close.
     */
    expect(
      shouldRefresh({ accessEnc: 'x', expiresAt: new Date('2026-08-16T13:00:00Z') }, now),
    ).toBe(false);
  });

  it('★ MANDATORY: no stored access token means refresh, whatever the expiry says ★', () => {
    // A row part-written by an interrupted exchange. Trusting the expiry alone would hand back a
    // token that is not there.
    expect(
      shouldRefresh({ accessEnc: null, expiresAt: new Date('2026-08-16T13:00:00Z') }, now),
    ).toBe(true);
  });

  it('an expired token refreshes', () => {
    expect(
      shouldRefresh({ accessEnc: 'x', expiresAt: new Date('2026-08-16T11:00:00Z') }, now),
    ).toBe(true);
  });

  it('★ MANDATORY: one about to expire refreshes BEFORE it dies ★', () => {
    /*
     * The skew. A token valid for another few seconds will have expired by the time the request it
     * was fetched for reaches Frontier, and the failure lands on the member rather than here.
     */
    expect(
      shouldRefresh({ accessEnc: 'x', expiresAt: new Date('2026-08-16T12:00:30Z') }, now),
    ).toBe(true);
  });

  it('a missing expiry refreshes rather than assuming', () => {
    // Null is not "valid for ever". Assuming it were would pin a member on a token nothing can
    // renew, and the only symptom would be requests failing for a reason nothing states.
    expect(shouldRefresh({ accessEnc: 'x', expiresAt: null }, now)).toBe(true);
  });
});
