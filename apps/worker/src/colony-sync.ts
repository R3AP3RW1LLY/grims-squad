import { PrismaClient } from '@grims/db';
import { announce } from '@grims/shared';
import { PrismaColonyStore, syncColonyProjects } from '@grims/db';
import { takeJobLock } from './lib/job-lock.js';

/**
 * Colonisation projects, kept current from members' journals.
 *
 *   pnpm --filter @grims/worker sync:colony
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "keep our own full records too" — of colonisation, built self-contained once Ravencolonial turned
 * out to learn everything from the same journal events we already read.
 *
 * ★ SAFE TO RUN AT ANY MOMENT, TWICE OVER, OR AFTER A WEEK OF DOWNTIME ★
 *
 * There is no cursor to advance and none to get wrong. Needs are REPLACED from the newest depot
 * reading, so a missed run costs nothing; contributions carry the journal's own idempotency key
 * into a UNIQUE column, so a repeated run is a no-op in the database rather than by agreement.
 *
 * That is what lets this be frequent and cheap. Every fifteen minutes, so a member who has just
 * hauled sees their delivery on the board while they are still docked.
 */

async function main(): Promise<number> {
  const lock = await takeJobLock('colony-sync');
  if (lock === null) {
    console.error(JSON.stringify({ msg: 'colony sync already running; declined' }));
    return 0;
  }

  const prisma = new PrismaClient();
  const started = Date.now();

  try {
    const report = await syncColonyProjects(new PrismaColonyStore(prisma));
    const ms = Date.now() - started;

    console.error(JSON.stringify({ msg: 'colony sync complete', ...report, ms }));

    /*
     * Only announced when there was something to say. A squadron with no live projects would
     * otherwise put an identical "0 projects" line on the live log ninety-six times a day, which is
     * how a log stops being read.
     */
    if (report.projects > 0) {
      await announce(prisma, {
        level: report.failed > 0 ? 'warn' : 'info',
        kind: 'colony',
        message:
          `${report.projects} project(s) synced` +
          `${report.contributionsAdded > 0 ? ` · ${report.contributionsAdded.toLocaleString()} new deliveries` : ''}` +
          `${report.completed > 0 ? ` · ${report.completed} completed` : ''}` +
          `${report.awaitingFirstVisit > 0 ? ` · ${report.awaitingFirstVisit} awaiting a first visit` : ''}` +
          `${report.failed > 0 ? ` · ${report.failed} failed` : ''} (${(ms / 1000).toFixed(1)}s)`,
      });
    }

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
    console.error('colony sync failed', err);
    process.exitCode = 1;
  });
