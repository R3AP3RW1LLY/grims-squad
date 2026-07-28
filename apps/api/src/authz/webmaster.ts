import { AppError, ErrorCode, type AccountStatus } from '@grims/shared';

/**
 * The `webmaster` role — website support, granted outside the Discord hierarchy.
 *
 * It carries ALL_PERMISSIONS and can grant itself to others, so it is
 * self-propagating and is the most dangerous object in the system. Three
 * controls make that survivable:
 *
 *  1. The BOOTSTRAP list is CONFIGURATION, not data. An attacker who fully
 *     compromises an account still cannot add themselves to it without server
 *     access, so there is always a recovery path they cannot close from inside
 *     the application.
 *  2. Every grant and revoke is audited with actor, target and result
 *     (INV-009). A self-propagating role with no audit trail turns a single
 *     compromise into something permanent and untraceable.
 *  3. A non-active account can neither hold it usefully (INV-037 zeroes the
 *     mask on read) nor use it to grant (checked here, on write).
 *
 * Worth stating plainly: calling this a "support role" does not make it less
 * powerful than an org admin. It can do everything an admin can do. The
 * difference is provenance and intent, not capability — which is precisely why
 * it is audited rather than merely trusted.
 */

export const WEBMASTER_ROLE_KEY = 'webmaster';

/** Discord snowflakes are 17-20 digits. Anything else is a configuration error. */
const SNOWFLAKE = /^\d{17,20}$/;

export function parseBootstrapIds(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    /*
     * The .env.example placeholder means UNSET, not "a snowflake called
     * CHANGE_ME". Without this, copying the example file unedited crashes the
     * API at startup with a validation error about a value the operator never
     * chose — which reads as a broken build rather than as an unfinished
     * configuration.
     *
     * A genuine typo still throws. That distinction is the point: silence about
     * a mistyped id is a lockout, silence about an untouched placeholder is
     * just an app that nobody has been bootstrapped on yet.
     */
    .filter((s) => !s.includes('CHANGE_ME'));
  for (const p of parts) {
    if (!SNOWFLAKE.test(p)) {
      // Fail loudly. A typo that quietly becomes "nobody is bootstrapped" is a
      // lockout; one that quietly became a wildcard would be far worse.
      throw new Error(`WEBMASTER_BOOTSTRAP_DISCORD_IDS contains a non-snowflake value: "${p}"`);
    }
  }
  return parts;
}

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before: unknown;
  after: unknown;
}

export interface IWebmasterStore {
  userStatus(userId: string): Promise<AccountStatus | null>;
  hasRole(userId: string, roleKey: string): Promise<boolean>;
  grantRole(
    userId: string,
    roleKey: string,
    source: 'discord' | 'manual' | 'system',
    grantedBy: string | null,
  ): Promise<void>;
  revokeRole(userId: string, roleKey: string): Promise<void>;
  /** Active holders only — a banned webmaster is not a safety net. */
  countActiveHolders(roleKey: string): Promise<number>;
  writeAudit(entry: AuditEntry): Promise<void>;
}

export interface WebmasterConfig {
  readonly bootstrapDiscordIds: readonly string[];
}

export class WebmasterService {
  constructor(
    private readonly store: IWebmasterStore,
    private readonly config: WebmasterConfig,
  ) {}

  /**
   * Called on every successful Discord login. Idempotent, and deliberately
   * re-asserting: if the role was removed by accident, the next sign-in by a
   * configured ID restores it. That is the recovery path, so it must not be a
   * one-shot.
   */
  async applyBootstrap(userId: string, discordId: string): Promise<void> {
    if (!this.config.bootstrapDiscordIds.includes(discordId)) return;
    if (await this.store.hasRole(userId, WEBMASTER_ROLE_KEY)) return;

    await this.store.grantRole(userId, WEBMASTER_ROLE_KEY, 'system', null);
    await this.store.writeAudit({
      // No actor: nobody decided this, configuration did. Attributing it to the
      // user themselves would read as a self-grant in the audit log.
      actorId: null,
      action: 'role.grant',
      targetType: 'user',
      targetId: userId,
      before: { role: null },
      after: { role: WEBMASTER_ROLE_KEY, reason: 'bootstrap', discordId },
    });
  }

  async grantTo(actorId: string, targetUserId: string): Promise<void> {
    await this.#assertActiveWebmaster(actorId);
    if ((await this.store.userStatus(targetUserId)) !== 'active') {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Cannot grant webmaster to an account that is not active.',
      );
    }
    if (await this.store.hasRole(targetUserId, WEBMASTER_ROLE_KEY)) return;

    await this.store.grantRole(targetUserId, WEBMASTER_ROLE_KEY, 'manual', actorId);
    await this.store.writeAudit({
      actorId,
      action: 'role.grant',
      targetType: 'user',
      targetId: targetUserId,
      before: { role: null },
      after: { role: WEBMASTER_ROLE_KEY },
    });
  }

  async revokeFrom(actorId: string, targetUserId: string): Promise<void> {
    await this.#assertActiveWebmaster(actorId);

    // One misclick must not lock everyone out of the admin console. The
    // bootstrap list would still recover it, but only for the configured IDs
    // and only if whoever is left remembers that is how it works.
    if (
      actorId === targetUserId &&
      (await this.store.countActiveHolders(WEBMASTER_ROLE_KEY)) <= 1
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'You are the last active webmaster. Grant it to someone else before removing your own.',
      );
    }

    await this.store.revokeRole(targetUserId, WEBMASTER_ROLE_KEY);
    await this.store.writeAudit({
      actorId,
      action: 'role.revoke',
      targetType: 'user',
      targetId: targetUserId,
      before: { role: WEBMASTER_ROLE_KEY },
      after: { role: null },
    });
  }

  async #assertActiveWebmaster(actorId: string): Promise<void> {
    // Status is checked on WRITES too, not only on reads. INV-037 zeroes a
    // departed officer's mask, but that governs what they can SEE — this stops
    // a banned webmaster seeding a replacement on the way out.
    const status = await this.store.userStatus(actorId);
    if (status !== 'active' || !(await this.store.hasRole(actorId, WEBMASTER_ROLE_KEY))) {
      throw new AppError(
        ErrorCode.PERMISSION_DENIED,
        'Only an active webmaster can manage the webmaster role.',
      );
    }
  }
}
