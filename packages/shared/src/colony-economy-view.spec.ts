import { describe, expect, it } from 'vitest';
import { selfSufficiency, systemTrade, type TradeSite } from './colony-economy-view.js';

/**
 * What a whole system will trade, and how much of its own bill it covers.
 *
 * ★ SQUADRON OWNER, 2026-08-11 ★
 *
 * "a section on what our system will produce ... make this section all about our economy and an
 * indepth view on everything about it"
 *
 * ★ AGGREGATION, NOT PREDICTION ★
 *
 * `predictMarket` has produced these lines since the planner shipped — each already carrying major
 * or minor AND which economy put it there — and they only ever rendered as chips under individual
 * sites. Nothing asked what the SYSTEM trades. So nothing here models anything new, and these tests
 * are about the gathering: what wins a disagreement, what must not be lost, and what the count
 * alone would hide.
 */

const site = (siteId: string, exports: string[][], imports: string[][] = []): TradeSite => ({
  siteId,
  market: {
    exports: exports.map(([commodity, strength, from]) => ({
      commodity: commodity as string,
      side: 'exports' as const,
      strength: (strength ?? 'major') as 'major' | 'minor',
      fromEconomy: (from ?? 'refinery') as string,
    })),
    imports: imports.map(([commodity, strength, from]) => ({
      commodity: commodity as string,
      side: 'imports' as const,
      strength: (strength ?? 'major') as 'major' | 'minor',
      fromEconomy: (from ?? 'refinery') as string,
    })),
    note: '',
  },
});

describe('what the whole system trades', () => {
  it('★ MANDATORY: one commodity from several stations is ONE line, not three ★', () => {
    /*
     * The rollup's whole job. Three refinery hubs all selling Steel is a system that sells Steel —
     * printing it three times says nothing and buries everything else.
     */
    const out = systemTrade([
      site('a', [['Steel', 'major', 'refinery']]),
      site('b', [['Steel', 'major', 'refinery']]),
      site('c', [['Steel', 'minor', 'extraction']]),
    ]);

    expect(out.sells).toHaveLength(1);
    expect(out.sells[0]?.commodity).toBe('Steel');
    expect(out.sells[0]?.siteIds, 'which stations sell it is the answer to "where do I go"').
      toEqual(['a', 'b', 'c']);
  });

  it('★ MANDATORY: major anywhere beats minor everywhere ★', () => {
    /*
     * A commodity one station sells heavily IS a system export, whatever a second station's weaker
     * claim says. Taking the last value seen would make the answer depend on site order.
     */
    const out = systemTrade([
      site('a', [['Steel', 'minor', 'colony']]),
      site('b', [['Steel', 'major', 'refinery']]),
    ]);
    expect(out.sells[0]?.strength).toBe('major');

    // And the other way round, so it is the RULE and not the ordering.
    const flipped = systemTrade([
      site('a', [['Steel', 'major', 'refinery']]),
      site('b', [['Steel', 'minor', 'colony']]),
    ]);
    expect(flipped.sells[0]?.strength).toBe('major');
  });

  it('★ MANDATORY: every economy that caused a line is kept ★', () => {
    /*
     * `fromEconomy` is the audit trail for a single row of the market — the answer to "why does my
     * system sell that". Collapsing to one economy would throw away the only explanation there is.
     */
    const out = systemTrade([
      site('a', [['Steel', 'major', 'refinery']]),
      site('b', [['Steel', 'minor', 'extraction']]),
    ]);
    expect(out.sells[0]?.economies).toEqual(['extraction', 'refinery']);
  });

  it('★ MANDATORY: a commodity both sold AND bought is named, not silently dropped ★', () => {
    /*
     * Not a contradiction — one station exports what another imports, which is a system feeding
     * itself. It is the single most useful thing on the page and reads as a bug if unexplained.
     */
    const out = systemTrade([
      site('a', [['Steel', 'major', 'refinery']], []),
      site('b', [], [['Steel', 'major', 'industrial']]),
    ]);

    expect(out.internal).toEqual(['Steel']);
    expect(out.sells.map((s) => s.commodity)).toContain('Steel');
    expect(out.buys.map((b) => b.commodity)).toContain('Steel');
  });

  it('MANDATORY: majors lead, then whatever the most stations trade', () => {
    const out = systemTrade([
      site('a', [
        ['Copper', 'minor', 'refinery'],
        ['Steel', 'major', 'refinery'],
      ]),
      site('b', [['Copper', 'minor', 'refinery']]),
    ]);
    expect(out.sells.map((s) => s.commodity)).toEqual(['Steel', 'Copper']);
  });

  it('MANDATORY: the order is stable — two readings of one plan agree', () => {
    const sites = [site('a', [['Titanium', 'major'], ['Steel', 'major']])];
    expect(systemTrade(sites).sells.map((s) => s.commodity)).toEqual(
      systemTrade(sites).sells.map((s) => s.commodity),
    );
  });

  it('a system with nothing planned trades nothing, and does not throw', () => {
    const out = systemTrade([]);
    expect(out.sells).toEqual([]);
    expect(out.buys).toEqual([]);
    expect(out.internal).toEqual([]);
  });
});

