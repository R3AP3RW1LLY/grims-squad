import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from 'pg';
import { PrismaClient } from '@grims/db';
import { JOB_REQUEST_CHANNEL } from '@grims/shared';
import { dueSources, lastRuns, TICK_MS } from './scheduler.js';
import { initialPoll, nextPoll } from '@grims/shared';
import { announcePendingColonyProjects, PrismaColonyStore, syncColonyProjects } from '@grims/db';
import { TokenCipher, createKeyring } from '@grims/shared/server';
import { pollCapiJournals } from './jobs/capi-journal-poll.js';
import { PrismaCapiPollStore } from './jobs/capi-journal-poll.wiring.js';
import { PrismaBuildWatchStore, runBuildCompletionWatch } from './jobs/build-completion-watch.wiring.js';
import { announce } from './jobs/job-log.js';
import { rollUpCommodities } from './jobs/commodity-rollup.js';
import { PrismaRollupStore } from './jobs/commodity-rollup.wiring.js';
import { takeJobLock } from './lib/job-lock.js';
import { resolveStations } from './jobs/resolve-stations.js';
import { RoleSyncService } from './jobs/role-sync.service.js';
import { PrismaRoleSyncStore, membersToSync } from './jobs/role-sync.wiring.js';
import { rebuildBountyBoard } from './jobs/bounty-board.js';
import { refreshEdsyIds } from './jobs/edsy-refresh.js';
import { scoreLeaderboards } from './jobs/leaderboard-scores.js';
import { ingestMining } from './jobs/mining-ingest.js';
import { ingestBgs } from './jobs/bgs-ingest.js';
import { awardRecruitMilestones } from './jobs/recruit-milestones.js';
import { rollUpTelemetry } from './jobs/telemetry-rollup.js';
import { PrismaTelemetryRollupStore } from './jobs/telemetry-rollup.wiring.js';
import { EdsmStationSource, PrismaStationStore } from './jobs/resolve-stations.wiring.js';
import { notificationNudge } from './lib/live-notify.js';

/**
 * The resident worker: runs an ingest when somebody asks for one.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "if any of the ingestion sources stall, we need to show a button to re-trigger or refresh or
 * something that will re-start the ingestion process."
 *
 * ★ WHY A BUTTON NEEDED A NEW PROCESS ★
 *
 * Every ingest runs as a container that cron starts and discards. The API cannot start one: it has
 * no Docker socket, and giving a web-facing process the ability to start containers would be a
 * far larger decision than a refresh button warrants.
 *
 * Clearing the stalled row instead was the tempting shortcut — the page would stop saying "Training
 * now" and the next scheduled run would proceed. But the galaxy runs once a day, so "it will sort
 * itself out within twenty-four hours" is not what anybody means by a re-trigger button.
 *
 * So: this listens on a Postgres channel and runs the job. The API only publishes a request, which
 * it can do with the connection it already has.
 *
 * ★ IT SPAWNS RATHER THAN IMPORTS ★
 *
 * The ingests are one-shots that call `process.exitCode` and expect to own their lifetime. Importing
 * them into a long-lived process would mean one failing import could leave this daemon in a state
 * nothing resets. A child process cannot: it dies, and the next request gets a clean one.
 */

/** From the contract, not retyped. See `ssot/04-contracts/job-channels.ts`. */
const CHANNEL = JOB_REQUEST_CHANNEL;

/**
 * What may be asked for: the entrypoint, and the arguments it takes.
 *
 * An allowlist, because the payload crosses a process boundary and names a program to run. Nothing
 * outside this table can ever be spawned, whatever arrives on the channel.
 */
const RUNNABLE: Record<
  string,
  { readonly entry: string; readonly args: readonly string[]; readonly selfLocked?: boolean }
> = {
  coriolis: { entry: 'ingest-knowledge', args: ['coriolis'] },
  galaxy: { entry: 'ingest-knowledge', args: ['galaxy'] },
  inara: { entry: 'ingest-knowledge', args: ['inara'] },
  journal: { entry: 'ingest-knowledge', args: ['journal'] },
  forum: { entry: 'ingest-knowledge', args: ['forum'] },
  reference: { entry: 'ingest-knowledge', args: ['reference'] },
  embed: { entry: 'embed', args: [] },
  /*
   * ★ THE NIGHTLY COMMANDER AUDIT, ON REQUEST — SQUADRON OWNER, 2026-08-02 ★
   *
   * "add a button to the admin console to trigger an inara update manually ... pressing this should
   * not interupt the daily job."
   *
   * `selfLocked` because this one has a second caller the daemon knows nothing about: cron runs it
   * at 00:15 in its own container, straight from the entrypoint. If the lock were taken HERE, the
   * nightly run would hold nothing and a button press would happily start a second audit alongside
   * it — two processes asking Inara about the same members and spending a budget of two requests a
   * minute.
   *
   * So `daily-audit.ts` takes the lock itself and both callers contend on the same key. Taking it
   * here as well would be worse than useless: the parent would hold it and the child it spawned
   * would be refused by its own daemon.
   */
  commanders: { entry: 'daily-audit', args: [], selfLocked: true },
  edsy: { entry: 'edsy-refresh', args: [] },
};

/**
 * How to run a sibling entrypoint, in whichever form this daemon is itself running.
 *
 * ★ THE BUG THIS FIXES ★
 *
 * The first version spawned `dist/ingest-knowledge.js` relative to the working directory. That is
 * wrong in both places it runs: in development there is no `dist` and the sources are TypeScript, so
 * it failed with MODULE_NOT_FOUND; in the container the working directory is the repository root, so
 * the path would have needed `apps/worker/` in front of it.
 *
 * Resolving against `import.meta.url` asks a question with one answer — "the file next to me" —
 * and the extension of THIS file says which runtime the sibling needs. A compiled daemon runs
 * compiled siblings; a daemon running under tsx runs TypeScript ones.
 */
