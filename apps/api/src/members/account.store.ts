import type { PrismaClient } from '@grims/db';

/** One signed-in device, as the member sees it. Deliberately NOT the row. */
export interface SessionSummary {
  readonly id: string;
  readonly deviceLabel: string | null;
  readonly userAgent: string | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date;
  /** True for the device making this request, so "sign out everywhere else" is possible. */
  readonly current: boolean;
}

/**
 * Everything we hold about a member, in one object.
 *
 * Assembled field by field rather than by dumping rows: an export is the one
 * response that is SUPPOSED to be comprehensive, which makes it the most
 * dangerous place to spread a database row. Encrypted OAuth tokens live on the
 * identity row, and handing those to a browser download would be worse than any
 * of the leaks the rest of this codebase guards against.
 */
export interface ExportBundle {
  readonly exportedAt: string;
  readonly profile: Record<string, unknown>;
  readonly privacy: Record<string, unknown> | null;
  readonly discordIdentity: Record<string, unknown> | null;
  readonly roles: Array<Record<string, unknown>>;
  readonly activity: Array<Record<string, unknown>>;
  readonly sessions: Array<Record<string, unknown>>;
  readonly cmdrVerifications: Array<Record<string, unknown>>;
  readonly auditOfMe: Array<Record<string, unknown>>;
}

export interface AccountStore {
  sessionsOf(userId: string, currentFamilyId?: string | null): Promise<SessionSummary[]>;
  ownerOfFamily(familyId: string): Promise<string | null>;
  revokeFamily(familyId: string, reason: string): Promise<void>;
  exportFor(userId: string, at: Date): Promise<ExportBundle>;
}

export class PrismaAccountStore implements AccountStore {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  async sessionsOf(userId: string, currentFamilyId: string | null = null): Promise<SessionSummary[]> {
    const rows = await this.#db.refreshTokenFamily.findMany({
      where: { userId, revokedAt: null },
      // ipHash is deliberately NOT selected. It is a stable identifier for a
      // location and the member gains nothing from seeing their own back.
      select: {
        id: true,
        deviceLabel: true,
        userAgent: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { lastUsedAt: 'desc' },
    });
    return rows.map((r) => ({ ...r, current: r.id === currentFamilyId }));
  }

  async ownerOfFamily(familyId: string): Promise<string | null> {
    const f = await this.#db.refreshTokenFamily.findUnique({
      where: { id: familyId },
      select: { userId: true },
    });
    return f?.userId ?? null;
  }

  async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.#db.refreshTokenFamily.update({
      where: { id: familyId },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  async exportFor(userId: string, at: Date): Promise<ExportBundle> {
    const [user, identity, roles, sessions, cmdrs] = await Promise.all([
      this.#db.user.findUnique({
        where: { id: userId },
        select: {
          handle: true,
          displayName: true,
          email: true,
          avatarUrl: true,
          bio: true,
          timezone: true,
          status: true,
          joinedAt: true,
          createdAt: true,
          privacySettings: true,
        },
      }),
      this.#db.discordIdentity.findUnique({
        where: { userId },
        // The encrypted access and refresh tokens are on this row and are NOT
        // selected. Exporting ciphertext would put a credential for the
        // member's Discord account into their downloads folder.
        select: {
          discordId: true,
          username: true,
          globalName: true,
          guildNick: true,
          guildRoles: true,
          guildJoinedAt: true,
        },
      }),
      this.#db.userRole.findMany({
        where: { userId },
        select: { source: true, grantedAt: true, role: { select: { name: true, key: true } } },
      }),
      this.sessionsOf(userId),
      this.#db.cmdrVerification.findMany({
        where: { userId },
        select: { cmdrName: true, method: true, trustTier: true, verifiedAt: true, revokedAt: true },
      }),
    ]);

    const { privacySettings, ...profile } = user ?? { privacySettings: null };

    return {
      exportedAt: at.toISOString(),
      profile: profile as Record<string, unknown>,
      privacy: (privacySettings ?? null) as Record<string, unknown> | null,
      discordIdentity: identity as Record<string, unknown> | null,
      roles: roles as unknown as Array<Record<string, unknown>>,
      // Activity arrives with the recorder's monthly rollups; empty until the
      // first month closes rather than absent, so the shape does not change.
      activity: [],
      sessions: sessions.map((s) => ({
        deviceLabel: s.deviceLabel,
        userAgent: s.userAgent,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
      })),
      cmdrVerifications: cmdrs as unknown as Array<Record<string, unknown>>,
      auditOfMe: [],
    };
  }
}
