import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The app hides Delete for the same reason the hub refuses it.
 *
 * ★ TWO GATES ON ONE ACTION, ASKING DIFFERENT QUESTIONS — AUDIT, 2026-08-18 ★
 *
 * The hub refuses to delete a build somebody has HAULED to: "People have already hauled to this
 * build, and deleting it would erase their deliveries. Close it instead."
 *
 * The app hid the button when `required === 0` — whether the SITE had ever reported a depot. Those
 * are different builds. Post a duplicate, or one in the wrong system, wait for the site to report
 * what it wants, and `required` stops being zero while nobody has hauled a tonne. The hub would
 * delete it; the app hid the button, leaving a member with a build they created, are allowed to
 * remove, and cannot.
 *
 * A UI gate is allowed to be STRICTER than the server only when that is a deliberate policy with a
 * reason written down. This one was an accident: the two rules were written months apart from the
 * same intention and drifted.
 */

const APP = readFileSync(
  join(process.cwd(), 'src', 'renderer', 'colonisation.tsx'),
  'utf8',
);
const SERVICE = readFileSync(
  join(process.cwd(), '..', 'api', 'src', 'logistics', 'colony.service.ts'),
  'utf8',
);


/**
 * The condition guarding the Delete control.
 *
 * ★ ANCHORED ON THE CONTROL, NOT ON THE FIRST `mayDirect` ★
 *
 * The first draft sliced from `APP.indexOf('mayDirect &&')`, which lands on an unrelated permission
 * check hundreds of lines earlier — so the assertion inspected the wrong code and failed for a
 * reason that had nothing to do with the rule. Same wrong-anchor mistake that has quietly made
 * several assertions in this repo protect nothing; here it failed loudly, which is the lucky case.
 *
 * `window.colony.remove(` appears exactly once, so the region above it is the gate.
 */
function deleteGate(): string {
  const call = APP.indexOf('window.colony.remove(');
  expect(call, 'the Delete control is still here').toBeGreaterThan(-1);
  return APP.slice(Math.max(0, call - 700), call);
}

describe('the Delete button and the rule behind it', () => {
  it('found both gates, so this cannot pass by matching nothing', () => {
    expect(SERVICE, 'the hub still refuses on deliveries').toContain('colony_contributions');
    expect(APP, 'the app still draws a Delete control').toContain('window.colony.remove(');
  });

  it('★ MANDATORY: the hub refuses on DELIVERIES, so the app hides on deliveries ★', () => {
    const refusal = SERVICE.slice(SERVICE.indexOf('async remove('));
    expect(
      refusal.slice(0, 900),
      'the hub counts contributions, not needs',
    ).toContain('FROM colony_contributions');

    /*
     * `lastDeliveryAt` is null exactly when nobody has hauled — the hub's question, asked with a
     * fact the board already carries, so the app needs no extra round trip to agree.
     */
    expect(deleteGate(), 'the app asks the same question').toContain('lastDeliveryAt');
  });

  it('★ MANDATORY: it no longer gates on what the SITE reported ★', () => {
    /*
     * `required` is about the depot, not about anybody's hauling. Its return here would be this
     * exact bug coming back — and it would look reasonable, which is why it is named.
     */
    expect(deleteGate()).not.toContain('project.required === 0');
  });
});
