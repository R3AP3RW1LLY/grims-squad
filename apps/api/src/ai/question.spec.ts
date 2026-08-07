import { describe, expect, it } from 'vitest';
import { planFor, sideOf } from './question.js';

/**
 * Routing decides which facts reach the model, and getting it wrong is not an error — it is a
 * confident answer built from the wrong rows. "Where can I sell Painite" answered with BUY prices
 * sends somebody across the bubble to pay for cargo they were trying to get rid of, and nothing
 * about the reply looks wrong.
 */

const COMMODITIES = [
  'Painite',
  'Platinum',
  'Diamonds',
  'Low Temperature Diamonds',
  'Void Opals',
  'Tritium',
  'Gold',
];

describe('sideOf', () => {
  it('reads plain buying and selling', () => {
    expect(sideOf('where can I sell Painite')).toBe('sell');
    expect(sideOf('where can I buy Tritium')).toBe('buy');
  });

  it('MANDATORY: when both verbs appear, the FIRST one is the question', () => {
    /*
     * "Buy X to sell at Y" is a question about where to BUY. Answering the selling half sends the
     * member to the wrong station with the wrong cargo.
     */
    expect(sideOf('where do I buy Platinum to sell in Sol')).toBe('buy');
    expect(sideOf('where can I sell Platinum that I bought in Sol')).toBe('sell');
  });

  it('treats a bare commodity question as buying', () => {
    // "Find me Tritium" means acquire it. Defaulting the other way would be a stranger reading.
    expect(sideOf('find me Tritium')).toBe('buy');
  });
});

describe('planFor — market', () => {
  it('picks up the commodity and the side together', () => {
    const plan = planFor('where can I sell Painite', COMMODITIES);
    expect(plan.market).toEqual({ commodity: 'Painite', side: 'sell' });
  });

  it('MANDATORY: prefers the longest matching commodity name', () => {
    /*
     * "Low Temperature Diamonds" contains "Diamonds". Matching the short one answers a question
     * about a 200,000cr commodity with prices for an entirely different, far cheaper one — and the
     * answer reads perfectly.
     */
    const plan = planFor('best place to sell Low Temperature Diamonds', COMMODITIES);
    expect(plan.market?.commodity).toBe('Low Temperature Diamonds');
  });

  it('does not invent a market question from a commodity mentioned in passing', () => {
    const plan = planFor('what is Painite', COMMODITIES);
    expect(plan.market).toBeNull();
  });

  it('does not invent a commodity we do not hold', () => {
    const plan = planFor('where can I sell unobtanium', COMMODITIES);
    expect(plan.market).toBeNull();
  });
});

describe('planFor — spatial', () => {
  it('finds the system and a default radius', () => {
    const plan = planFor('stations near Deciat', COMMODITIES);
    expect(plan.near?.system).toBe('Deciat');
    expect(plan.near?.radiusLy).toBe(50);
  });

  it('honours a stated radius', () => {
    expect(planFor('stations within 30ly of Deciat', COMMODITIES).near?.radiusLy).toBe(30);
    expect(planFor('anything 15 ly from Shinrarta Dezhra', COMMODITIES).near?.radiusLy).toBe(15);
  });

  it('caps the radius, so a typo cannot ask for the galaxy', () => {
    expect(planFor('stations within 99999ly of Sol', COMMODITIES).near?.radiusLy).toBe(250);
  });

  it('handles the system names Frontier actually uses', () => {
    // Real names are shaped like this. A pattern tight enough to exclude ordinary English would
    // exclude most of the galaxy.
    expect(planFor('stations near HIP 43008', COMMODITIES).near?.system).toBe('HIP 43008');
    expect(planFor('anything near Shinrarta Dezhra', COMMODITIES).near?.system).toBe(
      'Shinrarta Dezhra',
    );
  });

  it('is not spatial without a proximity word', () => {
    expect(planFor('tell me about Deciat', COMMODITIES).near).toBeNull();
  });
});

describe('planFor — names', () => {
  it('does not look up the first word just because a sentence starts with a capital', () => {
    // "What does a Krait hold" must not look up "What".
    const plan = planFor('What does a Krait hold', COMMODITIES);
    expect(plan.names).not.toContain('What');
    expect(plan.names).toContain('Krait');
  });

  it('keeps a run of capitals together', () => {
    // "Krait" and "Mk" looked up separately gives the ship and then noise.
    expect(planFor('how much does a Krait Mk II cost', COMMODITIES).names).toContain('Krait Mk II');
  });

  it('is bounded, so shouting does not become twenty lookups', () => {
    expect(planFor('WHAT IS THE BEST SHIP FOR MINING IN THE GALAXY', COMMODITIES).names.length)
      .toBeLessThanOrEqual(3);
  });
});

