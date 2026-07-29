import { describe, it, expect, beforeEach } from 'vitest';
import { Permission } from '@grims/shared';
import {
  RoleAdminService,
  type RoleAdminStore,
  type RoleRecord,
  type HolderRecord,
} from './role-admin.service.js';

/**
 * P1.7 — the role editor, and the preview that makes it safe to use.
 *
 * ★ WHY A PREVIEW IS AN ACCEPTANCE CRITERION AND NOT A NICETY ★
 *
 * A permission mask is a 70-bit number. Nobody can look at one and say who it
 * affects. Editing it blind is how somebody grants SITE_CONFIG to eleven people
 * while intending to let officers pin a thread — and the mistake is invisible
 * until it is exploited, because nothing fails.
 *
 * So the editor computes, BEFORE saving: exactly which members gain which
 * permissions and lose which permissions. Named, both ways, per member.
 *
 * ★ AND WHY THE CACHE BUST IS IN THE SAME TEST FILE ★
 *
 * A saved role that does not bust the cache is a change that has not happened
 * yet, for up to the TTL. Revoking someone's access and having it keep working
 * for five minutes is the direction that matters.
 */

const OFFICER = Permission.FORUM_VIEW_OFFICER;
const MODERATE = Permission.FORUM_MODERATE;
const SITE_CONFIG = Permission.SITE_CONFIG;

class FakeStore implements RoleAdminStore {
  roles: RoleRecord[] = [];
  holders = new Map<string, HolderRecord[]>();
  saved: Array<{ roleId: string; mask: bigint }> = [];
  busted: string[] = [];
  audit: Array<Record<string, unknown>> = [];

  async listRoles(): Promise<RoleRecord[]> {
    return this.roles;
  }
  async roleById(id: string): Promise<RoleRecord | null> {
    return this.roles.find((r) => r.id === id) ?? null;
  }
  async holdersOf(roleId: string): Promise<HolderRecord[]> {
    return this.holders.get(roleId) ?? [];
  }
  async saveMask(roleId: string, mask: bigint): Promise<void> {
    this.saved.push({ roleId, mask });
    const r = this.roles.find((x) => x.id === roleId);
    if (r !== undefined) (r as { permMask: bigint }).permMask = mask;
  }
  async invalidatePermissions(userId: string): Promise<void> {
    this.busted.push(userId);
  }
  async writeAudit(e: Record<string, unknown>): Promise<void> {
    this.audit.push(e);
  }
}

let store: FakeStore;
let svc: RoleAdminService;

beforeEach(() => {
  store = new FakeStore();
  store.roles = [
    { id: 'r1', key: 'sector_overseer', name: 'Sector Overseer', permMask: OFFICER, rankOrder: 20, isHierarchical: true },
    { id: 'r2', key: 'member', name: 'Member', permMask: 0n, rankOrder: 90, isHierarchical: true },
  ];
  svc = new RoleAdminService(store);
});

