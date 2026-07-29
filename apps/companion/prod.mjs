import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

/**
 * Runs the app against the REAL hub.
 *
 * ★ WHY THIS EXISTS SEPARATELY FROM dev.mjs ★
 *
 * `dev.mjs` force-sets `GRIMS_API_URL=http://localhost:5001`, which is correct
 * while developing and quietly wrong the moment you want to test for real:
 * every session goes to a local database, production stays empty, and the app
 * looks like it is working the whole time.
 *
 * Worse, a device token minted on the PRODUCTION website does not exist in the
 * local database, so the app answers "This device is no longer paired" — which
 * reads as a broken token and is really a broken destination.
 *
 * This one deliberately sets NOTHING. With no override the app falls back to
 * `config.apiBaseUrl`, which is the production hub.
 */

const env = { ...process.env };

/*
 * The one thing this shares with dev.mjs, and it is not optional.
 *
 * VS Code sets ELECTRON_RUN_AS_NODE=1 in its integrated terminal — it uses
 * Electron for itself and child processes inherit the variable. With it set the
 * electron binary starts as PLAIN NODE: `require('electron')` returns a path
 * instead of the API, and the first line to touch `app` dies with "Cannot read
 * properties of undefined". Nothing in that error points at the cause, and it
 * only happens inside the editor.
 */
delete env['ELECTRON_RUN_AS_NODE'];

/*
 * NOT set here — see above. Left in place if the caller exported one on
 * purpose, so `GRIMS_API_URL=… pnpm start:prod` still works for a staging box.
 */
if (env['GRIMS_API_URL'] !== undefined) {
  console.error(`Using GRIMS_API_URL from the environment: ${env['GRIMS_API_URL']}`);
} else {
  console.error('Using the hub address from companion-config.json.');
}

const electron = createRequire(import.meta.url)('electron');

spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env }).on('exit', (code) =>
  process.exit(code ?? 0),
);
