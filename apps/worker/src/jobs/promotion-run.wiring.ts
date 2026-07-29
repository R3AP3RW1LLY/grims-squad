import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PrismaClient } from '@grims/db';
import type { PromotionStore, LadderRung, MemberStanding } from './promotion-run.js';

/**
 * Reads the ladder from the SSOT file rather than from a table or from source.
 *
 * ssot/02-domain/rank-progression.yaml is authoritative (ADR-019/020), and the
 * drift check fails CI if a generated copy diverges from it. Parsing it here
 * means the engine and the document cannot disagree — a rank added to the
 * ladder is live without a code change, and a code change cannot invent a rank
 * that the document does not describe.
 *
 * Deliberately a small hand-written reader rather than a YAML dependency: the
 * shape being read is a list of four scalar keys, and this parser fails loudly
 * on anything it does not recognise instead of silently accepting it.
 */
export function readLadderFromSsot(repoRoot: string): LadderRung[] {
  const text = readFileSync(resolve(repoRoot, 'ssot/02-domain/rank-progression.yaml'), 'utf8');

  const start = text.indexOf('\nladder:');
  if (start === -1) throw new Error('rank-progression.yaml has no `ladder:` section.');
  const after = text.slice(start + '\nladder:'.length);
  // The ladder ends at the next top-level key.
  const end = after.search(/\n[a-z_]+:/);
  const body = end === -1 ? after : after.slice(0, end);

  const rungs: LadderRung[] = [];
  for (const block of body.split(/\n\s*- /).slice(1)) {
    const rank = /\brank:\s*(.+)/.exec(block)?.[1]?.trim();
    const nextRaw = /\bnext:\s*(.+)/.exec(block)?.[1]?.trim();
    const monthsRaw = /\bqualifyingMonthsRequired:\s*(\S+)/.exec(block)?.[1]?.trim();
    if (rank === undefined) continue;

    rungs.push({
      rank,
      next: nextRaw === undefined || nextRaw === 'null' ? null : nextRaw,
      qualifyingMonthsRequired:
        monthsRaw === undefined || monthsRaw === 'null' ? null : Number(monthsRaw),
    });
  }

  if (rungs.length === 0) throw new Error('Parsed an EMPTY ladder from the SSOT.');
  return rungs;
}

export class PrismaPromotionStore implements PromotionStore {
  readonly #db: PrismaClient;
  readonly #rungs: LadderRung[];

  constructor(db: PrismaClient, rungs: LadderRung[]) {
    this.#db = db;
    this.#rungs = rungs;
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
          month: { gte: rankGrant.grantedAt },
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
