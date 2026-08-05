import { assertPromotionsPermitted } from './promotion-floor.js';

/**
 * The monthly promotion engine.
 *
 * ★★ TWO SAFETY PROPERTIES, BOTH DELIBERATE ★★
 *
 * 1. THE FLOOR. Nothing may be promoted before 2026-08-01T00:00:00Z. That is a
 *    non-negotiable human instruction, and it is enforced as a coded guard
 *    rather than by a cron expression that happens not to fire yet — a schedule
 *    can be triggered by hand, by a deploy, or by someone testing. The guard
 *    lives in @grims/shared so the bot, the worker and the API cannot drift
 *    apart on the single most consequential constant in the system.
 *
 * 2. DRY RUN BY DEFAULT. A caller who forgets the flag gets the SAFE behaviour.
 *    Defaulting to live means one mistyped script promotes the squadron, in
 *    public, in a way that is tedious to unwind.
 *
 * The report is designed to be READ by a human before anything goes live: it
 * names every member it would promote and both ranks, and it explains every
 * skip, so "why not me?" has an answer that does not require a database.
 */

export interface LadderRung {
  readonly rank: string;
  /** Months at THIS rank before advancing. `null` at the top of the ladder. */
  readonly qualifyingMonthsRequired: number | null;
  readonly next: string | null;
}

export interface MemberStanding {
  readonly userId: string;
  readonly handle: string;
  readonly currentRank: string;
  readonly qualifyingMonthsAtRank: number;
  readonly heldRankSince: Date;
}

export interface PromotionStore {
  ladder(): Promise<LadderRung[]>;
  standings(): Promise<MemberStanding[]>;
  /** Grants the new rank and REMOVES the old one — a member holds exactly one. */
  applyPromotion(userId: string, from: string, to: string): Promise<void>;
  writeAudit(entry: Record<string, unknown>): Promise<void>;
}

export interface WouldPromote {
  readonly userId: string;
  readonly handle: string;
  readonly from: string;
  readonly to: string;
  readonly qualifyingMonths: number;
}

/**
 * Applies a rank change in DISCORD.
 *
 * Separate from the store because it is a different system with a different
 * failure mode, and because the ORDER between them is load-bearing: Discord
 * first, our row second. Ladder ranks are mapped to Discord roles so that
 * reconciliation can learn them, which means our database disagreeing with the
 * guild is not a cosmetic difference — the next reconciliation resolves it in
 * Discord's favour and hands the old rank back.
 */
export interface RankApplier {
  applyRank(userId: string, fromRank: string, toRank: string): Promise<void>;
}

export interface Failed {
  readonly userId: string;
  readonly handle: string;
  readonly reason: string;
}

export interface Skipped {
  readonly userId: string;
  readonly handle: string;
  readonly rank: string;
  readonly reason: string;
}

export interface PromotionReport {
  readonly dryRun: boolean;
  readonly ranAt: string;
  readonly considered: number;
  readonly wouldPromote: readonly WouldPromote[];
  readonly skipped: readonly Skipped[];
  /** Actually written. Always 0 in a dry run. */
  readonly promoted: number;
  /** Eligible, attempted, and refused by Discord. Neither side was changed. */
  readonly failed: readonly Failed[];
}

export interface RunOptions {
  readonly now?: Date;
  /** Defaults to TRUE. Omitting it must never write. */
  readonly dryRun?: boolean;
}

export class PromotionEngine {
  constructor(
    private readonly store: PromotionStore,
    /**
     * Optional so the engine stays runnable for a DRY RUN without Discord
     * wired up — which is how every rehearsal before August is done. A LIVE
     * run without one is refused, because it would write a rank here that
     * Discord does not have.
     */
    private readonly ranks?: RankApplier,
  ) {}

