import type { PrismaClient } from '@grims/db';
import type { DiscordAdapter } from '@grims/ed-clients';
import type {
  GuildSource,
  GuildMemberRecord,
  IdentityRecord,
  ReconcileStore,
  Reporter,
  Anomaly,
} from './discord-reconcile.js';
import type { RoleSource, RoleCacheStore, GuildRoleRecord } from './discord-role-sync.js';

/** Wraps the adapter so the service depends on one method, not on Discord. */
export class AdapterGuildSource implements GuildSource, RoleSource {
  constructor(private readonly discord: DiscordAdapter) {}

  async listMembers(guildId: string): Promise<GuildMemberRecord[]> {
    return this.discord.listGuildMembers(guildId);
  }

  async listRoles(guildId: string): Promise<GuildRoleRecord[]> {
    return this.discord.listGuildRoles(guildId);
  }
}

/**
 * The cache of guild role names and colours.
 *
 * Upsert rather than replace-all: a role removed from Discord is removed from
 * every member holding it, so it stops being shown anyway — and keeping the row
 * means a role deleted by accident and recreated does not lose its name for
 * however long the next sync takes.
 */
export class PrismaRoleCacheStore implements RoleCacheStore {
  constructor(private readonly db: PrismaClient) {}

  async upsertRole(role: GuildRoleRecord, at: Date): Promise<void> {
    await this.db.discordRole.upsert({
      where: { discordRoleId: role.id },
      create: {
        discordRoleId: role.id,
        name: role.name,
        colour: role.colour,
        position: role.position,
        hoist: role.hoist,
      },
      update: {
        name: role.name,
        colour: role.colour,
        position: role.position,
        hoist: role.hoist,
        syncedAt: at,
      },
    });
  }
}

/** The one Redis method this job needs. Typed narrowly so the worker does not depend on ioredis. */
interface CacheBuster {
  del(key: string): Promise<unknown>;
}

export class PrismaReconcileStore implements ReconcileStore {
  readonly #db: PrismaClient;
  readonly #redis: CacheBuster | null;

  constructor(db: PrismaClient, redis: CacheBuster | null = null) {
    this.#db = db;
    this.#redis = redis;
  }

  async allIdentities(): Promise<IdentityRecord[]> {
    const rows = await this.#db.discordIdentity.findMany({
      select: { userId: true, discordId: true, guildRoles: true },
    });
    return rows;
  }

  async mappings(): Promise<ReadonlyMap<string, string>> {
    // From the database, never from source. A snowflake in application code is
    // an INV-008 violation and the lint rule catches it — but the real reason
    // is that role ids change and a redeploy is not an acceptable way to fix a
    // mapping at 3am.
    const rows = await this.#db.roleMapping.findMany({
      select: { discordRoleId: true, role: { select: { key: true } } },
    });
    return new Map(rows.map((r) => [r.discordRoleId, r.role.key]));
  }

  async updateGuildRoles(userId: string, roles: readonly string[]): Promise<void> {
    await this.#db.discordIdentity.update({
      where: { userId },
      data: { guildRoles: [...roles] },
    });
  }

  async discordGrants(userId: string): Promise<readonly string[]> {
    // `source: 'discord'` is the load-bearing clause in this whole file. Drop
    // it and the job revokes the system-granted webmaster role on its first
    // unattended run.
    const rows = await this.#db.userRole.findMany({
      where: { userId, source: 'discord' },
      select: { role: { select: { key: true } } },
    });
    return rows.map((r) => r.role.key);
  }

  async #roleIdOf(key: string): Promise<string | null> {
    const r = await this.#db.role.findUnique({ where: { key }, select: { id: true } });
    return r?.id ?? null;
  }

  async grant(userId: string, roleKey: string): Promise<void> {
    const roleId = await this.#roleIdOf(roleKey);
    if (roleId === null) return;
    await this.#db.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      create: { userId, roleId, source: 'discord' },
      // Left alone on conflict. If a human granted this role manually, the
      // job must not quietly re-attribute it to Discord — that would make it
      // revocable by a later run.
      update: {},
    });
  }

  async revoke(userId: string, roleKey: string): Promise<void> {
    const roleId = await this.#roleIdOf(roleKey);
    if (roleId === null) return;
    await this.#db.userRole.deleteMany({ where: { userId, roleId, source: 'discord' } });
  }

  /**
   * Marks a member as having left, and ENDS THEIR SESSIONS.
   *
   * ★ RED-TEAM FINDING, 2026-07-27 ★
   *
   * Setting the status alone was not enough. computeEffectiveMask collapses any
   * non-active status to NO_PERMISSIONS, so a departed member could do nothing
   * privileged — but their refresh token family survived, so they kept a
   * working login to a members-only site indefinitely, refreshing it forever
   * after leaving the community.
   *
   * Zero permissions is not the same as no access: they could still read
   * whatever a signed-in-but-unprivileged session can read, and the site would
   * have no reason to stop them.
   *
   * One transaction, so a member is never left with the status changed and the
   * sessions live — which is the failure that looks exactly like it worked.
   */
  async markLeftGuild(userId: string): Promise<void> {
    const now = new Date();
    await this.#db.$transaction([
      this.#db.user.update({ where: { id: userId }, data: { status: 'left' } }),
      this.#db.refreshTokenFamily.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokeReason: 'left_guild' },
      }),
    ]);
  }

  async writeAudit(entry: Record<string, unknown>): Promise<void> {
    await this.#db.auditLog.create({
      data: {
        // No actor. Nobody CHOSE this — a reconciliation observed a difference.
        // Recording the member here would read as a self-grant in the log.
        actorId: null,
        actorType: 'system',
        action: String(entry['action']),
        targetType: String(entry['targetType']),
        targetId: String(entry['targetId']),
        before: entry['before'] as never,
        after: entry['after'] as never,
      },
    });
  }

  /**
   * Drops the cached permission mask so the change takes effect on the member's
   * NEXT request rather than up to the TTL later.
   *
   * The key format is shared with the API's permission service. Two processes
   * agreeing on a string by coincidence is fragile, so it is stated here rather
   * than implied — and the reconciler is the one place where a stale mask means
   * a demoted member keeps admin for the rest of the TTL.
   */
  async invalidatePermissions(userId: string): Promise<void> {
    if (this.#redis === null) return;
    await this.#redis.del(`perm:${userId}`);
  }
}

/**
 * Posts anomalies to the admin channel.
 *
 * Uses a webhook rather than the gateway client: the worker is a separate
 * process from the bot, and giving it a second gateway connection to the same
 * guild for the sake of one message a night is not a good trade.
 */
export class WebhookReporter implements Reporter {
  constructor(private readonly webhookUrl: string) {}

  async report(text: string, _anomalies: Anomaly[]): Promise<void> {
    if (this.webhookUrl === '') return;
    // Discord's message ceiling is 2000 characters. A run that repairs a lot
    // would exceed it and the post would fail entirely — losing the whole
    // report, which is worse than losing its tail.
    const body = text.length > 1900 ? `${text.slice(0, 1900)}\n… truncated` : text;
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: body, allowed_mentions: { parse: [] } }),
    });
  }
}
