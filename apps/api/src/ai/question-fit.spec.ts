import { describe, it, expect } from 'vitest';
import { planFor, budgetIn } from './question.js';

/**
 * Routing a question to the fitting engine.
 *
 * ★ SQUADRON OWNER ★
 *
 * "we want this to be promptable and answered in the Ask GDSM AI."
 *
 * ★ WHAT THIS FILE IS GUARDING AGAINST ★
 *
 * Two failures, and they pull in opposite directions.
 *
 * A MISS costs an answer: "what should I buy for mining with 50 million" falls through to the
 * semantic leg, which finds prose about mining and lets the model answer around the budget.
 *
 * A FALSE POSITIVE is worse. "Where do I sell mining cargo" contains "mining", and fitting a ship
 * for it would answer a question nobody asked — with a ship recommendation, in the middle of a
 * trading answer, which reads as the assistant not having understood at all.
 */

const SHIPS = [
  { id: 'python', name: 'Python' },
  { id: 'python_nx', name: 'Python Mk II' },
  { id: 'type_9_heavy', name: 'Type-9 Heavy' },
  { id: 'anaconda', name: 'Anaconda' },
  { id: 'krait_mkii', name: 'Krait Mk II' },
];

const plan = (q: string) => planFor(q, ['Painite', 'Low Temperature Diamonds', 'Gold'], SHIPS);

describe('recognising a build question', () => {
  it('routes the question the Shipyard was built to answer', () => {
    const p = plan('what should I buy for mining with 50 million?');

    expect(p.fit).not.toBeNull();
    expect(p.fit?.role).toBe('mining');
    expect(p.fit?.budget).toBe(50_000_000);
    expect(p.fit?.shipId).toBeNull();
  });

  it('reads each role from the words people actually use', () => {
    const cases: ReadonlyArray<[string, string]> = [
      ['best ship for mining', 'mining'],
      ['what should I fly for bounty hunting', 'combat'],
      ['recommend a ship for conflict zones', 'combat'],
      ['what ship for exploration', 'explorer'],
      ['best long-range build', 'explorer'],
      ['which ship should I buy for trading', 'trader'],
      ['recommend a hauler build', 'trader'],
    ];

    for (const [q, role] of cases) {
      expect(plan(q).fit?.role, q).toBe(role);
    }
  });

  it('picks up a named hull, longest name first', () => {
    // "Python Mk II" contains "Python". Matching the shorter one fits a different ship from the one
    // that was asked about — the same trap the commodity matcher avoids the same way.
    expect(plan('fit my Python Mk II for trading').fit?.shipId).toBe('python_nx');
    expect(plan('fit my Python for trading').fit?.shipId).toBe('python');
    expect(plan('best combat loadout for a Krait Mk II').fit?.shipId).toBe('krait_mkii');
  });

  it('MANDATORY: does not fire on a market question that mentions a role', () => {
    /*
     * The false positive this file exists for. Every one of these is about prices or places and
     * would be answered with a ship recommendation if a role word alone were enough.
     */
    for (const q of [
      'where do I sell mining cargo',
      'best place to sell Painite from mining',
      'where can I buy Gold for trading',
      'which stations near Deciat buy Low Temperature Diamonds',
      'what is the trade route from Sol',
    ]) {
      expect(plan(q).fit, q).toBeNull();
    }
  });

  it('needs a role at all', () => {
    // No job named, nothing to fit for. "What ship should I buy" alone is not answerable by the
    // fitter, which scores hulls against a role.
    expect(plan('what ship should I buy').fit).toBeNull();
    expect(plan('build me something with 100 million').fit).toBeNull();
  });

  it('treats a budget or a named hull as intent on its own', () => {
    // Neither says "build" or "recommend", and both are unambiguously asking for one.
    expect(plan('mining, 200 million').fit?.role).toBe('mining');
    expect(plan('Anaconda for exploration').fit?.shipId).toBe('anaconda');
  });

  it('leaves every other leg working', () => {
    // The fit leg is ADDED, never a replacement. A question can be both.
    const p = plan('best mining ship, and where do I sell Painite');

    expect(p.fit?.role).toBe('mining');
    expect(p.market?.commodity).toBe('Painite');
    expect(p.semantic).toBe(true);
  });
});

describe('reading a budget', () => {
  it('understands the shapes people write', () => {
    expect(budgetIn('50 million')).toBe(50_000_000);
    expect(budgetIn('50m')).toBe(50_000_000);
    expect(budgetIn('250 mil')).toBe(250_000_000);
    expect(budgetIn('1.5 billion')).toBe(1_500_000_000);
    expect(budgetIn('2b')).toBe(2_000_000_000);
    expect(budgetIn('200,000,000')).toBe(200_000_000);
    expect(budgetIn('85000000 credits')).toBe(85_000_000);
  });

  it('MANDATORY: does not read a small bare number as credits', () => {
    /*
     * "Type 9" and "4 pips" both contain digits. Reading either as a budget produces a
     * recommendation for four credits, and the fitter would correctly report that nothing can be
     * fitted for it — an answer that is both useless and confusing.
     */
    expect(budgetIn('a Type 9 for trading')).toBeNull();
    expect(budgetIn('4 pips to systems')).toBeNull();
    expect(budgetIn('class 6 shield generator')).toBeNull();
  });

  it('refuses a figure nobody has', () => {
    // A typo, not a budget. Better to fall through to no budget than to promise the galaxy.
    expect(budgetIn('1000 billion')).toBeNull();
  });
});
