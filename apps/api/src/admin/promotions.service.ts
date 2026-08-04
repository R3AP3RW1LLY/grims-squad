import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  DiscordRankApplier,
  notifyMembers,
  PrismaClient,
  PrismaPromotionStore,
  type LiveNudge,
} from '@grims/db';
import { DiscordAdapter } from '@grims/ed-clients';
import {
  AppError,
  ErrorCode,
  PromotionEngine,
  promotionsPermitted,
  type LadderRung,
  type PromotionReport,
} from '@grims/shared';
import { readLadderFromSsot } from '@grims/shared/server';

/**
 * Promotions, on demand.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "this needs to run on the first of every month, however, we are still onboarding, and we need an
 * override! add a button to each month, that will trigger promotions beyond the job that runs once
 * a month ... also add a promote feature to the /app/members page for each member, show thier
 * current rank and what clicking this button would promote them too."
 *
 * ★ TWO CONTROLS, AND ONLY ONE OF THEM BENDS THE RULES ★
 *
 * The month button re-runs the SAME evaluation the 1st-of-month job does — the owner's choice when
 * asked. Only complete months count, so pressing it during August promotes nobody for August, and
 * pressing it twice does nothing the second time. It means "run it now", not "let somebody through".
 *
 * The per-member button is the override, and it is deliberately unconditional: an officer's
 * judgement during onboarding, with their name on it in the audit log.
 */

/** How the members page describes where somebody stands. */
export interface PromotionStanding {
  readonly userId: string;
  readonly currentRank: string | null;
  /** The rung above, or null at the top of the ladder or off it entirely. */
  readonly nextRank: string | null;
  readonly qualifyingMonths: number;
  readonly monthsRequired: number | null;
  /** True when the rules alone would promote them. */
  readonly earned: boolean;
}

export class PromotionsService {
  #rungs: LadderRung[] | null = null;

  constructor(
    private readonly db: PrismaClient,
    /**
     * How a promotion notice nudges live bell badges. Optional so every existing test constructs
     * the service exactly as before; rows still land without it (notify.ts).
     */
    private readonly nudge?: LiveNudge,
  ) {}

