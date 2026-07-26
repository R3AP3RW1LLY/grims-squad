import { describe, it, expect, beforeEach } from 'vitest';
import { Permission, ALL_PERMISSIONS, NO_PERMISSIONS } from '@grims/shared';
import { PermissionService, PERM_CACHE_TTL_SEC } from './permission.service.js';
import { InMemoryPermissionStore, FakeCache } from './permission.store.fake.js';
import { WEBMASTER_ROLE_KEY } from './webmaster.js';

/**
 * P1.3 — the permission engine.
 *
 * Two rules, and nothing else grants anything:
 *   effective = OR(role masks) AND NOT deny_mask        (INV-001)
 *   ...unless the account is not active, in which case it is zero (INV-037)
 *
 * INV-037 exists because of RED-TEAM finding R4. Without a status check, an
 * officer who leaves the squadron or is banned keeps their mask indefinitely:
 * their Discord roles vanish, but any `manual` grant survives, and the mask is
 * computed from grants rather than from membership. They walk out with officer
 * access still attached to their account.
 */

let store: InMemoryPermissionStore;
let cache: FakeCache;
let svc: PermissionService;

const MEMBER_MASK = Permission.FORUM_VIEW_MEMBER | Permission.FORUM_POST_MEMBER | Permission.OPS_VIEW;
const OFFICER_MASK = MEMBER_MASK | Permission.FORUM_VIEW_OFFICER | Permission.FORUM_MODERATE;

beforeEach(() => {
  store = new InMemoryPermissionStore();
  cache = new FakeCache();
  svc = new PermissionService(store, cache);
  store.addRole('member', MEMBER_MASK);
  store.addRole('officer', OFFICER_MASK);
  // isHierarchical=false: webmaster is an orthogonal tag, not a squadron rank.
  store.addRole(WEBMASTER_ROLE_KEY, ALL_PERMISSIONS, false);
});