function commandFor(entry: string): { readonly exec: string; readonly argv: readonly string[] } {
  const here = fileURLToPath(import.meta.url);
  const compiled = here.endsWith('.js');
  const sibling = join(dirname(here), compiled ? `${entry}.js` : `${entry}.ts`);

  return compiled
    ? { exec: process.execPath, argv: [sibling] }
    : /*
       * `--import tsx` rather than the tsx binary: the binary's location differs between a pnpm
       * workspace and a plain install, and node is already the thing we are holding.
       */
      { exec: process.execPath, argv: ['--import', 'tsx', sibling] };
}

/**
 * One job at a time, and never the same one twice at once — ACROSS PROCESSES.
 *
 * ★ AN IN-MEMORY SET WAS NOT ENOUGH, AND IT SHOWED IMMEDIATELY ★
 *
 * The first version used a `Set` in this process. Two daemons happened to be running during
 * testing — one left over, one started by `pnpm dev` — and a single button press produced two
 * complete runs of the same ingest, 1651ms and 1634ms apart. Neither knew about the other.
 *
 * That is not a test artefact. Nothing stops a second daemon in production either: a redeploy that
 * overlaps, a container restarted by hand, an operator running one to debug. Two galaxy imports
 * together write the same rows and report progress into the same run, producing a count that goes
 * backwards on the training page.
 *
 * A Postgres ADVISORY LOCK is the only guard that spans processes, and both daemons already hold a
 * connection to the same database. It is released automatically if the process dies, which a row in
 * a table would not be.
 */
const LOCK_NAMESPACE = 0x67_6d_73_64; // "gmsd", so this cannot collide with another feature's locks.

/** A stable per-source lock id. Same string, same number, in every process. */
function lockIdFor(source: string): number {
  let hash = 0;
  for (const ch of source) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  // Kept positive and inside int4: pg_try_advisory_lock(int, int) takes two 32-bit keys.
  return Math.abs(hash) % 2_147_483_647;
}

async function run(db: PrismaClient, source: string): Promise<void> {
  const job = RUNNABLE[source];
  if (job === undefined) {
    await announce(db, { level: 'warn', kind: 'ingest', message: `ignored a request for unknown source "${source}"` });
    return;
  }

  /*
   * Claimed across every process on this database. `pg_try_advisory_lock` returns false rather than
   * waiting, which is the behaviour wanted: a second request while one is running should be
   * declined and SAID, not queued up to run again in twenty minutes when nobody is expecting it.
   *
   * A dedicated client, because the lock is held by the SESSION and Prisma's pool would hand the
   * connection back — releasing it while the job was still running.
   *
   * ★ UNLESS THE JOB LOCKS ITSELF ★
   *
   * A `selfLocked` job has a caller the daemon does not control — cron, running the entrypoint
   * directly — so the lock has to live in the entrypoint for both to contend on it. Taking it here
   * as well would mean the parent held it and the child it just spawned was refused.
   */
  const lock = job.selfLocked === true ? null : new Client({ connectionString: process.env['DATABASE_URL'] });

  if (lock !== null) {
    await lock.connect();

    const claimed = await lock
      .query<{ ok: boolean }>(`SELECT pg_try_advisory_lock($1, $2) AS ok`, [
        LOCK_NAMESPACE,
        lockIdFor(source),
      ])
      .then((r) => r.rows[0]?.ok === true)
      .catch(() => false);

    if (!claimed) {
      await lock?.end().catch(() => undefined);
      await announce(db, {
        level: 'warn',
        kind: 'ingest',
        message: `${source}: already running, request ignored`,
      });
      return;
    }
  }

  const startedAt = Date.now();
  await announce(db, { level: 'info', kind: 'ingest', message: `${source}: started on request` });

  await new Promise<void>((resolve) => {
    /*
     * Resolved by `commandFor`, so this behaves identically in development and in the container —
     * which matters more here than anywhere, because this is the path somebody reaches for when
     * something is already broken.
     */
    const { exec, argv } = commandFor(job.entry);
    const child = spawn(exec, [...argv, ...job.args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      void announce(db, {
        level: code === 0 ? 'info' : 'error',
        kind: 'ingest',
        message: code === 0 ? `${source}: finished on request` : `${source}: FAILED on request (exit ${code})`,
        tookMs: Date.now() - startedAt,
      }).finally(() => {
        // Released explicitly rather than left to the connection closing, so the next request can
        // proceed the instant this one is done.
        void lock?.end().catch(() => undefined);
        resolve();
      });
    });

    child.on('error', (e) => {
      void announce(db, {
        level: 'error',
        kind: 'ingest',
        message: `${source}: could not start — ${e.message}`,
      }).finally(() => {
        void lock?.end().catch(() => undefined);
        resolve();
      });
    });
  });
}

/** How long to wait before trying the connection again. */
const RETRY_MS = 5_000;

/**
 * Connects, listens, and reconnects for ever.
 *
 * ★ IT MUST NEVER EXIT, AND THE FIRST VERSION COULD ★
 *
 * `await client.connect()` throws when Postgres is not up. That is not an exotic failure — it is
 * what happens every time somebody runs `pnpm dev` before Docker has finished starting, which is
 * most mornings. The process would exit non-zero, and because this is now a task in `pnpm dev`,
 * TURBO TEARS DOWN EVERY OTHER TASK WITH IT. Starting the stack a few seconds early would have
 * taken the web and API down with no obvious cause.
 *
 * There was a second hole beside it: nothing reconnected. A dropped socket left the daemon running
 * and listening to nothing, so the button would report "Requested" for ever and no job would run —
 * exactly the silent failure this whole feature exists to remove.
 *
 * So it retries, indefinitely, and says so each time. A resident service that cannot tolerate its
 * database restarting is not resident.
 */
