import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A carrier snapshot is never silently thrown away.
 *
 * ★ SQUADRON OWNER, 2026-08-16 ★
 *
 * "materials being added to fleet carriers and in player holds are not registering properly"
 *
 * ★ THE DROP ★
 *
 * `journalSnapshot` used to check whether the carrier was attached to any build and, if it was not,
 * `return { stored: false }` — discarding the whole snapshot. No error, no message, nothing written.
 * A member transferred eight hundred tonnes, the app pushed it, the hub dropped it, and the board
 * went on showing nothing with no way for anybody to find out why.
 *
 * The owner's instruction was to keep it and offer to attach. So the row is stored either way, and
 * the caller is told which live builds actually want what is aboard — enough to ask, without
 * attaching anybody's private carrier to a squadron board on its own.
 *
 * Asserted on the source because the failure was a `return` statement, and a test that stood the
 * whole service up would be testing Prisma rather than the decision.
 */

const SRC = readFileSync(
  join(process.cwd(), 'src/logistics/colony-carrier.service.ts'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

describe('an unattached carrier', () => {
  it('★ MANDATORY: its snapshot is NOT discarded ★', () => {
    /*
     * The exact statement that caused it. Comments are stripped above, so this reads the code and
     * not the paragraph explaining the history — a trap that has caught three of my tests today.
     */
    const method = SRC.slice(SRC.indexOf('async journalSnapshot'));

    expect(
      method,
      'returning early on a missing attachment is the drop this exists to prevent',
    ).not.toMatch(/if \(attached === undefined\) return/);
  });

  it('★ MANDATORY: the caller is told it is unattached ★', () => {
    // Storing silently would be no better than dropping silently: the member still gets no prompt,
    // and the tonnage sits in a table nobody surfaces.
    expect(SRC).toContain('attached: attached !== undefined');
  });

  it('★ MANDATORY: and told WHICH commodities a live build wants ★', () => {
    /*
     * What turns "your carrier is not attached" into something worth acting on. Computed rather than
     * assumed, so an unattached carrier full of Painite prompts nothing at all.
     */
    expect(SRC).toContain('JOIN colony_needs n ON lower(n.commodity) = lower(g.commodity)');
    expect(SRC, 'a finished or abandoned build must not prompt').toContain(
      'p.completed_at IS NULL AND p.abandoned_at IS NULL',
    );
  });

  it('MANDATORY: an EMPTY push is still distinguished from an unattached one', () => {
    // Nothing to record is a different answer from "we recorded it but nobody has claimed this
    // carrier". Collapsing them would lose the prompt.
    expect(SRC).toContain('rows.length === 0 && total === null');
  });
});
