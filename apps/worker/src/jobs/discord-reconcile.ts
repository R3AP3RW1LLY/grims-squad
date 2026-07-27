/**
 * Nightly reconciliation of Discord guild roles against platform roles (P1.5).
 *
 * ★ WHY A RECONCILER AND NOT JUST EVENTS ★
 *
 * Roles reach us three ways — the OAuth callback, gateway events, and this job
 * — and the first two both drop things without saying so. A role change during
 * a bot restart produces an event nobody hears. A member who never signs in
 * again never triggers a callback. Neither failure is visible from the outside;
 * authorization simply drifts from what the guild actually says, and the drift
 * is not symmetric. Someone demoted in Discord keeps their admin here.
 *
 * ★ WHAT IT WILL NOT DO ★
 *
 * It never touches a `manual` or `system` grant. It never acts on an empty or
 * failed guild fetch. Both of those refusals exist because the failure they
 * prevent is total and unattended: this runs at night, and a job that revokes
 * every role in the squadron is discovered by 108 people at breakfast.
 */

export interface GuildMemberRecord {
  readonly discordId: string;
  readonly roles: readonly string[];
  readonly nick: string | null;
}

export interface IdentityRecord {
  readonly userId: string;
  readonly discordId: string;
  readonly guildRoles: readonly string[];
}

export interface GuildSource {
  /** Every member of the guild. Pagination is the adapter's problem, not this job's. */
  listMembers(guildId: string): Promise<GuildMemberRecord[]>;
}

export interface ReconcileStore {
  allIdentities(): Promise<IdentityRecord[]>;
  /** discordRoleId -> platform role key. Data, never hard-coded (INV-008). */
  mappings(): Promise<ReadonlyMap<string, string>>;
  updateGuildRoles(userId: string, roles: readonly string[]): Promise<void>;
  /** ONLY the grants this job is permitted to manage. */
  discordGrants(userId: string): Promise<readonly string[]>;
  grant(userId: string, roleKey: string): Promise<void>;
  revoke(userId: string, roleKey: string): Promise<void>;
  markLeftGuild(userId: string): Promise<void>;
  writeAudit(entry: Record<string, unknown>): Promise<void>;
  invalidatePermissions(userId: string): Promise<void>;
}

export type AnomalyKind =
  | 'guild_roles_drift'
  | 'grant_repaired'
  | 'left_guild'
  | 'unlinked_guild_member'
  | 'empty_guild_response'
  | 'upstream_failure';

export interface Anomaly {
  readonly kind: AnomalyKind;
  readonly userId: string | null;
  readonly discordId: string | null;
  readonly detail: string;
}

export interface ReconcileReport {
  readonly scanned: number;
  readonly repaired: number;
  readonly anomalies: readonly Anomaly[];
  /** True when the run refused to act. NOT the same as a clean run. */
  readonly aborted: boolean;
}

export interface Reporter {
  report(text: string, anomalies: Anomaly[]): Promise<void>;
}

export interface ReconcileConfig {
  readonly guildId: string;
}

const sorted = (xs: readonly string[]): string[] => [...xs].sort();
const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && sorted(a).every((v, i) => v === sorted(b)[i]);

export class ReconcileService {
  constructor(
    private readonly guild: GuildSource,
    private readonly store: ReconcileStore,
    private readonly reporter: Reporter,
    private readonly config: ReconcileConfig,
  ) {}

  async run(): Promise<ReconcileReport> {
    let members: GuildMemberRecord[];
    try {
      members = await this.guild.listMembers(this.config.guildId);
    } catch (cause) {
      // No data is not evidence of change. Revoking on an upstream failure
      // would mean Discord having a bad night costs the squadron its roles.
      return this.#abort(
        {
          kind: 'upstream_failure',
          userId: null,
          discordId: null,
          detail: `Could not fetch the guild member list: ${String(cause)}`,
        },
        'Reconciliation could not run — the guild member list was unavailable. Nothing was changed.',
      );
    }

    const identities = await this.store.allIdentities();

