import { describe, it, expect, beforeEach } from 'vitest';
import { IdempotencyService, ANONYMOUS_ACTOR } from './idempotency.service.js';
import { InMemoryIdempotencyStore } from './idempotency.store.fake.js';
import { ErrorCode } from '@grims/shared';

/**
 * P1.2 — idempotency keys.
 *
 * @INV-010 every mutating endpoint accepts an idempotency key and, on replay of
 * the same key with the same body, returns the original result without
 * repeating the side effect.
 *
 * @INV-041 keys are namespaced by (userId, endpoint, key). A key presented by a
 * different actor is never a replay.
 *
 * INV-041 exists because of RED-TEAM finding R8. With a global key namespace,
 * an attacker who guesses or observes an officer's key gets that officer's
 * STORED RESPONSE BODY handed back — and the replay path returns BEFORE any
 * permission guard runs, so nothing checks whether they were allowed to see it.
 * It is an authorization bypass wearing the costume of a caching feature.
 */

let store: InMemoryIdempotencyStore;
let svc: IdempotencyService;

beforeEach(() => {
  store = new InMemoryIdempotencyStore();
  svc = new IdempotencyService(store);
});

const OFFICER = '00000000-0000-0000-0000-00000000000f';
const MEMBER = '00000000-0000-0000-0000-00000000000a';
const BODY = { targetId: 'user-9', role: 'officer' };

describe('replay behaviour @INV-010', () => {
  it('returns the stored result on replay without re-running the work', async () => {
    let ran = 0;
    const work = async () => {
      ran += 1;
      return { status: 200, body: { ok: true, id: 'created-1' } };
    };

    const first = await svc.run(
      { userId: OFFICER, endpoint: 'POST /v1/admin/roles', key: 'k-1', body: BODY },
      work,
    );
    const second = await svc.run(
      { userId: OFFICER, endpoint: 'POST /v1/admin/roles', key: 'k-1', body: BODY },
      work,
    );

    expect(ran).toBe(1); // the side effect happened ONCE
    expect(second.body).toEqual(first.body);
    expect(second.replayed).toBe(true);
    expect(first.replayed).toBe(false);
  });

  it('treats the same key with a DIFFERENT body as a conflict, not a replay', async () => {
    const work = async () => ({ status: 200, body: { ok: true } });
    await svc.run({ userId: OFFICER, endpoint: 'POST /x', key: 'k-1', body: BODY }, work);
    await expect(
      svc.run(
        { userId: OFFICER, endpoint: 'POST /x', key: 'k-1', body: { ...BODY, role: 'admin' } },
        work,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.IDEMPOTENCY_KEY_CONFLICT });
  });

  it('does not cache a failure — a retry after a 500 runs again', async () => {
    let n = 0;
    const flaky = async () => {
      n += 1;
      if (n === 1) throw new Error('upstream blew up');
      return { status: 200, body: { ok: true } };
    };
    await svc
      .run({ userId: OFFICER, endpoint: 'POST /y', key: 'k-2', body: BODY }, flaky)
      .catch(() => {});
    const retry = await svc.run(
      { userId: OFFICER, endpoint: 'POST /y', key: 'k-2', body: BODY },
      flaky,
    );
    // Caching the failure would make a transient error permanent for that key.
    expect(retry.body).toEqual({ ok: true });
    expect(n).toBe(2);
  });
});

