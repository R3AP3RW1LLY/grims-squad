import type { PrismaClient } from '@grims/db';
import type { AccountStatus } from '@grims/shared';
import type { IWebmasterStore, AuditEntry } from './webmaster.js';

/**
 * The real store behind the webmaster role.
 *
 * ★ WHY THIS DID NOT EXIST UNTIL NOW ★
 *
 * `WebmasterService` was written, documented and tested against an in-memory
 * fake — and never wired to anything. So `applyBootstrap`, which its own
 * comment calls "the recovery path", could not run: there was no store to run
 * it against and nothing called it.
 *
 * The visible symptom was that NOBODY could reach the admin console, on a
 * platform with exactly one account. A test suite passing against a fake is not
 * evidence that a feature is connected.
 */
export class PrismaWebmasterStore implements IWebmasterStore {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  async userStatus(userId: string): Promise<AccountStatus | null> {
    const user = await this.#db.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    return (user?.status as AccountStatus | undefined) ?? null;
  }

  async hasRole(userId: string, roleKey: string): Promise<boolean> {
    const count = await this.#db.userRole.count({
      where: { userId, role: { key: roleKey } },
    });
    return count > 0;
  }

  async grantRole(
    userId: string,
    roleKey: string,
    source: 'discord' | 'manual' | 'system',
    grantedBy: string | null,
  ): Promise<void> {
    const role = await this.#db.role.findUnique({ where: { key: roleKey }, select: { id: true } });
    if (role === null) {
      // Loud rather than silent. A missing role here means the seed did not run,
      // and quietly doing nothing would look exactly like a permissions bug.
      throw new Error(`Role "${roleKey}" does not exist. Has the role seed been run?`);
    }

    await this.#db.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      create: { userId, roleId: role.id, source, grantedBy },
      // Already held. Left exactly as it is — re-stamping `grantedBy` would
      // rewrite the provenance of a grant somebody else made.
      update: {},
    });
  }

  async revokeRole(userId: string, roleKey: string): Promise<void> {
    await this.#db.userRole.deleteMany({ where: { userId, role: { key: roleKey } } });
  }

  async countActiveHolders(roleKey: string): Promise<number> {
    // Active only — a banned webmaster is not a safety net, and counting one
    // would let the last usable holder be removed.
    return this.#db.userRole.count({
      where: { role: { key: roleKey }, user: { status: 'active' } },
    });
  }

  async writeAudit(entry: AuditEntry): Promise<void> {
    await this.#db.auditLog.create({
      data: {
        actorId: entry.actorId,
        // `system` when configuration decided rather than a person. Attributing
        // a bootstrap grant to the user would read as a self-grant.
        actorType: entry.actorId === null ? 'system' : 'user',
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        before: entry.before as never,
        after: entry.after as never,
      },
    });
  }
}
