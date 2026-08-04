/**
 * What the new station's market will actually buy and sell.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "a system simulator that shows what dropping this station in the system will do to it — meet and
 * exceed what raven colonial allows us to do."
 *
 * ★ THE STEP PAST RAVEN COLONIAL ★
 *
 * colony-economy.ts answers "what economy does this station resolve to" — which is where Raven
 * Colonial stops. But no member hauls tonnes for an ADJECTIVE. The question they are actually
 * asking is "what will the shop sell, and what will it pay me to bring in" — and that is a
 * commodity list, not an economy name. This module maps the resolved economy mix onto the
 * commodity slates the game attaches to each economy, blended in proportion, so the planner can
 * show a MARKET before anybody undocks.
 *
 * ★ THE MODEL, STATED PLAINLY ★
 *
 * Every economy in Elite Dangerous produces one slate of goods and consumes another; a station's
 * market is the union of the slates of every economy present in it, each weighted by that
 * economy's share. So a 60% extraction / 40% industrial port sells raw metals AND machinery, and
 * buys what both trades need. The rules applied here:
 *
 *   - Every economy with a score above zero contributes its full export and import slate. A zero
 *     or absent economy contributes nothing.
 *   - STRENGTH: a commodity is 'major' when its driving economy's score is at least half the
 *     leading score (MAJOR_FRACTION), 'minor' otherwise. In a 60/40 blend both parents' goods are
 *     major; a 0.1-floor trace economy shows as minor.
 *   - NETTING: when a mix puts the same commodity on both sides — an agriculture/tourism port
 *     grows wine AND drinks it — the heavier side wins and the lighter is dropped. On an exact
 *     tie exports win: a producer sells its surplus.
 *   - SIZE: a market's breadth follows what can physically dock there. Odyssey settlements
 *     (surface, small or medium pads) run micro-markets — majors only. Orbital outposts, all
 *     starports and planetary ports carry the full slate. Construction TIER deliberately does not
 *     override this: the game's biggest settlement still runs a settlement market.
 *   - An installation has no market at all — same doctrine as colony-economy.ts: it makes the
 *     port on its body richer, it does not trade.
 *
 * ★ WHERE THE SLATES COME FROM ★
 *
 * Frontier publishes none of it. The economy→commodity relationships below are the game's
 * observed market behaviour — the same community-gathered knowledge every trade tool is built on
 * (agriculture sells foods and buys crop harvesters; refineries eat ore and sell metals; high
 * tech sells the expensive things and buys gold and superconductors). They are a MODEL of that
 * behaviour, not a scrape of any live station, and the result's `note` says so to the member.
 *
 * ★ COMMODITY NAMES ARE DISPLAY NAMES ★
 *
 * Every name here is a canonical Frontier display name — the strings the market tables show
 * (INV-020: an internal name never reaches a user). There is no static display-name catalogue in
 * @grims/shared to reuse (the FDevIDs mapping lives in the database's ReferenceName table), so
 * this file is the catalogue, with one alignment rule: where a commodity also appears in the
 * colonisation catalogue (packages/db/src/colony-build-seed.json) the spelling is byte-identical
 * to it — the spec enforces this — so the two colonisation surfaces never show a member two names
 * for one commodity. That is why 'Agricultural Medicines' follows the seed's spelling.
 *
 * ★ WHAT THIS DOES NOT COVER ★
 *
 * The game's 'colony' economy — the market a station runs WHILE UNDER CONSTRUCTION, which buys
 * the build commodities — is not predicted here, because the catalogue already carries the exact
 * delivery lists per build type. This module is about the station the system keeps afterwards.
 *
 * ★ PURE ★
 *
 * No database, no clock, no fetch. Same reason as the rest of the simulation: the website and the
 * companion run the IDENTICAL rules rather than two copies that drift.
 */

import { ECONOMIES, type Economy, type SiteEconomy } from './colony-economy.js';