describe('namespacing @INV-041', () => {
  it('MANDATORY: a member replaying an officer key with an identical body does NOT get the officer response', async () => {
    const officerWork = async () => ({ status: 200, body: { secret: 'officer-only-result' } });
    await svc.run(
      { userId: OFFICER, endpoint: 'POST /v1/admin/roles', key: 'shared-key', body: BODY },
      officerWork,
    );

    let memberWorkRan = false;
    const memberWork = async () => {
      // The member's own handler runs, which means the permission guard wrapped
      // around it runs too. Under a global namespace this never executed and the
      // officer's body was returned straight from the cache.
      memberWorkRan = true;
      return { status: 403, body: { error: 'forbidden' } };
    };

    const res = await svc.run(
      { userId: MEMBER, endpoint: 'POST /v1/admin/roles', key: 'shared-key', body: BODY },
      memberWork,
    );

    expect(memberWorkRan).toBe(true);
    expect(res.replayed).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('officer-only-result');
  });

  it('does not collide across endpoints for the same actor', async () => {
    let n = 0;
    const work = async () => ({ status: 200, body: { n: ++n } });
    await svc.run({ userId: OFFICER, endpoint: 'POST /a', key: 'k', body: BODY }, work);
    const b = await svc.run({ userId: OFFICER, endpoint: 'POST /b', key: 'k', body: BODY }, work);
    expect(b.replayed).toBe(false);
    expect(n).toBe(2);
  });

  it('stores the key under all three parts, so no two namespaces share a row', async () => {
    const work = async () => ({ status: 200, body: { ok: true } });
    await svc.run({ userId: OFFICER, endpoint: 'POST /a', key: 'k', body: BODY }, work);
    await svc.run({ userId: MEMBER, endpoint: 'POST /a', key: 'k', body: BODY }, work);
    expect(store.rows).toHaveLength(2);
    expect(new Set(store.rows.map((r) => r.userId)).size).toBe(2);
  });
});

describe('the unauthenticated namespace', () => {
  it('NEVER stores a response body for anonymous callers', async () => {
    // Anonymous callers all share the nil-UUID namespace, so a stored body there
    // is readable by anyone who reuses the key — the same leak INV-041 closes,
    // through a different door.
    const work = async () => ({ status: 200, body: { applicationId: 'private-123' } });
    await svc.run(
      { userId: ANONYMOUS_ACTOR, endpoint: 'POST /v1/apply', key: 'anon-key', body: BODY },
      work,
    );
    const row = store.rows[0];
    expect(row?.userId).toBe(ANONYMOUS_ACTOR);
    expect(row?.responseBody).toBeNull();
    expect(JSON.stringify(store.rows)).not.toContain('private-123');
  });

  it('still suppresses the duplicate side effect for anonymous callers', async () => {
    let ran = 0;
    const work = async () => {
      ran += 1;
      return { status: 202, body: { queued: true } };
    };
    const args = {
      userId: ANONYMOUS_ACTOR,
      endpoint: 'POST /v1/apply',
      key: 'anon-key',
      body: BODY,
    };
    await svc.run(args, work);
    const second = await svc.run(args, work);
    // The point of idempotency is not repeating the write; returning the body is
    // a convenience we give up here rather than leak.
    expect(ran).toBe(1);
    expect(second.replayed).toBe(true);
    expect(second.body).toBeNull();
  });
});

describe('key hygiene', () => {
  it('rejects an absurdly long or empty key rather than storing it', async () => {
    const work = async () => ({ status: 200, body: {} });
    for (const key of ['', '   ', 'x'.repeat(500)]) {
      await expect(
        svc.run({ userId: OFFICER, endpoint: 'POST /a', key, body: BODY }, work),
      ).rejects.toThrow();
    }
  });

  it('hashes the request body rather than storing it', async () => {
    // The body can contain anything a member typed. Storing it turns the
    // idempotency table into a second copy of every mutating request.
    const work = async () => ({ status: 200, body: { ok: true } });
    await svc.run(
      { userId: OFFICER, endpoint: 'POST /a', key: 'k', body: { note: 'sensitive-content' } },
      work,
    );
    expect(JSON.stringify(store.rows)).not.toContain('sensitive-content');
    expect(store.rows[0]?.requestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('gives every row an expiry so the table cannot grow without bound', async () => {
    const work = async () => ({ status: 200, body: {} });
    await svc.run({ userId: OFFICER, endpoint: 'POST /a', key: 'k', body: BODY }, work);
    expect(store.rows[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
