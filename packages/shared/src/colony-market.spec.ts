import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ECONOMIES, type Economy, type EconomyScores, type SiteEconomy } from './colony-economy.js';
import {
  ECONOMY_MARKETS,
  MAJOR_FRACTION,
  MARKET_COMMODITIES,
  marketScale,
  predictMarket,
  type MarketStationType,
} from './colony-market.js';

/**
 * What the predicted market must get right.
 *
 * ★ WHAT IS BEING PROVED ★
 *
 * Three things, in order of how expensive they would be to get wrong on a live page:
 *
 *   1. THE NAMES ARE REAL. A predicted market whose 'Advanced Catalysers' is spelled differently
 *      from the colonisation catalogue would look like two commodities to a member holding one.
 *      Every name that also appears in packages/db/src/colony-build-seed.json must be
 *      byte-identical to it — that seed is the one static display-name list in the repo.
 *   2. THE BLEND IS PROPORTIONAL. A 60/40 port must carry BOTH parents' staples as majors, and a
 *      trace economy must show as minor — otherwise the mix is decoration.
 *   3. THE MODEL KNOWS WHAT IT ISN'T. Installations get no market, empty mixes get no market,
 *      and the note admits this is a model rather than a scrape.
 */

const zeroScores = (): Record<Economy, number> => ({
  agriculture: 0,
  extraction: 0,
  hightech: 0,
  industrial: 0,
  military: 0,
  refinery: 0,
  service: 0,
  terraforming: 0,
  tourism: 0,
});

const siteWith = (
  over: Partial<Record<Economy, number>>,
  extra: Partial<SiteEconomy> = {},
): SiteEconomy => {
  const scores: EconomyScores = { ...zeroScores(), ...over };
  let leading: Economy | null = null;
  for (const economy of ECONOMIES) {
    if (scores[economy] > 0 && (leading === null || scores[economy] > scores[leading])) {
      leading = economy;
    }
  }
  return {
    siteId: 'site',
    buildTypeId: 'type',
    receivesLinks: true,
    isReceiver: true,
    scores,
    leading,
    audit: [],
    strongLinks: [],
    weakLinks: [],
    ...extra,
  };
};

const STARPORT: MarketStationType = { location: 'orbital', padSize: 'large', tier: 2 };
const SETTLEMENT: MarketStationType = { location: 'surface', padSize: 'small', tier: 1 };

const names = (list: readonly { commodity: string }[]): string[] => list.map((c) => c.commodity);

describe('the commodity names', () => {
  /** Case- and punctuation-blind key: the shape of drift a hand-typed name actually takes. */
  const normalize = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

  it('★ EVERY NAME SHARED WITH THE COLONISATION CATALOGUE IS BYTE-IDENTICAL TO IT ★', () => {
    /*
     * The seed is the one static display-name list in the repo — the same strings the delivery
     * tracker already shows members. If this model spelled a shared commodity differently, one
     * member would see two names for one thing across two colonisation pages.
     */
    const seed = JSON.parse(
      readFileSync(new URL('../../db/src/colony-build-seed.json', import.meta.url), 'utf8'),
    ) as unknown;

    const seedNames = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
      } else if (node !== null && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          if (key === 'commodity' && typeof value === 'string') seedNames.add(value);
          else walk(value);
        }
      }
    };
    walk(seed);
    expect(seedNames.size).toBeGreaterThan(0);

    const byNormalizedSeed = new Map([...seedNames].map((name) => [normalize(name), name]));
    const overlap: string[] = [];
    for (const name of MARKET_COMMODITIES) {
      const seedSpelling = byNormalizedSeed.get(normalize(name));
      if (seedSpelling === undefined) continue;
      overlap.push(name);
      expect(name).toBe(seedSpelling);
    }
    // The check must actually bite — if the overlap vanished, the assertion above proved nothing.
    expect(overlap.length).toBeGreaterThan(20);
  });

  it('holds no two spellings of one commodity', () => {
    const seen = new Map<string, string>();
    for (const name of MARKET_COMMODITIES) {
      const key = normalize(name);
      expect(seen.get(key) ?? name).toBe(name);
      seen.set(key, name);
    }
  });

  it('lists every slate name exactly once per side', () => {
    for (const economy of ECONOMIES) {
      const slate = ECONOMY_MARKETS[economy];
      expect(new Set(slate.exports).size).toBe(slate.exports.length);
      expect(new Set(slate.imports).size).toBe(slate.imports.length);
      for (const name of [...slate.exports, ...slate.imports]) {
        expect(MARKET_COMMODITIES).toContain(name);
      }
    }
  });
});

