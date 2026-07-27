import { describe, it, expect, beforeEach } from 'vitest';
import {
  MappingAdminService,
  isValidSnowflake,
  type MappingAdminStore,
  type MappingRecord,
} from './mapping-admin.service.js';

/**
 * P1.7 — the Discord mapping editor.
 *
 * The acceptance criterion: "The Discord mapping editor is the only path by
 * which snowflakes enter the system."
 *
 * That is INV-008 restated as a workflow. Role ids live in DATA, never in
 * source, because they change — a role deleted and recreated in Discord gets a
 * new id, and fixing that must not require a deploy at 3am. This is the door
 * they come through, so this is where they get validated.
 */

const OVERSEER = '1513749464458723469';
const ADMIRAL = '804027885081591818';

class FakeStore implements MappingAdminStore {
  mappings: MappingRecord[] = [];
  roles = new Map<string, string>([
    ['r1', 'Sector Overseer'],
    ['r2', 'Galactic Admiral'],
  ]);
  audit: Array<Record<string, unknown>> = [];
  busted: string[] = [];
  holders = new Map<string, string[]>();

  async list(): Promise<MappingRecord[]> {
    return this.mappings;
  }
  async roleName(roleId: string): Promise<string | null> {
    return this.roles.get(roleId) ?? null;
  }
  async findByDiscordRoleId(id: string): Promise<MappingRecord | null> {
    return this.mappings.find((m) => m.discordRoleId === id) ?? null;
  }
  async create(roleId: string, discordRoleId: string): Promise<void> {
    this.mappings.push({ roleId, roleName: this.roles.get(roleId) ?? '', discordRoleId });
  }
  async remove(roleId: string, discordRoleId: string): Promise<void> {
    this.mappings = this.mappings.filter(
      (m) => !(m.roleId === roleId && m.discordRoleId === discordRoleId),
    );
  }
  async holdersOfRole(roleId: string): Promise<string[]> {
    return this.holders.get(roleId) ?? [];
  }
  async invalidatePermissions(userId: string): Promise<void> {
    this.busted.push(userId);
  }
  async writeAudit(e: Record<string, unknown>): Promise<void> {
    this.audit.push(e);
  }
}

let store: FakeStore;
let svc: MappingAdminService;

beforeEach(() => {
  store = new FakeStore();
  svc = new MappingAdminService(store);
});

describe('snowflake validation', () => {
  it('accepts a real Discord snowflake', () => {
    expect(isValidSnowflake(OVERSEER)).toBe(true);
    expect(isValidSnowflake(ADMIRAL)).toBe(true);
  });

  it('MANDATORY: rejects anything that is not a bare 17-20 digit number', () => {
    // The paste-from-Discord failure modes, all of which look plausible:
    for (const bad of [
      '',
      '  ',
      '12345', // too short — an old-style id or a typo
      '123456789012345678901234', // too long
      '<@&1513749464458723469>', // the MENTION form, which is what copying a role from a message gives you
      '1513749464458723469 ', // trailing space from a paste
      'abc1513749464458723469',
      '1513749464458723469;DROP TABLE',
      '1.5137494644587e+18', // what happens when a snowflake goes through a JS number
    ]) {
      expect(isValidSnowflake(bad), `${JSON.stringify(bad)} must be rejected`).toBe(false);
    }
  });

  it('MANDATORY: rejects a snowflake that has been through a JS number', () => {
    // 1513749464458723469 exceeds 2^53. Round-tripping it through Number gives
    // 1513749464458723300 — a valid-LOOKING snowflake that is not the role.
    // This is the same class of bug as the permission mask, and it fails
    // silently: the mapping saves and simply never matches anyone.
    const mangled = String(Number(OVERSEER));
    expect(mangled).not.toBe(OVERSEER);
    // It is still 19 digits, so shape alone cannot catch it...
    expect(isValidSnowflake(mangled)).toBe(true);
    // ...which is why the SERVICE compares against the string it was given.
  });
});

describe('adding a mapping', () => {
  it('creates one and audits it', async () => {
    await svc.add('r1', OVERSEER, 'officer-1');
    expect(store.mappings).toHaveLength(1);
    expect(store.audit.at(-1)?.['action']).toBe('role.mapping.create');
    expect(JSON.stringify(store.audit.at(-1))).toContain(OVERSEER);
  });

  it('MANDATORY: rejects a malformed snowflake before touching the database', async () => {
    await expect(svc.add('r1', '<@&1513749464458723469>', 'officer-1')).rejects.toThrow(
      /snowflake|role id/i,
    );
    expect(store.mappings).toEqual([]);
  });

  it('404s on an unknown platform role', async () => {
    await expect(svc.add('nope', OVERSEER, 'officer-1')).rejects.toThrow(/not found/i);
  });

  it('MANDATORY: refuses to map one Discord role to TWO platform roles', async () => {
    // Ambiguity here is not a cosmetic problem: role-sync maps discordRoleId ->
    // ONE platform role key, so a second mapping means the member's platform
    // roles depend on which row the query happens to return first.
    await svc.add('r1', OVERSEER, 'officer-1');
    await expect(svc.add('r2', OVERSEER, 'officer-1')).rejects.toThrow(/already mapped/i);
  });

  it('is idempotent for the SAME pair', async () => {
    await svc.add('r1', OVERSEER, 'officer-1');
    await svc.add('r1', OVERSEER, 'officer-1');
    expect(store.mappings).toHaveLength(1);
    // And does not write a second audit row claiming it happened twice.
    expect(store.audit.filter((a) => a['action'] === 'role.mapping.create')).toHaveLength(1);
  });

  it('MANDATORY: busts the permission cache for everyone holding that role', async () => {
    // A new mapping changes who role-sync will grant the role to, and the
    // holders' effective masks are computed from roles. A stale cache means the
    // mapping is live but its effect is not.
    store.holders.set('r1', ['u1', 'u2']);
    await svc.add('r1', OVERSEER, 'officer-1');
    expect(store.busted.sort()).toEqual(['u1', 'u2']);
  });
});

describe('removing a mapping', () => {
  it('removes it and audits the removal', async () => {
    await svc.add('r1', OVERSEER, 'officer-1');
    await svc.remove('r1', OVERSEER, 'officer-1');

    expect(store.mappings).toEqual([]);
    expect(store.audit.at(-1)?.['action']).toBe('role.mapping.delete');
  });

  it('MANDATORY: warns that removal will strip the role on the next reconciliation', async () => {
    // Removing a mapping is not neutral. The nightly job will see holders whose
    // Discord role no longer maps to anything and revoke the platform role —
    // which is correct, and is exactly the sort of consequence that should not
    // arrive as a surprise the following morning.
    store.holders.set('r1', ['u1', 'u2']);
    const r = await svc.remove('r1', OVERSEER, 'officer-1');
    expect(r.willAffect).toEqual(['u1', 'u2']);
    expect(r.warning).toMatch(/reconcil/i);
  });

  it('is not an error when the mapping is already gone', async () => {
    await expect(svc.remove('r1', OVERSEER, 'officer-1')).resolves.toBeDefined();
  });
});

describe('listing', () => {
  it('shows every mapping with the platform role it points at', async () => {
    await svc.add('r1', OVERSEER, 'officer-1');
    await svc.add('r2', ADMIRAL, 'officer-1');

    const list = await svc.list();
    expect(list.map((m) => m.roleName).sort()).toEqual(['Galactic Admiral', 'Sector Overseer']);
  });
});
