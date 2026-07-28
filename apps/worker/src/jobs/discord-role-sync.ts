/**
 * Caching the guild's role names and colours.
 *
 * ★ WHY THIS IS A JOB AND NOT A LOOKUP ★
 *
 * The roster shows every Discord role a member wears, in the colour Discord
 * gives it. Asking Discord for that on each page render would be a request per
 * view for data that changes when somebody edits a role — which is to say,
 * almost never.
 *
 * So it is cached and refreshed on a schedule, alongside the reconciliation
 * that already talks to the same guild.
 *
 * ★ WHAT IT DELIBERATELY DOES NOT DO ★
 *
 * It does not delete roles that have vanished from Discord. A role removed
 * from the guild is removed from every member with it, so it stops being shown
 * anyway — and keeping the row means a role deleted by accident and recreated
 * does not lose its name for however long the next sync takes. Nothing reads a
 * role that nobody holds.
 */

export interface GuildRoleRecord {
  readonly id: string;
  readonly name: string;
  /** `#rrggbb`, or null when Discord reports colour 0 — which means "unset", not black. */
  readonly colour: string | null;
  readonly position: number;
  readonly hoist: boolean;
}

export interface RoleSource {
  listRoles(guildId: string): Promise<GuildRoleRecord[]>;
}

export interface RoleCacheStore {
  upsertRole(role: GuildRoleRecord, at: Date): Promise<void>;
}

export interface RoleSyncReport {
  readonly synced: number;
  readonly error: string | null;
}

/**
 * Refreshes the cache.
 *
 * Never throws. It runs beside reconciliation, which does the work that
 * actually matters — role grants and revocations — and a failure to refresh
 * some colours must not take that down with it. The report says what happened
 * so the caller can log it.
 */
export async function syncGuildRoles(
  source: RoleSource,
  store: RoleCacheStore,
  guildId: string,
  now: Date = new Date(),
): Promise<RoleSyncReport> {
  try {
    const roles = await source.listRoles(guildId);

    let synced = 0;
    for (const role of roles) {
      /*
       * One at a time, and a failure on one does not abandon the rest. Forty
       * roles is nothing, and the alternative — a transaction — would mean a
       * single malformed row costing the whole refresh.
       */
      try {
        await store.upsertRole(role, now);
        synced += 1;
      } catch {
        /* skip this role; the next sync will try again */
      }
    }

    return { synced, error: null };
  } catch (error) {
    return {
      synced: 0,
      error: error instanceof Error ? error.message : 'Could not read the guild roles.',
    };
  }
}