describe('the rules table', () => {
  it('★ EXHAUSTIVE ★ — every economy the resolver can produce sells something and buys something', () => {
    /*
     * Iterates ECONOMIES from colony-economy.ts, not a local list — if the resolver ever grows an
     * economy this table does not know, this test fails before a member sees an empty market.
     */
    for (const economy of ECONOMIES) {
      const slate = ECONOMY_MARKETS[economy];
      expect(slate.exports.length, `${economy} exports`).toBeGreaterThan(0);
      expect(slate.imports.length, `${economy} imports`).toBeGreaterThan(0);
    }
  });
});

describe('a single-economy port', () => {
  it('carries exactly its economy’s slate, every line major, every line attributed', () => {
    const market = predictMarket(siteWith({ refinery: 2 }), STARPORT);

    expect(names(market.exports).sort()).toEqual([...ECONOMY_MARKETS.refinery.exports].sort());
    expect(names(market.imports).sort()).toEqual([...ECONOMY_MARKETS.refinery.imports].sort());
    for (const line of [...market.exports, ...market.imports]) {
      expect(line.strength).toBe('major');
      expect(line.fromEconomy).toBe('refinery');
    }
  });

  it('gives a zero-score economy no voice at all', () => {
    const market = predictMarket(siteWith({ extraction: 1 }), STARPORT);
    // 'Fruit and Vegetables' belongs only to agriculture; it must not appear from a zero score.
    expect(names(market.exports)).not.toContain('Fruit and Vegetables');
    expect(names(market.imports)).not.toContain('Crop Harvesters');
    for (const line of [...market.exports, ...market.imports]) {
      expect(line.fromEconomy).toBe('extraction');
    }
  });
});

describe('a blended economy', () => {
  it('★ 60/40 CARRIES BOTH PARENTS’ SLATES AS MAJORS ★', () => {
    const market = predictMarket(siteWith({ extraction: 0.6, industrial: 0.4 }), STARPORT);

    // One staple each that no other economy touches on that side.
    const bauxite = market.exports.find((c) => c.commodity === 'Bauxite');
    const ceramics = market.exports.find((c) => c.commodity === 'Ceramic Composites');
    expect(bauxite).toMatchObject({ strength: 'major', fromEconomy: 'extraction' });
    expect(ceramics).toMatchObject({ strength: 'major', fromEconomy: 'industrial' });
  });

  it('marks a trace economy minor — at least half the leader is what major means', () => {
    const market = predictMarket(siteWith({ extraction: 1, tourism: 0.2 }), STARPORT);
    const liquor = market.imports.find((c) => c.commodity === 'Liquor');
    expect(liquor).toMatchObject({ strength: 'minor', fromEconomy: 'tourism' });

    // The boundary is inclusive: exactly half the leading score is still major.
    const boundary = predictMarket(siteWith({ extraction: 1, tourism: MAJOR_FRACTION }), STARPORT);
    expect(boundary.imports.find((c) => c.commodity === 'Liquor')?.strength).toBe('major');
  });

  it('★ NETS A COMMODITY WANTED ON BOTH SIDES ★ — the heavier side wins', () => {
    /*
     * Agriculture grows wine; tourism drinks it. A market shows one direction, so whichever
     * economy weighs more decides it — and the answer flips when the weights do.
     */
    const farmWorld = predictMarket(siteWith({ agriculture: 1, tourism: 0.4 }), STARPORT);
    expect(names(farmWorld.exports)).toContain('Wine');
    expect(names(farmWorld.imports)).not.toContain('Wine');

    const resort = predictMarket(siteWith({ agriculture: 0.3, tourism: 1 }), STARPORT);
    expect(names(resort.imports)).toContain('Wine');
    expect(names(resort.exports)).not.toContain('Wine');
    expect(resort.imports.find((c) => c.commodity === 'Wine')?.fromEconomy).toBe('tourism');
  });

  it('lets exports win an exact tie — a producer sells its surplus', () => {
    const market = predictMarket(siteWith({ agriculture: 0.5, tourism: 0.5 }), STARPORT);
    expect(names(market.exports)).toContain('Wine');
    expect(names(market.imports)).not.toContain('Wine');
  });

  it('lists majors before minors, so the page reads top-down', () => {
    const market = predictMarket(siteWith({ extraction: 1, tourism: 0.2 }), STARPORT);
    for (const side of [market.exports, market.imports]) {
      const firstMinor = side.findIndex((c) => c.strength === 'minor');
      if (firstMinor === -1) continue;
      expect(side.slice(firstMinor).every((c) => c.strength === 'minor')).toBe(true);
    }
  });
});

