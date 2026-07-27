import type { PrismaClient } from '@grims/db';
import type { CmdrStore, ClaimRecord } from './cmdr.service.js';

const SELECT = {
  id: true,
  userId: true,
  cmdrName: true,
  isVerified: true,
  trustTier: true,
  method: true,
  verifiedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

export class PrismaCmdrStore implements CmdrStore {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  async pendingFor(userId: string): Promise<ClaimRecord | null> {
    return (await this.#db.cmdrVerification.findFirst({
      where: { userId, isVerified: false, revokedAt: null },
      select: SELECT,
      orderBy: { createdAt: 'desc' },
    })) as ClaimRecord | null;
  }

  async verifiedFor(userId: string): Promise<ClaimRecord | null> {
    return (await this.#db.cmdrVerification.findFirst({
      where: { userId, isVerified: true, revokedAt: null },
      select: SELECT,
    })) as ClaimRecord | null;
  }

  async verifiedHolderOf(cmdrName: string): Promise<ClaimRecord | null> {
    // No `mode: 'insensitive'` needed — the column is citext, so the database
    // compares case-insensitively and the partial unique index does too. Adding
    // it here would build a different comparison from the one the index
    // enforces, which is how these two quietly disagree.
    return (await this.#db.cmdrVerification.findFirst({
      where: { cmdrName, isVerified: true, revokedAt: null },
      select: SELECT,
    })) as ClaimRecord | null;
  }

  async byId(id: string): Promise<ClaimRecord | null> {
    return (await this.#db.cmdrVerification.findUnique({
      where: { id },
      select: SELECT,
    })) as ClaimRecord | null;
  }

  async listPending(): Promise<ClaimRecord[]> {
    return (await this.#db.cmdrVerification.findMany({
      where: { isVerified: false, revokedAt: null },
      select: SELECT,
      orderBy: { createdAt: 'asc' },
    })) as ClaimRecord[];
  }

  async createPending(userId: string, cmdrName: string, at: Date): Promise<ClaimRecord> {
    return (await this.#db.cmdrVerification.create({
      data: {
        userId,
        cmdrName,
        method: 'officer_manual',
        // Tier 1, recorded honestly. An officer vouching is genuinely weaker
        // than cAPI, and inflating it would make the tier meaningless.
        trustTier: 1,
        isVerified: false,
        verifiedAt: at,
      },
      select: SELECT,
    })) as ClaimRecord;
  }

  async markVerified(id: string, at: Date): Promise<void> {
    // The partial unique index does the real enforcement here: if two approvals
    // race, one of them violates it and fails rather than both succeeding. The
    // application check makes the common case a clear message; the index makes
    // the rare case impossible.
    await this.#db.cmdrVerification.update({
      where: { id },
      data: { isVerified: true, verifiedAt: at },
    });
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.#db.cmdrVerification.update({ where: { id }, data: { revokedAt: at } });
  }

  async writeAudit(entry: Record<string, unknown>): Promise<void> {
    await this.#db.auditLog.create({
      data: {
        actorId: entry['actorId'] as string | null,
        actorType: 'user',
        action: String(entry['action']),
        targetType: String(entry['targetType']),
        targetId: String(entry['targetId']),
        before: entry['before'] as never,
        after: entry['after'] as never,
      },
    });
  }
}
