import { PrismaClient } from '@grims/db';
import type { ISessionStore, SessionContext, TokenLookup } from './session.store.js';

/**
 * Prisma-backed session store.
 *
 * `findByHash` returns the token AND its family in one query. Two round trips
 * would leave a window in which the family is revoked between them — and the
 * reuse check would pass against a family that had already been killed.
 */
export class PrismaSessionStore implements ISessionStore {
  constructor(private readonly prisma: PrismaClient) {}

  async createFamily(userId: string, ctx: SessionContext, expiresAt: Date): Promise<string> {
    const f = await this.prisma.refreshTokenFamily.create({
      data: { userId, userAgent: ctx.userAgent, ipHash: ctx.ipHash, expiresAt },
      select: { id: true },
    });
    return f.id;
  }

  async insertToken(familyId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.prisma.refreshToken.create({ data: { familyId, tokenHash, expiresAt } });
  }

  async findByHash(tokenHash: string): Promise<TokenLookup | null> {
    const t = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { family: true },
    });
    if (t === null) return null;
    return {
      token: {
        id: t.id,
        familyId: t.familyId,
        tokenHash: t.tokenHash,
        usedAt: t.usedAt,
        expiresAt: t.expiresAt,
      },
      family: {
        id: t.family.id,
        userId: t.family.userId,
        revokedAt: t.family.revokedAt,
        revokeReason: t.family.revokeReason,
        userAgent: t.family.userAgent,
        ipHash: t.family.ipHash,
        expiresAt: t.family.expiresAt,
      },
    };
  }

  async markUsed(tokenId: string, at: Date): Promise<void> {
    await this.prisma.refreshToken.update({ where: { id: tokenId }, data: { usedAt: at } });
  }

  async revokeFamily(familyId: string, reason: string, at: Date): Promise<void> {
    // Guarded on revokedAt being null so a second revocation cannot overwrite
    // the ORIGINAL reason. "reuse detected" is the fact worth keeping; a later
    // "user signed out" would bury the evidence of a theft.
    await this.prisma.refreshTokenFamily.updateMany({
      where: { id: familyId, revokedAt: null },
      data: { revokedAt: at, revokeReason: reason },
    });
  }

  async recordSecurityEvent(
    kind: string,
    userId: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: null,
        actorType: 'system',
        action: `security.${kind}`,
        targetType: 'user',
        targetId: userId,
        after: detail as object,
      },
    });
  }
}
