import { describe, it, expect, beforeEach } from 'vitest';
import {
  ReconcileService,
  type ReconcileStore,
  type GuildSource,
  type GuildMemberRecord,
  type IdentityRecord,
  type Anomaly,
} from './discord-reconcile.js';

/**
 * P1.5 — nightly reconciliation of Discord roles against the platform.
 *
 * ★ WHY THIS JOB EXISTS AT ALL ★
 *
 * Roles reach us three ways: the OAuth callback, gateway events, and this job.
 * The first two both drop things — a member whose role changes while the bot is
 * restarting generates an event nobody hears, and a member who never signs in
 * again never triggers a callback. Neither failure is visible. Authorization
 * silently drifts from what the guild actually says, and the direction of that
 * drift is unpredictable: someone demoted in Discord keeps admin here.
 *
 * The job is therefore the SOURCE OF TRUTH RECONCILER, and its rules are:
 *
 *  1. Discord's guild roles win for `discord`-sourced grants.
 *  2. `manual` and `system` grants are INVISIBLE to it. The webmaster role is
 *     system-granted with no Discord role behind it; a job that revoked
 *     "anything not in Discord" would lock out the only superuser on its first
 *     run, at 3am, with nobody watching.
 *  3. It REPORTS what it changed, with specifics. A count tells an officer
 *     something happened and gives them no way to check whether it was right.
 */

const ROLE_OVERSEER = '1513749464458723469';
const ROLE_ADMIRAL = '804027885081591818';
const ROLE_CADET = '1528251831531339927';

class FakeGuild implements GuildSource {
  members: GuildMemberRecord[] = [];
  failure: Error | null = null;
  calls = 0;

  async listMembers(): Promise<GuildMemberRecord[]> {
    this.calls += 1;
    if (this.failure !== null) throw this.failure;
    return this.members;
  }
}

class FakeStore implements ReconcileStore {
  identities: IdentityRecord[] = [];
  /** userId -> platform role keys, by source. */
  grants = new Map<string, Array<{ key: string; source: 'discord' | 'manual' | 'system' }>>();
  mapping = new Map<string, string>([
    [ROLE_OVERSEER, 'sector_overseer'],
    [ROLE_ADMIRAL, 'galactic_admiral'],
  ]);
  writes: string[] = [];
  audit: Array<Record<string, unknown>> = [];

  async allIdentities(): Promise<IdentityRecord[]> {
    return this.identities;
  }
  async mappings(): Promise<ReadonlyMap<string, string>> {
    return this.mapping;
  }
  async updateGuildRoles(userId: string, roles: readonly string[]): Promise<void> {
    this.writes.push(`roles:${userId}`);
    const i = this.identities.find((x) => x.userId === userId);
    if (i !== undefined) (i as { guildRoles: readonly string[] }).guildRoles = [...roles];
  }
  async discordGrants(userId: string): Promise<readonly string[]> {
    return (this.grants.get(userId) ?? []).filter((g) => g.source === 'discord').map((g) => g.key);
  }
  async grant(userId: string, key: string): Promise<void> {
    this.writes.push(`grant:${userId}:${key}`);
    const list = this.grants.get(userId) ?? [];
    list.push({ key, source: 'discord' });
    this.grants.set(userId, list);
  }
  async revoke(userId: string, key: string): Promise<void> {
    this.writes.push(`revoke:${userId}:${key}`);
    this.grants.set(
      userId,
      (this.grants.get(userId) ?? []).filter((g) => !(g.key === key && g.source === 'discord')),
    );
  }
  async markLeftGuild(userId: string): Promise<void> {
    this.writes.push(`left:${userId}`);
  }
  async writeAudit(e: Record<string, unknown>): Promise<void> {
    this.audit.push(e);
  }
  async invalidatePermissions(userId: string): Promise<void> {
    this.writes.push(`bust:${userId}`);
  }

