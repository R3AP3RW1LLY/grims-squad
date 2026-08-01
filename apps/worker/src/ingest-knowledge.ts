import { existsSync } from 'node:fs';
import { PrismaClient } from '@grims/db';
import { readCoriolis } from './jobs/ingest-coriolis.js';
import { refreshCoriolis } from './jobs/coriolis-refresh.js';
import { streamGalaxy } from './jobs/ingest-galaxy.js';
import { writeBatch, beginIngest, finishIngest, progressIngest } from './jobs/knowledge-writer.js';
import { rebuildMarketEntries } from './jobs/market-flatten.js';
import { readInaraKnowledge } from './jobs/ingest-inara.js';
import { readJournalKnowledge } from './jobs/ingest-journal.js';
import { readForumKnowledge } from './jobs/ingest-forum.js';
import { readReferenceKnowledge } from './jobs/ingest-reference.js';
import { announce } from './jobs/job-log.js';

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
  const run = await beginIngest(db, 'coriolis');
  try {
    /*
     * ★ PULL FIRST, THEN READ ★
     *
     * This used to read a folder somebody had downloaded by hand. Running more often could not
     * have made it fresher — the checkout was the ceiling, not the schedule. (The copy in place
     * turned out to be current, not stale; the point stands anyway, because staying current
     * depended entirely on a human remembering.)
     *
     * Almost always one small request that finds nothing new. See refreshCoriolis.
     */
    const upstream = await refreshCoriolis(CORIOLIS_DIR);
    if (upstream.changed) console.log(`coriolis: updated to ${upstream.head?.slice(0, 7)}`);
    else if (upstream.skipped !== null) console.log(`coriolis: using the local copy — ${upstream.skipped}`);

    if (!existsSync(CORIOLIS_DIR)) {
      /*
       * No checkout AND upstream unreachable. Recorded as a FAILURE rather than skipped: a source
       * that cannot get its data is broken, and "skipped" on the training page reads as a choice
       * somebody made.
       */
      await finishIngest(db, run, {
        error: `no checkout at ${CORIOLIS_DIR} and could not download one — ${upstream.skipped ?? 'unknown'}`,
      });
      console.log(`coriolis: FAILED — no data available`);
      return;
    }

    const rows = readCoriolis(CORIOLIS_DIR);
    const tally = { inserted: 0, updated: 0 };
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = await writeBatch(db, rows.slice(i, i + BATCH));
      tally.inserted += batch.inserted;
      tally.updated += batch.updated;
      // Every source reports, not just the galaxy — otherwise a short job that DOES stall looks
      // identical to one that finished, and the page has nothing to show while it runs.
      await progressIngest(db, run, tally.inserted + tally.updated);
    }
    const written = tally.inserted + tally.updated;
    await finishIngest(db, run, { rows: written, ...tally, source: 'coriolis' });
    console.log(`coriolis: ${written} rows`);
    await announce(db, {
      level: 'info',
      kind: 'ingest',
      message: `coriolis: ${tally.inserted} new, ${tally.updated} updated`,
    });
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
    const tally = { inserted: 0, updated: 0 };

    const stats = await streamGalaxy(
      GALAXY_FILE,
      async (batch) => {
        const result = await writeBatch(db, batch);
        tally.inserted += result.inserted;
        tally.updated += result.updated;
        written = tally.inserted + tally.updated;
        /*
         * Progress every 100k rows. The full dump is tens of millions and takes a long time; a job
         * that prints nothing for an hour is indistinguishable from one that has hung, and somebody
         * will kill it.
         */
        /*
         * ★ REPORTED EVERY BATCH, LOGGED EVERY 100k ★
         *
         * These were the same interval, and that made the countdown useless: nothing to divide by
         * for the first hundred thousand rows, so it read "estimating…" for the opening minutes of
         * every import — which is exactly when somebody is watching it.
         *
         * The galaxy writes 448,676 rows in batches of 2,000, so this is around 224 extra UPDATEs
         * across the whole run. The log stays coarse because a console line every two thousand rows
         * is noise nobody reads.
         */
        await progressIngest(db, run, written);
        if (written - lastLogged >= 100_000) {
          lastLogged = written;
          console.log(`galaxy: ${written} rows...`);
        }
      },
      BATCH,
    );

    await finishIngest(db, run, { rows: written, ...tally, source: 'galaxy' });
    console.log(
      `galaxy: ${written} rows (${tally.inserted} new, ${tally.updated} updated; ` +
        `${stats.systems} systems, ${stats.stations} stations)`,
    );
    await announce(db, {
      level: 'info',
      kind: 'ingest',
      message:
        `galaxy: ${tally.inserted.toLocaleString()} new, ${tally.updated.toLocaleString()} updated ` +
        `(${stats.systems.toLocaleString()} systems, ${stats.stations.toLocaleString()} stations)`,
    });

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

    const tally = { inserted: 0, updated: 0 };
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = await writeBatch(db, rows.slice(i, i + BATCH));
      tally.inserted += batch.inserted;
      tally.updated += batch.updated;
      // Every source reports, not just the galaxy — otherwise a short job that DOES stall looks
      // identical to one that finished, and the page has nothing to show while it runs.
      await progressIngest(db, run, tally.inserted + tally.updated);
    }
    const written = tally.inserted + tally.updated;
    await finishIngest(db, run, { rows: written, ...tally, source: 'inara' });
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

    const tally = { inserted: 0, updated: 0 };
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = await writeBatch(db, rows.slice(i, i + BATCH));
      tally.inserted += batch.inserted;
      tally.updated += batch.updated;
      // Every source reports, not just the galaxy — otherwise a short job that DOES stall looks
      // identical to one that finished, and the page has nothing to show while it runs.
      await progressIngest(db, run, tally.inserted + tally.updated);
    }
    const written = tally.inserted + tally.updated;
    await finishIngest(db, run, { rows: written, ...tally, source: 'journal' });
    console.log(`journal: ${written} rows (${systems} systems, ${stations} stations visited)`);
  } catch (e) {
    await finishIngest(db, run, { error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/**
 * The squadron's own answers.
 *
 * Cheap, like the journal aggregate: a query over tables we already hold, with no network.
 */
async function ingestForum(db: PrismaClient): Promise<void> {
  const run = await beginIngest(db, 'forum');
  try {
    const { rows, accepted, upvoted } = await readForumKnowledge(db);

    const tally = { inserted: 0, updated: 0 };
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = await writeBatch(db, rows.slice(i, i + BATCH));
      tally.inserted += batch.inserted;
      tally.updated += batch.updated;
      // Every source reports, not just the galaxy — otherwise a short job that DOES stall looks
      // identical to one that finished, and the page has nothing to show while it runs.
      await progressIngest(db, run, tally.inserted + tally.updated);
    }
    const written = tally.inserted + tally.updated;
    await finishIngest(db, run, { rows: written, ...tally, source: 'forum' });
    console.log(`forum: ${written} rows (${accepted} accepted answers, ${upvoted} highly-rated)`);
  } catch (e) {
    await finishIngest(db, run, { error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/**
 * Guides and reference — the squadron's own writing, plus documents kept with the repository.
 *
 * The only source whose value comes from being EMBEDDED rather than looked up: nobody searches a
 * guide by its title, they ask "how do I get more jump range" and the answer is a paragraph that
 * never uses those words.
 */
async function ingestReference(db: PrismaClient): Promise<void> {
  const run = await beginIngest(db, 'reference');
  try {
    const { rows, fromBoard, fromFiles } = await readReferenceKnowledge(
      db,
      process.env['KNOWLEDGE_REFERENCE_DIR'] ?? 'ssot/09-reference',
    );

    const tally = { inserted: 0, updated: 0 };
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = await writeBatch(db, rows.slice(i, i + BATCH));
      tally.inserted += batch.inserted;
      tally.updated += batch.updated;
      await progressIngest(db, run, tally.inserted + tally.updated);
    }
    const written = tally.inserted + tally.updated;
    await finishIngest(db, run, { rows: written, ...tally, source: 'reference' });
    console.log(
      `reference: ${written} passages (${fromBoard} guides, ${fromFiles} documents)`,
    );
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
      ['forum', ingestForum],
      ['reference', ingestReference],
    ] as const) {
      if (only.length > 0 && !only.includes(name)) continue;

      /*
       * Announced around the whole source rather than inside each job, so every one gets the same
       * treatment without five copies of the same two lines — and so a job that throws before its
       * own logging still reports a start and a failure.
       */
      const startedAt = Date.now();
      await announce(db, { level: 'info', kind: 'ingest', message: `${name}: started` });

      try {
        await run(db);
        await announce(db, {
          level: 'info',
          kind: 'ingest',
          message: `${name}: finished`,
          tookMs: Date.now() - startedAt,
        });
      } catch (e) {
        // Caught per source, deliberately: one broken source must not take the others with it.
        const message = e instanceof Error ? e.message : String(e);
        failures.push(`${name}: ${message}`);
        console.error(`${name}: FAILED — ${message}`);
        await announce(db, {
          level: 'error',
          kind: 'ingest',
          message: `${name}: FAILED — ${message}`,
          tookMs: Date.now() - startedAt,
        });
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
