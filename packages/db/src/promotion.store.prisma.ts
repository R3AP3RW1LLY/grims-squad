import type { PrismaClient } from '@prisma/client';
import type { LadderRung, PromotionStore, MemberStanding } from '@grims/shared';

/**
 * The promotion standings, read from Prisma.
 *
 * ★ MOVED OUT OF THE WORKER, 2026-08-02 ★
 *
 * Squadron owner: a button on each month, and a promote control on the members page. Both are the
 * WEBSITE deciding who has earned what, and the API cannot import from the worker.
 *
 * This class is where the RULES live — which months count toward a rank — so a second copy behind
 * the buttons would be two answers to "has this member earned Sergeant", diverging the first time
 * either was touched. `@grims/db` already hosts the stores both apps share.
 */
export class PrismaPromotionStore implements PromotionStore {
  readonly #db: PrismaClient;
  readonly #rungs: LadderRung[];

  /**
   * The last month that counts, or null for "everything up to now".
   *
   * ★ SQUADRON OWNER, 2026-08-02 ★
   *
   * "add a button to each month, that will trigger promotions beyond the job that runs once a month
   * on the 1st day of the month."
   *
   * A month-scoped run answers "what would the 1st-of-next-month job have done", so months AFTER
   * the chosen one must not count. Without this bound every button would produce an identical
   * result and the month labels would be decoration.
   *
   * Null for the nightly job and the unscoped path, which is the behaviour that was already there.
   *
   * ★ THE RISK, RECORDED ★
   *
   * Choosing the CURRENT month credits a month that has not finished. The owner was shown that this
   * is what the 1 August floor exists to prevent on partial data, and chose per-month scoping
   * anyway. It is an officer's deliberate act on a page that says so, not a default.
   */
  readonly #throughMonth: Date | null;

  constructor(db: PrismaClient, rungs: LadderRung[], throughMonth: Date | null = null) {
    this.#db = db;
    this.#rungs = rungs;
    this.#throughMonth = throughMonth;
  }

  async ladder(): Promise<LadderRung[]> {
    return this.#rungs;
  }

