import type { PrismaClient } from '@grims/db';
import type { MonthBank, TelemetryRollupStore, TypeCount } from './telemetry-rollup.js';

/**
 * Reading the live telemetry window, and writing the month bank.
 *
 * Every read rides the existing `(category, occurred_at)` / `(user_id, occurred_at)` indexes'
 * companion on occurred_at ranges — the window is thirty days at most, so even the full-window
 * GROUP BY is a bounded scan that cannot grow with the archive.
 */
export class PrismaTelemetryRollupStore implements TelemetryRollupStore {
  constructor(private readonly db: PrismaClient) {}

  async countsFor(start: Date, end: Date): Promise<readonly TypeCount[]> {
    const rows = await this.db.$queryRaw<Array<{ event_type: string; n: bigint }>>`
      SELECT event_type, COUNT(*)::bigint AS n
        FROM telemetry_events
       WHERE occurred_at >= ${start} AND occurred_at < ${end}
       GROUP BY event_type
    `;
    return rows.map((r) => ({ eventType: r.event_type, count: Number(r.n) }));
  }

  async reportersFor(start: Date, end: Date): Promise<number> {
    const rows = await this.db.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(DISTINCT user_id)::bigint AS n
        FROM telemetry_events
       WHERE occurred_at >= ${start} AND occurred_at < ${end}
    `;
    return Number(rows[0]?.n ?? 0n);
  }

  async banked(month: Date): Promise<MonthBank> {
    const rows = await this.db.telemetryMonthStat.findMany({
      where: { month },
      select: { eventType: true, eventCount: true, reportingMembers: true },
    });
    return {
      // Repeated on every row of the month by design; any row carries the month's figure.
      reporters: rows[0]?.reportingMembers ?? 0,
      counts: rows.map((r) => ({ eventType: r.eventType, count: r.eventCount })),
    };
  }

  async bank(month: Date, data: MonthBank, opts: { readonly prune: boolean }): Promise<void> {
    /*
     * One transaction for the month, so the dashboard can never read a half-written bank —
     * a pruned row gone with its replacement not yet landed.
     */
    const writes = data.counts.map(
      (c) => this.db.$executeRaw`
        INSERT INTO telemetry_month_stats (month, event_type, event_count, reporting_members)
        VALUES (${month}::date, ${c.eventType}, ${c.count}, ${data.reporters})
        ON CONFLICT (month, event_type) DO UPDATE SET
          event_count       = EXCLUDED.event_count,
          reporting_members = EXCLUDED.reporting_members,
          updated_at        = now()
      `,
    );

    if (opts.prune) {
      /*
       * Current month only. A type banked earlier this month and absent from the live window
       * now means the member purged it — the bank must follow, or the purge would be undone in
       * aggregate on a dashboard the member can never see to object to.
       */
      const keep = data.counts.map((c) => c.eventType);
      writes.push(this.db.$executeRaw`
        DELETE FROM telemetry_month_stats
         WHERE month = ${month}::date
           AND event_type <> ALL(${keep}::text[])
      `);
    }

    await this.db.$transaction(writes);
  }
}
