#!/usr/bin/env node
/**
 * Keeps a resident dev service alive.
 *
 *   node tools/keep-alive.mjs <label> -- <command> [args...]
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "this always needs to be on ... this really needs to be reliable!"
 *
 * ★ THE FAILURE THIS EXISTS FOR ★
 *
 * `turbo run dev` starts every service once. If one exits — and the two that matter most exit for a
 * completely routine reason, Postgres not being up yet when the stack starts — turbo does not
 * restart it. It prints a line into a scrolling log and moves on.
 *
 * That is survivable for a web server, because you notice immediately: the page does not load. It
 * is NOT survivable for the two resident ingestion services, and the EDDN collector's own header
 * says why: "a dead subscriber looks exactly like a quiet one: no error, no alert, just prices that
 * gradually stop being current."
 *
 * Measured on 2026-08-04, on a machine where `pnpm dev` had been running the whole time:
 *
 *     newest market reading anywhere : 33.2 hours old
 *     rows in the last 6 hours       : 0
 *     hourly price snapshots         : 2, both from two days earlier
 *
 * Nothing was broken. Two processes were simply not running, and nothing said so.
 *
 * ★ WHY A SUPERVISOR RATHER THAN "MAKE THEM NEVER CRASH" ★
 *
 * They already try. The collector retries its connections indefinitely by design. But "never exits"
 * is a property no process can actually guarantee — an unhandled rejection, an OOM, a killed socket
 * during a laptop suspend — and the cost of being wrong is silent, which is the worst kind of cost.
 * Production solved this with `restart: unless-stopped`. Development had no equivalent. This is it.
 *
 * ★ IT IS DELIBERATELY NOISY ★
 *
 * A restart prints a banner. Silence is what let this run for two days, so a supervisor that
 * restarted quietly would be reproducing the original bug with extra steps.
 */
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
if (split === -1 || split === 0 || split === argv.length - 1) {
  console.error('usage: keep-alive.mjs <label> -- <command> [args...]');
  process.exit(2);
}

const label = argv.slice(0, split).join(' ');
const [command, ...args] = argv.slice(split + 1);

/**
 * Backoff between restarts.
 *
 * A service that fails INSTANTLY and repeatedly is misconfigured, not unlucky — a tight respawn
 * loop would bury the error message that says which. A service that dies after running happily for
 * an hour should come back at once, so the delay resets whenever one survives a while.
 */
const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
/** Ran this long before dying? Then it was working, and the next failure starts from scratch. */
const HEALTHY_MS = 60_000;

let delay = MIN_DELAY_MS;
let stopping = false;
let child = null;

const stamp = () => new Date().toISOString().slice(11, 19);

function start() {
  const startedAt = Date.now();

  child = spawn(command, args, {
    stdio: 'inherit',
    // The children are pnpm/tsx wrappers on Windows, which need a shell to resolve.
    shell: process.platform === 'win32',
  });

  child.on('exit', (code, signal) => {
    if (stopping) return;

    const ranFor = Date.now() - startedAt;
    if (ranFor >= HEALTHY_MS) delay = MIN_DELAY_MS;

    console.error(
      `\n[${stamp()}] keep-alive: ${label} exited (${signal ?? `code ${code}`}) after ` +
        `${Math.round(ranFor / 1000)}s — restarting in ${Math.round(delay / 1000)}s\n`,
    );

    setTimeout(start, delay);
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  });

  child.on('error', (err) => {
    console.error(`[${stamp()}] keep-alive: ${label} could not start — ${err.message}`);
  });
}

/*
 * Ctrl-C must stop the whole thing rather than trigger a restart, or a developer would be unable to
 * shut their own stack down — the supervisor would helpfully bring back what they just killed.
 */
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true;
    child?.kill();
    process.exit(0);
  });
}

console.error(`[${stamp()}] keep-alive: supervising ${label}`);
start();