describe('planFor — the floor', () => {
  it('MANDATORY: always searches by meaning, whatever else it decides', () => {
    /*
     * Routing to exactly one retrieval is a bet, and losing it means answering "I do not know" to
     * a question we held the facts for. Semantic search is the floor, not a branch.
     */
    for (const q of ['where can I sell Painite', 'stations near Deciat', 'how do I engineer my FSD']) {
      expect(planFor(q, COMMODITIES).semantic).toBe(true);
    }
  });

  it('leaves a pure prose question with nothing but meaning', () => {
    const plan = planFor('how do I get more jump range', COMMODITIES);
    expect(plan.market).toBeNull();
    expect(plan.near).toBeNull();
    expect(plan.semantic).toBe(true);
  });
});

describe('planFor — terms consumed by the leg that understood them', () => {
  it('MANDATORY: does not also look a commodity up by name', () => {
    /*
     * Observed against the real knowledge base: "where can I sell Painite" name-looked-up Painite
     * and returned the stations "Paine Mine", "Pacalite" and "Pate" — pure noise, presented to the
     * model as facts, in an answer about prices.
     */
    const plan = planFor('where can I sell Painite', COMMODITIES);
    expect(plan.market?.commodity).toBe('Painite');
    expect(plan.names.map((n) => n.toLowerCase())).not.toContain('painite');
  });

  it('does not also look the origin system up by name', () => {
    const plan = planFor('stations near Deciat', COMMODITIES);
    expect(plan.near?.system).toBe('Deciat');
    expect(plan.names.map((n) => n.toLowerCase())).not.toContain('deciat');
  });

  it('still looks up names no other leg claimed', () => {
    const plan = planFor('can a Krait Mk II reach Deciat', COMMODITIES);
    expect(plan.names).toContain('Krait Mk II');
  });
});

describe('asking what the squadron wants done in the background sim', () => {
  /**
   * ★ SQUADRON OWNER, 2026-08-06 ★
   *
   * "we also want to create the BGS component too ... Make this extremely feature ritch, incorporate
   * AI where we can too"
   *
   * ★ ITS OWN LEG, FOR THE SAME REASON THE RINGS ARE ★
   *
   * The answer comes from a source no other leg touches: `bgs_orders`, written by officers this
   * week. A model asked this without it answers from whatever BGS prose the semantic leg found —
   * a wiki page explaining what influence IS, presented with the same confidence as tonight's
   * actual instructions.
   */
  it('routes "what factions should I run missions for" to the orders leg', () => {
    const plan = planFor('what factions should I be running missions for?', COMMODITIES);
    expect(plan.orders).not.toBeNull();
  });

  it('routes the plain forms an officer or member would type', () => {
    for (const q of [
      'what are our bgs orders',
      'who are we pushing right now',
      'which faction should I support',
      'what is the squadron working on in bgs',
      'are we suppressing anyone',
    ]) {
      expect(planFor(q, COMMODITIES).orders, `"${q}" did not reach the orders leg`).not.toBeNull();
    }
  });

  it('picks up the system when the member names one', () => {
    const plan = planFor('what are our bgs orders in Deciat?', COMMODITIES);
    expect(plan.orders?.system).toBe('Deciat');
  });

  it('leaves the system null when none is named, rather than guessing', () => {
    // A guess would answer about the wrong system with total confidence, which is worse than
    // listing everything and letting the member find their own.
    expect(planFor('what are our bgs orders', COMMODITIES).orders?.system).toBeNull();
  });

  it('MANDATORY: does not hijack a question about selling cargo', () => {
    /*
     * "faction" and "support" appear in questions that have nothing to do with standing orders.
     * Answering "where do I sell this" with a list of factions would be a confident non-answer.
     */
    expect(planFor('where do I sell Painite', COMMODITIES).orders).toBeNull();
    expect(planFor('what should I fly for combat', COMMODITIES).orders).toBeNull();
    expect(planFor('where can I buy gold near Sol', COMMODITIES).orders).toBeNull();
  });
});