export interface PredictedCommodity {
  readonly commodity: string;
  readonly side: 'exports' | 'imports';
  readonly strength: 'major' | 'minor';
  /** Which economy in the mix put it there — the audit trail for one line of the market. */
  readonly fromEconomy: string;
}

export interface PredictedMarket {
  readonly exports: PredictedCommodity[];
  readonly imports: PredictedCommodity[];
  /** The honest epistemics, in one sentence, for the page to print under the table. */
  readonly note: string;
}

/** The station identity the size rule keys off. Matches the catalogue's columns. */
export interface MarketStationType {
  readonly location: 'orbital' | 'surface';
  /** 'small' | 'medium' | 'large' | 'none' in the catalogue; unknown values are treated small. */
  readonly padSize: string;
  readonly tier: number;
}

/** What one economy sells and buys. */
export interface EconomySlate {
  readonly exports: readonly string[];
  readonly imports: readonly string[];
}

/**
 * The economy→commodity rules, one slate per economy the resolver can produce.
 *
 * Each list is the game's observed behaviour for a market DOMINATED by that economy. Slates are
 * deliberately the staple goods, not every commodity ever seen — a prediction that lists forty
 * lines it is half-sure of is worth less than fifteen it can stand behind.
 */
export const ECONOMY_MARKETS: Readonly<Record<Economy, EconomySlate>> = {
  /* Grows food and drink, plus the animal textiles; buys farm machinery, agri-chemicals and —
   * genuinely — biowaste, which is fertiliser to a farm and a disposal problem to everyone else. */
  agriculture: {
    exports: [
      'Grain',
      'Fruit and Vegetables',
      'Animal Meat',
      'Fish',
      'Coffee',
      'Tea',
      'Beer',
      'Wine',
      'Leather',
      'Natural Fabrics',
    ],
    imports: [
      'Crop Harvesters',
      'Pesticides',
      'Agricultural Medicines',
      'Biowaste',
      'Water Purifiers',
    ],
  },
  /* Pulls metals and ore out of the ground and sells them raw; buys the machinery and the
   * survival gear the work needs, and food, because nothing edible grows in a mine. */
  extraction: {
    exports: [
      'Gold',
      'Silver',
      'Palladium',
      'Platinum',
      'Bauxite',
      'Bertrandite',
      'Coltan',
      'Gallite',
      'Indite',
      'Rutile',
      'Uraninite',
      'Cobalt',
    ],
    imports: [
      'Mineral Extractors',
      'Power Generators',
      'Water Purifiers',
      'Basic Medicines',
      'Grain',
      'Hazardous Environment Suits',
    ],
  },
  /* Sells the expensive end of the shelf — computing, medicine, weaponry; buys precious metals
   * and superconductors, the raw ingredients of all of it. */
  hightech: {
    exports: [
      'Advanced Catalysers',
      'Computer Components',
      'Micro Controllers',
      'Auto-Fabricators',
      'Robotics',
      'Consumer Technology',
      'Advanced Medicines',
      'Progenitor Cells',
      'Medical Diagnostic Equipment',
      'Resonating Separators',
      'Bioreducing Lichen',
      'Land Enrichment Systems',
      'Battle Weapons',
      'Performance Enhancers',
    ],
    imports: ['Gold', 'Superconductors', 'Titanium', 'Beryllium', 'Gallium', 'Semiconductors'],
  },
  /* Turns metals into machinery, components and consumer goods — including the construction
   * commodities colonisation itself runs on; buys the refined metals it machines. */
  industrial: {
    exports: [
      'Power Generators',
      'Water Purifiers',
      'Crop Harvesters',
      'Mineral Extractors',
      'Thermal Cooling Units',
      'Microbial Furnaces',
      'Geological Equipment',
      'Building Fabricators',
      'Ceramic Composites',
      'CMM Composite',
      'Insulating Membrane',
      'Polymers',
      'Semiconductors',
      'Superconductors',
      'Domestic Appliances',
      'Clothing',
    ],
    imports: ['Aluminium', 'Copper', 'Steel', 'Titanium', 'Lithium'],
  },
  /* A garrison is a consumer, not a factory: it buys arms, armour, stimulants, fabrics and
   * rations. What it sells is the thin surplus of its own armoury. */
  military: {
    exports: ['Personal Weapons', 'Non-Lethal Weapons', 'Reactive Armour'],
    imports: [
      'Battle Weapons',
      'Combat Stabilisers',
      'Performance Enhancers',
      'Military Grade Fabrics',
      'Basic Medicines',
      'Food Cartridges',
    ],
  },
  /* Eats ore, sells metal — the middle of every industrial chain in the game. */
  refinery: {
    exports: [
      'Aluminium',
      'Copper',
      'Steel',
      'Titanium',
      'Beryllium',
      'Gallium',
      'Indium',
      'Lithium',
      'Tantalum',
      'Uranium',
    ],
    imports: [
      'Bauxite',
      'Bertrandite',
      'Coltan',
      'Gallite',
      'Indite',
      'Lepidolite',
      'Rutile',
      'Uraninite',
    ],
  },
  /* A population centre that makes nothing: it consumes finished goods, food and drink, and its
   * only reliable products are fuel at the pump and its own waste. */
  service: {
    exports: ['Biowaste', 'Hydrogen Fuel'],
    imports: [
      'Clothing',
      'Domestic Appliances',
      'Consumer Technology',
      'Beer',
      'Wine',
      'Animal Meat',
      'Fish',
    ],
  },
  /* A consumption economy by design — it exists to pull in water, enrichment systems and
   * groundwork machinery until the world underneath it changes. */
  terraforming: {
    exports: ['Hydrogen Fuel', 'Biowaste'],
    imports: [
      'Water',
      'Water Purifiers',
      'Land Enrichment Systems',
      'Surface Stabilisers',
      'Bioreducing Lichen',
      'Building Fabricators',
      'Structural Regulators',
    ],
  },
  /* Visitors drink, dine and shop; the resort sells them survival gear for the excursions and
   * ships its waste out behind the scenery. */
  tourism: {
    exports: ['Survival Equipment', 'Biowaste'],
    imports: [
      'Wine',
      'Beer',
      'Liquor',
      'Coffee',
      'Tea',
      'Animal Meat',
      'Fish',
      'Consumer Technology',
      'Clothing',
      'Domestic Appliances',
    ],
  },
};

