import { describe, it, expect, vi } from 'vitest';
import { ErrorCode, Permission } from '@grims/shared';
import { GrantService } from './grant.service.js';
import type { AclBoundClient } from '../authz/acl-db.service.js';

/**
 * Per-thread grants — the only write in the forum that WIDENS access.
 *
 * ★ WHAT IS ACTUALLY BEING TESTED HERE ★
 *
 * Not "does it insert a row". The four rules from `grant.service.ts`, and in
 * particular rule 2, which is the one that closes the hole rather than merely
 * gating it:
 *
 *   Rule 1 (holds FORUM_MODERATE) stops a member granting themselves access.
 *   Rule 2 (can SEE the thread) stops a MODERATOR who cannot read the officers'
 *          board from handing out access to it. Rule 1 alone does not do this —
 *          FORUM_MODERATE and FORUM_VIEW_OFFICER are different bits, and a
 *          moderator of the members' boards holds the first and not the second.
 *
 * Rule 2 is expressed as a QUERY, not as a check: the thread is read through the
 * granter's own bound client, so an invisible thread comes back `null`. That is why
 * these tests drive it with a stub whose `findFirst` returns null — that stub IS the
 * ACL predicate having filtered the row out.
 */

/** A stub bound client. The brand is a phantom type, so a cast is the only way in. */
function stubDb(over: Record<string, unknown>): AclBoundClient {
  return over as unknown as AclBoundClient;
}

const MODERATOR = Permission.FORUM_MODERATE;
const THREAD = 'thread-1';
/**
 * The first argument the mock was called with, typed.
 *
 * WHY THIS EXISTS
 *
 * Indexing mock.calls at zero and casting fails the STRICT typecheck: a vi.fn with no declared
 * parameters infers an empty tuple, so index 0 does not exist on it (TS2493).
 *
 * It was invisible locally because tsc -p tsconfig.json EXCLUDES specs. CI runs the package
 * typecheck script, which includes tsconfig.spec.json. The lesson is the command, not the cast:
 * run pnpm --filter @grims/api typecheck.
 *
 * This also fails BETTER: the old form silently produced undefined when a mock had not been
 * called, so the assertion failed on a missing property rather than saying the call never
 * happened.
 */
function firstArg<T>(fn: { mock: { calls: unknown[][] } }, what = 'the mock'): T {
  const call = fn.mock.calls[0];
  if (call === undefined) throw new Error(`expected ${what} to have been called, but it was not`);
  return call[0] as T;
}


/** A thread the granter CAN see, sitting in an officers-only category. */
const visibleOfficerThread = {
  id: THREAD,
  category: { viewPerm: { toFixed: () => '16' } },
};

describe('rule 1 — only a moderator may grant', () => {
  it('MANDATORY: a plain member cannot grant, even to themselves', async () => {
    const svc = new GrantService();
    const db = stubDb({});

    await expect(
      svc.grant(db, THREAD, ['user-2'], 'user-1', 0n, null),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
  });

  it('MANDATORY: refuses BEFORE touching the database', async () => {
    /*
     * Ordering matters. If the permission check came after the thread read, an
     * unprivileged caller could still probe which thread ids exist by watching
     * whether they got PERMISSION_DENIED or RESOURCE_NOT_VISIBLE.
     */
     const findFirst = vi.fn();
     const svc = new GrantService();

     await expect(
       svc.grant(stubDb({ forumThread: { findFirst } }), THREAD, ['u'], 'user-1', 0n, null),
     ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });

     expect(findFirst).not.toHaveBeenCalled();
  });

  it('MANDATORY: the same is true of search and revoke', async () => {
    const svc = new GrantService();
    const db = stubDb({});

    await expect(svc.search(db, THREAD, 'ab', 0n)).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
    });
    await expect(svc.revoke(db, THREAD, 'user-2', 0n)).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
    });
  });
});

describe('rule 2 — you cannot grant access to what you cannot see', () => {
  it('MANDATORY @INV-002: a moderator who cannot see the thread is refused', async () => {
    /*
     * ★ THE CENTRAL TEST OF THIS FILE ★
     *
     * `findFirst` returning null IS the ACL predicate having hidden the row — that is
     * what the extension does to a thread the principal cannot see. So this is a
     * moderator of the members' boards attempting to grant access to an officers'
     * thread, and being unable to because the thread does not exist as far as their
     * own client is concerned.
     *
     * No code in the service asks "is this the officers' board". It does not need to.
     */
    const svc = new GrantService();
    const db = stubDb({ forumThread: { findFirst: async () => null } });

    await expect(
      svc.grant(db, THREAD, ['user-2'], 'mod-1', MODERATOR, null),
    ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_NOT_VISIBLE });
  });

  it('MANDATORY @INV-024: refusal is cloaked as not-found, never as forbidden', async () => {
    /*
     * A 403 would confirm the thread is real. On the officers' board the existence of
     * a thread — and its id appearing in someone's clipboard — is part of what is
     * being protected, so "you may not" and "there is nothing here" must be the same
     * answer.
     */
    const svc = new GrantService();
    const db = stubDb({ forumThread: { findFirst: async () => null } });

    await expect(svc.list(db, THREAD)).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_VISIBLE,
    });
    expect(ErrorCode.RESOURCE_NOT_VISIBLE).not.toBe(ErrorCode.PERMISSION_DENIED);
  });

  it('reads the thread through the caller’s own client, not a system one', async () => {
    // The property the whole design rests on. If this ever called `forSystem()` the
    // rule would evaporate silently, so the stub records that the passed-in client is
    // the one used.
    const findFirst = vi.fn(async () => null);
    const svc = new GrantService();
    const db = stubDb({ forumThread: { findFirst } });

    await expect(
      svc.grant(db, THREAD, ['user-2'], 'mod-1', MODERATOR, null),
    ).rejects.toThrow();

    expect(findFirst).toHaveBeenCalledOnce();
  });
});

