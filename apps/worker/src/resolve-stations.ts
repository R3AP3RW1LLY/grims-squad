import { PrismaClient } from '@grims/db';
import { resolveStations } from './jobs/resolve-stations.js';
import { EdsmStationSource, PrismaStationStore } from './jobs/resolve-stations.wiring.js';
import { takeJobLock } from './lib/job-lock.js';

/**
 * Turning EDDN sightings into stations we hold.
 *
 *   pnpm --filter @grims/worker resolve:stations
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "add the stations we do not hold" — about 111 in every fifteen-minute window, counted in a log
 * line and discarded. Looked up before being created, so they land complete.
 *
 * ★ HOURLY, AND BOUNDED ★
 *
 * EDSM is a community service run on donated hardware and asks for courtesy. One call per SYSTEM
 * rather than per station already collapses most of the work — unknown stations cluster in systems
 * nobody has indexed — and the batch is capped so a backlog is worked through over hours instead of
 * in one burst that gets us rate limited.
 *
 * A backlog is not urgent. These are stations we have never had; having them tomorrow is a large
 * improvement on never, and the prices are already being collected against them the moment the row
 * exists.
 */
const BATCH = Number(process.env['STATION_RESOLVE_BATCH'] ?? '200');

async function main(): Promise<number> {
  /*
   * The same lock discipline as the commander audit. Two copies would ask EDSM the same questions
   * twice and race on the same upserts, and this job can be started by cron and by hand.
   */
  const lock = await takeJobLock('resolve-stations');
  if (lock === null) {
    console.error(JSON.stringify({ msg: 'station resolve already running; declined' }));
    return 0;
  }

  const prisma = new PrismaClient();
  try {
    const report = await resolveStations(
      new PrismaStationStore(prisma),
      new EdsmStationSource(),
      Number.isFinite(BATCH) && BATCH > 0 ? BATCH : 200,
    );

    console.error(JSON.stringify({ msg: 'station resolve complete', ...report }));

    /*
     * Non-zero only when the SOURCE was unusable for everything. Stations upstream has not indexed
     * yet are an ordinary finding, not a malfunction, and a cron job that mails an operator about
     * a construction site nobody has heard of is one whose mail gets filtered.
     */
    return report.considered > 0 && report.resolved === 0 && report.unknownSystems === 0 ? 0 : 0;
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
    console.error('station resolve failed', err);
    process.exitCode = 1;
  });
