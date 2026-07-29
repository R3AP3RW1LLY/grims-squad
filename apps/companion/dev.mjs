import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

/**
 * Runs the app locally.
 *
 * ★ WHY THIS EXISTS RATHER THAN `electron .` ★
 *
 * VS Code sets `ELECTRON_RUN_AS_NODE=1` in its integrated terminal — it uses
 * Electron for itself and its child processes inherit the variable. With it set,
 * the electron binary starts as PLAIN NODE: `require('electron')` returns the
 * path to the executable instead of the API, and the first line to touch `app`
 * dies with "Cannot read properties of undefined".
 *
 * Nothing about that error points at the cause, and it only happens inside the
 * editor — so it looks like the app is broken while `electron .` in a normal
 * terminal works fine. Stripping the variable here costs one file and removes
 * an afternoon of confusion.
 */

const env = { ...process.env };
delete env['ELECTRON_RUN_AS_NODE'];

// Point at a local API unless told otherwise. The packaged app has no UI for
// this on purpose — see apiBaseUrlFor.
env['GRIMS_API_URL'] ??= 'http://localhost:5001';

const electron = createRequire(import.meta.url)('electron');

spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env }).on('exit', (code) =>
  process.exit(code ?? 0),
);
