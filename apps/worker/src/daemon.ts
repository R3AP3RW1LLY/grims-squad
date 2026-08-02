import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from 'pg';
import { PrismaClient } from '@grims/db';
import { JOB_REQUEST_CHANNEL } from '@grims/shared';
import { dueSources, lastRuns, TICK_MS } from './scheduler.js';
import { announce } from './jobs/job-log.js';

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

  /*
   * Never returns. The subscription and the reconnect loop live in there, and this process exists
   * to wait.
   */
  await listenForever(db, url);
}

await main();
