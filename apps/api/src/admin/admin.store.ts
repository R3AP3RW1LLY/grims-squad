import type { PrismaClient } from '@grims/db';
import { LEADERSHIP_CEILING } from '../members/members.store.js';

/**
 * The rank ladder, for reporting what somebody is working toward.
 *
 * ★ WHY THIS IS RESTATED HERE ★
 *
 * The authority is ssot/02-domain/rank-progression.yaml, read by the promotion
 * worker. The API does not read that file — it has no business promoting
 * anyone, and giving it the parser would put the ladder in two places that both
 * ACT on it.
 *
 * This is display only: it answers "what comes next" on an admin table and can
 * never grant anything. If it drifted from the SSOT the worst outcome is a
 * wrong label on a page, not a wrong promotion — and a test pins the two
 * together so it will not drift silently.
 */
export const LADDER_NEXT: Record<string, string> = {
  Cadet: 'Sergeant',
  Sergeant: 'Master Sergeant',
  'Master Sergeant': '2nd Lieutenant',
  '2nd Lieutenant': '1st Lieutenant',
  '1st Lieutenant': 'Commander',
  Commander: 'Master Commander',
  'Master Commander': 'General',
  General: 'Lord General',
  'Lord General': 'Grand Master General',
  // Grand Master General is absent on purpose: it is the top, and an entry
  // would render an upward arrow pointing at a rank that does not exist.
};

export interface ActivityRow {
  readonly discordId: string;
  readonly handle: string | null;
  readonly displayName: string | null;
  /** Server nickname — the in-game name, by this squadron's convention. */
  readonly nick: string | null;
  /** They have an account here, not merely a presence in Discord. */
  readonly joinedWebsite: boolean;
  /** A verified commander name, and how it was proven. Null when unverified. */
  readonly cmdrName: string | null;
  readonly verifiedVia: string | null;
  /**
   * Their TENURE rank — the ladder promotion moves them up. Null when they
   * hold no rank role at all.
   */
  readonly currentRank: string | null;
  /**
   * A leadership APPOINTMENT, if they hold one. A separate axis entirely.
   *
   * Somebody can be a Cadet by tenure and a Squadron Leader by appointment at
   * the same time, and the two must not be shown as one thing — see the note
   * on the query.
   */
  readonly appointment: string | null;
  /** The next rung up. Null at the top of the ladder, and for unranked members. */
  readonly nextRank: string | null;
  readonly messageCount: number;
  readonly forumPostCount: number;
  readonly voiceJoinCount: number;
  readonly gameActivity: string;
  /** Derived, not stored — see the note on the query. */
  readonly qualifies: boolean;
  /** Last activity WITHIN THE MONTH being shown. Null when they did nothing in it. */
  readonly lastActivityAt: string | null;
  /**
   * The last time they did anything in Discord, EVER.
   *
   * ★ WHY THIS IS NOT `lastActivityAt` ★
   *
   * That one is scoped to the month on screen, so somebody who has not spoken
   * since May has no July row for it to come from — it would read as null and
   * be indistinguishable from a member who joined yesterday. A "last seen"
   * column has to look across every month or it cannot answer the one question
   * it exists for: who has gone quiet.
   *
   * Discord activity, not website sign-ins. Squadron owner, 2026-07-29.
   */
  readonly lastSeenAt: string | null;
  /**
   * When they joined the voice channel they are in NOW. Null when not in one.
   *
   * ★ THE ONLY FIELD HERE THAT IS ABOUT THE PRESENT ★
   *
   * Everything else on this row is a tally or a timestamp in the past. A member
   * sitting in comms all evening showed as "3 days" because their last MESSAGE
   * was three days ago — which is true and completely misleading, and is why an
   * officer looking for who has gone quiet needs this separately.
   *
   * Squadron owner, 2026-07-29.
   */
  readonly inVoiceSince: string | null;
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
  /**
   * The actor's display name — their Discord server nickname, which the hub
   * keeps matching their in-game commander name.
   *
   * Shown ALONGSIDE the handle rather than instead of it. A display name is
   * chosen by the member and can be changed to match somebody else's, so an
   * audit log identifying people by display name alone could be made to
   * misattribute an action. The handle is stable and unique, so it stays as the
   * thing that actually identifies the row.
   */
  readonly actorName: string | null;
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
  /** How many matching rows to skip. Page N is offset = (N - 1) * limit. */
  readonly offset?: number;
}

