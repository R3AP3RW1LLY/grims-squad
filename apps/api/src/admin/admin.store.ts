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

/**
 * Filters for the audit viewer.
 *
 * Every field is optional and they AND together. An audit log you cannot query
 * is a log nobody reads — "what did this officer do last week" and "who has
 * been granting roles" are the two questions it exists to answer, and a flat
 * tail of 100 rows answers neither.
 */
export interface AuditFilter {
  /** Matched against the actor's HANDLE, not their uuid — nobody knows a uuid. */
  readonly actor?: string;
  /** Prefix match, so `role.` finds every role action without listing them. */
  readonly action?: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly since?: Date;
  readonly until?: Date;
  readonly limit: number;
}

export interface AdminStore {
  activityForMonth(monthKey: string): Promise<ActivityRow[]>;
  members(): Promise<MemberRow[]>;
  auditTail(limit: number): Promise<AuditRow[]>;
  auditSearch(filter: AuditFilter): Promise<AuditRow[]>;
  /** Clears a member's second factor. Audited; never silent. */
  resetTwoFactor(userId: string, actorId: string, reason: string): Promise<void>;
  /** Distinct action names present in the log, so the UI can offer them. */
  auditActions(): Promise<string[]>;
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

  /**
   * Filtered search.
   *
   * Built as a Prisma `where` rather than string-concatenated SQL: the actor
   * and action values come straight from a query string, and this is a table
   * whose whole purpose is being trustworthy. Prisma parameterises, so a
   * quote in the input is a quote in the input.
   */
  async auditSearch(filter: AuditFilter): Promise<AuditRow[]> {
    const where: Record<string, unknown> = {};

    if (filter.actor !== undefined && filter.actor !== '') {
      // By handle, case-insensitively. Nobody knows anyone's uuid.
      where['actor'] = { handle: { equals: filter.actor, mode: 'insensitive' } };
    }
    if (filter.action !== undefined && filter.action !== '') {
      // Prefix, so `role.` finds role.grant, role.revoke, role.mask.update and
      // anything added later without the filter needing to know about it.
      where['action'] = { startsWith: filter.action };
    }
    if (filter.targetType !== undefined && filter.targetType !== '') {
      where['targetType'] = filter.targetType;
    }
    if (filter.targetId !== undefined && filter.targetId !== '') {
      where['targetId'] = filter.targetId;
    }
    if (filter.since !== undefined || filter.until !== undefined) {
      const range: Record<string, Date> = {};
      if (filter.since !== undefined) range['gte'] = filter.since;
      // `lte`, not `lt`. A human entering an end date means that whole day, and
      // the caller has already pushed it to the end of it.
      if (filter.until !== undefined) range['lte'] = filter.until;
      where['createdAt'] = range;
    }

    const rows = await this.#db.auditLog.findMany({
      where,
      take: filter.limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        before: true,
        after: true,
        createdAt: true,
        actor: { select: { handle: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id.toString(),
      action: r.action,
      actorHandle: r.actor?.handle ?? null,
      targetType: r.targetType,
      targetId: r.targetId,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Removes a member's TOTP enrolment and every recovery code with it.
   *
   * One transaction: a half-reset that deleted the credential but left the
   * recovery codes would leave codes that unlock nothing, and the member would
   * be told to use one.
   */
  async resetTwoFactor(userId: string, actorId: string, reason: string): Promise<void> {
    await this.#db.$transaction([
      // Recovery codes cascade from the credential, but deleted explicitly so
      // the intent survives a future schema change to the cascade rule.
      this.#db.twoFactorRecovery.deleteMany({ where: { userId } }),
      this.#db.twoFactorCredential.deleteMany({ where: { userId } }),
      this.#db.auditLog.create({
        data: {
          // A HUMAN did this, so they are the actor — and this is the row
          // somebody will look for when asking how an account lost its second
          // factor.
          actorId,
          actorType: 'user',
          action: 'security.two_factor.reset',
          targetType: 'user',
          targetId: userId,
          before: { twoFactorEnrolled: true },
          after: { twoFactorEnrolled: false, reason },
        },
      }),
    ]);
  }

  async auditActions(): Promise<string[]> {
    const rows = await this.#db.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    });
    return rows.map((r) => r.action);
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