/** Every display name the model can emit, deduplicated and sorted — the page's checklist. */
export const MARKET_COMMODITIES: readonly string[] = [
  ...new Set(Object.values(ECONOMY_MARKETS).flatMap((s) => [...s.exports, ...s.imports])),
].sort();

/** An economy is 'major' in the mix when its score is at least this fraction of the leader's. */
export const MAJOR_FRACTION = 0.5;

/**
 * How much of the slate a station of this shape carries.
 *
 * ★ THE SIZE RULE ★
 *
 * Breadth follows what can physically dock, not the construction tier:
 *
 *   - surface + small/medium pads → an Odyssey settlement. Micro-market: majors only.
 *   - padSize 'small' or 'none' anywhere → the same trim (such sites rarely trade at all, and
 *     when they do it is staples).
 *   - everything else — orbital outposts (medium), every starport and planetary port (large) —
 *     carries the full slate.
 *
 * Tier never overrides pads because the game's biggest settlement still runs a settlement market.
 */
export function marketScale(station: MarketStationType): 'full' | 'majors-only' {
  if (station.padSize !== 'medium' && station.padSize !== 'large') return 'majors-only';
  if (station.location === 'surface' && station.padSize !== 'large') return 'majors-only';
  return 'full';
}

const EPISTEMICS =
  "A model of the economy rules Frontier never published, not a reading of a live market — a real station's stock and demand drift with population, system state, and galactic events";

