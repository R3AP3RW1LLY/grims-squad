import { AppError, ErrorCode } from '@grims/shared';

/**
 * The Discord role-mapping editor (P1.7).
 *
 * "The Discord mapping editor is the only path by which snowflakes enter the
 * system" — which is INV-008 restated as a workflow. Role ids live in DATA and
 * never in source, because they change: a role deleted and recreated in Discord
 * gets a new id, and fixing that must not require a deploy at 3am.
 *
 * This is the door, so this is where the validation goes.
 */

export interface MappingRecord {
  readonly roleId: string;
  readonly roleName: string;
  readonly discordRoleId: string;
}

export interface MappingAdminStore {
  list(): Promise<MappingRecord[]>;
  roleName(roleId: string): Promise<string | null>;
  findByDiscordRoleId(discordRoleId: string): Promise<MappingRecord | null>;
  create(roleId: string, discordRoleId: string): Promise<void>;
  remove(roleId: string, discordRoleId: string): Promise<void>;
  holdersOfRole(roleId: string): Promise<string[]>;
  invalidatePermissions(userId: string): Promise<void>;
  writeAudit(entry: Record<string, unknown>): Promise<void>;
}

/**
 * A bare Discord snowflake: 17–20 digits, nothing else.
 *
 * Every rejected shape here is something a person actually pastes. The mention
 * form `<@&123…>` is what copying a role out of a Discord message gives you; a
 * trailing space is what a double-click selection gives you; and
 * `1.5137494644587e+18` is what a snowflake looks like after it has been
 * through a JavaScript number somewhere upstream.
 *
 * NOTE: shape validation cannot catch a snowflake that has been silently
 * ROUNDED by passing through a number — 1513749464458723469 becomes
 * 1513749464458723300, which is still 19 digits and still passes. That failure
 * is invisible: the mapping saves and simply never matches anybody. The defence
 * is that the id is carried as a string end to end and compared to the string
 * the officer supplied, never parsed.
 */
const SNOWFLAKE = /^[0-9]{17,20}$/;

export function isValidSnowflake(value: string): boolean {
  return SNOWFLAKE.test(value);
}

export interface RemovalResult {
  readonly removed: boolean;
  /** Members who will lose the platform role at the next reconciliation. */
  readonly willAffect: string[];
  readonly warning: string;
}

export class MappingAdminService {
  constructor(private readonly store: MappingAdminStore) {}

  list(): Promise<MappingRecord[]> {
    return this.store.list();
  }

  async add(roleId: string, discordRoleId: string, actorId: string): Promise<void> {
    if (!isValidSnowflake(discordRoleId)) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'That is not a Discord role id. Turn on Developer Mode, right-click the role in Server Settings → Roles, and choose Copy Role ID — a mention like <@&123…> is not the id.',
      );
    }

    const name = await this.store.roleName(roleId);
    if (name === null) throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Role not found.');

    const existing = await this.store.findByDiscordRoleId(discordRoleId);
    if (existing !== null) {
      // The same pair again is a no-op, not an error — a double-click should
      // not look like a problem, and it must not write a second audit row
      // claiming something happened twice.
      if (existing.roleId === roleId) return;

      /*
       * A second platform role for the same Discord role is REFUSED. Role-sync
       * maps discordRoleId -> ONE platform role key, so an ambiguous mapping
       * means a member's platform roles depend on which row the query happens
       * to return first. That is a bug that appears intermittently and reads
       * like the sync being flaky.
       */
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `That Discord role is already mapped to ${existing.roleName}. Remove that mapping first.`,
      );
    }

    await this.store.create(roleId, discordRoleId);
    await this.#bust(roleId);
    await this.store.writeAudit({
      actorId,
      action: 'role.mapping.create',
      targetType: 'role',
      targetId: roleId,
      before: null,
      after: { roleName: name, discordRoleId },
    });
  }

  async remove(roleId: string, discordRoleId: string, actorId: string): Promise<RemovalResult> {
    const holders = await this.store.holdersOfRole(roleId);
    await this.store.remove(roleId, discordRoleId);
    await this.#bust(roleId);

    await this.store.writeAudit({
      actorId,
      action: 'role.mapping.delete',
      targetType: 'role',
      targetId: roleId,
      before: { discordRoleId },
      after: null,
    });

    return {
      removed: true,
      willAffect: holders,
      // Removing a mapping is NOT neutral, and the consequence should not
      // arrive as a surprise the following morning.
      warning:
        holders.length === 0
          ? 'Nobody currently holds this role.'
          : `${holders.length} member${holders.length === 1 ? '' : 's'} hold this role. The nightly reconciliation will revoke it from anyone whose Discord role no longer maps to anything.`,
    };
  }

  /**
   * Drops cached permission masks for everyone holding the platform role.
   *
   * A mapping change alters who role-sync will grant the role to, and effective
   * masks are computed from roles. Without this the mapping is live but its
   * effect is not, for up to the cache TTL.
   */
  async #bust(roleId: string): Promise<void> {
    for (const userId of await this.store.holdersOfRole(roleId)) {
      await this.store.invalidatePermissions(userId);
    }
  }
}
