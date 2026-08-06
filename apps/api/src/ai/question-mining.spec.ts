import { describe, expect, it } from 'vitest';
import { planFor } from './question.js';

/**
 * Routing a mining question to the ring survey rather than to the shipyard or the market.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "if we can add our AI into this some way that would be epic!"
 *
 * ★ THREE DIFFERENT QUESTIONS CONTAIN THE WORD "MINING" ★
 *
 * "What should I fly for mining"     → the fitter. A ship.
 * "Where do I sell mined Painite"    → the market. A station buying.
 * "Where should I mine Painite"      → THIS. A ring, from the squadron's own limpets.
 *
 * Routing is grammar, not the model's judgement — the same rule as every other leg. Getting it
 * wrong is not an error, it is a confident answer built from the wrong rows: a member asking where
 * to dig and being handed a ship build has no way to tell that the question was misheard.
 */

const COMMODITIES = ['Painite', 'Platinum', 'Void Opals', 'Low Temperature Diamonds', 'Tritium'];
const SHIPS = [{ id: 'python', name: 'Python' }];

describe('routing a question to the ring survey', () => {
  it('MANDATORY: "where should I mine painite" asks the rings, not the shipyard', () => {
    const plan = planFor('Where should I mine Painite?', COMMODITIES, SHIPS);

    expect(plan.rings, 'a place-seeking mining question did not reach the ring survey').not.toBeNull();
    expect(plan.rings?.material?.toLowerCase()).toContain('painite');
    expect(plan.fit, 'it was routed to the fitter instead').toBeNull();
  });

  it('MANDATORY: a ring question with no material named still asks', () => {
    // "Where is good mining right now" is a real question with a real answer: the best rings we
    // have measured, whatever they are running.
    const plan = planFor('Which rings are worth mining right now?', COMMODITIES, SHIPS);

    expect(plan.rings).not.toBeNull();
    expect(plan.rings?.material).toBeNull();
  });

  it('MANDATORY: "what should I fly for mining" is still the fitter', () => {
    /*
     * The collision this file exists to prevent. Both questions contain a mining word; only one is
     * about a place. Answering a ship question with a list of rings would be the same class of
     * failure as answering a sell question with buy prices.
     */
    const plan = planFor('What should I fly for mining on a 200 million budget?', COMMODITIES, SHIPS);

    expect(plan.fit, 'the fitter lost a build question to the ring survey').not.toBeNull();
    expect(plan.rings).toBeNull();
  });

  it('MANDATORY: "where do I sell mined painite" is still the market', () => {
    /*
     * "Sell" is the whole signal. A member holding a full hold wants a station, and a list of rings
     * is the one answer that cannot help them — they have already done the mining.
     */
    const plan = planFor('Where do I sell mined Painite?', COMMODITIES, SHIPS);

    expect(plan.market?.side).toBe('sell');
    expect(plan.rings, 'a selling question was routed to the ring survey').toBeNull();
  });

  it('MANDATORY: a question with no mining word at all asks nothing of the rings', () => {
    expect(planFor('Where can I buy Tritium?', COMMODITIES, SHIPS).rings).toBeNull();
    expect(planFor('What is the jump range of a Python?', COMMODITIES, SHIPS).rings).toBeNull();
  });

  it('MANDATORY: the material is not also looked up as a name', () => {
    /*
     * The same reasoning the market leg is given: a trigram lookup for "Painite" returned the
     * stations "Paine Mine", "Pacalite" and "Pate" — three rows of noise handed to the model as
     * facts. The leg that understood the word consumes it.
     */
    const plan = planFor('Best ring to mine Painite?', COMMODITIES, SHIPS);

    expect(plan.rings).not.toBeNull();
    expect(plan.names.map((n) => n.toLowerCase())).not.toContain('painite');
  });
});