async function listenForever(db: PrismaClient, url: string): Promise<void> {
  for (;;) {
    const client = new Client({ connectionString: url });

    /*
     * ★ THE ERROR HANDLER IS NOT OPTIONAL ★
     *
     * An unhandled 'error' on a pg Client is an unhandled EventEmitter error, which ends the
     * process. Registered BEFORE connect, because that is when the first one can arrive.
     */
    const dropped = new Promise<void>((resolve) => {
      client.on('error', (e) => {
        console.error(`daemon: connection error — ${e.message}`);
        resolve();
      });
      client.on('end', () => resolve());
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      console.log(`daemon: listening on ${CHANNEL}`);
      await announce(db, {
        level: 'info',
        kind: 'health',
        message: 'Worker daemon ready for on-demand runs',
      });

      client.on('notification', (msg) => {
        if (msg.channel !== CHANNEL || msg.payload === undefined) return;
        // The payload is just the source name. Validated against RUNNABLE before anything is spawned.
        void run(db, msg.payload.trim());
      });

      // Resolves only when the connection goes away. Until then this is the whole program.
      await dropped;
      console.error('daemon: connection lost, reconnecting');
    } catch (e) {
      console.error(
        `daemon: could not connect (${e instanceof Error ? e.message : String(e)}), retrying in ${RETRY_MS / 1000}s`,
      );
    }

    await client.end().catch(() => undefined);
    await new Promise((r) => setTimeout(r, RETRY_MS));
  }
}

/**
 * Starts anything that is due, once a minute.
 *
 * ★ NOT AWAITED PER SOURCE ★
 *
 * The galaxy stream runs for roughly two hours. Awaiting it inside the tick would stop every other
 * source being considered for that whole time — so each is started and left to run, and `run`'s
 * advisory lock is what stops a second copy of the same source ever starting.
 *
 * A failure inside one source is logged by `run` itself and must not stop the loop: the next tick
 * is a minute away and one broken source is not a reason to stall the other five.
 */
function startScheduler(db: PrismaClient): void {
  const tick = async (): Promise<void> => {
    try {
      const due = dueSources(await lastRuns(db), Date.now());
      for (const source of due) {
        void run(db, source).catch(() => undefined);
      }
    } catch (e) {
      console.error(`daemon: scheduler tick failed (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  // Once at startup as well as on the interval: a worker that has just been restarted after being
  // down for a day should not wait another minute before catching up.
  void tick();
  setInterval(() => void tick(), TICK_MS);

  startColonySync(db);
  startCommodityRollup(db);
  startIngestionWatch(db);
  startRoleSync(db);
  startCapiJournalPoll(db);
  startBuildCompletionWatch(db);
  startStationResolver(db);
  startBountyBoard(db);
  startLeaderboardScoring(db);
  startTelemetryRollup(db);
}

/**
 * How often to fold colonisation journals into project records.
 *
 * ★ WHY THIS RUNS IN THE DAEMON AND NOT ONLY IN CRON ★
 *
 * It has a crontab entry, and on a developer's machine there is no cron at all — so a project
 * posted locally sat on the board with no needs, no deliveries and no progress, reading "waiting for
 * somebody to dock there" while the owner was docked there. Reported 2026-08-02, and the data was
 * never missing: 1,764 depot events and six contributions were already stored, with nothing
 * scheduled to read them.
 *
 * A resident daemon is the one thing guaranteed to be running wherever the platform runs. The
 * crontab entry stays — it is what covers the daemon being down — and running twice is free: the
 * job takes an advisory lock, needs are REPLACED rather than accumulated, and contributions carry a
 * unique key.
 *
 * Five minutes rather than fifteen. A member who has just hauled to a site wants to see it while
 * they are still on the pad, and the work is one small query per live project.
 */
const COLONY_SYNC_MS = 5 * 60_000;

function startColonySync(db: PrismaClient): void {
  const run = async (): Promise<void> => {
    try {
      // The nudge rides to the sync's markComplete transition: a build this pass finishes
      // announces itself, and connected browsers hear about it through the Redis bridge.
      const report = await syncColonyProjects(new PrismaColonyStore(db, notificationNudge));

      /*
       * ★ ANNOUNCED FROM HERE, AFTER THE SYNC, ON PURPOSE — SQUADRON OWNER, 2026-08-15 ★
       *
       * "we need this to announce with the type of build it is please."
       *
       * The sync above is what identifies a build type, so running the sweep immediately after it
       * gives a project the best chance of being announced WITH its type on the very first pass.
       * Announced from the create path — where it lived until now — the type is null by definition
       * and the channel got "build type not identified yet" every time.
       */
      const posted = await announcePendingColonyProjects(db, siteUrl());
      if (posted.announced > 0) {
        console.log(`daemon: colony sync — announced ${posted.announced} new build(s)`);
      }
      // Only worth a line when something changed. A squadron with no live projects would otherwise
      // print an identical zero every five minutes for ever.
      if (report.needsUpdated > 0 || report.contributionsAdded > 0 || report.completed > 0) {
        console.log(
          `daemon: colony sync — ${report.projects} project(s), ` +
            `${report.contributionsAdded} new deliveries, ${report.completed} completed`,
        );
      }
    } catch (e) {
      console.error(`daemon: colony sync failed (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  void run();
  setInterval(() => void run(), COLONY_SYNC_MS);
}

/**
 * How often to take the galaxy's price a snapshot.
 *
 * ★ THE ONE JOB WHERE A MISSED RUN IS PERMANENT — MEASURED 2026-08-04 ★
 *
 * Every other scheduled job here can catch up. This one cannot: `market_entries` holds only the
 * CURRENT price, so an hour nobody recorded is an hour no chart will ever have. The job's own
 * header says so — "every hour it does not run is a hole nothing can backfill".
 *
 * It had a crontab entry and no daemon entry, which is the same omission `startColonySync` above
 * was added to fix, and it cost more. Two days after the owner asked to "start recording now, show
 * charts as they fill", the table held exactly TWO hourly buckets — 05:00 and 20:00 on one day,
 * 392 commodities each, and nothing since. Zero commodities had enough history to draw a line.
 * Every commodity chart on the site was going to be two dots for ever.
 *
 * A resident daemon is the one thing guaranteed to be running wherever the platform runs. The
 * crontab entry stays — it covers the daemon being down — and running twice is free: the job takes
 * an advisory lock and the write is an idempotent upsert on the truncated hour.
 */
const COMMODITY_ROLLUP_MS = 60 * 60_000;

function startCommodityRollup(db: PrismaClient): void {
  const run = async (): Promise<void> => {
    /*
     * The lock is the whole safety story. Cron may fire at the same minute, and two copies would
     * aggregate 398 commodities twice against the table the entire site reads — harmless to the
     * data, expensive to everybody looking at a page.
     */
    const lock = await takeJobLock('commodity-rollup');
    if (lock === null) return;

    try {
      const report = await rollUpCommodities(new PrismaRollupStore(db), new Date());
      console.log(
        `daemon: commodity rollup — ${report.commodities} commodities` +
          `${report.untraded > 0 ? `, ${report.untraded} untraded` : ''}` +
          `${report.failed > 0 ? `, ${report.failed} FAILED` : ''}`,
      );
    } catch (e) {
      /*
       * Logged and swallowed. A failed hour is one missing point on a chart; a throw here would
       * take down the interval and cost every hour after it, which is the failure this job exists
       * to prevent.
       */
      console.error(`daemon: commodity rollup failed (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      await lock.release();
    }
  };

  // At startup as well as on the hour: a worker restarted after being down should take the current
  // hour's point immediately rather than waiting up to an hour for the next tick.
  void run();
  setInterval(() => void run(), COMMODITY_ROLLUP_MS);
}

/**
 * The pulse-taker, and the thing that finally ANNOUNCES a dead feed.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "restart all AI and ingestion services immediately please! ... this always needs to be on" — and,
 * asked how a failure should announce itself: Discord DM plus the site banner.
 *
 * Twice in two days something in this pipeline died silently: the collector stopped for 33 hours
 * (nothing said anything; every page just aged uniformly), and the galaxy download failed nightly
 * for as long as it has existed (a 30s deadline on a 4 GB file). Both were found by accident, days
 * later, by reading the database. This watch exists so the THIRD failure is a DM within minutes.
 *
 * ★ IT WRITES A ROW, NOT A MESSAGE ★
 *
 * The bot delivers the DM by polling `ops_alerts` for undelivered rows. An alert about
 * infrastructure being down must survive infrastructure being down — a row waits for the bot
 * however long the bot takes, where a fire-and-forget notify would vanish into the outage it was
 * reporting.
 *
 * ★ TRANSITIONS, NOT STATES ★
 *
 * A dead collector is one incident, not one alert per ten-minute check. Each kind re-alerts only
 * after six quiet hours, and recovery posts its own row — because "it fixed itself at 05:40" is
 * exactly what somebody reading the incident at breakfast needs to know.
 */
const INGESTION_WATCH_MS = 10 * 60_000;
/** A healthy collector closes a window every fifteen minutes; thirty means two missed. */
const COLLECTOR_STALL_MS = 30 * 60_000;
/** Spansh rebuilds nightly; thirty hours means a whole rebuild came and went without us. */
const GALAXY_STALL_MS = 30 * 60 * 60_000;

/**
 * Which deployment is speaking.
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * "i think we need to state what environment this is happening in in the message it sends us" —
 * said on receiving a production alert that could equally have come from a developer's laptop. Both
 * write to the same table shape and the bot delivers whatever it finds, so the reader had no way to
 * tell whether the site was actually down.
 *
 * Derived from PUBLIC_URL's host rather than a NODE_ENV string, because that is the address the
 * deployment actually serves and it is already required in production.
 */
/**
 * Where the site lives, for the link in a Discord message.
 *
 * The same pair the API's colony service reads, in the same order: `WEB_BASE_URL` where somebody has
 * set one explicitly, `PUBLIC_URL` otherwise — the one the deploy preflight already requires. An
 * unset pair yields a relative link, which is ugly in Discord but cannot point at the wrong hub.
 */
function siteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = (env['WEB_BASE_URL'] ?? '').trim();
  const fallback = (env['PUBLIC_URL'] ?? '').trim();
  return explicit === '' ? fallback : explicit;
}

function environmentLabel(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env['PUBLIC_URL'] ?? '';
  try {
    return new URL(raw).host;
  } catch {
    return raw === '' ? 'development' : raw;
  }
}

/**
 * How long ago, said in words a person can act on.
 *
 * `Math.round(Infinity / 60_000)` prints "Infinity minutes ago", which is what the first production
 * alert said. Infinity is not a duration — it is this watch's way of saying the thing has NEVER
 * reported, which is a different and more serious fact than a long gap, so it gets its own sentence.
 */
export function describeAge(ms: number, unit: 'minutes' | 'hours'): string {
  if (!Number.isFinite(ms)) return 'has never reported at all';
  const value = unit === 'minutes' ? Math.round(ms / 60_000) : Math.round(ms / 3_600_000);
  return `last did work ${value} ${unit} ago`;
}

function startIngestionWatch(db: PrismaClient): void {
  const where = environmentLabel();
  const alert = async (kind: string, message: string): Promise<void> => {
    const [recent] = await db.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM ops_alerts
        WHERE kind = $1 AND created_at > now() - interval '6 hours'`,
      kind,
    );
    if ((recent?.n ?? 0) > 0) return;

    // The environment leads the sentence, so a reader knows whether to get out of bed.
    const stamped = `[${where}] ${message}`;
    await db.$executeRawUnsafe(
      `INSERT INTO ops_alerts (kind, message) VALUES ($1, $2)`,
      kind,
      stamped,
    );
    console.error(`daemon: ALERT ${kind} — ${stamped}`);
  };

  /* Whether each thing was healthy at the LAST check, so recovery is a transition too. */
  const wasHealthy: Record<string, boolean> = { collector: true, galaxy: true };

  const run = async (): Promise<void> => {
    try {
      // The collector's own heartbeat: it updates progress_at on a timer while a window is open.
      const [eddn] = await db.$queryRawUnsafe<Array<{ newest: Date | null }>>(
        `SELECT max(progress_at) AS newest FROM knowledge_ingests WHERE source = 'eddn'`,
      );
      const collectorAge =
        eddn?.newest == null ? Number.POSITIVE_INFINITY : Date.now() - eddn.newest.getTime();
      const collectorHealthy = collectorAge < COLLECTOR_STALL_MS;

      if (!collectorHealthy && wasHealthy['collector']) {
        await alert(
          'collector-stalled',
          `Market ingestion has stopped. The EDDN collector ` +
            `${describeAge(collectorAge, 'minutes')} (threshold 30 minutes). ` +
            `Every price on the site is ageing from this moment.`,
        );
      } else if (collectorHealthy && !wasHealthy['collector']) {
        await alert('collector-recovered', 'The EDDN collector is receiving again.');
      }
      wasHealthy['collector'] = collectorHealthy;

      // The galaxy baseline: the last galaxy ingest that finished, from its own run history.
      const [galaxy] = await db.$queryRawUnsafe<Array<{ newest: Date | null }>>(
        `SELECT max(finished_at) AS newest FROM knowledge_ingests
          WHERE source = 'galaxy' AND error IS NULL`,
      );
      const galaxyAge =
        galaxy?.newest == null ? Number.POSITIVE_INFINITY : Date.now() - galaxy.newest.getTime();
      const galaxyHealthy = galaxyAge < GALAXY_STALL_MS;

      if (!galaxyHealthy && wasHealthy['galaxy']) {
        await alert(
          'galaxy-stale',
          `The Spansh galaxy baseline ${describeAge(galaxyAge, 'hours')} ` +
            `(threshold 30 hours). ` +
            `Stations nobody visits live are ageing without a floor under them.`,
        );
      } else if (galaxyHealthy && !wasHealthy['galaxy']) {
        await alert('galaxy-recovered', 'The galaxy baseline has refreshed.');
      }
      wasHealthy['galaxy'] = galaxyHealthy;
    } catch (e) {
      // The watchdog must not die of a transient error — a dead watchdog is the disease it treats.
      console.error(`daemon: ingestion watch failed (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  void run();
  setInterval(() => void run(), INGESTION_WATCH_MS);
}

/**
 * The pending-stations drainer, finally scheduled.
 *
 * The resolver has existed since 2026-08-02 and was scheduled ONLY in a crontab the repo's own
 * test says was never installed — so the queue sat at 1,323 rows with zero attempts, for ever.
 * The daemon is the one thing guaranteed to be running wherever the platform runs, which is the
 * same argument that put the colony sync and the rollup here.
 *
 * Every thirty minutes, small batches: EDSM is donated hardware and a backlog is not urgent — the
 * markets themselves are no longer lost while stations wait, only their enrichment is.
 */
const STATION_RESOLVE_MS = 30 * 60_000;

/**
 * Discord roles onto platform roles, every sixty seconds.
 *
 * ★ MOVED OUT OF CRON — SQUADRON OWNER, 2026-08-11 ★
 *
 * It was documented in docs/scheduled-jobs.md as `* * * * *` and, like the three jobs beside it,
 * never actually installed on any box. Installing it as written would have been 1,440 CONTAINER
 * STARTS A DAY — each one paying Node and Prisma boot to run a handful of indexed queries — and
 * infra/runbooks/workers-second-box.md already blames container churn for the load incident that
 * caused the second box to exist at all.
 *
 * The daemon is up regardless, so the same work costs a timer here. It also gains what a cron entry
 * could never have: the job lock every other daemon loop uses, so the sweep cannot overlap itself
 * if one run is slow.
 *
 * ★ WHY EVERY MINUTE IS STILL THE RIGHT CADENCE ★
 *
 * It touches Discord not at all. `discord_guild_members` is kept current by the bot from gateway
 * events, so this reads roles that are already fresh and writes only when something differs. The
 * alternative — asking Discord for 109 members a minute — is 157,000 requests a day and would be
 * rate-limited into uselessness within the hour.
 *
 * Before this ran anywhere, the only thing granting a platform role from Discord was the nightly
 * reconciliation: a member promoted in Discord at 09:00 held nothing on the site until 03:00 the
 * next morning.
 */
const ROLE_SYNC_MS = 60_000;

function startRoleSync(db: PrismaClient): void {
  const svc = new RoleSyncService(new PrismaRoleSyncStore(db));

  const run = async (): Promise<void> => {
    const lock = await takeJobLock('role-sync');
    if (lock === null) return;
    try {
      const members = await membersToSync(db);

      let granted = 0;
      let revoked = 0;
      let failed = 0;

      for (const member of members) {
        try {
          const result = await svc.sync(member.userId, member.discordRoleIds);
          granted += result.granted.length;
          revoked += result.revoked.length;
        } catch {
          /*
           * One member's failure must not abandon the rest. This runs every minute, so a transient
           * error costs that member sixty seconds — where aborting the sweep would leave everybody
           * after them unsynced, and the next run would hit the same row first and do it again.
           */
          failed += 1;
        }
      }

      /*
       * Logged ONLY when something happened. At once a minute, a line per run is 1,440 a day saying
       * nothing changed, which is how a log stops being read.
       */
      if (granted > 0 || revoked > 0 || failed > 0) {
        console.log(
          `daemon: role sync — ${granted} granted, ${revoked} revoked, ` +
            `${failed} failed of ${members.length}`,
        );
      }
    } catch (e) {
      console.error(`daemon: role sync failed (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      await lock.release();
    }
  };

  void run();
  setInterval(() => void run(), ROLE_SYNC_MS);
}

/**
 * How often the journal poller runs.
 *
 * ★ SIXTY SECONDS, MATCHING THE FASTEST CADENCE A MEMBER CAN REACH ★
 *
 * The job does not poll everybody every tick — each member has their own interval, measured from
 * how fast Frontier actually publishes for them. This is only how often we come back to LOOK, and
 * it is set to the floor so a member who has earned the fast cadence actually gets it. A slower tick
 * would silently cap everyone at the tick.
 */
const CAPI_POLL_MS = 60_000;

/**
 * Frontier's journals, for the members who cannot run the companion app.
 *
 * ★ SQUADRON OWNER ★
 *
 * "the primary feature must be so that players that are playing on Geforce Now and cloud platforms
 * can use the companion app like everyone else"
 *
 * They cannot install anything beside the game, so Frontier's copy of their journal is the only way
 * they exist on this platform at all. It also fills the gap that kept them out of promotions: game
 * activity sat at `unknown` because the only thing that ever set it was the companion's own ingest.
 *
 * ★ LIVE ONLY WHEN FRONTIER IS CONFIGURED ★
 *
 * Without the client id and the keyring this cannot do anything useful, and starting it anyway would
 * log a failure every minute for ever on a box where the feature is simply not set up.
 */
function startCapiJournalPoll(db: PrismaClient): void {
  const clientId = process.env['FDEV_CAPI_CLIENT_ID'] ?? '';
  const redirectUri = process.env['FDEV_CAPI_REDIRECT_URI'] ?? '';
  const keyring = process.env['TOKEN_ENCRYPTION_KEYRING'] ?? '';

  if (clientId === '' || redirectUri === '' || keyring === '') {
    console.log('daemon: cAPI journal poll disabled — Frontier is not configured on this box');
    return;
  }

  const store = new PrismaCapiPollStore(db, new TokenCipher(createKeyring(keyring)), {
    authBase: process.env['FDEV_CAPI_AUTH_BASE'] ?? 'https://auth.frontierstore.net',
    clientId,
    redirectUri,
    clientSecret: process.env['FDEV_CAPI_SHARED_KEY'] ?? '',
  });

  const run = async (): Promise<void> => {
    /*
     * ★ THE LOCK IS NOT ABOUT THIS BOX ★
     *
     * Frontier's rate limit is per CLIENT ID, across every process using it. Two daemons polling
     * would double the squadron's spend against a budget sized for one, and the member who gets the
     * 429 is not the member who caused it.
     */
    const lock = await takeJobLock('capi-journal-poll');
    if (lock === null) return;

    try {
      const report = await pollCapiJournals(store, {
        now: new Date(),
        live: true,
        apiBase: process.env['FDEV_CAPI_API_BASE'] ?? 'https://companion.orerve.net',
        tickMs: CAPI_POLL_MS,
      });

      /*
       * Logged only when something happened, or when the run was cut short. At once a minute a line
       * per run is 1,440 a day saying nothing, which is how a log stops being read — but an
       * abandoned run is the squadron's whole budget going quiet and must always be said.
       */
      if (report.abandoned) {
        console.warn(`daemon: cAPI journal poll stopped early — ${report.note ?? 'rate limited'}`);
      } else if (report.stored > 0 || report.deferred > 0) {
        console.log(
          `daemon: cAPI journal poll — ${report.stored} new entries from ${report.asked} member(s)` +
            (report.deferred > 0 ? `, ${report.deferred} deferred to the next run` : ''),
        );
      }
    } catch (e) {
      console.error(
        `daemon: cAPI journal poll failed (${e instanceof Error ? e.message : String(e)})`,
      );
    } finally {
      await lock.release();
    }
  };

  void run();
  setInterval(() => void run(), CAPI_POLL_MS);
}

/**
 * The build watch scales itself, like the poller does.
 *
 * ★ SQUADRON OWNER, 2026-08-16 ★
 *
 * "we didnt want a 20 minute cadence for capi we wanted auto scaling fast if active slow if now!"
 *
 * A fixed twenty minutes is wrong in both directions at once. While members are actively hauling to
 * a site, twenty minutes is twenty minutes of the board asking for materials that are already
 * delivered. While nothing is happening — which is most of the time — it is a query every twenty
 * minutes for ever, answering the same nothing.
 *
 * So it is MEASURED, exactly as the journal poller's interval is: each pass reports whether anything
 * new was seen at any watched build, and `nextPoll` walks the interval toward whatever that turns
 * out to be. Same function, same floors — one minute when the sites are busy, thirty when they are
 * not — so there is one idea of "how active is this" in the codebase rather than two.
 *
 * ★ SCHEDULED WITH setTimeout, NOT setInterval ★
 *
 * The interval changes after every pass, and `setInterval` fixes it at the value it was created
 * with. Re-arming after each run is what makes an adaptive cadence adaptive rather than decorative.
 */
function startBuildCompletionWatch(db: PrismaClient): void {
  const store = new PrismaBuildWatchStore(db);
  let poll = initialPoll();
  let lastSighting: Date | null = null;

  const run = async (): Promise<void> => {
    // Two daemons must not both close and both announce the same completion.
    const lock = await takeJobLock('build-completion-watch');

    if (lock !== null) {
      try {
        const now = new Date();
        const report = await runBuildCompletionWatch(store, now);

        /*
         * "Something happened" means a build closed, or a sighting arrived that we had not seen
         * before. A pass that merely re-read the same old sighting is exactly the pass that was not
         * worth making, and it is what should widen the interval.
         */
        const advanced =
          report.newestSightingAt !== null &&
          (lastSighting === null || report.newestSightingAt > lastSighting);
        if (report.newestSightingAt !== null) lastSighting = report.newestSightingAt;

        poll = nextPoll(poll, report.closed > 0 || advanced, now);

        // Only when something closed. A line per pass saying nothing changed is how a log stops
        // being read — and a close is the event somebody may need to find later.
        if (report.closed > 0) {
          console.log(
            `daemon: build watch — closed ${report.closed} finished build(s) of ${report.checked} live`,
          );
        }
      } catch (e) {
        console.error(`daemon: build watch failed (${e instanceof Error ? e.message : String(e)})`);
      } finally {
        await lock.release();
      }
    }

    setTimeout(() => void run(), poll.intervalMs);
  };

  void run();
}

function startStationResolver(db: PrismaClient): void {
  const run = async (): Promise<void> => {
    const lock = await takeJobLock('resolve-stations');
    if (lock === null) return;
    try {
      const report = await resolveStations(
        new PrismaStationStore(db),
        new EdsmStationSource(),
        Number(process.env['STATION_RESOLVE_BATCH'] ?? '50'),
      );
      if (report.resolved > 0 || report.abandoned > 0) {
        console.log(
          `daemon: station resolver — ${report.resolved} resolved, ` +
            `${report.stillUnknown} still unknown, ${report.abandoned} abandoned ` +
            `of ${report.considered}`,
        );
      }
    } catch (e) {
      console.error(`daemon: station resolver failed (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      await lock.release();
    }
  };

  void run();
  setInterval(() => void run(), STATION_RESOLVE_MS);
}

/**
 * The Data Bounty board, rebuilt every half hour. See jobs/bounty-board.ts for the why of every
 * number; the daemon owns only the cadence and the lock. Same reasoning as the resolver above for
 * why it lives here: the daemon is the one process guaranteed to be running wherever the platform
 * runs.
 */
const BOUNTY_BOARD_MS = 30 * 60_000;

function startBountyBoard(db: PrismaClient): void {
  const run = async (): Promise<void> => {
    const lock = await takeJobLock('bounty-board');
    if (lock === null) return;
    try {
      const report = await rebuildBountyBoard(db);
      console.log(
        `daemon: bounty board — ${report.ops} in squadron space, ${report.galaxy} galaxy tail, ${report.jackpots} jackpots`,
      );
    } catch (e) {
      // A failed rebuild keeps the previous board — stale bounties, not an empty page.
      console.error(`daemon: bounty board failed (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      await lock.release();
    }
  };

  void run();
  setInterval(() => void run(), BOUNTY_BOARD_MS);
}

/**
 * The EDSY id tables, daily.
 *
 * ★ WRITTEN, TESTED, AND CALLED BY NOTHING ★
 *
 * `refreshEdsyIds` had no caller anywhere in the repository except its own spec — no entrypoint,
 * no cron line, no key here, no deploy step — while two migrations created and extended `edsy_ids`
 * on every deploy. Production carried a perfectly-formed EMPTY table, confirmed 2026-08-05 at zero
 * rows, and pasting an EDSY build link answered with a red box telling the member to ask an
 * officer to run a job nobody could run.
 *
 * The migration's header says the data is "refreshed on a schedule the same way coriolis-data is".
 * This is that schedule, finally.
 *
 * ★ DAILY, AND WHY NOT HOURLY ★
 *
 * It is one HTTP GET of a static file on GitHub that changes when Frontier ships a game update —
 * a few times a year. The job already short-circuits on an unchanged version, so an hourly cadence
 * would buy nothing and spend somebody else's bandwidth to learn the same answer twenty-four times
 * a day. Run once at startup as well, which is what fixes an empty table the moment this deploys
 * rather than up to a day later.
 */
const EDSY_REFRESH_MS = 24 * 60 * 60_000;

function startEdsyRefresh(db: PrismaClient): void {
  const run = async (): Promise<void> => {
    const lock = await takeJobLock('edsy-refresh');
    if (lock === null) return;
    try {
      const result = await refreshEdsyIds(db);
      if (result.problem !== undefined) {
        // Upstream being unreachable leaves the existing table alone — yesterday's ids decode
        // today's links. Said out loud so a refresh failing for a month is not silent.
        console.error(`daemon: edsy refresh — ${result.problem}`);
      } else if (result.changed) {
        console.log(`daemon: edsy — ${result.ships} ships, ${result.modules} modules`);
      }
    } catch (e) {
      console.error(`daemon: edsy refresh failed (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      await lock.release();
    }
  };

  void run();
  setInterval(() => void run(), EDSY_REFRESH_MS);
}

/**
 * The leaderboard scorers, every five minutes — the same cadence as the colony sync they feed
 * from, and fast enough that telemetry's 30-day purge can never outrun the trade scorer.
 */
const LEADERBOARD_SCORE_MS = 5 * 60_000;

function startLeaderboardScoring(db: PrismaClient): void {
  const run = async (): Promise<void> => {
    const lock = await takeJobLock('leaderboard-scores');
    if (lock === null) return;
    try {
      /*
       * Mining folds BEFORE the scorers run, so a tonne refined in the last five minutes is on the
       * board in the same tick it is banked — and so the badge sweep at the end of `scoreLeaderboards`
       * sees it. Folding after would leave Deep Core badges a full cycle behind every other board's.
       */
      const mining = await ingestMining(db);
      if (mining.rocks > 0 || mining.tonnes > 0) {
        console.log(
          `daemon: mining — ${mining.rocks} rocks, ${mining.tonnes} t refined, ${mining.points} points, ${mining.sessions} sessions opened`,
        );
      }

      /*
       * BGS folds here too, for the same reason: influence moved in the last five minutes reaches
       * the Faction Hands board in the tick it was earned. Its own points are written directly to
       * the ledger, so `scoreLeaderboards` picks them up in the same pass.
       */
      const bgs = await ingestBgs(db);
      if (bgs.effects > 0) {
        console.log(
          `daemon: bgs — ${bgs.effects} influence effect(s), ${bgs.scored} scored, ${bgs.points} points`,
        );
      }

      /*
       * Recruit milestones fold in the same tick, and BEFORE the scorers, so a recruit reaching
       * Cadet pays their recruiter and the badge sweep at the end of `scoreLeaderboards` sees the
       * points in the same pass rather than a cycle later.
       */
      const recruits = await awardRecruitMilestones(db);
      if (recruits.reached > 0) {
        console.log(
          `daemon: recruits — ${recruits.reached} milestone(s) reached, ${recruits.points} points`,
        );
      }

      // The nudge lets a badge or line-closure notice reach open tabs through the Redis bridge.
      const report = await scoreLeaderboards(db, notificationNudge);
      if (report.colonyEvents > 0 || report.tradeEvents > 0 || report.badgesAwarded > 0) {
        console.log(
          `daemon: leaderboards — ${report.colonyEvents} colony, ${report.tradeEvents} trade, ${report.badgesAwarded} badges awarded`,
        );
      }
    } catch (e) {
      console.error(`daemon: leaderboard scoring failed (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      await lock.release();
    }
  };

  void run();
  setInterval(() => void run(), LEADERBOARD_SCORE_MS);
}

/**
 * The telemetry month bank, hourly — the same cadence as the commodity rollup, and for a related
 * reason: raw telemetry is purged at 30 days, so a month nobody banked is a month no chart will
 * ever have. An hour of lag costs nothing — the dashboard blends the LIVE window in for the
 * month still running and reads the bank only for closed months — but a month that reaches the
 * purge unbanked is gone for good, and hourly leaves ~720 chances before that can happen.
 */
const TELEMETRY_ROLLUP_MS = 60 * 60_000;

function startTelemetryRollup(db: PrismaClient): void {
  const run = async (): Promise<void> => {
    // The lock spans processes, same as every job here: a rerun is harmless — replace and
    // lift are both idempotent — but two copies interleaving their transactions is noise the
    // dashboard would briefly read.
    const lock = await takeJobLock('telemetry-rollup');
    if (lock === null) return;
    try {
      const report = await rollUpTelemetry(new PrismaTelemetryRollupStore(db), new Date());
      console.log(
        `daemon: telemetry rollup — ${report.currentEvents} events this month, ` +
          `${report.previousEvents} banked for last`,
      );
    } catch (e) {
      // Logged and swallowed. A missed hour is caught by the next one; a throw here would take
      // the interval down and cost every hour after it — the failure this job exists to prevent.
      console.error(`daemon: telemetry rollup failed (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      await lock.release();
    }
  };

  // At startup as well as on the hour, matching the commodity rollup: a worker restarted after
  // being down should bank the months immediately rather than wait out the first interval.
  void run();
  setInterval(() => void run(), TELEMETRY_ROLLUP_MS);
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    /*
     * ★ COMPLAINS FOR EVER RATHER THAN EXITING ★
     *
     * This was an `exitCode = 1` on the reasoning that a missing connection string cannot fix
     * itself by waiting. True, and beside the point: this is a task in `pnpm dev`, and turbo tears
     * down every other task when one fails — so the tidy exit takes the web app and the API with
     * it. One idle process saying what is wrong is strictly better than three dead ones.
     */
    for (;;) {
      console.error('daemon: DATABASE_URL is not set — on-demand ingests cannot be served');
      await new Promise((r) => setTimeout(r, 60_000));
    }
  }

  const db = new PrismaClient();

  /*
   * ★ THE SCHEDULE LIVES HERE NOW — SQUADRON OWNER, 2026-08-01 ★
   *
   * "this is a non-negotiable! these are clearly not triggering as we have overdue on them!"
   *
   * They were not, and the cadences were not the reason: NOTHING SCHEDULED THEM. The entire
   * schedule lived in `infra/cron/grims-worker`, a crontab that has to be installed on the host by
   * hand — never installed in production, and absent entirely on a developer's machine. This daemon
   * listened for on-demand requests and did nothing on its own.
   *
   * There was even a test reading that crontab and asserting every source appeared in it often
   * enough. It passed the whole time. It proved the FILE said the right thing, which was true and
   * unrelated to whether anything ran.
   *
   * So the schedule moved into the process that does the work, driven by the same `REFRESH_HOURS`
   * the training page reports from. One number, one place, no installation step, and "due to run"
   * and "overdue" can no longer disagree.
   */
  startScheduler(db);
  startEdsyRefresh(db);

  /*
   * Never returns. The subscription and the reconnect loop live in there, and this process exists
   * to wait.
   */
  await listenForever(db, url);
}

await main();