  /**
   * Tells a member their rank moved.
   *
   * ★ THE MEMBER, AND ONLY THE MEMBER ★
   *
   * A promotion is already announced to the squadron through the monthly report and Discord
   * roles; the personal row is the one place the member themselves is told directly, on the
   * platform, with a timestamp they can find again. The copy names no actor — an earned
   * promotion has none, and an override is the officer's entry in the audit log, not a thing to
   * hang over the member's congratulations. `notifyMembers` swallows failure: the rank is
   * already granted, and a bell must never un-grant it.
   */
  async #announcePromotion(userId: string, from: string, to: string): Promise<void> {
    await notifyMembers(
      this.db,
      [userId],
      {
        kind: 'promotion.rank',
        title: `Promoted to ${to}`,
        body: `Your rank has advanced from ${from} to ${to}. Congratulations, Commander.`,
        link: '/roster',
      },
      this.nudge,
    );
  }

  /**
   * The ladder, read once.
   *
   * ★ WALKED FOR, NOT ASSUMED ★
   *
   * The same trap the monthly job fell into: `resolve(cwd, '../..')` is right when started from
   * `apps/worker` and resolves to `/` in the container, where the job died on a missing file at
   * midnight on the one run that mattered. Walking up looking for the file itself asks the question
   * that matters — where is the ladder — rather than assuming a directory depth.
   */
  #ladder(): LadderRung[] {
    if (this.#rungs !== null) return this.#rungs;

    let dir = process.cwd();
    for (;;) {
      if (existsSync(join(dir, 'ssot', '02-domain', 'rank-progression.yaml'))) break;
      const up = join(dir, '..');
      if (up === dir) {
        throw new AppError(
          ErrorCode.UPSTREAM_UNAVAILABLE,
          'The rank ladder could not be found on disk, so promotions cannot be evaluated.',
        );
      }
      dir = up;
    }

    this.#rungs = readLadderFromSsot(dir);
    return this.#rungs;
  }

  /**
   * The engine, with the Discord half attached.
   *
   * ★ WITHOUT THE APPLIER THIS FEATURE UNDOES ITSELF ★
   *
   * Ladder ranks are mapped to Discord roles so reconciliation can learn them. A promotion written
   * only to our database is therefore not a promotion at all — the next reconciliation resolves the
   * disagreement IN DISCORD'S FAVOUR and hands the member their old rank back, some hours later,
   * with nothing reporting a problem.
   *
   * Null when the bot is unconfigured, which is the ordinary state in development. The engine then
   * writes our row alone, and that is a visible difference rather than a silent one.
   */
  /** The Discord half, or null when the bot is unconfigured. Built once, used by both paths. */
  #rankApplier(): DiscordRankApplier | null {
    const guildId = process.env['DISCORD_GUILD_ID'] ?? '';
    const botToken = process.env['DISCORD_BOT_TOKEN'] ?? '';
    if (guildId === '' || botToken === '') return null;

    const discord = new DiscordAdapter({
      clientId: process.env['DISCORD_CLIENT_ID'] ?? '',
      clientSecret: process.env['DISCORD_CLIENT_SECRET'] ?? '',
      botToken,
      // EMPTY: this adapter promotes people and must never grant an arbitrary role.
      grantableRoleIds: [],
    });

    return new DiscordRankApplier(this.db, discord, guildId);
  }

  /**
   * The last month a run counts, from a `YYYY-MM` label.
   *
   * ★ SQUADRON OWNER, 2026-08-02: A BUTTON PER MONTH ★
   *
   * Scoped to the FIRST of that month, because `member_activity_months` stores one row per month
   * keyed on its first day. `lte` that date therefore includes the month itself and excludes every
   * later one — "what would the job on the 1st of next month have done".
   *
   * Null for an unscoped run, which is what the nightly job does.
   */
  #throughMonth(month: string | null): Date | null {
    if (month === null || month === '') return null;

    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (m === null) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'A month must be written as YYYY-MM.');
    }

    const year = Number(m[1]);
    const index = Number(m[2]) - 1;
    if (index < 0 || index > 11) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'That is not a month.');
    }

    // UTC, matching how the rollups are keyed. A local-time Date would land on the last day of the
    // previous month for anybody west of Greenwich and quietly drop a month from the count.
    return new Date(Date.UTC(year, index, 1));
  }

  #engine(month: string | null = null): PromotionEngine {
    const store = new PrismaPromotionStore(this.db, this.#ladder(), this.#throughMonth(month));
    const applier = this.#rankApplier();
    return applier === null ? new PromotionEngine(store) : new PromotionEngine(store, applier);
  }

  /**
   * Who WOULD be promoted, writing nothing.
   *
   * The owner asked for a preview before a whole-month run: it affects many people at once, and
   * seeing the list is the difference between a decision and a hope. `dryRun` defaults to true in
   * the engine, so this is the engine's own safe path rather than a separate code route that might
   * disagree with it.
   */
  async preview(month: string | null = null): Promise<PromotionReport> {
    return this.#engine(month).run({ dryRun: true });
  }

  /** Runs them for real. Same evaluation as the preview, one flag apart. */
  async apply(month: string | null = null): Promise<PromotionReport> {
    if (!promotionsPermitted()) {
      /*
       * The floor is a coded guard, not a schedule — a cron expression that does not fire yet is no
       * safeguard, because somebody runs the job by hand to test it. Surfaced as a refusal the page
       * can show rather than a 500.
       */
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Promotions are not permitted yet. The first run is 1 August 2026.',
      );
    }

    const report = await this.#engine(month).run({ dryRun: false });

    /*
     * ★ WHO WAS ACTUALLY PROMOTED: THE ELIGIBLE LIST MINUS THE REFUSALS ★
     *
     * The engine (frozen in @grims/shared) applies `wouldPromote` one by one and moves anyone
     * Discord refuses into `failed` — so on a live run the difference between the two lists is
     * exactly the set whose rank genuinely changed. A member in `failed` was NOT promoted, and
     * congratulating them would be the bell telling a lie the next reconciliation exposes.
     */
    const refused = new Set(report.failed.map((f) => f.userId));
    for (const p of report.wouldPromote) {
      if (refused.has(p.userId)) continue;
      await this.#announcePromotion(p.userId, p.from, p.to);
    }

    return report;
  }

  /**
   * Where one member stands, for the members page.
   *
   * Returns nulls rather than throwing for somebody off the ladder entirely — an ally, an
   * applicant, a webmaster. The page shows them as having no rank, which is true.
   */
  async standing(userId: string): Promise<PromotionStanding> {
    const rungs = this.#ladder();
    const standings = await new PrismaPromotionStore(this.db, rungs).standings();
    const mine = standings.find((s) => s.userId === userId) ?? null;

    if (mine === null) {
      return {
        userId,
        currentRank: null,
        nextRank: null,
        qualifyingMonths: 0,
        monthsRequired: null,
        earned: false,
      };
    }

    const rung = rungs.find((r) => r.rank === mine.currentRank) ?? null;

    return {
      userId,
      currentRank: mine.currentRank,
      nextRank: rung?.next ?? null,
      qualifyingMonths: mine.qualifyingMonthsAtRank,
      monthsRequired: rung?.qualifyingMonthsRequired ?? null,
      earned:
        rung?.next != null &&
        rung.qualifyingMonthsRequired != null &&
        mine.qualifyingMonthsAtRank >= rung.qualifyingMonthsRequired,
    };
  }

  /** Every member's standing, keyed by user id, for one pass over the roster. */
  async standings(): Promise<Map<string, PromotionStanding>> {
    const rungs = this.#ladder();
    const rows = await new PrismaPromotionStore(this.db, rungs).standings();

    return new Map(
      rows.map((s) => {
        const rung = rungs.find((r) => r.rank === s.currentRank) ?? null;
        return [
          s.userId,
          {
            userId: s.userId,
            currentRank: s.currentRank,
            nextRank: rung?.next ?? null,
            qualifyingMonths: s.qualifyingMonthsAtRank,
            monthsRequired: rung?.qualifyingMonthsRequired ?? null,
            earned:
              rung?.next != null &&
              rung.qualifyingMonthsRequired != null &&
              s.qualifyingMonthsAtRank >= rung.qualifyingMonthsRequired,
          },
        ];
      }),
    );
  }

  /**
   * Promotes one member by an officer's decision.
   *
   * ★ UNCONDITIONAL BY DESIGN — SQUADRON OWNER, 2026-08-02 ★
   *
   * Asked whether this should follow the rules or override them, the owner chose "Override —
   * always enabled, officer's judgement", because the squadron is still onboarding and the ladder
   * has not had time to earn anybody anything.
   *
   * So it does NOT check qualifying months. What it does check is the LADDER: the only rank it will
   * grant is the one directly above, which stops a slip of the finger putting a new member at Grand
   * Master General.
   *
   * ★ AND IT RESTARTS THEIR CLOCK, FOR FREE ★
   *
   * `applyPromotion` creates a fresh `UserRole` row, and qualifying months are counted from
   * `grantedAt`. So a member promoted by hand on the 5th has not held the new rank for the whole of
   * that month and the job on the 1st will not move them again — which is what the owner chose when
   * asked. No extra bookkeeping, and nothing to keep in step.
   */
  async promoteOne(userId: string, actorId: string): Promise<{ from: string; to: string }> {
    if (!promotionsPermitted()) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Promotions are not permitted yet. The first run is 1 August 2026.',
      );
    }

    const standing = await this.standing(userId);

    if (standing.currentRank === null) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'They hold no ladder rank, so there is nothing to promote them from. Grant them Cadet first.',
      );
    }
    if (standing.nextRank === null) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `${standing.currentRank} is the top of the ladder.`,
      );
    }

    const store = new PrismaPromotionStore(this.db, this.#ladder());

    /*
     * ★ DISCORD FIRST, OUR ROW SECOND — THE SAME ORDER THE ENGINE USES ★
     *
     * My first version of this method wrote `applyPromotion` alone, which is the exact failure the
     * engine's applier exists to prevent: ladder ranks are mapped to Discord roles so reconciliation
     * can learn them, so a promotion written only here is UNDONE hours later in Discord's favour,
     * silently, and the member is handed their old rank back.
     *
     * Discord first because that is the side that can refuse. If it does, nothing has been written
     * and the officer is told; the other order leaves our database claiming a rank the guild never
     * granted.
     */
    const applier = this.#rankApplier();
    if (applier !== null) {
      try {
        await applier.applyRank(userId, standing.currentRank, standing.nextRank);
      } catch {
        throw new AppError(
          ErrorCode.UPSTREAM_UNAVAILABLE,
          'Discord refused the rank change, so nothing was altered. Check the bot sits above that ' +
            'role in Server Settings → Roles.',
        );
      }
    }

    await store.applyPromotion(userId, standing.currentRank, standing.nextRank);

    await store.writeAudit({
      actorId,
      action: 'promotion.manual',
      targetType: 'user',
      targetId: userId,
      before: { rank: standing.currentRank },
      after: {
        rank: standing.nextRank,
        /*
         * Recorded so the log distinguishes an override from an earned promotion. Somebody reading
         * this in six months should be able to tell which promotions the rules produced and which
         * an officer decided, without recomputing anything.
         */
        earned: standing.earned,
        qualifyingMonths: standing.qualifyingMonths,
        monthsRequired: standing.monthsRequired,
      },
    });

    // The rank is applied and audited; the member hears about it the same way an earned
    // promotion tells them. The copy deliberately reads identically — see #announcePromotion.
    await this.#announcePromotion(userId, standing.currentRank, standing.nextRank);

    return { from: standing.currentRank, to: standing.nextRank };
  }
}
