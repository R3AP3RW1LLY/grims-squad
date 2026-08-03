import { describe, expect, it } from 'vitest';
import {
  WEAK_LINK_STRENGTH,
  bodyBuffs,
  bodyEconomies,
  resolveEconomies,
  strongLinkStrength,
  type EconBody,
  type EconBuildType,
  type EconSite,
} from './colony-economy.js';

/**
 * What a planned station's economy would resolve to.
 *
 * ★ WHAT IS BEING PROVED ★
 *
 * Not that the arithmetic runs — that the ARRANGEMENT changes the answer. The whole argument for
 * having a planner rather than a list is that the same six builds give a different system depending
 * on where they stand, and if these tests pass with the links removed the model is worthless.
 */

const body = (over: Partial<EconBody> & { bodyId: number }): EconBody => ({
  kind: 'Planet',
  subType: 'Rocky body',
  hasRings: false,
  terraformable: false,
  hasVolcanism: false,
  isLandable: true,
  ...over,
});

const type = (over: Partial<EconBuildType> & { id: string }): EconBuildType => ({
  displayName: over.id,
  tier: 1,
  buildClass: 'installation',
  economyInfluence: 'none',
  economyFixed: null,
  ...over,
});

const CORIOLIS = type({
  id: 'no_truss',
  displayName: 'Coriolis Starport',
  tier: 2,
  buildClass: 'starport',
  economyInfluence: 'colony',
});

const PIRATE_OUTPOST = type({
  id: 'dysnomia',
  displayName: 'Pirate Outpost',
  buildClass: 'outpost',
  economyInfluence: 'service',
  economyFixed: 'service',
});

const FARM = type({
  id: 'demeter',
  displayName: 'Space Farm',
  economyInfluence: 'agriculture',
});

const MINING = type({
  id: 'euthenia',
  displayName: 'Mining Installation',
  economyInfluence: 'extraction',
});

const CATALOGUE = new Map([CORIOLIS, PIRATE_OUTPOST, FARM, MINING].map((t) => [t.id, t]));

const site = (id: string, buildTypeId: string | null, bodyId: number | null, location: 'orbital' | 'surface' = 'orbital'): EconSite => ({
  id,
  buildTypeId,
  bodyId,
  location,
});

describe('what a body contributes on its own', () => {
  it('reads EDSM’s prose rather than a code', () => {
    /*
     * There is no enumeration to switch on — `subType` is a sentence. The order of the checks is
     * load-bearing: "Rocky Ice world" must not fall through to the generic "Rocky" test.
     */
    const rockyIce = bodyEconomies(body({ bodyId: 1, subType: 'Rocky Ice world' }));
    expect(rockyIce.map((e) => e.economy).sort()).toEqual(['industrial', 'refinery']);

    const rocky = bodyEconomies(body({ bodyId: 2, subType: 'Rocky body' }));
    expect(rocky.map((e) => e.economy)).toEqual(['refinery']);
  });

  it('treats an earth-like world as the prize it is', () => {
    const elw = bodyEconomies(body({ bodyId: 1, subType: 'Earth-like world' }));
    expect(elw.map((e) => e.economy).sort()).toEqual([
      'agriculture',
      'hightech',
      'military',
      'tourism',
    ]);
  });

  it('separates exotic remnants from ordinary stars', () => {
    const star = bodyEconomies(body({ bodyId: 0, kind: 'Star', subType: 'G (White-Yellow) Star' }));
    expect(star.map((e) => e.economy)).toEqual(['military']);

    const nsq = bodyEconomies(body({ bodyId: 0, kind: 'Star', subType: 'Neutron Star' }));
    expect(nsq.map((e) => e.economy).sort()).toEqual(['hightech', 'tourism']);
  });

  it('counts rings as something to extract from', () => {
    const ringed = bodyEconomies(body({ bodyId: 1, subType: 'Class III gas giant', hasRings: true }));
    expect(ringed.filter((e) => e.economy === 'extraction')).toHaveLength(1);
  });
});

describe('the buffs a body applies', () => {
  it('penalises agriculture on an ice ball rather than quietly rounding it away', () => {
    const icy = bodyBuffs(body({ bodyId: 1, subType: 'Icy body' }));
    const agri = icy.find((b) => b.economy === 'agriculture');
    expect(agri?.delta).toBe(-0.4);
  });

  it('rewards a world that can already grow things, and one that could be made to', () => {
    const water = bodyBuffs(body({ bodyId: 1, subType: 'Water world' }));
    expect(water.find((b) => b.economy === 'agriculture')?.delta).toBe(0.4);

    const candidate = bodyBuffs(body({ bodyId: 2, subType: 'Rocky body', terraformable: true }));
    expect(candidate.map((b) => b.economy).sort()).toEqual(['agriculture', 'terraforming']);
  });
});

