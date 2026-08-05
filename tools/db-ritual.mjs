#!/usr/bin/env node
/**
 * The Prisma ritual, automated.
 *
 * ★ SQUADRON OWNER, 2026-08-04: "all of this must be automated during the deploy sequence" ★
 *
 * Applying a migration in development has a fixed choreography that was living in one person's
 * memory: the dev API (and every other tsx-watch app child) holds Prisma's query-engine DLL open,
 * so `prisma generate` dies with EPERM until they are stopped — and a killed tsx child does NOT
 * respawn on its own, because the watcher only reacts to file changes. So:
 *
 *   1. Kill the app CHILDREN (the node processes tsx spawned — identifiable by tsx's
 *      preflight.cjs in their command line). The watchers and keep-alive parents stay up.
 *   2. prisma migrate deploy      — apply what is in packages/db/prisma/migrations.
 *   3. prisma generate            — now nothing holds the engine DLL.
 *   4. build @grims/db            — the apps load its dist, not its source.
 *   5. Touch each app's entry file — the surviving watchers see a change and respawn their child.
 *
 * Production needs none of this: deploy.sh runs the migration inside the container build, where
 * nothing else holds the engine. This script is the DEV half of the same guarantee.
 *
 * Usage: pnpm db:ritual        (from the repo root)
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, utimesSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/** The files whose mtime bump makes each tsx watcher respawn the child it lost. */
const ENTRIES = [
  'apps/api/src/main.ts',
  'apps/bot/src/main.ts',
  'apps/worker/src/daemon.ts',
  'apps/eddn-collector/src/index.ts',
];

const say = (line) => process.stdout.write(`ritual: ${line}\n`);

function killAppChildren() {
  if (process.platform !== 'win32') {
    // Elsewhere the engine is not a locked DLL and generate works alongside a running app.
    say('not Windows — skipping the child kill, EPERM does not happen here');
    return;
  }

  /*
   * The app children are the node processes tsx spawned: their command line carries tsx's
   * preflight.cjs require. The tsx WATCHERS (cli.mjs watch ...) are left alone on purpose —
   * they are what respawns everything at step 5.
   */
  const json = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | ` +
        `Where-Object { $_.CommandLine -like '*preflight.cjs*' } | ` +
        `Select-Object ProcessId | ConvertTo-Json -Compress`,
    ],
    { encoding: 'utf8' },
  ).trim();

  if (json === '') {
    say('no tsx app children running — nothing holds the engine');
    return;
  }

  const rows = JSON.parse(json);
  const pids = (Array.isArray(rows) ? rows : [rows]).map((r) => r.ProcessId);
  for (const pid of pids) {
    say(`stopping app child ${pid}`);
    try {
      execFileSync('taskkill.exe', ['/PID', String(pid), '/F'], { stdio: 'ignore' });
    } catch {
      // Already gone. The goal is a free DLL, not a body count.
    }
  }
}

function run(label, command) {
  say(label);
  execSync(command, { cwd: ROOT, stdio: 'inherit' });
}

killAppChildren();
run('applying migrations', 'pnpm --filter @grims/db exec prisma migrate deploy');
run('regenerating the client', 'pnpm --filter @grims/db exec prisma generate');
run('building @grims/db', 'pnpm --filter @grims/db build');

const now = new Date();
for (const entry of ENTRIES) {
  const full = resolve(ROOT, entry);
  if (!existsSync(full)) continue;
  utimesSync(full, now, now);
  say(`touched ${entry}`);
}

say('done — the watchers are respawning their children now');
