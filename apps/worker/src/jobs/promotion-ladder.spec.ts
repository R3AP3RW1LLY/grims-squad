import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLadderFromSsot } from './promotion-run.wiring.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * The ladder the engine runs on must be THE ladder in the SSOT.
 *
 * Reading it from the document rather than restating it in code is the only way
 * those two cannot disagree. This spec proves the reader actually works — a
 * parser that silently returned a shorter list would make the engine skip ranks
 * without anything failing.
 */
describe('ladder read from ssot/02-domain/rank-progression.yaml', () => {
  const ladder = readLadderFromSsot(REPO);

  it('reproduces all ten rungs in order', () => {
    expect(ladder.map((r) => r.rank)).toEqual([
      'Cadet',
      'Sergeant',
      'Master Sergeant',
      '2nd Lieutenant',
      '1st Lieutenant',
      'Commander',
      'Master Commander',
      'General',
      'Lord General',
      'Grand Master General',
    ]);
  });

  it('MANDATORY: preserves the deliberate 2 and 3 month gaps', () => {
    // These are a human decision, not an oversight: there is no 8-, 10- or
    // 11-month rank. A parser that defaulted a missing value to 1 would erase
    // them and promote people five months early over the course of a year.
    const months = Object.fromEntries(ladder.map((r) => [r.rank, r.qualifyingMonthsRequired]));
    expect(months['General']).toBe(2);
    expect(months['Lord General']).toBe(3);
    expect(months['Cadet']).toBe(1);
  });

  it('the top of the ladder terminates rather than looping', () => {
    const top = ladder.at(-1);
    expect(top?.next).toBeNull();
    expect(top?.qualifyingMonthsRequired).toBeNull();
  });

  it('every `next` names a rank that exists', () => {
    // A typo here would silently strand everyone at that rung forever.
    const names = new Set(ladder.map((r) => r.rank));
    for (const r of ladder) {
      if (r.next !== null) expect(names.has(r.next), `${r.rank} -> ${r.next}`).toBe(true);
    }
  });

  it('cumulative months reach 12, matching the rank names', () => {
    const total = ladder.reduce((n, r) => n + (r.qualifyingMonthsRequired ?? 0), 0);
    expect(total).toBe(12);
  });
});
