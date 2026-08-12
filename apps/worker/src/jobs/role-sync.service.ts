/**
 * Maps a member's DISCORD roles onto platform roles, on every sign-in.
 *
 * ★ IT ONLY EVER TOUCHES GRANTS WHOSE SOURCE IS `discord`. ★
 *
 * A grant made by a human (`manual`) or by configuration (`system`) is
 * invisible to it. Without that rule, the first sign-in after this shipped
 * would revoke the webmaster role — which is system-granted and has no Discord
 * role behind it — and lock the only superuser out of the admin console.
 *
 * Role sync has to be able to say "you no longer hold Sector Overseer in
 * Discord" without also saying "and therefore you hold nothing else either".
 */

export type GrantSource = 'discord' | 'manual' | 'system';

/**
 * The role a member holds when they hold nothing else.
 *
 * Matches the `roles.key` created by the membership-roles migration. Named here
 * rather than written inline so the sync and the console cannot disagree about
 * which row is the floor.
 */
export const UNRANKED_ROLE_KEY = 'unranked';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before: unknown;
  after: unknown;
}

export interface IRoleSyncStore {
  /** discordRoleId -> platform role key. Data, never hard-coded (INV-008). */
  mappings(): Promise<ReadonlyMap<string, string>>;
  /** Only the grants this service is allowed to REVOKE. */
  discordGrants(userId: string): Promise<readonly string[]>;
  /**
   * Every role the member holds, whatever granted it.
   *
   * ★ SEPARATE FROM `discordGrants` — THE RE-GRANT LOOP, 2026-08-11 ★
   *
   * "Do they already hold this?" and "may this service take it away?" are different questions, and
   * answering the first with the second is what made role-sync re-grant the same three ranks every
   * sixty seconds in production, writing 4,320 audit rows a day.
   *
   * The promotion engine writes a rank with source `system`. `discordGrants` cannot see it, so the
   * sweep granted it again on every tick — and `grant` upserts with an empty `update`, deliberately,
   * because moving `grantedAt` would reset every member's promotion tenure. The row therefore never
   * changed and the loop could never break itself.
   */
  heldGrants(userId: string): Promise<readonly string[]>;
  grant(userId: string, roleKey: string, source: GrantSource): Promise<void>;
  revoke(userId: string, roleKey: string): Promise<void>;
  writeAudit(entry: AuditEntry): Promise<void>;
  invalidatePermissions(userId: string): Promise<void>;
}

export interface SyncResult {
  readonly granted: readonly string[];
  readonly revoked: readonly string[];
}

export class RoleSyncService {
  constructor(private readonly store: IRoleSyncStore) {}

  async sync(userId: string, discordRoleIds: readonly string[]): Promise<SyncResult> {
    const mappings = await this.store.mappings();

    // Discord roles that map to nothing are simply skipped. Tenure and loyalty
    // ranks are cosmetic and grant no permissions (INV-046), so most of a
    // member's roles land here.
    const wanted = new Set<string>();
    for (const id of discordRoleIds) {
      const key = mappings.get(id);
      if (key !== undefined) wanted.add(key);
    }

    /*
     * ★ THE FLOOR IS A ROLE, NOT AN ABSENCE ★
     *
     * Somebody who maps to nothing used to hold nothing, so there was no row an
     * admin could edit to say what a brand-new member may do — the console could
     * describe officers and nobody else.
     *
     * `unranked` is granted here rather than mapped to a Discord role, because
     * it IS the absence of one: no snowflake exists to map. It is granted with
     * source `discord` deliberately, so this same sync revokes it the moment the
     * member gains a real role — a floor that outlived the member's promotion
     * would keep applying its permissions forever.
     *
     * Its mask ships as zero, so this grants nobody anything until an admin
     * decides otherwise.
     */
    if (wanted.size === 0) wanted.add(UNRANKED_ROLE_KEY);

    /*
     * Two reads, two questions.
     *
     * `heldAny` decides what to GRANT: if the member already holds the role — because an officer
     * granted it, or because the promotion engine did — there is nothing to do and nothing to
     * audit, whatever put it there.
     *
     * `discordHeld` decides what to REVOKE, and stays scoped to this service's own grants. That is
     * the original safety story and it is not traded away: a rank awarded by a promotion, or a
     * webmaster role granted by hand, must survive somebody editing a Discord role.
     */
    const heldAny = new Set(await this.store.heldGrants(userId));
    const discordHeld = new Set(await this.store.discordGrants(userId));

    const granted = [...wanted].filter((k) => !heldAny.has(k));
    const revoked = [...discordHeld].filter((k) => !wanted.has(k));

    for (const key of granted) {
      await this.store.grant(userId, key, 'discord');
      await this.store.writeAudit({
        // Attributed to the system, not the member. Nobody CHOSE this — a
        // Discord role change did — and recording the member as the actor
        // would read as a self-grant in the audit log.
        actorId: null,
        action: 'role.grant',
        targetType: 'user',
        targetId: userId,
        before: { role: null },
        after: { role: key, source: 'discord', reason: 'discord role sync' },
      });
    }

    for (const key of revoked) {
      await this.store.revoke(userId, key);
      await this.store.writeAudit({
        actorId: null,
        action: 'role.revoke',
        targetType: 'user',
        targetId: userId,
        before: { role: key, source: 'discord' },
        after: { role: null, reason: 'discord role sync' },
      });
    }

    // Only when something actually moved. Busting on every login would throw
    // away a warm cache 100+ times a day for nothing.
    if (granted.length > 0 || revoked.length > 0) {
      await this.store.invalidatePermissions(userId);
    }

    return { granted, revoked };
  }
}
