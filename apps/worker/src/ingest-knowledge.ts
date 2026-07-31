import { existsSync } from 'node:fs';
import { PrismaClient } from '@grims/db';
import { readCoriolis } from './jobs/ingest-coriolis.js';
import { streamGalaxy } from './jobs/ingest-galaxy.js';
import { writeBatch, beginIngest, finishIngest } from './jobs/knowledge-writer.js';

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
  } catch (e) {
    await finishIngest(db, run, { error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

async function main(): Promise<void> {
  const only = process.argv[2];
  const db = new PrismaClient();
  const failures: string[] = [];

  try {
    for (const [name, run] of [
      ['coriolis', ingestCoriolis],
      ['galaxy', ingestGalaxy],
    ] as const) {
      if (only !== undefined && only !== name) continue;
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