  // helpers
  rolesOf(userId: string): string[] {
    return (this.grants.get(userId) ?? []).map((g) => g.key).sort();
  }
  seedGrant(userId: string, key: string, source: 'discord' | 'manual' | 'system'): void {
    const list = this.grants.get(userId) ?? [];
    list.push({ key, source });
    this.grants.set(userId, list);
  }
}

class FakeReporter {
  posted: Array<{ text: string; anomalies: Anomaly[] }> = [];
  async report(text: string, anomalies: Anomaly[]): Promise<void> {
    this.posted.push({ text, anomalies });
  }
}

let guild: FakeGuild;
let store: FakeStore;
let reporter: FakeReporter;
let svc: ReconcileService;

beforeEach(() => {
  guild = new FakeGuild();
  store = new FakeStore();
  reporter = new FakeReporter();
  svc = new ReconcileService(guild, store, reporter, { guildId: 'g1' });
});

/** A member who is consistent everywhere — the case that must produce no writes. */
function seedConsistent(): void {
  guild.members = [{ discordId: 'd1', roles: [ROLE_OVERSEER, ROLE_CADET], nick: 'Grim' }];
  store.identities = [{ userId: 'u1', discordId: 'd1', guildRoles: [ROLE_OVERSEER, ROLE_CADET] }];
  store.seedGrant('u1', 'sector_overseer', 'discord');
}

describe('drift repair', () => {
  it('MANDATORY: a corrupted guild_roles row is repaired from Discord AND reported', () => {
    // The acceptance criterion, stated directly. Someone edits the row by hand,
    // or a dropped gateway event leaves it stale; either way Discord wins.
    guild.members = [{ discordId: 'd1', roles: [ROLE_OVERSEER], nick: null }];
    store.identities = [{ userId: 'u1', discordId: 'd1', guildRoles: [ROLE_ADMIRAL] }];
    store.seedGrant('u1', 'galactic_admiral', 'discord');

    return svc.run().then((r) => {
      expect(store.identities[0]?.guildRoles).toEqual([ROLE_OVERSEER]);
      expect(store.rolesOf('u1')).toEqual(['sector_overseer']);
      expect(r.anomalies.some((a) => a.kind === 'guild_roles_drift')).toBe(true);
    });
  });

  it('grants the platform role a member gained in Discord', async () => {
    guild.members = [{ discordId: 'd1', roles: [ROLE_ADMIRAL], nick: null }];
    store.identities = [{ userId: 'u1', discordId: 'd1', guildRoles: [] }];

    await svc.run();
    expect(store.rolesOf('u1')).toEqual(['galactic_admiral']);
  });

  it('revokes a platform role a member lost in Discord', async () => {
    guild.members = [{ discordId: 'd1', roles: [], nick: null }];
    store.identities = [{ userId: 'u1', discordId: 'd1', guildRoles: [ROLE_OVERSEER] }];
    store.seedGrant('u1', 'sector_overseer', 'discord');

    await svc.run();
    expect(store.rolesOf('u1')).toEqual([]);
  });

  it('ignores Discord roles that map to no platform role', async () => {
    // Tenure and loyalty ranks are cosmetic and carry no permissions (INV-046).
    guild.members = [{ discordId: 'd1', roles: [ROLE_CADET], nick: null }];
    store.identities = [{ userId: 'u1', discordId: 'd1', guildRoles: [ROLE_CADET] }];

    await svc.run();
    expect(store.rolesOf('u1')).toEqual([]);
  });
});

describe('grants this job must not touch', () => {
  it('MANDATORY: manual and system grants SURVIVE; discord-sourced ones do not', async () => {
    // The webmaster role is system-granted and has NO Discord role behind it.
    // Revoking "anything not in Discord" locks out the only superuser on the
    // first run of this job — unattended, at 3am.
    guild.members = [{ discordId: 'd1', roles: [], nick: null }];
    store.identities = [{ userId: 'u1', discordId: 'd1', guildRoles: [ROLE_OVERSEER] }];
    store.seedGrant('u1', 'sector_overseer', 'discord');
    store.seedGrant('u1', 'webmaster', 'system');
    store.seedGrant('u1', 'special_project', 'manual');

    await svc.run();
    expect(store.rolesOf('u1')).toEqual(['special_project', 'webmaster']);
  });
});