    /*
     * An empty list is indistinguishable from "the bot lost its permissions",
     * "the token was revoked" and "the pagination cursor was wrong" — and it is
     * far more likely to be one of those than for every member to have left. A
     * job that acts on it strips every role in the squadron in one pass, at
     * night, with nobody watching.
     */
    if (members.length === 0 && identities.length > 0) {
      return this.#abort(
        {
          kind: 'empty_guild_response',
          userId: null,
          discordId: null,
          detail: `Discord reported ZERO guild members while ${identities.length} linked accounts exist. Refusing to act — this is far more likely to be a permissions or pagination fault than a mass departure. Check the bot's SERVER MEMBERS intent.`,
        },
        'Reconciliation refused to run: Discord returned an empty member list. Nothing was changed.',
      );
    }

    const mappings = await this.store.mappings();
    const byDiscordId = new Map(members.map((m) => [m.discordId, m]));
    const anomalies: Anomaly[] = [];
    let repaired = 0;

    for (const identity of identities) {
      const member = byDiscordId.get(identity.discordId);

      if (member === undefined) {
        // In our database, not in the guild. Their discord-sourced grants go;
        // anything a human gave them stays, because a human gave it to them.
        const held = await this.store.discordGrants(identity.userId);
        if (held.length > 0 || identity.guildRoles.length > 0) {
          for (const key of held) await this.store.revoke(identity.userId, key);
          await this.store.updateGuildRoles(identity.userId, []);
          await this.store.markLeftGuild(identity.userId);
          await this.store.invalidatePermissions(identity.userId);
          await this.#audit(identity.userId, 'reconcile.left_guild', held, []);
          repaired += 1;
          anomalies.push({
            kind: 'left_guild',
            userId: identity.userId,
            discordId: identity.discordId,
            detail: `No longer in the guild. Revoked discord-sourced roles: ${held.join(', ') || 'none'}. Manual and system grants were left alone.`,
          });
        }
        continue;
      }

      // --- the stored guild roles, versus what Discord says right now -------
      if (!sameSet(identity.guildRoles, member.roles)) {
        await this.store.updateGuildRoles(identity.userId, member.roles);
        repaired += 1;
        anomalies.push({
          kind: 'guild_roles_drift',
          userId: identity.userId,
          discordId: identity.discordId,
          detail: `Stored guild roles did not match Discord. Was [${sorted(identity.guildRoles).join(', ')}], now [${sorted(member.roles).join(', ')}].`,
        });
      }

      // --- platform grants, derived from those roles ------------------------
      const wanted = new Set<string>();
      for (const roleId of member.roles) {
        const key = mappings.get(roleId);
        // Roles that map to nothing are skipped. Tenure and loyalty ranks are
        // cosmetic and grant no permissions (INV-046), so most land here.
        if (key !== undefined) wanted.add(key);
      }

      const held = new Set(await this.store.discordGrants(identity.userId));
      const toGrant = [...wanted].filter((k) => !held.has(k));
      const toRevoke = [...held].filter((k) => !wanted.has(k));

      if (toGrant.length === 0 && toRevoke.length === 0) continue;

      for (const key of toGrant) await this.store.grant(identity.userId, key);
      for (const key of toRevoke) await this.store.revoke(identity.userId, key);
      await this.store.invalidatePermissions(identity.userId);
      await this.#audit(identity.userId, 'reconcile.roles', [...held], [...wanted]);
      repaired += 1;

      anomalies.push({
        kind: 'grant_repaired',
        userId: identity.userId,
        discordId: identity.discordId,
        detail: `Platform roles did not match Discord. Granted: [${toGrant.join(', ') || 'none'}]. Revoked: [${toRevoke.join(', ') || 'none'}].`,
      });
    }

    // --- guild members with no account here ---------------------------------
    const knownDiscordIds = new Set(identities.map((i) => i.discordId));
    for (const m of members) {
      if (knownDiscordIds.has(m.discordId)) continue;
      // Expected and harmless: in Discord, never signed in here. A user row
      // cannot be created without OAuth, so this is reported, never repaired.
      anomalies.push({
        kind: 'unlinked_guild_member',
        userId: null,
        discordId: m.discordId,
        detail: `In the guild with no hub account${m.nick === null ? '' : ` (${m.nick})`}. Nothing to do — they have not signed in.`,
      });
    }

    await this.#post(anomalies, repaired);
    return { scanned: identities.length, repaired, anomalies, aborted: false };
  }

  // ------------------------------------------------------------------ private
  async #abort(anomaly: Anomaly, summary: string): Promise<ReconcileReport> {
    // Always reported. A silent no-op is indistinguishable from a clean run,
    // and this job is only useful if its silence means something.
    await this.reporter.report(`${summary}\n\n${anomaly.detail}`, [anomaly]);
    return { scanned: 0, repaired: 0, anomalies: [anomaly], aborted: true };
  }

  async #audit(userId: string, action: string, before: unknown, after: unknown): Promise<void> {
    await this.store.writeAudit({
      // Null, not the member: nobody CHOSE this, a reconciliation did.
      // Recording the member as actor would read as a self-grant.
      actorId: null,
      action,
      targetType: 'user',
      targetId: userId,
      before,
      after,
      source: 'reconciliation',
    });
  }

  async #post(anomalies: readonly Anomaly[], repaired: number): Promise<void> {
    // Silence when there is nothing to say. A nightly "0 anomalies" post trains
    // everyone to ignore the channel where the one that matters will land.
    const worthSaying = anomalies.filter((a) => a.kind !== 'unlinked_guild_member');
    if (worthSaying.length === 0) return;

    // SPECIFICS, never a count. "3 anomalies" tells an officer something
    // happened and gives them no way to judge whether it was right.
    const lines = worthSaying.map(
      (a) => `• [${a.kind}] ${a.userId ?? a.discordId ?? 'unknown'} — ${a.detail}`,
    );
    await this.reporter.report(
      `**Nightly reconciliation** — repaired ${repaired}:\n${lines.join('\n')}`,
      [...anomalies],
    );
  }
}