// ---------------------------------------------------------------------------
describe('effective mask @INV-001', () => {
  it('is the OR of every role the user holds', async () => {
    store.addUser('u1', 'active');
    store.grant('u1', 'member');
    store.grant('u1', 'officer');
    expect(await svc.effectiveMask('u1')).toBe(MEMBER_MASK | OFFICER_MASK);
  });

  it('is zero for a user with no roles at all', async () => {
    store.addUser('u1', 'active');
    expect(await svc.effectiveMask('u1')).toBe(NO_PERMISSIONS);
  });

  it('is zero for a user who does not exist', async () => {
    // Fails closed. Returning "no roles found, therefore no restrictions" is how
    // a deleted account becomes a superuser.
    expect(await svc.effectiveMask('nobody')).toBe(NO_PERMISSIONS);
  });

  it('subtracts the deny mask LAST, so deny always beats grant @INV-007', async () => {
    store.addUser('u1', 'active', Permission.FORUM_MODERATE);
    store.grant('u1', 'officer');
    const mask = await svc.effectiveMask('u1');
    expect(mask & Permission.FORUM_MODERATE).toBe(0n);
    expect(mask & Permission.FORUM_VIEW_OFFICER).not.toBe(0n);
  });

  it('lets a deny mask strip even a WEBMASTER permission', async () => {
    // The most powerful role in the system must still be answerable to an
    // explicit revocation, or there is no way to contain a compromised account
    // short of deleting it.
    store.addUser('u1', 'active', Permission.SITE_CONFIG);
    store.grant('u1', WEBMASTER_ROLE_KEY);
    const mask = await svc.effectiveMask('u1');
    expect(mask & Permission.SITE_CONFIG).toBe(0n);
    expect(mask & Permission.MEMBER_MANAGE).not.toBe(0n);
  });

  it('nothing outside roles and deny can grant a bit', async () => {
    store.addUser('u1', 'active');
    store.grant('u1', 'member');
    const mask = await svc.effectiveMask('u1');
    // Every bit set must be traceable to a role the user holds.
    expect(mask & ~MEMBER_MASK).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
describe('account status @INV-037', () => {
  for (const status of ['left', 'banned', 'inactive'] as const) {
    it(`resolves to NO_PERMISSIONS for a ${status} account even with surviving grants`, async () => {
      store.addUser('u1', status);
      store.grant('u1', 'officer', 'manual'); // a manual grant survives role sync
      store.grant('u1', WEBMASTER_ROLE_KEY, 'manual');
      expect(await svc.effectiveMask('u1')).toBe(NO_PERMISSIONS);
    });
  }

  it('restores permissions when the account becomes active again', async () => {
    store.addUser('u1', 'inactive');
    store.grant('u1', 'member');
    expect(await svc.effectiveMask('u1')).toBe(NO_PERMISSIONS);
    store.setStatus('u1', 'active');
    await svc.invalidate('u1');
    expect(await svc.effectiveMask('u1')).toBe(MEMBER_MASK);
  });
});

// ---------------------------------------------------------------------------
describe('caching', () => {
  it('caches under perm:{userId} with a 5 minute TTL', async () => {
    store.addUser('u1', 'active');
    store.grant('u1', 'member');
    await svc.effectiveMask('u1');
    expect(PERM_CACHE_TTL_SEC).toBe(300);
    expect(cache.entries.get('perm:u1')?.ttlSec).toBe(300);
  });

  it('serves the second call from cache without touching the store', async () => {
    store.addUser('u1', 'active');
    store.grant('u1', 'member');
    await svc.effectiveMask('u1');
    const reads = store.reads;
    await svc.effectiveMask('u1');
    expect(store.reads).toBe(reads);
  });

  it('busts the cache on a role change', async () => {
    store.addUser('u1', 'active');
    store.grant('u1', 'member');
    expect(await svc.effectiveMask('u1')).toBe(MEMBER_MASK);

    store.grant('u1', 'officer');
    await svc.invalidate('u1');
    expect(await svc.effectiveMask('u1')).toBe(MEMBER_MASK | OFFICER_MASK);
  });

  it('MANDATORY: busts the cache when the account status changes', async () => {
    // A ban that takes five minutes to bite is not a ban.
    store.addUser('u1', 'active');
    store.grant('u1', 'officer');
    await svc.effectiveMask('u1');
    // The caller changes the status, THEN notifies — the service does not own
    // the write, it owns the invalidation.
    store.setStatus('u1', 'banned');
    await svc.onStatusChanged('u1', 'banned');
    expect(cache.entries.has('perm:u1')).toBe(false);
    expect(await svc.effectiveMask('u1')).toBe(NO_PERMISSIONS);
  });

  it('drops the user WebSocket channels when status changes', async () => {
    // Otherwise a banned member keeps receiving live officer traffic on an
    // already-open socket, because nothing re-checks an established connection.
    store.addUser('u1', 'active');
    store.grant('u1', 'officer');
    await svc.onStatusChanged('u1', 'banned');
    expect(store.droppedSockets).toContain('u1');
  });

  it('busts on guild member removal', async () => {
    store.addUser('u1', 'active');
    store.grant('u1', 'member');
    await svc.effectiveMask('u1');
    await svc.onGuildMemberRemoved('u1');
    expect(cache.entries.has('perm:u1')).toBe(false);
    expect(store.droppedSockets).toContain('u1');
  });

  it('fails OPEN to the store, not to a default, when the cache is unavailable', async () => {
    store.addUser('u1', 'active');
    store.grant('u1', 'member');
    cache.breakIt();
    // Redis being down must degrade to a slower correct answer, never to a
    // guessed one in either direction.
    expect(await svc.effectiveMask('u1')).toBe(MEMBER_MASK);
  });

  it('never caches a mask for a non-active account', async () => {
    store.addUser('u1', 'banned');
    store.grant('u1', 'officer');
    await svc.effectiveMask('u1');
    // Caching zero is harmless, but caching under a key that a later
    // reactivation might not bust is not. Simpler to never store it.
    expect(cache.entries.has('perm:u1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('has()', () => {
  it('answers true only when every requested bit is present', async () => {
    store.addUser('u1', 'active');
    store.grant('u1', 'member');
    expect(await svc.has('u1', Permission.FORUM_VIEW_MEMBER)).toBe(true);
    expect(await svc.has('u1', Permission.FORUM_MODERATE)).toBe(false);
    // ALL of the requested bits, not any.
    expect(
      await svc.has('u1', Permission.FORUM_VIEW_MEMBER | Permission.FORUM_MODERATE),
    ).toBe(false);
  });

  it('answers false for an empty request rather than vacuously true', async () => {
    // `has(user, 0n)` is almost always a bug at the call site — a permission
    // constant that failed to resolve. Answering "yes, you have no permissions"
    // turns that bug into an open door.
    store.addUser('u1', 'active');
    store.grant('u1', WEBMASTER_ROLE_KEY);
    expect(await svc.has('u1', NO_PERMISSIONS)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('webmaster role', () => {
  it('holds every permission that exists', async () => {
    store.addUser('u1', 'active');
    store.grant('u1', WEBMASTER_ROLE_KEY);
    expect(await svc.effectiveMask('u1')).toBe(ALL_PERMISSIONS);
  });

  it('is NOT mapped to any Discord role', async () => {
    // The point of it: a site support role that exists independently of the
    // squadron hierarchy. A Discord mapping would let role sync revoke it.
    expect(store.mappingsFor(WEBMASTER_ROLE_KEY)).toHaveLength(0);
  });

  it('is not hierarchical — it confers no rank in the squadron', async () => {
    expect(store.role(WEBMASTER_ROLE_KEY)?.isHierarchical).toBe(false);
  });

  it('still resolves to nothing if the account is banned', async () => {
    store.addUser('u1', 'banned');
    store.grant('u1', WEBMASTER_ROLE_KEY, 'manual');
    expect(await svc.effectiveMask('u1')).toBe(NO_PERMISSIONS);
  });
});