describe('links between sites', () => {
  it('is worth more from a bigger neighbour', () => {
    expect(strongLinkStrength(1)).toBe(0.4);
    expect(strongLinkStrength(2)).toBe(0.8);
    expect(strongLinkStrength(3)).toBe(1.2);
  });

  it('★ THE ARRANGEMENT IS THE ANSWER ★ — the same builds on one body beat them scattered', () => {
    /*
     * The claim the whole feature rests on. Two mining installations feeding a port from its OWN
     * body are worth 0.8 of extraction; the identical two on a different body are worth 0.1. If
     * this test ever passes with the topology removed, the planner is decoration.
     */
    const bodies = [
      body({ bodyId: 1, subType: 'Rocky body' }),
      body({ bodyId: 2, subType: 'Rocky body' }),
    ];

    const together = resolveEconomies(
      [
        site('port', 'no_truss', 1),
        site('m1', 'euthenia', 1),
        site('m2', 'euthenia', 1),
      ],
      bodies,
      CATALOGUE,
    );

    const scattered = resolveEconomies(
      [
        site('port', 'no_truss', 1),
        site('m1', 'euthenia', 2),
        site('m2', 'euthenia', 2),
      ],
      bodies,
      CATALOGUE,
    );

    const near = together.sites.find((s) => s.siteId === 'port');
    const far = scattered.sites.find((s) => s.siteId === 'port');

    expect(near?.scores.extraction).toBeCloseTo(0.8, 5);
    expect(far?.scores.extraction).toBeCloseTo(WEAK_LINK_STRENGTH * 2, 5);
    expect(near?.strongLinks).toEqual(['m1', 'm2']);
    expect(far?.weakLinks).toEqual(['m1', 'm2']);
  });

  it('does not let a surface settlement feed an orbital station', () => {
    // Same rock, different worlds. They are separate economies that happen to share a body.
    const result = resolveEconomies(
      [site('port', 'no_truss', 1, 'orbital'), site('farm', 'demeter', 1, 'surface')],
      [body({ bodyId: 1 })],
      CATALOGUE,
    );

    const port = result.sites.find((s) => s.siteId === 'port');
    expect(port?.strongLinks).toEqual([]);
    expect(port?.weakLinks).toEqual(['farm']);
  });

  it('feeds only the receiving port, and elects the biggest one', () => {
    /*
     * An installation is not something anything feeds into. If every site accumulated links, a
     * satellite would resolve to an economy the game never gives it.
     */
    const result = resolveEconomies(
      [site('port', 'no_truss', 1), site('mine', 'euthenia', 1)],
      [body({ bodyId: 1 })],
      CATALOGUE,
    );

    expect(result.sites.find((s) => s.siteId === 'mine')?.strongLinks).toEqual([]);
    expect(result.sites.find((s) => s.siteId === 'port')?.strongLinks).toEqual(['mine']);
  });
});

describe('a fixed economy', () => {
  it('ignores the body entirely', () => {
    /*
     * A Pirate Outpost is a service economy wherever it stands. Inheriting the body's contribution
     * on top would produce something the game never makes — an earth-like pirate farm.
     */
    const result = resolveEconomies(
      [site('p', 'dysnomia', 1)],
      [body({ bodyId: 1, subType: 'Earth-like world', terraformable: true })],
      CATALOGUE,
    );

    const p = result.sites[0];
    expect(p?.leading).toBe('service');
    expect(p?.scores.agriculture).toBe(0);
    expect(p?.scores.service).toBe(1);
  });

  it('is worth half as much on a surface as in orbit', () => {
    const orbit = resolveEconomies([site('p', 'dysnomia', 1, 'orbital')], [body({ bodyId: 1 })], CATALOGUE);
    const ground = resolveEconomies([site('p', 'dysnomia', 1, 'surface')], [body({ bodyId: 1 })], CATALOGUE);

    expect(orbit.sites[0]?.scores.service).toBe(1);
    expect(ground.sites[0]?.scores.service).toBe(0.5);
  });
});

describe('honesty about what it cannot know', () => {
  it('names every input the game uses that we do not hold', () => {
    /*
     * Not decoration. A prediction that quietly omitted reserve level would be wrong in a way
     * nobody could see, and this is the only thing standing between a model and a guess dressed up
     * as one.
     */
    const result = resolveEconomies([], [], CATALOGUE);

    expect(result.blindSpots).toHaveLength(3);
    expect(result.blindSpots.join(' ')).toContain('reserve level');
    expect(result.blindSpots.join(' ')).toContain('tidally locked');
  });

  it('separates a place that trades from a thing that feeds one', () => {
    /*
     * ★ AN INSTALLATION DOES NOT HAVE AN ECONOMY ★
     *
     * It still picks up the body's contribution in the arithmetic, because that is how the model
     * works. But it has no market, so the page must not print "industrial" beside it as though it
     * had one — it makes the PORT on its body industrial.
     */
    const result = resolveEconomies(
      [site('port', 'no_truss', 1), site('mine', 'euthenia', 1)],
      [body({ bodyId: 1, subType: 'Class III gas giant' })],
      CATALOGUE,
    );

    const port = result.sites.find((s) => s.siteId === 'port');
    const mine = result.sites.find((s) => s.siteId === 'mine');

    expect(port?.receivesLinks).toBe(true);
    expect(port?.isReceiver).toBe(true);
    expect(mine?.receivesLinks).toBe(false);
    expect(mine?.isReceiver).toBe(false);
  });

  it('says nothing at all about a slot with no build chosen', () => {
    const result = resolveEconomies([site('empty', null, 1)], [body({ bodyId: 1 })], CATALOGUE);
    expect(result.sites[0]?.leading).toBeNull();
    expect(result.sites[0]?.audit).toEqual([]);
  });
});
