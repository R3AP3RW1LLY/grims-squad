import type { PrismaClient } from '@grims/db';
import type { GrantSource, AuditEntry, IRoleSyncStore } from './role-sync.service.js';

/**
 * The real store behind Discord-role-to-platform-role granting.
 *
 * ★ THERE WAS NEVER ONE ★
 *
 * `RoleSyncService` was written, documented and unit-tested. The only
 * implementation of its store was an in-memory fake for the tests, and the
 * service was never instantiated anywhere in the application — so nothing in
 * the API had ever granted a platform role.
 *
 * Roles came solely from the nightly reconciliation, which meant a member who
 * joined the squadron at 09:00 held no permissions until 03:00 the following
 * morning. Squadron owner's instruction, 2026-07-29: this runs every minute.
 */
export class PrismaRoleSyncStore implements IRoleSyncStore {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Snowflake to platform role key.
   *
   * Data, never hard-coded (INV-008). A role renamed or recreated in Discord is
   * fixed by editing a mapping in the console, not by a deploy.
   */
  async mappings(): Promise<ReadonlyMap<string, string>> {
    const rows = await this.db.roleMapping.findMany({
      select: { discordRoleId: true, role: { select: { key: true } } },
    });
    return new Map(rows.map((r) => [r.discordRoleId, r.role.key]));
  }

  /**
   * ONLY the grants this service is allowed to manage.
   *
   * ★ `source: 'discord'` IS THE WHOLE SAFETY STORY ★
   *
   * A grant made by a human (`manual`) or by configuration (`system`) is
   * invisible here. Without that filter the first sync would revoke the
   * webmaster role — which is system-granted and has no Discord role behind it
   * — and lock the only superuser out of the admin console.
   */
  async discordGrants(userId: string): Promise<readonly string[]> {
    const rows = await this.db.userRole.findMany({
      where: { userId, source: 'discord' },
      select: { role: { select: { key: true } } },
    });
    return rows.map((r) => r.role.key);
  }

  async grant(userId: string, roleKey: string, source: GrantSource): Promise<void> {
    const role = await this.db.role.findUnique({ where: { key: roleKey }, select: { id: true } });
    // A mapping pointing at a role that no longer exists is a configuration
    // problem, not a reason to fail the whole sweep for everybody else.
    if (role === null) return;

    await this.db.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      create: { userId, roleId: role.id, source },
      // Deliberately empty. Re-granting must not move `grantedAt`: promotion
      // eligibility counts qualifying months FROM that timestamp, so touching
      // it every minute would reset every member's tenure forever.
      update: {},
    });
  }

  async revoke(userId: string, roleKey: string): Promise<void> {
    const role = await this.db.role.findUnique({ where: { key: roleKey }, select: { id: true } });
    if (role === null) return;

    // Scoped to `source: 'discord'` again, so a manual grant of the same role
    // survives a Discord revocation.
    await this.db.userRole.deleteMany({ where: { userId, roleId: role.id, source: 'discord' } });
  }

  async writeAudit(entry: AuditEntry): Promise<void> {
    await this.db.auditLog.create({
      data: {
        actorId: entry.actorId,
        actorType: 'system',
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        before: entry.before as never,
        after: entry.after as never,
      },
    });
  }

  async invalidatePermissions(_userId: string): Promise<void> {
    /*
     * No cache to bust from the worker.
     *
     * The API caches effective masks in Redis; this process has no client and
     * adding one to delete a key would make a scheduled job fail when Redis
     * hiccups. The cache is short-lived and the API re-reads on expiry, so the
     * cost of not busting it here is that a change takes effect a little later
     * — never that it is missed.
     */
  }
}

/** Every member with a Discord identity, and the roles they currently wear. */
export async function membersToSync(
  db: PrismaClient,
): Promise<Array<{ userId: string; discordRoleIds: string[] }>> {
  /*
   * ★ READ FROM THE GUILD TABLE, NOT FROM DISCORD ★
   *
   * Running every minute, asking Discord for 109 members would be 157,000
   * requests a day and would be rate-limited into uselessness. The bot keeps
   * `discord_guild_members` current from gateway events, so this is fresh
   * without a single API call.
   *
   * `discord_identities.guildRoles` is the fallback: it is written at sign-in,
   * so it covers a member whose guild row has not been synced yet.
   */
  const identities = await db.discordIdentity.findMany({
    select: { userId: true, discordId: true, guildRoles: true },
  });

  const guild = new Map(
    (
      await db.discordGuildMember.findMany({ select: { discordId: true, roles: true } })
    ).map((m) => [m.discordId, m.roles]),
  );

  return identities.map((i) => ({
    userId: i.userId,
    discordRoleIds: guild.get(i.discordId) ?? i.guildRoles,
  }));
}
