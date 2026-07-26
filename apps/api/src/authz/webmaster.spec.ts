import { describe, it, expect, beforeEach } from 'vitest';
import { Permission, ALL_PERMISSIONS } from '@grims/shared';
import {
  WebmasterService,
  WEBMASTER_ROLE_KEY,
  parseBootstrapIds,
} from './webmaster.js';
import { InMemoryPermissionStore } from './permission.store.fake.js';

/**
 * The `webmaster` role — site support, granted outside the squadron hierarchy.
 *
 * This is the most dangerous object in the system: it carries ALL_PERMISSIONS
 * and it can grant itself to others, which makes it self-propagating. Two
 * controls make that survivable rather than reckless:
 *
 *   1. The BOOTSTRAP list lives in configuration, not in the database. A
 *      compromised account with full site permissions can still not add itself
 *      to the bootstrap list, because that would require server access. So
 *      there is always a recovery path that an attacker inside the application
 *      cannot close.
 *
 *   2. Every grant and revoke is AUDITED with actor, target and before/after
 *      (INV-009). A self-propagating role with no audit trail is how a single
 *      compromise becomes permanent and untraceable.
 *
 * It is worth being plain about one thing: calling this a "support role" does
 * not make it less powerful than an org admin. It can do everything an admin
 * can. The distinction is intent and provenance, not capability.
 */

let store: InMemoryPermissionStore;
let svc: WebmasterService;

const PEBBLES = '1262447044337864850';

beforeEach(() => {
  store = new InMemoryPermissionStore();
  store.addRole(WEBMASTER_ROLE_KEY, ALL_PERMISSIONS, false);
  store.addRole('member', Permission.FORUM_VIEW_MEMBER);
  svc = new WebmasterService(store, { bootstrapDiscordIds: [PEBBLES] });
});

describe('bootstrap on login', () => {
  it('grants webmaster to a bootstrap Discord ID when they first sign in', async () => {
    store.addUser('u1', 'active');
    await svc.applyBootstrap('u1', PEBBLES);
    expect(store.rolesOf('u1')).toContain(WEBMASTER_ROLE_KEY);
  });

  it('does NOT grant it to anyone else', async () => {
    store.addUser('u2', 'active');
    await svc.applyBootstrap('u2', '999999999999999999');
    expect(store.rolesOf('u2')).not.toContain(WEBMASTER_ROLE_KEY);
  });

  it('is idempotent across repeated logins', async () => {
    store.addUser('u1', 'active');
    await svc.applyBootstrap('u1', PEBBLES);
    await svc.applyBootstrap('u1', PEBBLES);
    expect(store.rolesOf('u1').filter((r) => r === WEBMASTER_ROLE_KEY)).toHaveLength(1);
    // And it does not spam the audit log on every single sign-in.
    expect(store.audit.filter((a) => a.action === 'role.grant')).toHaveLength(1);
  });

  it('records the grant as system-sourced, not as a human decision', async () => {
    store.addUser('u1', 'active');
    await svc.applyBootstrap('u1', PEBBLES);
    expect(store.grantSource('u1', WEBMASTER_ROLE_KEY)).toBe('system');
    const entry = store.audit.find((a) => a.action === 'role.grant');
    expect(entry?.actorId).toBeNull(); // nobody chose this; configuration did
    expect(JSON.stringify(entry)).toMatch(/bootstrap/i);
  });

  it('re-grants if the role was removed but the ID is still in the bootstrap list', async () => {
    // The bootstrap list is the recovery path. If it did not re-assert, an
    // accidental self-revoke would lock everyone out of the admin console with
    // no way back in short of editing the database by hand.
    store.addUser('u1', 'active');
    await svc.applyBootstrap('u1', PEBBLES);
    store.revoke('u1', WEBMASTER_ROLE_KEY);
    await svc.applyBootstrap('u1', PEBBLES);
    expect(store.rolesOf('u1')).toContain(WEBMASTER_ROLE_KEY);
  });

  it('does nothing when the bootstrap list is empty', async () => {
    const empty = new WebmasterService(store, { bootstrapDiscordIds: [] });
    store.addUser('u1', 'active');
    await empty.applyBootstrap('u1', PEBBLES);
    expect(store.rolesOf('u1')).not.toContain(WEBMASTER_ROLE_KEY);
  });
});