describe('the who-does-this-affect preview', () => {
  it('MANDATORY: names every member who GAINS a permission, and which one', async () => {
    store.holders.set('r1', [
      { userId: 'u1', handle: 'grim', otherRoleMasks: [], denyMask: 0n },
      { userId: 'u2', handle: 'ava', otherRoleMasks: [], denyMask: 0n },
    ]);

    const preview = await svc.previewMaskChange('r1', OFFICER | MODERATE);

    expect(preview.affected).toHaveLength(2);
    expect(preview.affected[0]?.gains).toContain('FORUM_MODERATE');
    expect(preview.affected[0]?.losses).toEqual([]);
    expect(preview.affected.map((a) => a.handle).sort()).toEqual(['ava', 'grim']);
  });

  it('MANDATORY: names every member who LOSES a permission, and which one', async () => {
    store.holders.set('r1', [{ userId: 'u1', handle: 'grim', otherRoleMasks: [], denyMask: 0n }]);

    const preview = await svc.previewMaskChange('r1', 0n);
    expect(preview.affected[0]?.losses).toContain('FORUM_VIEW_OFFICER');
    expect(preview.affected[0]?.gains).toEqual([]);
  });

  it('MANDATORY: a member who holds the permission via ANOTHER role loses nothing', async () => {
    // The subtle case, and the reason the preview computes EFFECTIVE masks
    // rather than diffing the role mask on its own. Removing a bit from one
    // role does not remove it from someone who also holds it elsewhere —
    // reporting otherwise would send an officer chasing a revocation that
    // never happened.
    store.holders.set('r1', [
      { userId: 'u1', handle: 'grim', otherRoleMasks: [OFFICER], denyMask: 0n },
    ]);

    const preview = await svc.previewMaskChange('r1', 0n);
    expect(preview.affected).toEqual([]);
  });

  it('respects denyMask — a denied bit is not a gain', async () => {
    // Deny always beats grant (INV-007). Reporting a gain the member will not
    // actually receive is a preview that lies in the safest-looking direction.
    store.holders.set('r1', [
      { userId: 'u1', handle: 'grim', otherRoleMasks: [], denyMask: MODERATE },
    ]);

    const preview = await svc.previewMaskChange('r1', OFFICER | MODERATE);
    expect(preview.affected).toEqual([]);
  });

  it('MANDATORY: flags a change that grants SITE_CONFIG as dangerous', async () => {
    // SITE_CONFIG is bit 63 and effectively total control. Granting it should
    // never be something that slips past in a list of eleven names.
    store.holders.set('r1', [{ userId: 'u1', handle: 'grim', otherRoleMasks: [], denyMask: 0n }]);

    const preview = await svc.previewMaskChange('r1', OFFICER | SITE_CONFIG);
    expect(preview.dangerous).toBe(true);
    expect(preview.warnings.join(' ')).toMatch(/SITE_CONFIG/);
  });

  it('is not dangerous for an ordinary change', async () => {
    store.holders.set('r1', [{ userId: 'u1', handle: 'grim', otherRoleMasks: [], denyMask: 0n }]);
    const preview = await svc.previewMaskChange('r1', OFFICER | MODERATE);
    expect(preview.dangerous).toBe(false);
  });

  it('reports a no-op change as affecting nobody', async () => {
    store.holders.set('r1', [{ userId: 'u1', handle: 'grim', otherRoleMasks: [], denyMask: 0n }]);
    const preview = await svc.previewMaskChange('r1', OFFICER);
    expect(preview.affected).toEqual([]);
    expect(preview.unchanged).toBe(true);
  });

  it('MANDATORY: the preview writes NOTHING', async () => {
    // It is a preview. An officer must be able to look at the consequences of a
    // change they then decide not to make.
    store.holders.set('r1', [{ userId: 'u1', handle: 'grim', otherRoleMasks: [], denyMask: 0n }]);
    await svc.previewMaskChange('r1', SITE_CONFIG);

    expect(store.saved).toEqual([]);
    expect(store.busted).toEqual([]);
    expect(store.audit).toEqual([]);
  });

  it('404s on an unknown role', async () => {
    await expect(svc.previewMaskChange('nope', 0n)).rejects.toThrow(/not found/i);
  });
});

describe('saving a role', () => {
  beforeEach(() => {
    store.holders.set('r1', [
      { userId: 'u1', handle: 'grim', otherRoleMasks: [], denyMask: 0n },
      { userId: 'u2', handle: 'ava', otherRoleMasks: [], denyMask: 0n },
    ]);
  });

  it('MANDATORY: busts the permission cache for EVERY affected member', async () => {
    // A saved role that does not bust the cache has not taken effect yet. For a
    // revocation that means access keeps working for the rest of the TTL.
    await svc.saveMask('r1', OFFICER | MODERATE, 'officer-1');
    expect(store.busted.sort()).toEqual(['u1', 'u2']);
  });

  it('busts the cache for holders even when the change only REMOVES bits', async () => {
    await svc.saveMask('r1', 0n, 'officer-1');
    expect(store.busted.sort()).toEqual(['u1', 'u2']);
  });

  it('audits the change with the before and after masks @INV-009', async () => {
    await svc.saveMask('r1', OFFICER | MODERATE, 'officer-1');
    const entry = store.audit.at(-1);

    expect(entry?.['actorId']).toBe('officer-1');
    // Masks as STRINGS. They exceed 2^53 and JSON has no bigint — a number here
    // would silently round the very value being audited.
    expect(typeof (entry?.['before'] as Record<string, unknown>)['permMask']).toBe('string');
    expect((entry?.['after'] as Record<string, unknown>)['permMask']).toBe(
      (OFFICER | MODERATE).toString(),
    );
  });

  it('records WHO was affected in the audit entry, not just the mask', async () => {
    // Six months later, "the mask changed from 20 to 52" tells nobody anything.
    // The list of people it moved is the part a human can act on.
    await svc.saveMask('r1', OFFICER | MODERATE, 'officer-1');
    expect(JSON.stringify(store.audit.at(-1))).toContain('grim');
  });

  it('does nothing at all when the mask is unchanged', async () => {
    await svc.saveMask('r1', OFFICER, 'officer-1');
    expect(store.saved).toEqual([]);
    expect(store.busted).toEqual([]);
    expect(store.audit).toEqual([]);
  });

  it('MANDATORY: refuses a mask with bits that are not real permissions', async () => {
    // A typo'd literal, or a value pasted from somewhere else, would otherwise
    // set bits nothing checks — until a future permission is assigned that bit
    // and everyone holding this role silently acquires it.
    await expect(svc.saveMask('r1', 1n << 99n, 'officer-1')).rejects.toThrow(/not valid permissions/i);
    expect(store.saved).toEqual([]);
  });
});