  async run(opts: RunOptions = {}): Promise<PromotionReport> {
    const now = opts.now ?? new Date();
    const dryRun = opts.dryRun !== false;

    /*
     * The floor is checked ONLY for a live run.
     *
     * A dry run must stay available before August: it is how the whole engine
     * gets reviewed ahead of going live, and blocking it would leave the first
     * real run as the first time anyone has seen the logic work — on the one
     * day when being wrong is most visible. A dry run writes nothing, so the
     * instruction is not weakened by allowing it.
     */
    if (!dryRun) {
      assertPromotionsPermitted(now);
      if (this.ranks === undefined) {
        throw new Error(
          'Refusing a live promotion run with no Discord rank applier: our database would ' +
            'say one rank and the guild another, and the next reconciliation would undo it.',
        );
      }
    }

    const ladder = await this.store.ladder();
    const byRank = new Map(ladder.map((r) => [r.rank, r]));
    const standings = await this.store.standings();

    const wouldPromote: WouldPromote[] = [];
    const skipped: Skipped[] = [];

    for (const m of standings) {
      const rung = byRank.get(m.currentRank);

      if (rung === undefined) {
        // Expected for a large part of the server. 56 members have never been
        // granted Cadet, which is what marks onboarding complete — sweeping
        // them in would promote people nobody has onboarded.
        skipped.push({
          userId: m.userId,
          handle: m.handle,
          rank: m.currentRank,
          reason: `${m.currentRank} is not on the ladder — not enrolled in progression.`,
        });
        continue;
      }

      if (rung.next === null || rung.qualifyingMonthsRequired === null) {
        skipped.push({
          userId: m.userId,
          handle: m.handle,
          rank: m.currentRank,
          reason: 'Already at the top of the ladder.',
        });
        continue;
      }

      if (m.qualifyingMonthsAtRank < rung.qualifyingMonthsRequired) {
        const short = rung.qualifyingMonthsRequired - m.qualifyingMonthsAtRank;
        skipped.push({
          userId: m.userId,
          handle: m.handle,
          rank: m.currentRank,
          reason: `${m.qualifyingMonthsAtRank} of ${rung.qualifyingMonthsRequired} qualifying months at ${m.currentRank} — ${short} more needed.`,
        });
        continue;
      }

      // ONE step, however many months are banked. Advancement should be visible
      // and celebrated; two at once reads like a bug even when the arithmetic
      // is right.
      wouldPromote.push({
        userId: m.userId,
        handle: m.handle,
        from: m.currentRank,
        to: rung.next,
        qualifyingMonths: m.qualifyingMonthsAtRank,
      });
    }

    let promoted = 0;
    const failed: Failed[] = [];
    if (!dryRun) {
      for (const p of wouldPromote) {
        try {
          // DISCORD FIRST. If it refuses, nothing here changes either, and the
          // next run simply tries again — recoverable. The other order leaves
          // our database and the guild disagreeing, which reconciliation then
          // resolves by handing back the rank the member just left.
          await this.ranks?.applyRank(p.userId, p.from, p.to);
        } catch (cause) {
          failed.push({
            userId: p.userId,
            handle: p.handle,
            reason: `Discord refused the role change: ${String(cause)}`,
          });
          continue;
        }

        await this.store.applyPromotion(p.userId, p.from, p.to);
        await this.store.writeAudit({
          // No actor. Nobody CHOSE this — the member earned it and the engine
          // observed that. Recording an officer would be a lie about who acted.
          actorId: null,
          action: 'rank.promote',
          targetType: 'user',
          targetId: p.userId,
          before: { rank: p.from },
          after: { rank: p.to, qualifyingMonths: p.qualifyingMonths },
        });
        promoted += 1;
      }
    }

    return {
      dryRun,
      ranAt: now.toISOString(),
      considered: standings.length,
      wouldPromote,
      skipped,
      promoted,
      failed,
    };
  }
}

/** Formats a report for a human to read in Discord. */
export function formatReport(r: PromotionReport): string {
  const head = r.dryRun
    ? `**Promotion DRY RUN** — ${r.ranAt}. Nothing was written.`
    : `**Promotions applied** — ${r.ranAt}. ${r.promoted} promoted.`;

  if (r.wouldPromote.length === 0) {
    return `${head}\nNobody is eligible this run (${r.considered} considered).`;
  }

  // Names and both ranks, never a count. The point of the report is that a
  // human can read it and say "no, not that one" before it goes live.
  const lines = r.wouldPromote.map(
    (p) => `• ${p.handle}: ${p.from} → ${p.to} (${p.qualifyingMonths} qualifying months)`,
  );
  return `${head}\n${lines.join('\n')}\n\n${r.skipped.length} not promoted this run.`;
}
