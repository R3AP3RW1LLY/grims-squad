import { existsSync } from 'node:fs';
import { PrismaClient } from '@grims/db';
import { readCoriolis } from './jobs/ingest-coriolis.js';
import { streamGalaxy } from './jobs/ingest-galaxy.js';
import { writeBatch, beginIngest, finishIngest } from './jobs/knowledge-writer.js';
import { rebuildMarketEntries } from './jobs/market-flatten.js';
import { readInaraKnowledge } from './jobs/ingest-inara.js';
import { readJournalKnowledge } from './jobs/ingest-journal.js';

/**
 * Ingests what GMSD AI knows about Elite Dangerous.
 *
 * ★ A ONE-SHOT, LIKE EVERY OTHER JOB HERE ★
 *
 * Runs, does the work, exits with a status cron can act on. No resident scheduler — the host's cron
 * already solves timing, retries and overlap, and does it observably from outside the process.
 *
 *   node apps/worker/dist/ingest-knowledge.js            both sources
 *   node apps/worker/dist/ingest-knowledge.js coriolis   just one
 *
 * ★ SOURCES ARE INDEPENDENT ★
 *
 * Coriolis failing must not stop the galaxy, and vice versa. Each records its own run, its own
 * failure, and its own row count — so the training page can say "ships are fine, systems are four
 * days stale" rather than one combined status that is wrong about both.
 */

/** Where the downloaded data lives. Overridable so a second machine need not match this one. */
const CORIOLIS_DIR = process.env['KNOWLEDGE_CORIOLIS_DIR'] ?? 'D:/ai/knowledge/coriolis-data-master';
const GALAXY_FILE = process.env['KNOWLEDGE_GALAXY_FILE'] ?? 'D:/ai/knowledge/galaxy_populated.json.gz';

/** Rows per statement. See knowledge-writer for why this number and not one or a million. */
const BATCH = 2_000;

async function ingestCoriolis(db: PrismaClient): Promise<void> {
  if (!existsSync(CORIOLIS_DIR)) {
    console.log(`coriolis: skipped, no checkout at ${CORIOLIS_DIR}`);
    return;
  }

  const run = await beginIngest(db, 'coriolis');
  try {
    const rows = readCoriolis(CORIOLIS_DIR);
    let written = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      written += await writeBatch(db, rows.slice(i, i + BATCH));
    }
    await finishIngest(db, run, { rows: written });
    console.log(`coriolis: ${written} rows`);
  } catch (e) {
    /*
     * Recorded, then rethrown to the caller's per-source handler. A failure that is only logged
     * leaves the training page showing the source as still running, which is the one state that
     * tells an officer nothing.
     */
    await finishIngest(db, run, { error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

async function ingestGalaxy(db: PrismaClient): Promise<void> {
  if (!existsSync(GALAXY_FILE)) {
    console.log(`galaxy: skipped, no dump at ${GALAXY_FILE}`);
    return;
  }

  const run = await beginIngest(db, 'galaxy');
  try {
    let written = 0;
    let lastLogged = 0;

    const stats = await streamGalaxy(
      GALAXY_FILE,
      async (batch) => {
        written += await writeBatch(db, batch);
        /*
         * Progress every 100k rows. The full dump is tens of millions and takes a long time; a job
         * that prints nothing for an hour is indistinguishable from one that has hung, and somebody
         * will kill it.
         */
        if (written - lastLogged >= 100_000) {
          lastLogged = written;
          console.log(`galaxy: ${written} rows...`);
        }
      },
      BATCH,
    );

    await finishIngest(db, run, { rows: written });
    console.log(`galaxy: ${written} rows (${stats.systems} systems, ${stats.stations} stations)`);

    /*
     * ★ FLATTEN AFTER EVERY GALAXY INGEST ★
     *
     * market_entries is derived from what was just written, so it is stale the moment the ingest
     * finishes. Rebuilding it here — rather than on its own schedule — means the two can never
     * disagree, which is the failure that would have members routed to prices that no longer exist
     * while the station page showed the correct ones.
     */
    const flat = await rebuildMarketEntries(db);
    console.log(`markets: ${flat} rows flattened for route-finding`);
  } catch (e) {
    await finishIngest(db, run, { error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/**
 * Our own roster, from the Inara cache.
 *
 * ★ ITS OWN SCHEDULE — squadron owner, 2026-07-31 ★
 *
 * "the ingestion for ML from inara, that one must be batched and run on its own." It has its own
 * cron line at 04:40 rather than riding along with the galaxy: a four-gigabyte dump import and a
 * hundred-row roster read have nothing in common but the word "ingest", and tying them together
 * would mean the roster could only refresh as often as the galaxy.
 */
async function ingestInara(db: PrismaClient): Promise<void> {
  const run = await beginIngest(db, 'inara');
  try {
    const { rows, members } = await readInaraKnowledge(db);

    if (rows.length === 0) {
      /*
       * Recorded as a completed run of zero rather than skipped. An empty roster cache is a real
       * state with a real cause — the rank sweep has not run yet, or every lookup failed — and
       * marking it "skipped" would leave the training page saying the source had never run at all.
       */
      await finishIngest(db, run, { rows: 0 });
      console.log('inara: 0 rows (no cached profiles yet — the rank sweep fills that table)');
      return;
    }

    let written = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      written += await writeBatch(db, rows.slice(i, i + BATCH));
    }
    await finishIngest(db, run, { rows: written });
    console.log(`inara: ${written} rows (${members} commanders)`);
  } catch (e) {
    await finishIngest(db, run, { error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/**
 * Where the squadron has actually been, from our own telemetry.
 *
 * Cheap — it is an aggregate over a table we already hold, with no network at all — so it rides
 * with the nightly ingest rather than earning a cron line of its own.
 */
async function ingestJournal(db: PrismaClient): Promise<void> {
  const run = await beginIngest(db, 'journal');
  try {
    const { rows, systems, stations } = await readJournalKnowledge(db);

    let written = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      written += await writeBatch(db, rows.slice(i, i + BATCH));
    }
    await finishIngest(db, run, { rows: written });
    console.log(`journal: ${written} rows (${systems} systems, ${stations} stations visited)`);
  } catch (e) {
    await finishIngest(db, run, { error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

async function main(): Promise<void> {
  /*
   * ★ SEVERAL NAMES, NOT ONE ★
   *
   * `ingest-knowledge.js coriolis galaxy` runs exactly those two. It took a single name until the
   * squadron owner asked for the Inara ingest to run on its own schedule — which needs a way to
   * say "everything EXCEPT that one", and a single name could only say "only this one".
   *
   * No names at all still means all of them.
   */
  const only = process.argv.slice(2).filter((a) => a !== '');
  const db = new PrismaClient();
  const failures: string[] = [];

  try {
    for (const [name, run] of [
      ['coriolis', ingestCoriolis],
      ['galaxy', ingestGalaxy],
      ['inara', ingestInara],
      ['journal', ingestJournal],
    ] as const) {
      if (only.length > 0 && !only.includes(name)) continue;
      try {
        await run(db);
      } catch (e) {
        // Caught per source, deliberately: one broken source must not take the others with it.
        failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
        console.error(`${name}: FAILED — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    await db.$disconnect();
  }

  if (failures.length > 0) {
    // Non-zero so cron mails it. A job that fails quietly is a job nobody knows is failing.
    process.exitCode = 1;
  }
}

await main();
