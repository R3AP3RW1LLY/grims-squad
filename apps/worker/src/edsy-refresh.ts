import { prisma } from '@grims/db';
import { refreshEdsyIds } from './jobs/edsy-refresh.js';

/**
 * Loading the EDSY id tables.
 *
 * ★ THE JOB EXISTED. NOTHING CALLED IT. ★
 *
 * `refreshEdsyIds` is complete and unit-tested, and until this file its only caller in the entire
 * repository was its own spec. There was no entrypoint, no cron line, no key in the daemon's
 * RUNNABLE map and no deploy step — while two hand-written migrations
 * (`20260801300000_edsy_ids`, `20260801310000_edsy_fdid`) created and extended `edsy_ids` on every
 * deploy. Production therefore carried a perfectly-formed EMPTY table, confirmed 2026-08-05:
 * `select count(*) from edsy_ids` returned 0.
 *
 * The migration's own header claims the data is "refreshed on a schedule the same way
 * coriolis-data is". There was no such schedule. This is the file that makes that true.
 *
 * ★ WHY NOBODY NOTICED ★
 *
 * The failure is per-paste and only on one input. A member pasting a Coriolis or orbis.zone build
 * link into Help Train the Bot gets a working import; an EDSY link gets a polite red box telling
 * them to ask an officer to run a job that could not be run. So the feature looks alive, and the
 * report reads as a member problem rather than a missing job. The same shape as the colony build
 * catalogue: a migration makes the table, and nothing introduces it to the data.
 *
 * ★ SAFE TO RUN AS OFTEN AS IT LIKES ★
 *
 * The job records `edsy.eddb_version` in `site_config` and returns early when upstream is
 * unchanged AND the table already holds rows — the second half deliberately covers exactly the
 * case above, where a version is recorded against an empty table. Upstream being unreachable
 * leaves what we have alone rather than emptying it.
 */
const result = await refreshEdsyIds(prisma);

if (result.problem !== undefined) {
  /*
   * Non-zero so cron mails it and a deploy step can warn. Upstream being down is not a crisis —
   * yesterday's ids decode today's links — but a refresh that has been failing for a month is
   * something somebody should be told about, and silence is how the last one lasted this long.
   */
  console.error(`edsy: ${result.problem}`);
  process.exitCode = 1;
} else if (result.changed) {
  console.log(`edsy: ${result.ships} ships, ${result.modules} modules`);
} else {
  console.log(`edsy: unchanged upstream — ${result.modules} entries held`);
}

await prisma.$disconnect();