/** A page of audit rows, and how many matched the filter in total. */
export interface AuditPage {
  readonly rows: AuditRow[];
  readonly total: number;
}

export interface AdminStore {
  activityForMonth(monthKey: string): Promise<ActivityRow[]>;
  members(): Promise<MemberRow[]>;
  auditTail(limit: number): Promise<AuditRow[]>;
  auditSearch(filter: AuditFilter): Promise<AuditPage>;
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

    /*
     * ★ THE MONTH IS AN EXACT MATCH, NOT A RANGE ★
     *
     * `member_activity_months` stores one row per member per calendar month,
     * with `month` pinned to the first at midnight UTC. So equality here IS the
     * calendar-month scope — a message from June cannot appear in July's row
     * because it was never added to it.
     */
    const [rows, guildMembers, discordRoles, lastSeen, mappings] = await Promise.all([
      this.#db.memberActivityMonth.findMany({
        where: { month },
      select: {
        discordId: true,
        messageCount: true,
        forumPostCount: true,
        voiceJoinCount: true,
        gameActivity: true,
        lastActivityAt: true,
          user: {
            select: {
              handle: true,
              displayName: true,
              cmdrVerifications: {
                where: { isVerified: true, revokedAt: null },
                select: { cmdrName: true, method: true },
                orderBy: { verifiedAt: 'desc' as const },
                take: 1,
              },
            },
          },
        },
        orderBy: [{ messageCount: 'desc' }, { voiceJoinCount: 'desc' }],
      }),