describe('station size', () => {
  it('★ A SETTLEMENT CARRIES ONLY THE STAPLES ★ — minors are trimmed, majors survive', () => {
    const site = siteWith({ agriculture: 1, tourism: 0.2 });
    const full = predictMarket(site, STARPORT);
    const trimmed = predictMarket(site, SETTLEMENT);

    expect(full.imports.some((c) => c.strength === 'minor')).toBe(true);
    for (const line of [...trimmed.exports, ...trimmed.imports]) {
      expect(line.strength).toBe('major');
    }
    // The trim removes lines rather than relabelling them.
    expect(trimmed.imports.length).toBeLessThan(full.imports.length);
    expect(names(trimmed.exports)).toContain('Grain');
  });

  it('scales by what can dock, never by construction tier', () => {
    expect(marketScale({ location: 'surface', padSize: 'small', tier: 1 })).toBe('majors-only');
    expect(marketScale({ location: 'surface', padSize: 'medium', tier: 2 })).toBe('majors-only');
    expect(marketScale({ location: 'surface', padSize: 'large', tier: 3 })).toBe('full');
    expect(marketScale({ location: 'orbital', padSize: 'medium', tier: 1 })).toBe('full');
    expect(marketScale({ location: 'orbital', padSize: 'large', tier: 2 })).toBe('full');
    expect(marketScale({ location: 'orbital', padSize: 'none', tier: 1 })).toBe('majors-only');
  });

  it('says in the note when it has trimmed', () => {
    const site = siteWith({ agriculture: 1 });
    expect(predictMarket(site, SETTLEMENT).note).toContain('staples');
    expect(predictMarket(site, STARPORT).note).not.toContain('staples');
  });
});

describe('honesty about what it is', () => {
  it('gives an installation no market at all', () => {
    /*
     * ★ AN INSTALLATION DOES NOT HAVE A MARKET ★ — it makes the port on its body richer. Same
     * doctrine as colony-economy.ts, and the note says where the goods actually went.
     */
    const market = predictMarket(
      siteWith({ industrial: 2 }, { receivesLinks: false, isReceiver: false }),
      STARPORT,
    );
    expect(market.exports).toEqual([]);
    expect(market.imports).toEqual([]);
    expect(market.note).toContain('no market of its own');
  });

  it('predicts nothing from nothing', () => {
    const market = predictMarket(siteWith({}), STARPORT);
    expect(market.exports).toEqual([]);
    expect(market.imports).toEqual([]);
    expect(market.note).toContain('economy yet');
  });

  it('admits it is a model, not a scrape of a live market', () => {
    const note = predictMarket(siteWith({ extraction: 1 }), STARPORT).note;
    expect(note).toContain('model');
    expect(note).toContain('population');
  });
});
