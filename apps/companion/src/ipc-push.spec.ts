import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every handler that changes saved state tells the window about it.
 *
 * ★ SQUADRON OWNER, 2026-08-03 ★
 *
 * "my companion app is not paired, we need this fixed — nothing happens when i click unpair device."
 *
 * It DID work. `unpair` cleared the token, wrote it to disk and stopped the poll, and never called
 * `push()` — so the page went on saying "Paired as …" over a config with no token in it. The member
 * pressed a button that appeared dead, and found out only on the next restart that they had been
 * unpaired the whole time. `setEnabled` had the identical omission.
 *
 * ★ WHY THIS IS A SOURCE-TEXT TEST ★
 *
 * `main.ts` imports Electron and cannot be unit tested — which is exactly why the rule it has to
 * follow is unwritten and gets forgotten. Reading the file as text is crude and catches precisely
 * the mistake that happened twice: a handler that mutates and does not announce.
 *
 * It is deliberately narrow. It says nothing about WHAT a handler does, only that one which writes
 * the config also refreshes the page — so it cannot fail for a reason that is not this one.
 */

const MAIN = readFileSync(join(process.cwd(), 'src', 'main.ts'), 'utf8');

/** Slices out each `ipcMain.handle('name', … )` body by brace depth. */
function handlers(): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const opener = /ipcMain\.handle\(\s*'([^']+)'/g;

  for (const match of MAIN.matchAll(opener)) {
    const name = match[1] ?? '';
    let depth = 0;
    let i = MAIN.indexOf('(', match.index ?? 0);
    const start = i;

    for (; i < MAIN.length; i += 1) {
      const c = MAIN[i];
      if (c === '(') depth += 1;
      else if (c === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push({ name, body: MAIN.slice(start, i + 1) });
  }

  return out;
}

/*
 * Handlers that write the config and legitimately do NOT push, with the reason.
 *
 * An allow-list rather than a looser rule: "these two are exempt because X" is a decision somebody
 * made, and a rule vague enough to let them through would let the next mistake through too.
 */
const EXEMPT = new Map<string, string>([
  // Its whole job is to reach the settings, which then push on their own once applied.
  ['setOverlays', 'push() is called by the overlay runtime after the layout is applied'],
]);

describe('IPC handlers that change saved state', () => {
  it('finds the handlers at all', () => {
    // Guards the parser. If this test ever stops finding handlers it would pass vacuously and the
    // real rule below would silently stop being checked.
    const found = handlers();
    expect(found.length).toBeGreaterThan(10);
    expect(found.map((h) => h.name)).toContain('unpair');
  });

  it('every handler that saves the config also refreshes the window', () => {
    const offenders = handlers()
      .filter((h) => /saveConfig\(/.test(h.body))
      .filter((h) => !/\bpush\(\)/.test(h.body))
      .filter((h) => !EXEMPT.has(h.name))
      .map((h) => h.name);

    /*
     * `unpair` and `setEnabled` were both here. A member pressing either got a control that did
     * nothing visible while quietly changing something that mattered.
     */
    expect(offenders).toEqual([]);
  });

  it('every handler that stops or starts the poll refreshes the window', () => {
    // The status line reads straight off the poll. Starting or stopping it without saying so leaves
    // the page describing a state the app is no longer in.
    const offenders = handlers()
      .filter((h) => /\b(startPolling|stopPolling)\(/.test(h.body))
      .filter((h) => !/\bpush\(\)/.test(h.body))
      .filter((h) => !EXEMPT.has(h.name))
      .map((h) => h.name);

    expect(offenders).toEqual([]);
  });
});
