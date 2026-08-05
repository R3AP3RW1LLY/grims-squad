/**
 * A month of telemetry, banked before the purge can reach it.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "the Journal Telemetry needs to be split into the YTD and per month so we can see it per month
 * how much telemetry were getting etc."
 *
 * ★ WHY BANKING, AND NOT A QUERY ★
 *
 * Raw `telemetry_events` live THIRTY DAYS. A per-month chart read from them would show honest
 * data for one month and fake zeros for every month before it — and once a month is purged
 * nothing can ever recompute it. So this job copies each month's per-type counts into
 * `telemetry_month_stats` while the raw rows still exist, and the dashboard reads the bank for
 * every closed month.
 *
 * ★ TWO MONTHS, TWO RULES ★
 *
 * The CURRENT month is fully inside retention, so the live window is the truth — including a
 * member exercising their right to purge a category, which REDUCES counts. Its bank is replaced
 * whole, stale types pruned.
 *
 * The PREVIOUS month is usually already part-eaten: on the 29th of a month, the 1st of the
 * previous one is beyond the 30-day window, so recomputing it from live rows would UNDERCOUNT and
 * overwrite a good figure with a worse one. Its bank is therefore only ever LIFTED — the greater
 * of what is banked and what is still visible, per type — which absorbs late-arriving journals
 * without ever letting the purge claw a banked month back down.
 *
 * Months older than the previous one are never touched at all. The job cannot see them, and a
 * job must never zero a month it cannot see.
 */

/** One event type's tally within a month. */
export interface TypeCount {
  readonly eventType: string;
  readonly count: number;
}

/** What a month's bank holds: the per-type counts, and the month's distinct reporters. */
export interface MonthBank {
  readonly reporters: number;
  readonly counts: readonly TypeCount[];
}

export interface TelemetryRollupStore {
  /** Per-type counts from the live window, for events with occurred_at in [start, end). */
  countsFor(start: Date, end: Date): Promise<readonly TypeCount[]>;
  /** Distinct commanders with ANY event in [start, end), from the live window. */
  reportersFor(start: Date, end: Date): Promise<number>;
  /** What is already banked for a month. Empty counts when nothing is. */
  banked(month: Date): Promise<MonthBank>;
  /**
   * Writes a month's bank. Upserts by (month, event_type) so a re-run corrects rather than
   * doubles. With `prune`, types banked for the month but absent from `counts` are deleted —
   * only ever asked for on the current month, where the live window is the whole truth.
   */
  bank(month: Date, data: MonthBank, opts: { readonly prune: boolean }): Promise<void>;
}

/** Pins an instant to the first of its month, midnight UTC. Same rule as the activity tables. */
export function monthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

/** The first of the month `offset` months after this one. */
function monthAfter(month: Date, offset: number): Date {
  return new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + offset, 1));
}

/**
 * The lift: per type, the greater of what is banked and what the live window still shows.
 *
 * Exported so the spec can pin the rule directly — it is the entire reason a banked month
 * survives the purge.
 */
export function liftBank(banked: MonthBank, computed: MonthBank): MonthBank {
  const byType = new Map<string, number>();
  for (const c of banked.counts) byType.set(c.eventType, c.count);
  for (const c of computed.counts) {
    byType.set(c.eventType, Math.max(byType.get(c.eventType) ?? 0, c.count));
  }

  return {
    reporters: Math.max(banked.reporters, computed.reporters),
    counts: [...byType.entries()]
      .map(([eventType, count]) => ({ eventType, count }))
      .sort((a, b) => a.eventType.localeCompare(b.eventType)),
  };
}

export interface TelemetryRollupReport {
  /** The current month's total events, as banked this run. */
  readonly currentEvents: number;
  /** The previous month's total events after the lift. */
  readonly previousEvents: number;
}

/**
 * Sweeps the current and previous month from the live window into the bank.
 *
 * Idempotent by construction: the current month is replaced, the previous is lifted, and both
 * writes key on (month, event_type) — so however many times a run repeats, the bank ends in the
 * same state.
 */
export async function rollUpTelemetry(
  store: TelemetryRollupStore,
  now: Date,
): Promise<TelemetryRollupReport> {
  const current = monthStart(now);
  const previous = monthAfter(current, -1);
  const next = monthAfter(current, 1);

  /*
   * Current month: the live window is the whole truth, purges included, so the bank is replaced
   * and stale types pruned. Reporters and counts are read as two queries over the same range —
   * a distinct cannot ride the GROUP BY without a second scan anyway.
   */
  const [currentCounts, currentReporters] = await Promise.all([
    store.countsFor(current, next),
    store.reportersFor(current, next),
  ]);
  await store.bank(
    current,
    { reporters: currentReporters, counts: currentCounts },
    { prune: true },
  );

  /*
   * Previous month: possibly part-purged, so only ever lifted. `prune: false`, because a type
   * the purge has already eaten is exactly the thing the bank exists to keep.
   */
  const [previousCounts, previousReporters, previouslyBanked] = await Promise.all([
    store.countsFor(previous, current),
    store.reportersFor(previous, current),
    store.banked(previous),
  ]);
  const lifted = liftBank(previouslyBanked, {
    reporters: previousReporters,
    counts: previousCounts,
  });
  await store.bank(previous, lifted, { prune: false });

  return {
    currentEvents: currentCounts.reduce((a, c) => a + c.count, 0),
    previousEvents: lifted.counts.reduce((a, c) => a + c.count, 0),
  };
}
