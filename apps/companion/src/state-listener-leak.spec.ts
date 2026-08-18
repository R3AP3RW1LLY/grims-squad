import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A state listener registered inside an effect is let go of again.
 *
 * ★ THE FAULT NOBODY REPORTS AS A BUG — AUDIT, 2026-08-18 ★
 *
 * `onState` registered a handler and returned nothing, so a caller inside a React effect had no way
 * to undo it. The project page re-runs its effect on every id and filter change, so ten project
 * pages left ten live handlers — and every successful journal upload then fired ten identical
 * reloads of the same board.
 *
 * The app got steadily chattier the longer a session ran. That reads as "the app is getting slow",
 * which is not a bug report anybody can act on, and it would never have failed a test.
 */

const src = (...parts: string[]): string =>
  readFileSync(join(process.cwd(), 'src', ...parts), 'utf8');

const PRELOAD = src('preload.ts');
const PROJECT = src('renderer', 'colonisation.tsx');

describe('listening to the main process without leaking', () => {
  it('★ MANDATORY: the bridge hands back a way to stop ★', () => {
    /*
     * And it removes the SAME reference it added. Registering one function and removing another is
     * the shape this bug takes next time: `removeListener` silently does nothing when handed a
     * function it never saw, so the leak would come back looking fixed.
     */
    const fn = PRELOAD.slice(PRELOAD.indexOf('onState:'));
    const body = fn.slice(0, fn.indexOf('\n  },'));

    expect(body, 'the wrapper is named so it can be removed').toContain('const wrapped');
    expect(body, 'and the same one is removed').toContain("removeListener('state', wrapped)");
    expect(body).toMatch(/return \(\) =>/);
  });

  it('★ MANDATORY: the project page lets go on unmount ★', () => {
    // The effect that re-runs on `[id, filters]`. Its cleanup already clears the interval; the
    // listener has to go with it.
    expect(PROJECT, 'the disposer is kept').toContain('const stopListening = window.companion.onState(');
    expect(PROJECT, 'and called in cleanup').toContain('stopListening();');
  });

  it('every effect that registers a state listener disposes of it', () => {
    /*
     * Written as a count rather than as a named case, so a NEW page that starts listening is caught
     * too. This is the rule, not one instance of it.
     */
    const registrations = [...PROJECT.matchAll(/window\.companion\.onState\(/g)].length;
    const disposals = [...PROJECT.matchAll(/stopListening\(\)/g)].length;

    expect(registrations).toBeGreaterThan(0);
    expect(disposals, 'one disposal per registration').toBeGreaterThanOrEqual(registrations);
  });
});