describe('rule 3 — the grantee must be an active account', () => {
  it('MANDATORY: refuses when any named account is not active', async () => {
    /*
     * "all forum users must be in our discord" — a grant to a banned or departed
     * account would sit dormant and become live again if the account were restored.
     *
     * Checked as a SET before writing anything: two ids requested, one active row
     * returned.
     */
    const upsert = vi.fn();
    const svc = new GrantService();
    const db = stubDb({
      forumThread: { findFirst: async () => visibleOfficerThread },
      user: { findMany: async () => [{ id: 'user-2' }] },
      forumThreadGrant: { upsert },
      $transaction: vi.fn(),
    });

    await expect(
      svc.grant(db, THREAD, ['user-2', 'banned-1'], 'mod-1', MODERATOR, null),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });

    // Nothing partially applied.
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('the multi-select contract', () => {
  it('applies the whole set in ONE transaction', async () => {
    /*
     * The instruction asks for a multi-select. Five grants as five requests would
     * leave a half-applied set when the third fails, and an admin with no way to tell
     * which two landed.
     */
    const transaction = vi.fn(async () => []);
    const svc = new GrantService();
    const db = stubDb({
      forumThread: { findFirst: async () => visibleOfficerThread },
      user: { findMany: async () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
      forumThreadGrant: {
        upsert: (a: unknown) => a,
        findMany: async () => [],
      },
      $transaction: transaction,
    });

    await svc.grant(db, THREAD, ['a', 'b', 'c'], 'mod-1', MODERATOR, 'helping with BGS');

    expect(transaction).toHaveBeenCalledOnce();
    expect(firstArg<unknown[]>(transaction, 'transaction')).toHaveLength(3);
  });

  it('de-duplicates a list the UI sent twice', async () => {
    const transaction = vi.fn(async () => []);
    const svc = new GrantService();
    const db = stubDb({
      forumThread: { findFirst: async () => visibleOfficerThread },
      user: { findMany: async () => [{ id: 'a' }] },
      forumThreadGrant: { upsert: (a: unknown) => a, findMany: async () => [] },
      $transaction: transaction,
    });

    await svc.grant(db, THREAD, ['a', 'a', 'a'], 'mod-1', MODERATOR, null);

    // One row, not three — and the active-account check saw one id, so a stub
    // returning one active user is consistent rather than accidentally passing.
    expect(firstArg<unknown[]>(transaction, 'transaction')).toHaveLength(1);
  });

  it('MANDATORY: refuses an empty list rather than silently doing nothing', async () => {
    const svc = new GrantService();
    const db = stubDb({ forumThread: { findFirst: async () => visibleOfficerThread } });

    await expect(
      svc.grant(db, THREAD, [], 'mod-1', MODERATOR, null),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it('MANDATORY: caps the set, because "grant to everyone" is what this must not become', async () => {
    const svc = new GrantService();
    const db = stubDb({ forumThread: { findFirst: async () => visibleOfficerThread } });

    const many = Array.from({ length: 26 }, (_, i) => `user-${i}`);
    await expect(
      svc.grant(db, THREAD, many, 'mod-1', MODERATOR, null),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });
});

describe('search — a dropdown that does not leak the roster', () => {
  it('MANDATORY: an empty or one-character query returns nothing', async () => {
    /*
     * The lazy implementation of "searchable and autocompletable" ships the whole
     * membership to the browser and filters there, which publishes the roster to
     * anybody who can open a thread. An empty query is the same leak with fewer
     * keystrokes.
     */
    const findMany = vi.fn();
    const svc = new GrantService();
    const db = stubDb({
      forumThread: { findFirst: async () => visibleOfficerThread },
      user: { findMany },
    });

    for (const q of ['', ' ', 'a', ' x ']) {
      expect(await svc.search(db, THREAD, q, MODERATOR)).toEqual([]);
    }
    expect(findMany).not.toHaveBeenCalled();
  });

  it('caps the result set', async () => {
    let seen: { take?: number } = {};
    const svc = new GrantService();
    const db = stubDb({
      forumThread: { findFirst: async () => visibleOfficerThread },
      user: {
        findMany: async (a: { take?: number }) => {
          seen = a;
          return [];
        },
      },
    });

    await svc.search(db, THREAD, 'cmdr', MODERATOR);
    expect(seen.take).toBe(20);
  });

  it('MANDATORY: computes the mask with toFixed(0), not toString()', async () => {
    /*
     * ★ THE 1e21 TRAP ★
     *
     * permMask is NUMERIC(40,0) and Prisma maps it to a Decimal whose `toString()`
     * switches to EXPONENTIAL NOTATION at 1e21 — and ALL_PERMISSIONS is 1.19e21, so
     * every all-permission role is over the line and `BigInt()` throws on it.
     *
     * This stub's Decimal deliberately mimics that: `toString()` returns the
     * exponential form, `toFixed(0)` the digits. A regression to `toString()` fails
     * here with the same "Cannot convert … to a BigInt" the dev-grant script hit,
     * rather than silently mis-reporting who already has access.
     */
    /*
     * ★ …967, NOT …887 — AND THIS TEST CAUGHT ME USING THE WRONG ONE ★
     *
     * I first wrote `…887` here, calling it "ALL". It is not: it is the WEBMASTER
     * mask, which is ALL_PERMISSIONS with exactly FORUM_POST_OFFICER (64) and
     * FORUM_VIEW_OFFICER (16) subtracted — 967 − 887 = 80 = 64 + 16. So the one bit
     * this test needs was the one that number is defined by not having, and
     * `alreadyHasAccess` correctly came back false.
     *
     * Two similar-looking constants where one is the other minus the bit under test
     * is a good reason to write both down.
     */
    const ALL_PERMISSIONS = '1197902339489246755967';
    const decimal = {
      toFixed: () => ALL_PERMISSIONS,
      toString: () => '1.197902339489246755967e+21',
    };

    const svc = new GrantService();
    const db = stubDb({
      forumThread: { findFirst: async () => visibleOfficerThread },
      user: {
        findMany: async () => [
          {
            id: 'admin-1',
            handle: 'grim',
            displayName: 'Grim',
            userRoles: [{ role: { permMask: decimal } }],
            threadGrantsReceived: [],
          },
        ],
      },
    });

    const [candidate] = await svc.search(db, THREAD, 'grim', MODERATOR);

    // An all-permission role satisfies the officers-only viewPerm of 16, so this
    // person already has access and the UI must say so rather than offering a
    // grant that changes nothing.
    expect(candidate?.alreadyHasAccess).toBe(true);
  });

  it('reports a member who does NOT already have access', async () => {
    const svc = new GrantService();
    const db = stubDb({
      forumThread: { findFirst: async () => visibleOfficerThread },
      user: {
        findMany: async () => [
          {
            id: 'user-2',
            handle: 'newcmdr',
            displayName: null,
            // FORUM_VIEW_MEMBER only — not the officers bit the category demands.
            userRoles: [{ role: { permMask: { toFixed: () => '4' } } }],
            threadGrantsReceived: [],
          },
        ],
      },
    });

    const [candidate] = await svc.search(db, THREAD, 'newcmdr', MODERATOR);
    expect(candidate?.alreadyHasAccess).toBe(false);
  });

  it('counts an EXISTING grant as already having access', async () => {
    const svc = new GrantService();
    const db = stubDb({
      forumThread: { findFirst: async () => visibleOfficerThread },
      user: {
        findMany: async () => [
          {
            id: 'user-2',
            handle: 'newcmdr',
            displayName: null,
            userRoles: [{ role: { permMask: { toFixed: () => '4' } } }],
            threadGrantsReceived: [{ threadId: THREAD }],
          },
        ],
      },
    });

    const [candidate] = await svc.search(db, THREAD, 'newcmdr', MODERATOR);
    expect(candidate?.alreadyHasAccess).toBe(true);
  });
});

describe('revoke', () => {
  it('is idempotent — two admins clicking the same X both succeed', async () => {
    const deleteMany = vi.fn(async () => ({ count: 0 }));
    const svc = new GrantService();
    const db = stubDb({
      forumThread: { findFirst: async () => visibleOfficerThread },
      forumThreadGrant: { deleteMany, findMany: async () => [] },
    });

    await expect(
      svc.revoke(db, THREAD, 'user-2', MODERATOR),
    ).resolves.toEqual([]);
    expect(deleteMany).toHaveBeenCalledOnce();
  });
});

describe('rule 4 — a grant conveys READ only', () => {
  it('MANDATORY: nothing in the service touches a posting permission', async () => {
    /*
     * Asserted structurally rather than behaviourally, because the guarantee is an
     * ABSENCE: posting is decided by the category's `post_perm`, and the safe
     * implementation of "a grant does not confer posting" is that this file never
     * mentions posting at all.
     *
     * A behavioural test cannot show an absence — it can only show that the paths
     * somebody thought to try do not post. Reading the source can.
     */
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./grant.service.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    expect(code).not.toContain('FORUM_POST');
    expect(code).not.toContain('postPerm');
    expect(code).not.toContain('canPost');
  });
});