  /**
   * Current rank and banked qualifying months, per member.
   *
   * Rank is READ FROM THE GRANTS, never from a column on users. INV-047 forbids
   * a denormalised rank field precisely because it drifts from the grants that
   * actually confer it, and then two parts of the system disagree about what
   * someone is.
   */
  async standings(): Promise<MemberStanding[]> {
    const ladderNames = new Set(this.#rungs.map((r) => r.rank));

    const users = await this.#db.user.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        handle: true,
        userRoles: {
          select: { grantedAt: true, role: { select: { name: true } } },
        },
      },
    });

    /*
     * ★ WHEN EACH MEMBER JOINED THE DISCORD — SQUADRON OWNER, 2026-08-11 ★
     *
     * "the member needs to be in the discord server for 1 calender month ... then add this as a
     * requirement for all other ranks"
     *
     * From `discord_guild_members`, which is the BOT'S OWN SWEEP of the server — refreshed on every
     * bot start, and it survives somebody leaving and rejoining. `discord_identities.guildJoinedAt`
     * carries the same fact but is a snapshot taken once at website sign-in and never revisited, so
     * it can only go stale. The schema already documents the sweep as authoritative where the two
     * disagree; measured on 2026-08-11 they agreed for all twenty members, which is the moment to
     * pick the one that will still be right later.
     *
     * One query for everybody rather than one per member: this runs over the whole roster.
     */
    const joinRows = await this.#db.discordIdentity.findMany({
      where: { userId: { in: users.map((u) => u.id) } },
      select: { userId: true, discordId: true },
    });

    const guildRows = await this.#db.discordGuildMember.findMany({
      where: { discordId: { in: joinRows.map((r) => r.discordId) } },
      select: { discordId: true, joinedAt: true },
    });

    /*
     * ★ A LINKED INARA ACCOUNT — SQUADRON OWNER, 2026-08-11, NON-NEGOTIABLE ★
     *
     * "to qualify for a promotion the commander must have a linked inara account on our profile
     * this is non-negotiable."
     *
     * TWO tables, because there are two ways a commander is linked and refusing somebody who took
     * the other route would be the rule punishing the member for our own plumbing:
     *
     *   inara_links         the member added their own Inara API key. `cmdrName` is null until the
     *                       first successful call, so a non-null name is the proof the key WORKS —
     *                       a row alone would count an unverified paste as a link.
     *   cmdr_verifications  a proven claim of a CMDR by any method, including an officer vouching.
     *                       `revokedAt IS NULL` because a revoked verification is not a link.
     *
     * One query each for the whole roster rather than two per member — this runs over everybody.
     */
    const [inaraRows, cmdrRows] = await Promise.all([
      this.#db.inaraLink.findMany({
        where: { userId: { in: users.map((u) => u.id) }, cmdrName: { not: null } },
        select: { userId: true },
      }),
      this.#db.cmdrVerification.findMany({
        where: { userId: { in: users.map((u) => u.id) }, revokedAt: null },
        select: { userId: true },
      }),
    ]);

    const linked = new Set<string>([
      ...inaraRows.map((r) => r.userId),
      ...cmdrRows.map((r) => r.userId),
    ]);

    const byDiscordId = new Map(guildRows.map((g) => [g.discordId, g.joinedAt]));
    const joined = new Map<string, Date | null>(
      joinRows.map((r) => [r.userId, byDiscordId.get(r.discordId) ?? null]),
    );

    const out: MemberStanding[] = [];
    for (const u of users) {
      const rankGrant = u.userRoles.find((r) => ladderNames.has(r.role.name));
      if (rankGrant === undefined) continue;

      /*
       * Qualifying months come from the activity rollups, not from elapsed
       * time. A member absent for three months has three FEWER qualifying
       * months, not three more.
       *
       * There is no `qualified` column, and deliberately so — qualification is
       * DERIVED, and the SSOT can change what it means (the per-rank config
       * page exists for exactly that). Storing a boolean would freeze one
       * month's definition into rows that a later rule change silently
       * contradicts.
       *
       * The rule: at least one MESSAGE, and a game session that was seen or
       * fairly assumed. `assumed` counts because the human chose fail-open when
       * the upstream check cannot run (D26) — `absent` and `unlinked` do not.
       */
      const months = await this.#db.memberActivityMonth.count({
        where: {
          userId: u.id,
          month: {
            gte: rankGrant.grantedAt,
            // Bounded when the run is for a named month; open otherwise.
            ...(this.#throughMonth === null ? {} : { lte: this.#throughMonth }),
          },
          /*
           * ★ ONLY MESSAGES QUALIFY — squadron owner, 2026-07-29 ★
           *
           * This was `OR: [messageCount, forumPostCount, voiceJoinCount]`.
           * Both of the others are still COLLECTED and still shown on a
           * member's profile — they are a real part of how somebody takes part
           * — they simply no longer earn a qualifying month.
           *
           * Expressed as a plain condition rather than a one-armed OR: an OR
           * with a single clause invites the next person to add a second, which
           * is precisely the change that must not be made casually.
           *
           * And it is in the QUERY, not a filter afterwards. A member whose only
           * activity was voice must not be counted at any point, and a
           * post-filter is one refactor away from being dropped.
           */
          messageCount: { gt: 0 },
          gameActivity: { in: ['observed', 'assumed'] },
        },
      });

      out.push({
        userId: u.id,
        handle: u.handle,
        currentRank: rankGrant.role.name,
        qualifyingMonthsAtRank: months,
        heldRankSince: rankGrant.grantedAt,
        joinedServerAt: joined.get(u.id) ?? null,
        inaraLinked: linked.has(u.id),
      });
    }
    return out;
  }

  async applyPromotion(userId: string, from: string, to: string): Promise<void> {
    const [fromRole, toRole] = await Promise.all([
      this.#db.role.findFirst({ where: { name: from }, select: { id: true } }),
      this.#db.role.findFirst({ where: { name: to }, select: { id: true } }),
    ]);
    if (toRole === null) throw new Error(`No role row for rank "${to}".`);

    // One transaction. A member must never be visible holding both ranks or
    // neither — `single_rank` in the SSOT is a statement about what an observer
    // can ever see, not merely about the end state.
    await this.#db.$transaction(async (tx) => {
      if (fromRole !== null) {
        await tx.userRole.deleteMany({ where: { userId, roleId: fromRole.id } });
      }
      await tx.userRole.create({
        data: { userId, roleId: toRole.id, source: 'system' },
      });
    });
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