      /*
       * Names and Discord roles for EVERY guild member, account or not.
       *
       * `discord_identities` was the obvious join and is the wrong one: it is
       * keyed on a website user id and exists only for people who have signed
       * in. One member of fifty-one had a row, so the table showed a name for
       * one person and a raw snowflake for the rest.
       */
      this.#db.discordGuildMember.findMany({
        select: {
          discordId: true,
          nick: true,
          username: true,
          globalName: true,
          roles: true,
          /*
           * Whether they are sitting in a voice channel AT THIS MOMENT.
           *
           * Not derivable from anything else here. `voiceJoinCount` says how
           * often they joined this month, and `lastActivityAt` is a timestamp
           * in the past — neither can tell an officer that somebody is on the
           * server right now, which is what the Last Seen column was showing
           * as "3 days" for a member who was in comms at the time.
           *
           * Squadron owner, 2026-07-29.
           */
          inVoiceSince: true,
        },
      }),
      // Names and categories, for the membership fallback.
      this.#db.discordRole.findMany({ select: { discordRoleId: true, name: true, category: true } }),

      /*
       * The newest activity across EVERY month, per member.
       *
       * A `groupBy` rather than a second pass over the rows above: those are
       * scoped to the month on screen, and the whole point of this figure is to
       * see past it. One aggregate query for the page, not one per member.
       */
      this.#db.memberActivityMonth.groupBy({
        by: ['discordId'],
        _max: { lastActivityAt: true },
      }),

      /*
       * ★ RANK COMES FROM DISCORD, NOT FROM GRANTED ROLES ★
       *
       * Reading granted `UserRole` rows showed nothing for a member who is
       * plainly a Cadet in Discord — the mapping exists, but the internal role
       * had never been granted, because grants only appear once reconciliation
       * has run for an account that exists. Most of the squadron has neither.
       *
       * This is the same correction already made for officer status: the roles
       * somebody WEARS are the current fact, and the grants catch up.
       */
      this.#db.roleMapping.findMany({
        where: { role: { isHierarchical: true } },
        select: { discordRoleId: true, role: { select: { name: true, rankOrder: true } } },
      }),
    ]);

    const byDiscordId = new Map(guildMembers.map((m) => [m.discordId, m]));
    const rankByRoleId = new Map(mappings.map((m) => [m.discordRoleId, m.role]));
    const roleById = new Map(discordRoles.map((r) => [r.discordRoleId, r]));

    const lastSeenByDiscordId = new Map(
      lastSeen.map((g) => [g.discordId, g._max.lastActivityAt]),
    );

    return rows.map((r) => {
      const guild = byDiscordId.get(r.discordId);

      /*
       * ★ TWO LADDERS, NOT ONE, AND MIXING THEM MISREPORTS PEOPLE ★
       *
       * Roles below LEADERSHIP_CEILING are APPOINTMENTS ("Reserved",
       * "Leadership. Admin area access"). Roles from it upward are TENURE ranks
       * earned by qualifying months, Cadet at one through Grand Master General
       * at twelve.
       *
       * Taking the single highest across both put "Squadron Leader" in the rank
       * column with nothing above it, which the table rendered as "Top of
       * ladder" — wrong twice over: Squadron Leader is not the top of anything,
       * and it is not on the promotion ladder at all.
       *
       * So they are picked separately. Somebody can be a Cadet by tenure AND a
       * Squadron Leader by appointment; promotion concerns only the first.
       *
       * Highest of each wins, because a member can wear several mapped roles at
       * once — mid-promotion, or because an old one was never removed — and
       * picking the first would make the answer depend on Discord's ordering.
       */
      let currentRank: string | null = null;
      let appointment: string | null = null;
      let bestTenure = -Infinity;
      let bestAppointment = Infinity;

      for (const roleId of guild?.roles ?? []) {
        const mapped = rankByRoleId.get(roleId);
        if (mapped === undefined) continue;

        if (mapped.rankOrder >= LEADERSHIP_CEILING) {
          if (mapped.rankOrder > bestTenure) {
            bestTenure = mapped.rankOrder;
            currentRank = mapped.name;
          }
        } else if (mapped.rankOrder < bestAppointment) {
          /*
       * ★ FOR APPOINTMENTS, THE LOWEST NUMBER IS THE MOST SENIOR ★
       *
       * The two ladders run in OPPOSITE directions and this is the trap. Tenure
       * ascends — Cadet 100 up to Grand Master General 190 — while appointments
       * descend: Squadron Leader 60, Sector Overseer 50, First Commander 40,
       * Chief Fleet Commander 30, Prime Legate 20, Galactic Admiral 10.
       *
       * Every officer also holds Squadron Leader as their base, so taking the
       * highest number reported the BASE rank for all nine of them. The
       * Galactic Admiral and the Prime Legate both showed as Squadron Leader,
       * which is precisely backwards.
       */
          bestAppointment = mapped.rankOrder;
          appointment = mapped.name;
        }
      }

      /*
       * The membership fallback, for members with no rank role at all. Read by
       * CATEGORY rather than by name, so renaming "Allies" needs no code change.
       */
      const membershipRole =
        (guild?.roles ?? [])
          .map((id) => roleById.get(id))
          .find((role) => role?.category === 'membership')?.name ?? null;

      const verification = r.user?.cmdrVerifications[0];

      /*
       * What they are working toward. Null at the top of the ladder — Grand
       * Master General has nothing above it, and showing a blank arrow there
       * would read as missing data rather than as an achievement.
       *
       * Computed BEFORE the row rather than inline, because `qualifies` now
       * depends on it: there is no promotion to be eligible for when there is
       * no rank above you.
       */
      const nextRank = currentRank === null ? null : (LADDER_NEXT[currentRank] ?? null);

      return {
      discordId: r.discordId,
      handle: r.user?.handle ?? null,
      displayName: r.user?.displayName ?? null,
      /*
       * Nickname first, then Discord's display name, then the handle. The
       * squadron's convention is that the nickname IS the commander name, so
       * it is what an officer recognises somebody by.
       */
      nick: guild?.nick ?? guild?.globalName ?? guild?.username ?? null,
      joinedWebsite: r.user !== null,
      cmdrName: verification?.cmdrName ?? null,
      verifiedVia: verification?.method ?? null,
      currentRank,
      appointment,
      membershipRole,
      messageCount: r.messageCount,
      forumPostCount: r.forumPostCount,
      voiceJoinCount: r.voiceJoinCount,
      gameActivity: r.gameActivity,
      /*
       * Computed here, exactly as the promotion engine computes it: a MESSAGE,
       * and a game session observed or fairly assumed.
       *
       * ★ THIS DRIFTED, AND THE CONSOLE WAS THE ONE THAT WAS WRONG ★
       *
       * It read `messageCount > 0 || forumPostCount > 0 || voiceJoinCount > 0`,
       * which was the rule until the squadron owner narrowed it to messages
       * alone on 2026-07-29. Left as it was, this table would have told an
       * officer that a member with nothing but voice joins had qualified, while
       * the engine that actually promotes people disagreed — and nobody would
       * have found out until August.
       *
       * `assumed` counts because the human chose fail-open when the upstream
       * check cannot run (D26) — but the dashboard shows gameActivity beside
       * this so an officer can see WHICH it was. An assumption must never be
       * displayed as if it were an observation.
       */
      nextRank,
      /*
       * ★ AND THERE HAS TO BE SOMEWHERE TO GO ★
       *
       * Squadron owner, 2026-07-29: a member showing "Top of ladder" must not
       * be highlighted green, because there is no promotion for them to be
       * eligible for.
       *
       * They were. A Grand Master General with a message and a session met both
       * activity conditions, so the row went green and the column read YES —
       * telling an officer that somebody was due a promotion the engine will
       * never grant. `promotion-run.ts` refuses them outright with "Already at
       * the top of the ladder", so this was the console disagreeing with the
       * thing that actually promotes people.
       *
       * That is the SECOND time this field has drifted from the engine in one
       * day. Both times the console was the one that was wrong, and both times
       * the symptom was a green row nobody could act on.
       */
      qualifies:
        nextRank !== null &&
        r.messageCount > 0 &&
        (r.gameActivity === 'observed' || r.gameActivity === 'assumed'),
      lastActivityAt: r.lastActivityAt?.toISOString() ?? null,
      lastSeenAt: lastSeenByDiscordId.get(r.discordId)?.toISOString() ?? null,
      inVoiceSince: byDiscordId.get(r.discordId)?.inVoiceSince?.toISOString() ?? null,
      };
    });
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
  async auditSearch(filter: AuditFilter): Promise<AuditPage> {
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

    const [rows, total] = await Promise.all([
      this.#db.auditLog.findMany({
        where,
        take: filter.limit,
        skip: filter.offset ?? 0,
        /*
         * ★ THE TIEBREAK IS LOAD-BEARING ★
         *
         * `createdAt` alone is not a total order: rows written in one
         * transaction share a timestamp to the microsecond, and Postgres is
         * free to return equal keys in any order it likes — including a
         * DIFFERENT order for the same query run twice.
         *
         * Without pagination that was invisible. With it, a tie straddling a
         * page boundary means a row appears on both pages, or on neither. A
         * silently missing row is not an acceptable failure for an audit log:
         * the whole value of the thing is that it is complete.
         *
         * `id` is a monotonic bigint, so it breaks every tie deterministically.
         */
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          before: true,
          after: true,
          createdAt: true,
          actor: { select: { handle: true, displayName: true } },
        },
      }),
      // Counted with the SAME filter, so the page count describes the query the
      // member is actually looking at rather than the table as a whole.
      this.#db.auditLog.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id.toString(),
        action: r.action,
        actorHandle: r.actor?.handle ?? null,
        actorName: r.actor?.displayName ?? null,
        targetType: r.targetType,
        targetId: r.targetId,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
    };
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
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        createdAt: true,
        actor: { select: { handle: true, displayName: true } },
      },
    });

    return rows.map((r) => ({
      // BigInt id — stringified rather than passed through, because JSON has no
      // bigint and Fastify's serialiser would throw on the raw value.
      id: r.id.toString(),
      action: r.action,
      actorHandle: r.actor?.handle ?? null,
      actorName: r.actor?.displayName ?? null,
      targetType: r.targetType,
      targetId: r.targetId,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
