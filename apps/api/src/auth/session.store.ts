/**
 * Persistence port for sessions. Defined as an interface so the reuse-detection
 * logic — the part that actually matters — is testable without a database.
 */

export interface FamilyRow {
  id: string;
  userId: string;
  revokedAt: Date | null;
  revokeReason: string | null;
  userAgent: string | null;
  ipHash: string | null;
}

export interface TokenRow {
  id: string;
  familyId: string;
  tokenHash: string;
  usedAt: Date | null;
  expiresAt: Date;
}

/** What a lookup needs to decide accept / rotate / treat-as-theft, in one read. */
export interface TokenLookup {
  token: TokenRow;
  family: FamilyRow;
}

export interface SessionContext {
  readonly userAgent: string | null;
  /** Hashed upstream. A raw IP must never reach this layer (INV-012 spirit). */
  readonly ipHash: string | null;
}

export interface ISessionStore {
  createFamily(userId: string, ctx: SessionContext): Promise<string>;
  insertToken(familyId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findByHash(tokenHash: string): Promise<TokenLookup | null>;
  markUsed(tokenId: string, at: Date): Promise<void>;
  revokeFamily(familyId: string, reason: string, at: Date): Promise<void>;
  /**
   * Recorded so a human can tell a theft from a bug. A revocation that happens
   * silently leaves the member confused and leaves nobody able to investigate.
   */
  recordSecurityEvent(kind: string, userId: string, detail: Record<string, unknown>): Promise<void>;
}
