import { PrismaClient } from '@grims/db';
import { announce } from '@grims/shared';
import { rollUpCommodities } from './jobs/commodity-rollup.js';
import { PrismaRollupStore } from './jobs/commodity-rollup.wiring.js';
import { takeJobLock } from './lib/job-lock.js';

/**
 * One hour of the galaxy's trade, per commodity.
 *
 *   pnpm --filter @grims/worker rollup:commodities
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "average pricing, price over time lots of data" — and, told the hypertable behind it had never
 * once been written to, "start recording now, show charts as they fill".
 *
 * This is the clock starting. Every hour it runs is a point every commodity chart will have for as
 * long as we keep it; every hour it does not run is a hole nothing can backfill, because
 * `market_entries` holds only the CURRENT price and the past is not recoverable from it.
 *
 * That asymmetry is why the job is deliberately dull: it competes with nothing, it rides indexes
 * only, and a single bad commodity cannot cost the other 397 their point.
 */

async function main(): Promise<number> {
  /*
   * The same lock discipline as the other scheduled jobs. Two copies would do identical work
   * twice — harmless to the data, since the write is an idempotent upsert on the truncated hour,
   * but 796 needless aggregates against the table the whole site reads.
   */
  const lock = await takeJobLock('commodity-rollup');
  if (lock === null) {
    console.error(JSON.stringify({ msg: 'commodity rollup already running; declined' }));
    return 0;
  }

  const prisma = new PrismaClient();
  const started = Date.now();

  try {
    const report = await rollUpCommodities(new PrismaRollupStore(prisma), new Date());
    const ms = Date.now() - started;

    console.error(JSON.stringify({ msg: 'commodity rollup complete', ...report, ms }));

    /*
     * On the live log, because this is the feature's heartbeat. A member looking at a chart that
     * stops needs somebody to have been able to see it stop — and the run BEFORE anyone notices is
     * the one that explains it.
     */
    await announce(prisma, {
      level: report.commodities === 0 ? 'warn' : 'info',
      kind: 'market',
      message:
        report.commodities === 0
          ? 'commodity rollup recorded nothing — no tradeable market data was readable'
          : `${report.commodities.toLocaleString()} commodities priced` +
            `${report.untraded > 0 ? ` · ${report.untraded} untraded this hour` : ''}` +
            `${report.failed > 0 ? ` · ${report.failed} failed` : ''} (${(ms / 1000).toFixed(1)}s)`,
    });

    return 0;
  } finally {
    await lock.release();
    await prisma.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error('commodity rollup failed', err);
    process.exitCode = 1;
  });
