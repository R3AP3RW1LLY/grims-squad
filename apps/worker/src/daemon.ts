import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from 'pg';
import { PrismaClient } from '@grims/db';
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

/** Must match the API. Two sides, one name. */
const CHANNEL = 'gmsd_job_request';

/**
 * What may be asked for: the entrypoint, and the arguments it takes.
 *
 * An allowlist, because the payload crosses a process boundary and names a program to run. Nothing
 * outside this table can ever be spawned, whatever arrives on the channel.
 */
const RUNNABLE: Record<string, { readonly entry: string; readonly args: readonly string[] }> = {
  coriolis: { entry: 'ingest-knowledge', args: ['coriolis'] },
  galaxy: { entry: 'ingest-knowledge', args: ['galaxy'] },
  inara: { entry: 'ingest-knowledge', args: ['inara'] },
  journal: { entry: 'ingest-knowledge', args: ['journal'] },
  forum: { entry: 'ingest-knowledge', args: ['forum'] },
  reference: { entry: 'ingest-knowledge', args: ['reference'] },
  embed: { entry: 'embed', args: [] },
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
   */
  const lock = new Client({ connectionString: process.env['DATABASE_URL'] });
  await lock.connect();

  const claimed = await lock
    .query<{ ok: boolean }>(`SELECT pg_try_advisory_lock($1, $2) AS ok`, [
      LOCK_NAMESPACE,
      lockIdFor(source),
    ])
    .then((r) => r.rows[0]?.ok === true)
    .catch(() => false);

  if (!claimed) {
    await lock.end().catch(() => undefined);
    await announce(db, {
      level: 'warn',
      kind: 'ingest',
      message: `${source}: already running, request ignored`,
    });
    return;
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
        void lock.end().catch(() => undefined);
        resolve();
      });
    });

    child.on('error', (e) => {
      void announce(db, {
        level: 'error',
        kind: 'ingest',
        message: `${source}: could not start — ${e.message}`,
      }).finally(() => {
        void lock.end().catch(() => undefined);
        resolve();
      });
    });
  });
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    console.error('daemon: DATABASE_URL is not set');
    process.exitCode = 1;
    return;
  }

  const db = new PrismaClient();
  const client = new Client({ connectionString: url });

  /*
   * ★ THE ERROR HANDLER IS NOT OPTIONAL ★
   *
   * An unhandled 'error' on a pg Client is an unhandled EventEmitter error, which ends the process.
   * This one is meant to stay up for weeks; a network blip must not be the end of it.
   */
  client.on('error', (e) => {
    console.error(`daemon: connection error — ${e.message}`);
  });

  await client.connect();
  await client.query(`LISTEN ${CHANNEL}`);
  console.log(`daemon: listening on ${CHANNEL}`);
  await announce(db, { level: 'info', kind: 'health', message: 'Worker daemon ready for on-demand runs' });

  client.on('notification', (msg) => {
    if (msg.channel !== CHANNEL || msg.payload === undefined) return;
    // The payload is just the source name. Validated against RUNNABLE before anything is spawned.
    void run(db, msg.payload.trim());
  });

  /*
   * Held open by the listener. No timer, no poll — the process exists to wait, and a heartbeat here
   * would only be a second thing to go wrong.
   */
  await new Promise(() => {});
}

await main();