describe('members who left the guild', () => {
  it('revokes discord-sourced grants for someone no longer in the guild', async () => {
    // The guild list must be NON-EMPTY here. An empty one is refused outright
    // by the rule below, so departures are only ever acted on relative to a
    // list that plainly contains other people.
    guild.members = [{ discordId: 'd-other', roles: [], nick: 'Still here' }];
    store.identities = [
      { userId: 'u1', discordId: 'd1', guildRoles: [ROLE_OVERSEER] },
      { userId: 'u-other', discordId: 'd-other', guildRoles: [] },
    ];
    store.seedGrant('u1', 'sector_overseer', 'discord');
    store.seedGrant('u1', 'webmaster', 'system');

    const r = await svc.run();
    expect(store.rolesOf('u1')).toEqual(['webmaster']);
    expect(r.anomalies.some((a) => a.kind === 'left_guild' && a.userId === 'u1')).toBe(true);
  });

  it('MANDATORY: an EMPTY guild response changes nothing at all', async () => {
    // The dangerous failure. A permissions problem, a revoked bot token or a
    // bad pagination cursor all produce an empty list that looks exactly like
    // "everyone left", and acting on it would strip every role in the squadron
    // in one pass. Refusing is the only safe reading.
    seedConsistent();
    store.identities.push({ userId: 'u2', discordId: 'd2', guildRoles: [ROLE_ADMIRAL] });
    store.seedGrant('u2', 'galactic_admiral', 'discord');
    guild.members = [];
    store.writes = [];

    const r = await svc.run();
    expect(store.writes).toEqual([]);
    expect(store.rolesOf('u2')).toEqual(['galactic_admiral']);
    expect(r.aborted).toBe(true);
    expect(r.anomalies.some((a) => a.kind === 'empty_guild_response')).toBe(true);
  });

  it('reports a guild member who has no platform account, without inventing one', async () => {
    // Expected and harmless: they are in Discord but have never signed in here.
    // A user row cannot be created without OAuth, so this is informational.
    guild.members = [
      { discordId: 'd1', roles: [ROLE_OVERSEER], nick: 'Grim' },
      { discordId: 'd-unknown', roles: [ROLE_OVERSEER], nick: 'Stranger' },
    ];
    store.identities = [{ userId: 'u1', discordId: 'd1', guildRoles: [ROLE_OVERSEER] }];
    store.seedGrant('u1', 'sector_overseer', 'discord');

    const r = await svc.run();
    expect(r.anomalies.filter((a) => a.kind === 'unlinked_guild_member')).toHaveLength(1);
    expect(store.writes.filter((w) => w.includes('d-unknown'))).toEqual([]);
  });
});

describe('idempotence', () => {
  it('MANDATORY: a second run in the same minute changes nothing', async () => {
    seedConsistent();
    await svc.run();
    store.writes = [];

    const second = await svc.run();
    expect(store.writes).toEqual([]);
    expect(second.repaired).toBe(0);
  });

  it('writes no audit row when nothing drifted', async () => {
    // An audit log that gains 108 rows every night for changes that did not
    // happen is an audit log nobody reads.
    seedConsistent();
    await svc.run();
    expect(store.audit).toEqual([]);
  });

  it('does not bust the permission cache for members that did not change', async () => {
    seedConsistent();
    await svc.run();
    expect(store.writes.filter((w) => w.startsWith('bust:'))).toEqual([]);
  });
});

