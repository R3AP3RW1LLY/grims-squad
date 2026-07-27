import type { PrismaClient } from '@grims/db';

export interface ActivityRow {
  readonly discordId: string;
  readonly handle: string | null;
  readonly displayName: string | null;
  readonly messageCount: number;
  readonly forumPostCount: number;
  readonly voiceJoinCount: number;
  readonly gameActivity: string;
  /** Derived, not stored — see the note on the query. */
  readonly qualifies: boolean;
  readonly lastActivityAt: string | null;
}

export interface MemberRow {
  readonly id: string;
  readonly handle: string;
  readonly displayName: string;
  readonly status: string;
  readonly joinedAt: string;
  readonly ranks: string[];
  readonly cmdrName: string | null;
  readonly twoFactorEnrolled: boolean;
}

export interface AuditRow {
  readonly id: string;
  readonly action: string;
  readonly actorHandle: string | null;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly createdAt: string;
}

export interface AdminStore {
  activityForMonth(monthKey: string): Promise<ActivityRow[]>;
  members(): Promise<MemberRow[]>;
  auditTail(limit: number): Promise<AuditRow[]>;
}

export class PrismaAdminStore implements AdminStore {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  async activityForMonth(monthKey: string): Promise<ActivityRow[]> {
    const month = new Date(`${monthKey}-01T00:00:00Z`);
    const rows = await this.#db.memberActivityMonth.findMany({
      where: { month },
      select: {
        discordId: true,
        messageCount: true,
        forumPostCount: true,
        voiceJoinCount: true,
        gameActivity: true,
        lastActivityAt: true,
        user: { select: { handle: true, displayName: true } },
      },
      orderBy: [{ messageCount: 'desc' }, { voiceJoinCount: 'desc' }],
    });

    return rows.map((r) => ({
      discordId: r.discordId,
      handle: r.user?.handle ?? null,
      displayName: r.user?.displayName ?? null,
      messageCount: r.messageCount,
      forumPostCount: r.forumPostCount,
      voiceJoinCount: r.voiceJoinCount,
      gameActivity: r.gameActivity,
      /*
       * Computed here, exactly as the promotion engine computes it: any one of
       * the three Discord kinds, AND a game session observed or fairly assumed.
       * `assumed` counts because the human chose fail-open when the upstream
       * check cannot run (D26) — but the dashboard shows gameActivity beside
       * this so an officer can see WHICH it was. An assumption must never be
       * displayed as if it were an observation.
       */
      qualifies:
        (r.messageCount > 0 || r.forumPostCount > 0 || r.voiceJoinCount > 0) &&
        (r.gameActivity === 'observed' || r.gameActivity === 'assumed'),
      lastActivityAt: r.lastActivityAt?.toISOString() ?? null,
    }));
  }

  async members(): Promise<MemberRow[]> {
    const rows = await this.#db.user.findMany({
      select: {
        id: true,
        handle: true,
        displayName: true,
        status: true,
        joinedAt: true,
        userRoles: { select: { role: { select: { name: true } } } },
        cmdrVerifications: {
          where: { revokedAt: null, isVerified: true },
          select: { cmdrName: true },
          take: 1,
        },
        twoFactor: { select: { confirmedAt: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });

    return rows.map((u) => ({
      id: u.id,
      handle: u.handle,
      displayName: u.displayName,
      status: u.status,
      joinedAt: u.joinedAt.toISOString(),
      ranks: u.userRoles.map((r) => r.role.name),
      cmdrName: u.cmdrVerifications[0]?.cmdrName ?? null,
      // Whether it is ENROLLED, never anything about the secret itself.
      twoFactorEnrolled: u.twoFactor?.confirmedAt != null,
    }));
  }

  async auditTail(limit: number): Promise<AuditRow[]> {
    const rows = await this.#db.auditLog.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        createdAt: true,
        actor: { select: { handle: true } },
      },
    });

    return rows.map((r) => ({
      // BigInt id — stringified rather than passed through, because JSON has no
      // bigint and Fastify's serialiser would throw on the raw value.
      id: r.id.toString(),
      action: r.action,
      actorHandle: r.actor?.handle ?? null,
      targetType: r.targetType,
      targetId: r.targetId,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
