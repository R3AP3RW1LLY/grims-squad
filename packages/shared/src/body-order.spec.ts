import { describe, expect, it } from 'vitest';
import { compareBodyNames, sortBodiesByName } from './body-order.js';

/**
 * How a system map orders bodies.
 *
 * ★ SQUADRON OWNER, 2026-08-07 ★
 *
 * "in the planner in the colonization module, all the sub planets are not appearing alphabetically,
 * and it looks really bad!"
 *
 * ★ PLAIN STRING SORTING IS THE BUG, NOT THE FIX ★
 *
 * Body names carry numbers, and `'B 10' < 'B 2'` is true for a string comparison and wrong for a
 * commander reading a system map. Every ordering here is the one the game's own navigation panel
 * uses: numbers as numbers, letters as letters.
 */

describe('ordering bodies the way a system map does', () => {
  it('MANDATORY: puts 2 before 10, which a string sort does not', () => {
    const out = sortBodiesByName(['B 10', 'B 2', 'B 1']);
    expect(out).toEqual(['B 1', 'B 2', 'B 10']);
  });

  it('keeps a moon with its planet rather than sorting it away', () => {
    // 'A 1 a' belongs directly under 'A 1', and both come before 'A 2'.
    const out = sortBodiesByName(['A 2', 'A 1 b', 'A 1', 'A 1 a']);
    expect(out).toEqual(['A 1', 'A 1 a', 'A 1 b', 'A 2']);
  });

  it('orders the star clusters A then B', () => {
    const out = sortBodiesByName(['B 1', 'A 4', 'A 1', 'B']);
    expect(out).toEqual(['A 1', 'A 4', 'B', 'B 1']);
  });

  it('handles the real system, moons and all', () => {
    const out = sortBodiesByName([
      'B 8 b',
      'A 10',
      'A 2 e',
      'A 1',
      'B 8',
      'A 2 a',
      'A 2',
      'B 10',
      'A 1 f',
      'B 8 a',
    ]);

    expect(out).toEqual([
      'A 1',
      'A 1 f',
      'A 2',
      'A 2 a',
      'A 2 e',
      'A 10',
      'B 8',
      'B 8 a',
      'B 8 b',
      'B 10',
    ]);
  });

  it('strips a shared system prefix so the comparison is about the body', () => {
    /*
     * EDSM returns fully-qualified names. Comparing those works by accident while the prefix is
     * identical and breaks the moment one body is named differently — a ring or a belt cluster.
     */
    const out = sortBodiesByName([
      'Col 285 Sector GL-W c2-12 B 10',
      'Col 285 Sector GL-W c2-12 B 2',
      'Col 285 Sector GL-W c2-12 A 1',
    ]);

    expect(out).toEqual([
      'Col 285 Sector GL-W c2-12 A 1',
      'Col 285 Sector GL-W c2-12 B 2',
      'Col 285 Sector GL-W c2-12 B 10',
    ]);
  });

  it('is a total order, so a sort cannot be unstable or throw', () => {
    // Equal names compare equal in both directions; that is what a comparator contract requires.
    expect(compareBodyNames('A 1', 'A 1')).toBe(0);
    expect(Math.sign(compareBodyNames('A 1', 'A 2'))).toBe(-1);
    expect(Math.sign(compareBodyNames('A 2', 'A 1'))).toBe(1);
  });

  it('does not fall over on the odd names real data contains', () => {
    // Belt clusters, rings and unnamed bodies all turn up in EDSM payloads.
    const out = sortBodiesByName(['', 'A 1 Ring', 'A Belt Cluster 1', 'A 1']);
    expect(out).toHaveLength(4);
    expect(out[0]).toBe('');
  });

  it('sorts objects by a chosen field, not just bare strings', () => {
    const bodies = [
      { name: 'B 10', id: 1 },
      { name: 'B 2', id: 2 },
    ];
    const out = [...bodies].sort((a, b) => compareBodyNames(a.name, b.name));
    expect(out.map((b) => b.id)).toEqual([2, 1]);
  });
});
