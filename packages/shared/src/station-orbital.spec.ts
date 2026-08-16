import { describe, expect, it } from 'vitest';
import { isOrbitalStation } from './station-orbital.js';

/**
 * Is this station in orbit, or on a rock?
 *
 * ★ WHY IT MATTERS, AND IT IS NOT AESTHETIC ★
 *
 * Squadron owner, 2026-08-15: "the priority is on orbital stations, followed by ground stations."
 *
 * A ground station costs a descent, a landing, a pad walk and a launch on EVERY run. Over a
 * twenty-run haul that dwarfs the few light years between two candidate stops, which is why
 * `rankBuySources` ranks convenience above distance inside a band.
 *
 * ★ THE TRAP THIS FILE EXISTS FOR ★
 *
 * `Outpost` is ORBITAL. `Planetary Outpost` is GROUND. They are the two commonest types in our own
 * galaxy data — 114,531 and 14,848 rows — and a substring match on "Outpost" gets the larger of
 * them exactly backwards.
 *
 * The counts below are from our own `knowledge_items`, not from a wiki, because the spellings that
 * matter are the ones we actually store: the dump's display names AND the journal's enum, both of
 * which are present.
 */

describe('stations in orbit', () => {
  it('★ MANDATORY: a plain Outpost is ORBITAL, despite the word ★', () => {
    /*
     * The single most important assertion here. 114,531 of our station rows say exactly "Outpost",
     * and every one of them is in space. Reading the word as planetary would push the most common
     * orbital station in the galaxy behind every ground station in range.
     */
    expect(isOrbitalStation('Outpost')).toBe(true);
  });

  it('the starports are orbital, under both spellings we store', () => {
    // The dump writes "Coriolis Starport"; journals write "Coriolis". Both are in our data.
    for (const t of [
      'Coriolis Starport',
      'Coriolis',
      'Orbis Starport',
      'Orbis',
      'Ocellus Starport',
      'Ocellus',
      'Dodec Starport',
    ]) {
      expect(isOrbitalStation(t), `${t} is a starport`).toBe(true);
    }
  });

  it('asteroid bases, mega ships and space construction depots are orbital', () => {
    for (const t of [
      'Asteroid base',
      'AsteroidBase',
      'Mega ship',
      'MegaShip',
      'Space Construction Depot',
      'SpaceConstructionDepot',
    ]) {
      expect(isOrbitalStation(t), t).toBe(true);
    }
  });
});

describe('stations on the ground', () => {
  it('★ MANDATORY: a Planetary Outpost is GROUND, despite sharing a word with the orbital one ★', () => {
    expect(isOrbitalStation('Planetary Outpost')).toBe(false);
  });

  it('settlements and surface ports are ground', () => {
    for (const t of [
      'Settlement',
      'OnFootSettlement',
      'SurfaceStation',
      'CraterOutpost',
      'CraterPort',
      'Planetary Port',
      'Planetary Construction Depot',
      'PlanetaryConstructionDepot',
    ]) {
      expect(isOrbitalStation(t), `${t} is on a rock`).toBe(false);
    }
  });

  it('★ MANDATORY: CraterOutpost is ground, which is the trap a second time ★', () => {
    // Same word, same wrong answer, different prefix. Asserted separately because a fix for
    // "Planetary Outpost" written as a prefix check would still get this one wrong.
    expect(isOrbitalStation('CraterOutpost')).toBe(false);
  });
});

describe('what we do not know', () => {
  it('★ MANDATORY: an unrecognised type is null, never a guess ★', () => {
    /*
     * `rankBuySources` sorts null with GROUND, deliberately — guessing generously would send
     * somebody on a descent they were told they would not make. That choice is only safe if this
     * function reports ignorance rather than inventing an answer, so the pessimism lives in exactly
     * one place instead of two.
     */
    expect(isOrbitalStation('Something Frontier Added Last Tuesday')).toBeNull();
    expect(isOrbitalStation(null)).toBeNull();
    expect(isOrbitalStation(undefined)).toBeNull();
    expect(isOrbitalStation('')).toBeNull();
  });

  it('a fleet carrier is not answered here', () => {
    /*
     * A carrier is neither, and the buy list already drops them before this is reached — they move,
     * so "how far is it" is a question with no stable answer. Returning `true` would quietly
     * reintroduce them into an ordering built on distance.
     */
    expect(isOrbitalStation('Drake-Class Carrier')).toBeNull();
    expect(isOrbitalStation('FleetCarrier')).toBeNull();
  });

  it('matching ignores case and surrounding space, because three sources spell these', () => {
    // EDDN, the galaxy dump and a member typing it are three different capitalisations of one type.
    expect(isOrbitalStation('  coriolis starport ')).toBe(true);
    expect(isOrbitalStation('PLANETARY OUTPOST')).toBe(false);
  });
});
