import { randomUUID } from 'node:crypto';
import type {
  ISessionStore,
  SessionContext,
  TokenLookup,
  FamilyRow,
  TokenRow,
} from './session.store.js';

/** In-memory session store for unit tests. No database, no clock trickery. */
export class InMemorySessionStore implements ISessionStore {
  readonly families: FamilyRow[] = [];
  readonly tokens: TokenRow[] = [];
  readonly securityEvents: Array<{ kind: string; userId: string; detail: unknown }> = [];

  async createFamily(userId: string, ctx: SessionContext, expiresAt: Date): Promise<string> {
    const id = randomUUID();
    this.families.push({
      id,
      userId,
      revokedAt: null,
      revokeReason: null,
      userAgent: ctx.userAgent,
      ipHash: ctx.ipHash,
      expiresAt,
    });
    return id;
  }

  async insertToken(familyId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    this.tokens.push({ id: randomUUID(), familyId, tokenHash, usedAt: null, expiresAt });
  }

  async findByHash(tokenHash: string): Promise<TokenLookup | null> {
    const token = this.tokens.find((t) => t.tokenHash === tokenHash);
    if (token === undefined) return null;
    const family = this.families.find((f) => f.id === token.familyId);
    if (family === undefined) return null;
    return { token, family };
  }

  async markUsed(tokenId: string, at: Date): Promise<void> {
    const t = this.tokens.find((x) => x.id === tokenId);
    if (t !== undefined) t.usedAt = at;
  }

  async revokeFamily(familyId: string, reason: string, at: Date): Promise<void> {
    const f = this.families.find((x) => x.id === familyId);
    if (f !== undefined && f.revokedAt === null) {
      f.revokedAt = at;
      f.revokeReason = reason;
    }
  }

  async recordSecurityEvent(
    kind: string,
    userId: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    this.securityEvents.push({ kind, userId, detail });
  }
}
