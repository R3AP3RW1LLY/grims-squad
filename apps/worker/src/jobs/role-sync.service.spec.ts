import { describe, it, expect, beforeEach } from 'vitest';
import { RoleSyncService } from './role-sync.service.js';
import { InMemoryRoleSyncStore } from './role-sync.store.fake.js';

/**
 * Maps a member's DISCORD roles onto platform roles when they sign in.
 *
 * ★ THE RULE THAT MAKES THIS SAFE ★
 * It only ever touches grants whose source is `discord`. A grant made by a
 * human (`manual`) or by configuration (`system`) is invisible to it.
 *
 * Without that rule, the first sign-in after this shipped would revoke the
 * webmaster role — which is `system`-sourced and has no Discord role behind it
 * — and lock the only superuser out of the admin console. Role sync must be
 * able to say "you no longer hold Sector Overseer in Discord" without also
 * saying "and therefore you hold nothing else either".
 */

const DISCORD = {
  admiral: '804027885081591818',
  legate: '1512912541771235601',
  chiefFleet: '1512912750416760892',
  sectorOverseer: '1513749464458723469',
  squadronLeader: '1513669809756311593',
  cadet: '1528251831531339927', // mapped to nothing — a cosmetic rank
};

let store: InMemoryRoleSyncStore;
let svc: RoleSyncService;

beforeEach(() => {
  store = new InMemoryRoleSyncStore();
  store.addMapping(DISCORD.admiral, 'galactic_admiral');
  store.addMapping(DISCORD.legate, 'prime_legate');
  store.addMapping(DISCORD.chiefFleet, 'chief_fleet_commander');
  store.addMapping(DISCORD.sectorOverseer, 'sector_overseer');
  store.addMapping(DISCORD.squadronLeader, 'squadron_leader');
  svc = new RoleSyncService(store);
});

describe('granting on sign-in', () => {
  it('grants the platform role for each mapped Discord role', async () => {
    await svc.sync('u1', [DISCORD.sectorOverseer, DISCORD.cadet]);
    expect(store.rolesOf('u1')).toEqual(['sector_overseer']);
  });

  it('grants several when a member holds several', async () => {
    await svc.sync('u1', [DISCORD.admiral, DISCORD.squadronLeader]);
    expect(store.rolesOf('u1').sort()).toEqual(['galactic_admiral', 'squadron_leader']);
  });

  it('ignores Discord roles that map to nothing, and lands on the floor', async () => {
    /*
     * Tenure and loyalty ranks are cosmetic and grant no permissions (INV-046),
     * so a Cadet maps to nothing at all.
     *
     * They are not left holding NOTHING, though — they hold `unranked`, which is
     * the editable floor. Before it existed there was no row an admin could edit
     * to say what an ordinary member may do, so the console could describe
     * officers and nobody else.
     */
    await svc.sync('u1', [DISCORD.cadet]);
    expect(store.rolesOf('u1')).toEqual(['unranked']);
  });

  it('MANDATORY: the floor is REVOKED the moment a real role arrives', async () => {
    /*
     * It is granted with source `discord` precisely so this sync owns it. A
     * floor that outlived the member's promotion would keep applying its
     * permissions to somebody who had moved past it, and nothing would ever
     * take it away.
     */
    await svc.sync('u1', [DISCORD.cadet]);
    expect(store.rolesOf('u1')).toEqual(['unranked']);

    await svc.sync('u1', [DISCORD.sectorOverseer]);
    expect(store.rolesOf('u1')).toEqual(['sector_overseer']);

    // And back again when they lose it.
    await svc.sync('u1', []);
    expect(store.rolesOf('u1')).toEqual(['unranked']);
  });

  it('is idempotent across repeated sign-ins', async () => {
    await svc.sync('u1', [DISCORD.chiefFleet]);
    await svc.sync('u1', [DISCORD.chiefFleet]);
    expect(store.rolesOf('u1')).toEqual(['chief_fleet_commander']);
    // And it does not write an audit row on every single login.
    expect(store.audit.filter((a) => a.action === 'role.grant')).toHaveLength(1);
  });

  it('records the grant as discord-sourced', async () => {
    await svc.sync('u1', [DISCORD.legate]);
    expect(store.sourceOf('u1', 'prime_legate')).toBe('discord');
  });
});

describe('revoking when Discord changes', () => {
  it('removes a role the member no longer holds in Discord', async () => {
    await svc.sync('u1', [DISCORD.sectorOverseer]);
    await svc.sync('u1', []); // demoted in Discord
    // Down to the floor, not to nothing: they are still a member, and the floor
    // is the row that says what a member with no rank may do.
    expect(store.rolesOf('u1')).toEqual(['unranked']);
  });

  it('MANDATORY: never touches a manual or system grant', async () => {
    // The webmaster role is system-granted and has NO Discord role behind it.
    // A sync that revoked "anything not in Discord" would remove it on the very
    // next login and lock the only superuser out of the admin console.
    store.grant('u1', 'webmaster', 'system');
    store.grant('u1', 'special_project', 'manual');

    await svc.sync('u1', [DISCORD.sectorOverseer]);
    expect(store.rolesOf('u1').sort()).toEqual([
      'sector_overseer',
      'special_project',
      'webmaster',
    ]);

    /*
     * `unranked` joins them once the Discord role is gone — the member now maps
     * to nothing, which is what the floor is for. The invariant under test is
     * unchanged and is asserted directly below: the manual and system grants
     * survive.
     */
    await svc.sync('u1', []);
    expect(store.rolesOf('u1').sort()).toEqual(['special_project', 'unranked', 'webmaster']);
    expect(store.rolesOf('u1')).toContain('webmaster');
    expect(store.rolesOf('u1')).toContain('special_project');
  });

  it('handles a promotion — old role out, new role in, in one sync', async () => {
    await svc.sync('u1', [DISCORD.sectorOverseer]);
    await svc.sync('u1', [DISCORD.chiefFleet]);
    expect(store.rolesOf('u1')).toEqual(['chief_fleet_commander']);
  });
});

describe('audit @INV-009', () => {
  it('writes a row for every grant and every revoke', async () => {
    await svc.sync('u1', [DISCORD.sectorOverseer]);
    await svc.sync('u1', [DISCORD.chiefFleet]);

    const grants = store.audit.filter((a) => a.action === 'role.grant');
    const revokes = store.audit.filter((a) => a.action === 'role.revoke');
    expect(grants).toHaveLength(2);
    expect(revokes).toHaveLength(1);
    // Attributed to the system, not to the member: nobody CHOSE this, a
    // Discord role change did. Recording the member as the actor would read as
    // a self-grant in the audit log.
    expect(grants[0]?.actorId).toBeNull();
    expect(JSON.stringify(grants[0])).toMatch(/discord/i);
  });

  it('writes nothing when nothing changed', async () => {
    await svc.sync('u1', [DISCORD.sectorOverseer]);
    const before = store.audit.length;
    await svc.sync('u1', [DISCORD.sectorOverseer]);
    expect(store.audit.length).toBe(before);
  });
});

describe('cache invalidation', () => {
  it('busts the permission cache when roles actually change', async () => {
    await svc.sync('u1', [DISCORD.sectorOverseer]);
    expect(store.invalidated).toContain('u1');
  });

  it('does not bust it when nothing changed', async () => {
    await svc.sync('u1', [DISCORD.sectorOverseer]);
    store.invalidated.length = 0;
    await svc.sync('u1', [DISCORD.sectorOverseer]);
    expect(store.invalidated).toEqual([]);
  });
});