/** One contribution of one economy to one commodity, before netting. */
interface Contribution {
  readonly economy: Economy;
  readonly weight: number;
  readonly strength: 'major' | 'minor';
}

/**
 * Predicts the market a planned station would open with, from its resolved economy mix.
 *
 * Pure: same inputs, same market. Feed it a SiteEconomy from resolveEconomies and the station's
 * shape from the catalogue row (location, padSize, tier).
 */
export function predictMarket(site: SiteEconomy, stationType: MarketStationType): PredictedMarket {
  /*
   * ★ AN INSTALLATION DOES NOT HAVE A MARKET ★ — same doctrine as colony-economy.ts. It carries
   * scores because that is how the arithmetic works, but printing a commodity list for a
   * satellite would claim there is a shop aboard. There is not.
   */
  if (!site.receivesLinks) {
    return {
      exports: [],
      imports: [],
      note: 'This site feeds the port on its body — it has no market of its own to predict.',
    };
  }

  const active = ECONOMIES.filter((economy) => site.scores[economy] > 0);
  if (active.length === 0) {
    return {
      exports: [],
      imports: [],
      note: 'Nothing gives this port an economy yet — place it on a body or feed it same-body builds, and the market follows.',
    };
  }

  const top = Math.max(...active.map((economy) => site.scores[economy]));

  /* Gather every economy's slate, weighted by its score. Insertion order follows ECONOMIES, which
   * is what makes the tie-breaks below deterministic. */
  const byCommodity = new Map<string, { exports: Contribution[]; imports: Contribution[] }>();
  for (const economy of active) {
    const weight = site.scores[economy];
    const strength: 'major' | 'minor' = weight >= top * MAJOR_FRACTION ? 'major' : 'minor';
    const slate = ECONOMY_MARKETS[economy];
    for (const side of ['exports', 'imports'] as const) {
      for (const commodity of slate[side]) {
        const held = byCommodity.get(commodity) ?? { exports: [], imports: [] };
        held[side].push({ economy, weight, strength });
        byCommodity.set(commodity, held);
      }
    }
  }

  const scale = marketScale(stationType);
  const sum = (list: readonly Contribution[]): number =>
    list.reduce((total, c) => total + c.weight, 0);

  const rows: { entry: PredictedCommodity; weight: number }[] = [];
  for (const [commodity, sides] of byCommodity) {
    /*
     * ★ NETTING ★ — a mixed economy can want a commodity on both sides: an agriculture/tourism
     * port grows wine and drinks it. A market shows one direction, so the heavier side wins and
     * the lighter is dropped. Exports win a tie: a producer sells its surplus.
     */
    const side = sum(sides.exports) >= sum(sides.imports) ? 'exports' : 'imports';
    const winners = sides[side];
    // Strongest contributor names the line; reduce keeps the FIRST on ties = ECONOMIES order.
    const best = winners.reduce((a, b) => (b.weight > a.weight ? b : a));
    if (scale === 'majors-only' && best.strength === 'minor') continue;
    rows.push({
      entry: { commodity, side, strength: best.strength, fromEconomy: best.economy },
      weight: best.weight,
    });
  }

  /* Majors first, then by driving score, then by name — stable enough to diff two plans. */
  const order = (a: (typeof rows)[number], b: (typeof rows)[number]): number => {
    if (a.entry.strength !== b.entry.strength) return a.entry.strength === 'major' ? -1 : 1;
    if (a.weight !== b.weight) return b.weight - a.weight;
    return a.entry.commodity < b.entry.commodity ? -1 : 1;
  };

  return {
    exports: rows
      .filter((r) => r.entry.side === 'exports')
      .sort(order)
      .map((r) => r.entry),
    imports: rows
      .filter((r) => r.entry.side === 'imports')
      .sort(order)
      .map((r) => r.entry),
    note:
      scale === 'majors-only'
        ? `${EPISTEMICS}; a market this small carries only its staples, so minor lines are trimmed.`
        : `${EPISTEMICS}.`,
  };
}