describe('granting to others', () => {
  it('lets an existing webmaster grant the role', async () => {
    store.addUser('boss', 'active');
    store.addUser('helper', 'active');
    store.grant('boss', WEBMASTER_ROLE_KEY);
    await svc.grantTo('boss', 'helper');
    expect(store.rolesOf('helper')).toContain(WEBMASTER_ROLE_KEY);
  });

  it('REFUSES a grant from someone who is not a webmaster', async () => {
    store.addUser('member', 'active');
    store.addUser('victim', 'active');
    store.grant('member', 'member');
    await expect(svc.grantTo('member', 'victim')).rejects.toThrow();
    expect(store.rolesOf('victim')).not.toContain(WEBMASTER_ROLE_KEY);
  });

  it('REFUSES a grant from a webmaster whose account is not active', async () => {
    // A departed or banned webmaster must not be able to seed a replacement on
    // the way out. INV-037 governs reads; this is the same rule on writes.
    store.addUser('exboss', 'banned');
    store.addUser('friend', 'active');
    store.grant('exboss', WEBMASTER_ROLE_KEY, 'manual');
    await expect(svc.grantTo('exboss', 'friend')).rejects.toThrow();
  });

  it('REFUSES to grant to a non-active account', async () => {
    store.addUser('boss', 'active');
    store.addUser('ghost', 'left');
    store.grant('boss', WEBMASTER_ROLE_KEY);
    await expect(svc.grantTo('boss', 'ghost')).rejects.toThrow();
  });

  it('audits every grant with actor, target and the resulting mask @INV-009', async () => {
    store.addUser('boss', 'active');
    store.addUser('helper', 'active');
    store.grant('boss', WEBMASTER_ROLE_KEY);
    await svc.grantTo('boss', 'helper');
    const entry = store.audit.find((a) => a.action === 'role.grant' && a.targetId === 'helper');
    expect(entry?.actorId).toBe('boss');
    expect(entry?.after).toMatchObject({ role: WEBMASTER_ROLE_KEY });
  });

  it('audits a revoke as well as a grant', async () => {
    store.addUser('boss', 'active');
    store.addUser('helper', 'active');
    store.grant('boss', WEBMASTER_ROLE_KEY);
    await svc.grantTo('boss', 'helper');
    await svc.revokeFrom('boss', 'helper');
    expect(store.rolesOf('helper')).not.toContain(WEBMASTER_ROLE_KEY);
    expect(store.audit.some((a) => a.action === 'role.revoke')).toBe(true);
  });

  it('refuses to let the LAST active webmaster revoke themselves', async () => {
    // Otherwise one misclick locks everybody out of the admin console. The
    // bootstrap list would still recover it, but only for the configured IDs —
    // and only if someone remembers that is how it works.
    store.addUser('boss', 'active');
    store.grant('boss', WEBMASTER_ROLE_KEY);
    await expect(svc.revokeFrom('boss', 'boss')).rejects.toThrow(/last/i);
  });

  it('allows self-revoke when another active webmaster remains', async () => {
    store.addUser('boss', 'active');
    store.addUser('other', 'active');
    store.grant('boss', WEBMASTER_ROLE_KEY);
    store.grant('other', WEBMASTER_ROLE_KEY);
    await expect(svc.revokeFrom('boss', 'boss')).resolves.toBeUndefined();
  });
});

describe('parseBootstrapIds', () => {
  it('parses a comma-separated list and ignores blanks', () => {
    // Real snowflake lengths: the validator rejects anything shorter, which is
    // the point of it.
    expect(parseBootstrapIds(' 1262447044337864850 , 804027885081591818 ,, ')).toEqual([
      '1262447044337864850',
      '804027885081591818',
    ]);
  });

  it('returns an empty list for undefined or empty configuration', () => {
    expect(parseBootstrapIds(undefined)).toEqual([]);
    expect(parseBootstrapIds('   ')).toEqual([]);
  });

  it('rejects anything that is not a Discord snowflake', () => {
    // A typo that silently becomes "nobody is bootstrapped" is a lockout; one
    // that silently becomes a wildcard would be far worse. Fail loudly.
    expect(() => parseBootstrapIds('not-an-id')).toThrow();
    expect(() => parseBootstrapIds('1262447044337864850,*')).toThrow();
    expect(() => parseBootstrapIds('123')).toThrow(); // too short to be one
  });
});