describe('reporting @INV-009', () => {
  it('MANDATORY: reports SPECIFICS, not a count', async () => {
    // "3 anomalies" tells an officer something happened and gives them no way
    // to judge whether it was right. The whole value is in naming who and what.
    guild.members = [{ discordId: 'd1', roles: [ROLE_ADMIRAL], nick: null }];
    store.identities = [{ userId: 'u1', discordId: 'd1', guildRoles: [] }];

    await svc.run();
    const text = reporter.posted.map((p) => p.text).join('\n');
    expect(text).toContain('u1');
    expect(text).toContain('galactic_admiral');
    expect(reporter.posted[0]?.anomalies.length).toBeGreaterThan(0);
  });

  it('says nothing at all when there is nothing to say', async () => {
    // A nightly "0 anomalies" message trains everyone to ignore the channel,
    // which is where the one that matters will also land.
    seedConsistent();
    await svc.run();
    expect(reporter.posted).toEqual([]);
  });

  it('writes an audit row for every grant change', async () => {
    guild.members = [{ discordId: 'd1', roles: [ROLE_ADMIRAL], nick: null }];
    store.identities = [{ userId: 'u1', discordId: 'd1', guildRoles: [] }];

    await svc.run();
    expect(store.audit).toHaveLength(1);
    // Attributed to the job, not to the member — nobody CHOSE this.
    expect(store.audit[0]?.['actorId']).toBeNull();
    expect(JSON.stringify(store.audit[0])).toMatch(/reconcil/i);
  });
});

describe('when Discord is unavailable', () => {
  it('MANDATORY: an upstream failure changes NOTHING', async () => {
    // Fail closed, in the sense that matters here: no data is the same as no
    // evidence, and no evidence is never grounds for revoking a role.
    seedConsistent();
    store.writes = [];
    guild.failure = new Error('503 from Discord');

    const r = await svc.run();
    expect(store.writes).toEqual([]);
    expect(r.aborted).toBe(true);
    expect(r.anomalies.some((a) => a.kind === 'upstream_failure')).toBe(true);
  });

  it('reports the failure so a silent no-op is not mistaken for a clean run', async () => {
    guild.failure = new Error('503 from Discord');
    await svc.run();
    expect(reporter.posted).toHaveLength(1);
    expect(reporter.posted[0]?.text).toMatch(/could not|failed|unavailable/i);
  });
});

/**
 * @RED-TEAM FINDING, 2026-07-27 — a departed member kept a working login.
 *
 * Setting status to 'left' collapses their effective mask to nothing, so they
 * could do nothing privileged. But their refresh token family survived, so they
 * kept an authenticated session to a members-only site and could refresh it
 * indefinitely after leaving the community.
 *
 * Zero permissions is not the same as no access.
 */
describe('@RED-TEAM leaving the guild ends the session', () => {
  it('MANDATORY: revokes sessions, not just the status', async () => {
    guild.members = [{ discordId: 'd-other', roles: [], nick: 'Still here' }];
    store.identities = [
      { userId: 'u1', discordId: 'd1', guildRoles: [ROLE_OVERSEER] },
      { userId: 'u-other', discordId: 'd-other', guildRoles: [] },
    ];
    store.seedGrant('u1', 'sector_overseer', 'discord');

    await svc.run();

    // The fake records markLeftGuild as a single write; the REAL store does the
    // status change and the session revocation in one transaction, which is
    // asserted against the source below.
    expect(store.writes).toContain('left:u1');
  });

  it('MANDATORY: the store revokes token families in the SAME transaction', async () => {
    // Separate statements would allow a member left with the status changed and
    // the sessions live — the failure that looks exactly like it worked.
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const wiring = readFileSync(resolve(here, 'discord-reconcile.wiring.ts'), 'utf8');

    const block = wiring.slice(
      wiring.indexOf('async markLeftGuild'),
      wiring.indexOf('async writeAudit'),
    );
    expect(block).toContain('$transaction');
    expect(block).toContain('refreshTokenFamily.updateMany');
    expect(block).toContain("revokeReason: 'left_guild'");
  });
});
