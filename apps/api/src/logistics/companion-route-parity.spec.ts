import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every call the companion app makes has a route to land on.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * "in the companion app under the new Where the squadron has bought it we get this error: Cannot
 * GET /v1/companion/colony/projects/17d1cdff-.../purchases"
 *
 * ★ WHAT HAPPENED, AND WHY NOTHING CAUGHT IT ★
 *
 * The shopping route shipped to both surfaces on the same day. The website's endpoint went on
 * `ColonyController` (`/v1/logistics/colony/...`); the companion talks to `ColonyDeviceController`
 * (`/v1/companion/colony/...`), which is a SEPARATE controller with its own routes, its own bearer
 * -token auth and its own `@Public()` decorator on every method.
 *
 * The client function was written. The IPC channel was wired. The renderer called it. Every one of
 * those has a test, and every one passed — because each end was correct. The only thing missing was
 * a route on the other side of the wire, which no unit test on either end can see. The first thing
 * that noticed was a member opening the tab.
 *
 * ★ SO THE TEST IS THE JOIN ITSELF ★
 *
 * A source scan of both files, matching what the client asks for against what the controller
 * answers. It is the same shape as `controller-injection.spec.ts` and for the same reason: some
 * facts live in the gap between two files, and only something that reads both can hold them.
 *
 * The owner has objected to this exact split twice — "ensure the Companion app matches and has all
 * the same pages in colonization that the website has please! must be a mirror!" — so a mirror that
 * silently loses a pane is worth a permanent guard rather than another apology.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, '..', '..', '..', 'companion', 'src', 'hub-colony.ts');
const CONTROLLER = join(HERE, 'colony-device.controller.ts');

const client = readFileSync(CLIENT, 'utf8');
const controller = readFileSync(CONTROLLER, 'utf8');

interface Call {
  readonly method: string;
  readonly path: string;
}

/** `/projects/${encodeURIComponent(id)}/purchases?x=1` → `/projects/:p/purchases`. */
function normalise(raw: string): string {
  return raw
    .replace(/\$\{[^}]*\}/g, ':p')
    .split('?')[0]
    ?.replace(/\/+$/, '') ?? '';
}

/**
 * Every `hubColony(call, <path>, { method })` in the app's colonisation client.
 *
 * The path literal is matched WITHOUT newlines in it, deliberately: a pattern allowed to span lines
 * runs past the end of its own call and swallows the next function whole, which produced two
 * imaginary missing routes the first time this was written by hand.
 */
function clientCalls(): Call[] {
  const found: Call[] = [];

  for (const m of client.matchAll(/hubColony\(\s*call\s*,\s*([`'"])([^`'"\n]*)\1/g)) {
    const path = normalise(m[2] ?? '');
    if (path === '') continue;

    /*
     * The options object belongs to THIS call, so the search window stops at the next `hubColony(`.
     * Without that bound a GET immediately following a POST inherits the POST's method.
     */
    const after = client.slice(m.index + m[0].length, m.index + m[0].length + 240);
    const method = /method:\s*'([A-Z]+)'/.exec(after.split('hubColony')[0] ?? '')?.[1] ?? 'GET';

    found.push({ method, path });
  }

  return found;
}

/** Every route the device controller answers, with its param names flattened. */
function deviceRoutes(): Call[] {
  const found: Call[] = [];

  for (const m of controller.matchAll(/@(Get|Post|Patch|Delete)\('([^']*)'\)/g)) {
    const path = `/${m[2] ?? ''}`.replace(/:[A-Za-z0-9_]+/g, ':p').replace(/\/+$/, '');
    found.push({ method: (m[1] ?? '').toUpperCase(), path: path === '' ? '/' : path });
  }

  return found;
}

const key = (c: Call): string => `${c.method} ${c.path}`;

describe('the companion app and the hub agree on what exists', () => {
  const calls = clientCalls();
  const routes = new Set(deviceRoutes().map(key));

  it('★ MANDATORY: every call the app makes has a route on the device controller ★', () => {
    /*
     * The bug, in one assertion. Before the fix this listed:
     *   GET  /v1/companion/colony/projects/:p/purchases
     *   POST /v1/companion/colony/projects/:p/purchases
     * and a member saw "Cannot GET" where the shopping route should have been.
     */
    const missing = [...new Set(calls.map(key))].filter((k) => !routes.has(k)).sort();

    expect(
      missing,
      'the app calls these and the hub answers 404 — add them to ' +
        'apps/api/src/logistics/colony-device.controller.ts (the WEBSITE controller is a different ' +
        'file and does not serve /v1/companion)',
    ).toEqual([]);
  });

  it('★ MANDATORY: the scan actually found the calls — a silent zero would pass everything ★', () => {
    /*
     * The failure mode that makes a scan like this worthless: somebody renames the client helper,
     * the pattern matches nothing, and "no missing routes" is reported about an empty list for ever.
     * There were 32 distinct calls the day this was written; the floor is deliberately well under
     * that so ordinary removals do not trip it, and far above zero.
     */
    expect(calls.length, 'the client scan matched nothing — the pattern has stopped working').
      toBeGreaterThan(20);
    expect(routes.size, 'the controller scan matched nothing').toBeGreaterThan(20);
  });

  it('★ MANDATORY: every device route is @Public(), or the app gets 401 instead of data ★', () => {
    /*
     * The other way this wire breaks, and it fails differently: the route EXISTS, so no parity check
     * on paths would notice, and the app gets "Sign in to continue" from a machine that has no
     * session and never will. These routes carry a paired-device bearer token and authenticate
     * themselves in `#caller`; the session guard has to be told to stand aside.
     */
    const lines = controller.split('\n');
    const unguarded: string[] = [];

    lines.forEach((line, i) => {
      const m = /^\s*@(Get|Post|Patch|Delete)\('([^']*)'\)/.exec(line);
      if (m === null) return;

      let hasPublic = false;
      for (let j = i - 1; j >= 0 && lines[j]?.trim().startsWith('@'); j -= 1) {
        if (lines[j]?.includes('@Public()') === true) hasPublic = true;
      }
      if (!hasPublic) unguarded.push(`${m[1]} ${m[2]}`);
    });

    expect(
      unguarded,
      'these device routes have no @Public(), so a paired app is told to sign in',
    ).toEqual([]);
  });
});
