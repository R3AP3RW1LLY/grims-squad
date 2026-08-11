import { assertPromotionsPermitted } from './promotion-floor.js';
import { tenureMet } from './promotion-tenure.js';

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
  /**
   * Total months the rank is meant to represent — 1, 2, 3, 4, 5, 6, 7, 9, 12 in the SSOT, gaps
   * included. The Discord-tenure requirement is measured against this, so somebody cannot reach
   * Grand Master General three months after joining however much they take part.
   *
   * Optional so a ladder built in a test without it still compiles; absent falls back to the
   * per-rank figure, which is the safe direction.
   */
  readonly cumulativeMonths?: number | null;
}

export interface MemberStanding {
  readonly userId: string;
  readonly handle: string;
  readonly currentRank: string;
  readonly qualifyingMonthsAtRank: number;
  readonly heldRankSince: Date;
  /**
   * When they joined the squadron's Discord.
   *
   * ★ SQUADRON OWNER, 2026-08-11 ★
   *
   * "the member needs to be in the discord server for 1 calender month ... then add this as a
   * requirement for all other ranks"
   *
   * Null when we have no record, which BLOCKS rather than passes — a promotion granted on an
   * unknown is one nobody can defend afterwards. Optional on the interface so a store that predates
   * this compiles; absent is treated as null, which is the safe direction.
   */
  readonly joinedServerAt?: Date | null;
  /**
   * Whether the member has a linked Inara account on their profile.
   *
   * ★ SQUADRON OWNER, 2026-08-11 — NON-NEGOTIABLE ★
   *
   * "to qualify for a promotion the commander must have a linked inara account on our profile
   * this is non-negotiable."
   *
   * Optional so a store written before the rule still compiles — but anything other than an
   * explicit `true` REFUSES. Absent is "we do not know", and the engine must never treat an unknown
   * as satisfying a requirement given as non-negotiable.
   */
  readonly inaraLinked?: boolean;
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

      /*
       * ★ A LINKED INARA ACCOUNT — SQUADRON OWNER, 2026-08-11, GIVEN AS NON-NEGOTIABLE ★
       *
       * "to qualify for a promotion the commander must have a linked inara account on our profile
       * this is non-negotiable."
       *
       * It is also the SSOT's own rule, written a fortnight earlier and never once enforced:
       *
       *     gameActivity.failureMode.noLinkedCmdr: NOT eligible, and surfaced on the admin
       *     dashboard so an officer can fix the cause. Silently promoting on missing data would
       *     make the requirement meaningless.
       *
       * ★ WHY IT IS ITS OWN GATE AND NOT A CONSEQUENCE OF THE ACTIVITY CHECK ★
       *
       * Until now the only thing between an unlinked member and a promotion was that their
       * `gameActivity` sat at `unknown`, and `unknown` is not in ('observed','assumed'). That is an
       * ACCIDENT rather than a rule: it holds exactly as long as nothing else writes that column.
       * The moment a month is credited `assumed` under the fail-open rule — which is precisely what
       * the retroactive correction does — an unlinked member would sail through untouched.
       *
       * The two questions are independent. "Did they play" is the activity check. "Can we ever
       * check" is this one, and it is the one the owner called non-negotiable.
       *
       * ★ ABSENT REFUSES ★
       *
       * The field is optional so a store predating this rule still compiles, and that is exactly
       * the shape that fails open by accident. Absent means "we do not know", and an unknown must
       * never satisfy a non-negotiable requirement. Failing closed is loud — nobody is promoted and
       * somebody asks why. Failing open is silent, public, and about someone's standing.
       */
      if (m.inaraLinked !== true) {
        skipped.push({
          userId: m.userId,
          handle: m.handle,
          rank: m.currentRank,
          reason:
            'No linked Inara account — required for promotion. The member can link one on their ' +
            'profile, or an officer can check why it is missing.',
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

      /*
       * ★ TIME AT THE RANK — SQUADRON OWNER, 2026-08-11 ★
       *
       * "promotes based on length of time and promotion requirements, based on tier join dates"
       *
       * Qualifying months and elapsed months are NOT the same thing, and the gap is exploitable:
       * somebody granted Cadet on the 28th who talks and plays for four days banks a whole
       * qualifying month, because the rollup is keyed on the month rather than on their grant. The
       * clock for the next rank starts when the current one was given — the owner's own choice.
       */
      const atRank = tenureMet(m.heldRankSince, rung.qualifyingMonthsRequired, now);
      if (!atRank.met) {
        skipped.push({
          userId: m.userId,
          handle: m.handle,
          rank: m.currentRank,
          reason: `Held ${m.currentRank} since ${m.heldRankSince.toISOString().slice(0, 10)} — ${
            rung.qualifyingMonthsRequired === 1 ? '1 month' : `${rung.qualifyingMonthsRequired} months`
          } at the rank required, eligible ${atRank.eligibleAt?.toISOString().slice(0, 10) ?? 'unknown'}.`,
        });
        continue;
      }

      /*
       * ★ TIME IN THE SERVER ★
       *
       * "the member needs to be in the discord server for 1 calender month ... then add this as a
       * requirement for all other ranks"
       *
       * Measured against the ladder's own `cumulativeMonths` — the total the rank is meant to
       * represent — so nobody reaches Grand Master General three months after joining however much
       * they talk. A missing join date blocks, and says how to fix it.
       */
      const inServer = tenureMet(
        m.joinedServerAt ?? null,
        rung.cumulativeMonths ?? rung.qualifyingMonthsRequired,
        now,
      );
      if (!inServer.met) {
        skipped.push({
          userId: m.userId,
          handle: m.handle,
          rank: m.currentRank,
          reason: inServer.reason,
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
