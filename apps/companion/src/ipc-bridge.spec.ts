import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every IPC handler has a way for the window to actually call it.
 *
 * ★ THE FAILURE THIS EXISTS FOR ★
 *
 * A route was added to the API, a client function to `hub-colony.ts`, a handler to `main.ts` — and
 * no entry in `preload.ts`. The renderer can only reach what the preload bridge exposes, so the
 * feature was complete on both sides and connected on neither. Four freight filters shipped that
 * way and were silently ignored for two days; nothing errored, the app simply behaved as though
 * those controls did not exist.
 *
 * It is the same shape as the other two found in this codebase: `enrichStationFromDock` with no
 * caller, and an N+1 with no measurement. The code was right and nothing joined it up.
 *
 * ★ WHY BOTH DIRECTIONS ★
 *
 * A handler with no bridge entry is dead code the renderer cannot reach. A bridge entry with no
 * handler is worse — `ipcRenderer.invoke` on an unregistered channel REJECTS at runtime, so the
 * button throws when somebody presses it, which is a bug that only appears in the hands of a member.
 *
 * ★ SOURCE TEXT, BECAUSE NEITHER FILE CAN BE IMPORTED ★
 *
 * `main.ts` and `preload.ts` both require Electron's runtime. Reading them as text is crude and
 * catches exactly the mistake that has happened: a channel named in one file and not the other.
 */

const read = (name: string): string =>
  readFileSync(join(process.cwd(), 'src', name), 'utf8');

/** Channels `main.ts` registers. */
function handled(): string[] {
  return [...read('main.ts').matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((m) => m[1] ?? '');
}

/** Channels `preload.ts` exposes to the window. */
function invoked(): string[] {
  return [...read('preload.ts').matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((m) => m[1] ?? '');
}

describe('the IPC bridge is joined up at both ends', () => {
  it('found the channels to check', () => {
    // If a refactor moves either file, this guard must fail rather than quietly protect nothing.
    expect(handled().length).toBeGreaterThan(50);
    expect(invoked().length).toBeGreaterThan(50);
  });

  it('★ MANDATORY: every handler is reachable from the window ★', () => {
    const bridge = new Set(invoked());
    const unreachable = handled().filter((c) => !bridge.has(c));

    expect(
      unreachable,
      'These channels are handled in main.ts but not exposed in preload.ts, so the renderer cannot ' +
        'call them. The feature will look finished and do nothing — which is how four freight ' +
        'filters were silently ignored for two days.\n\n' +
        unreachable.join('\n'),
    ).toEqual([]);
  });

  it('★ MANDATORY: nothing on the bridge calls a channel that does not exist ★', () => {
    const registered = new Set(handled());
    const ghosts = invoked().filter((c) => !registered.has(c));

    expect(
      ghosts,
      'These channels are exposed in preload.ts with no handler in main.ts. `invoke` on an ' +
        'unregistered channel rejects at runtime, so this throws in a member’s hands rather ' +
        'than failing here.\n\n' +
        ghosts.join('\n'),
    ).toEqual([]);
  });

  it('MANDATORY: no channel is registered twice', () => {
    /*
     * `ipcMain.handle` on a channel that already has a handler THROWS at startup — the app would
     * not open. Cheap to check here, and the failure mode is total.
     */
    const seen = new Set<string>();
    const duplicates = handled().filter((c) => (seen.has(c) ? true : (seen.add(c), false)));
    expect(duplicates, `registered more than once: ${duplicates.join(', ')}`).toEqual([]);
  });
});
