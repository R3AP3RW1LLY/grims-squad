import { createConnection } from 'node:net';

/**
 * Refuses to build while the dev server is running.
 *
 * ★ THIS HAS BROKEN THE SITE TWICE — SQUADRON OWNER, 2026-08-03 ★
 *
 * "were getting an internal server error on localhost, lets fix this please so i can do a demo to
 * my project team please."
 *
 * `next build` and `next dev` write to the same `.next` directory. Run the build while dev is up
 * and dev's watcher sees a half-written tree: the site then throws
 *
 *     Cannot find module './6015.js'
 *     Require stack: .next/server/webpack-runtime.js
 *
 * on every route, and nothing about that message says what caused it or that deleting one directory
 * fixes it. The first time it cost an evening; the second time it took the site down an hour before
 * a demo.
 *
 * ★ WHY A PORT CHECK AND NOT A LOCK FILE ★
 *
 * A lock file has to be written on start and removed on exit, and a dev server killed with Ctrl-C
 * or by a crash leaves one behind — so the guard would then refuse builds for a server that is not
 * running, and somebody would learn to delete it without reading it. A listening socket cannot lie:
 * either something is answering on the port or it is not.
 *
 * ★ IT REFUSES RATHER THAN WAITING OR KILLING ★
 *
 * Killing somebody's dev server from a build script is a surprise, and waiting hides the problem
 * until the build times out. The message says what is running, why it matters, and the one command
 * that fixes it — `predev` already clears a production `.next`, so restarting dev is genuinely all
 * that is needed.
 */

const PORT = 5000;

/** True when something is already listening. Resolves fast either way — this runs before every build. */
function inUse(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    const done = (answer) => {
      socket.destroy();
      resolve(answer);
    };

    socket.setTimeout(400);
    socket.once('connect', () => done(true));
    // Refused, unreachable or slow to answer all mean "nothing is serving here".
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

if (await inUse(PORT)) {
  console.error(
    [
      '',
      `  Refusing to build: something is already serving on port ${PORT}.`,
      '',
      '  `next build` and `next dev` share the .next directory. Building while dev is running',
      '  leaves a half-written tree, and every route then fails with',
      '',
      "      Cannot find module './6015.js'",
      '',
      '  which says nothing about what caused it. This has taken the site down twice.',
      '',
      '  Stop the dev server and build again. Nothing else is needed — `predev` clears a',
      '  production .next on the way back in.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