describe('how much of its own bill the system covers', () => {
  const sells = systemTrade([
    site('a', [
      ['Steel', 'major', 'refinery'],
      ['Aluminium', 'major', 'refinery'],
      ['Titanium', 'minor', 'extraction'],
    ]),
  ]).sells;

  it('★ MANDATORY: it answers in TONNES, not in how many commodities ★', () => {
    /*
     * "4 of 17 materials" sounds meagre. "141,600 t of 257,000 t outstanding" is the same fact and
     * the opposite conclusion — the plan paying for itself. A count alone hides which four.
     */
    const out = selfSufficiency(sells, [
      { commodity: 'Steel', remaining: 68_200 },
      { commodity: 'Aluminium', remaining: 41_900 },
      { commodity: 'Titanium', remaining: 22_400 },
      { commodity: 'CMM Composite', remaining: 9_100 },
      { commodity: 'Semiconductors', remaining: 900 },
    ]);

    expect(out.covered.map((c) => c.commodity)).toEqual(['Steel', 'Aluminium', 'Titanium']);
    expect(out.coveredTonnes).toBe(132_500);
    expect(out.outstandingTonnes).toBe(142_500);
    expect(out.pctCovered).toBe(93);
  });

  it('★ MANDATORY: what it will NOT produce is listed too ★', () => {
    /*
     * The half that decides the evening. A member reading only what the system covers still has to
     * find out the hard way that CMM Composite is coming in by hand for the rest of the build.
     */
    const out = selfSufficiency(sells, [
      { commodity: 'Steel', remaining: 100 },
      { commodity: 'CMM Composite', remaining: 9_100 },
    ]);
    expect(out.notCovered.map((c) => c.commodity)).toEqual(['CMM Composite']);
  });

  it('MANDATORY: matching ignores case, because two sources spell them differently', () => {
    // The journal says `steel` for exactly the commodities whose symbol is the plain word; the
    // catalogue says `Steel`. A case-sensitive match would report a covered material as missing.
    const out = selfSufficiency(sells, [{ commodity: 'steel', remaining: 500 }]);
    expect(out.covered).toHaveLength(1);
    expect(out.pctCovered).toBe(100);
  });

  it('MANDATORY: biggest outstanding first, on both lists', () => {
    const out = selfSufficiency(sells, [
      { commodity: 'Titanium', remaining: 10 },
      { commodity: 'Steel', remaining: 9_000 },
      { commodity: 'CMM Composite', remaining: 40 },
      { commodity: 'Water', remaining: 4_000 },
    ]);
    expect(out.covered.map((c) => c.commodity)).toEqual(['Steel', 'Titanium']);
    expect(out.notCovered.map((c) => c.commodity)).toEqual(['Water', 'CMM Composite']);
  });

  it('a finished build is not 0% self-sufficient — it is finished', () => {
    // Null, not zero. Zero would read as "this system supplies none of what you need".
    expect(selfSufficiency(sells, []).pctCovered).toBeNull();
  });
});
