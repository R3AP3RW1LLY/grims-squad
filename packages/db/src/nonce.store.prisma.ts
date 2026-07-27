import type { PrismaClient } from '@prisma/client';
import type { NonceStore, NonceClaim } from '@grims/shared';

const SELECT = {
  id: true,
  userId: true,
  cmdrName: true,
  claimNonce: true,
  nonceExpiresAt: true,
  isVerified: true,
  revokedAt: true,
  createdAt: true,
} as const;

type Row = {
  id: string;
  userId: string;
  cmdrName: string;
  claimNonce: string | null;
  nonceExpiresAt: Date | null;
  isVerified: boolean;
  revokedAt: Date | null;
  createdAt: Date;
};

/**
 * Rows with no nonce are officer-manual claims and belong to the other path.
 * Returning them here would have the poller looking for a code that was never
 * issued, forever.
 */
function toClaim(r: Row | null): NonceClaim | null {
  if (r === null || r.claimNonce === null || r.nonceExpiresAt === null) return null;
  return {
    id: r.id,
    userId: r.userId,
    cmdrName: r.cmdrName,
    claimNonce: r.claimNonce,
    nonceExpiresAt: r.nonceExpiresAt,
    isVerified: r.isVerified,
    revokedAt: r.revokedAt,
    createdAt: r.createdAt,
  };
}

export class PrismaNonceStore implements NonceStore {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  async pendingFor(userId: string): Promise<NonceClaim | null> {
    return toClaim(
      (await this.#db.cmdrVerification.findFirst({
        where: { userId, isVerified: false, revokedAt: null, claimNonce: { not: null } },
        select: SELECT,
        orderBy: { createdAt: 'desc' },
      })) as Row | null,
    );
  }

  async byId(id: string): Promise<NonceClaim | null> {
    return toClaim(
      (await this.#db.cmdrVerification.findUnique({ where: { id }, select: SELECT })) as Row | null,
    );
  }

  async listPollable(): Promise<NonceClaim[]> {
    const rows = (await this.#db.cmdrVerification.findMany({
      where: {
        isVerified: false,
        revokedAt: null,
        claimNonce: { not: null },
        method: 'inara_nonce',
      },
      select: SELECT,
      // Oldest first. Inara allows two calls a minute globally (INV-033), so a
      // busy queue must not leave the earliest claimant waiting behind everyone
      // who started after them.
      orderBy: { createdAt: 'asc' },
    })) as Row[];
    return rows.map(toClaim).filter((c): c is NonceClaim => c !== null);
  }

  async verifiedHolderOf(cmdrName: string): Promise<NonceClaim | null> {
    // citext column — the database compares case-insensitively, and so does the
    // partial unique index. Adding `mode: 'insensitive'` here would build a
    // DIFFERENT comparison from the one being enforced.
    const r = (await this.#db.cmdrVerification.findFirst({
      where: { cmdrName, isVerified: true, revokedAt: null },
      select: SELECT,
    })) as Row | null;
    // A verified officer-manual claim has no nonce, but it still HOLDS the
    // name. Mapped through a synthetic value rather than toClaim(), which would
    // drop it and let the name be claimed twice.
    return r === null
      ? null
      : {
          id: r.id,
          userId: r.userId,
          cmdrName: r.cmdrName,
          claimNonce: r.claimNonce ?? '',
          nonceExpiresAt: r.nonceExpiresAt ?? r.createdAt,
          isVerified: r.isVerified,
          revokedAt: r.revokedAt,
          createdAt: r.createdAt,
        };
  }

  async createPending(
    userId: string,
    cmdrName: string,
    nonce: string,
    expiresAt: Date,
    at: Date,
  ): Promise<NonceClaim> {
    const r = (await this.#db.cmdrVerification.create({
      data: {
        userId,
        cmdrName,
        method: 'inara_nonce',
        // Tier 2 is recorded on VERIFICATION, not on creation — but the column
        // is not nullable, so it is set here and only becomes meaningful once
        // isVerified flips.
        trustTier: 2,
        isVerified: false,
        claimNonce: nonce,
        nonceExpiresAt: expiresAt,
        verifiedAt: at,
      },
      select: SELECT,
    })) as Row;
    return toClaim(r) as NonceClaim;
  }

  async markVerified(id: string, trustTier: number, at: Date): Promise<void> {
    // The partial unique index is the real enforcement under a race: if two
    // claims on one name flip together, one violates it and fails.
    await this.#db.cmdrVerification.update({
      where: { id },
      data: { isVerified: true, trustTier, verifiedAt: at },
    });
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.#db.cmdrVerification.update({ where: { id }, data: { revokedAt: at } });
  }

  async writeAudit(entry: Record<string, unknown>): Promise<void> {
    await this.#db.auditLog.create({
      data: {
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
}
