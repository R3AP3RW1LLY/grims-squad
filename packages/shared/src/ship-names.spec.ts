import { describe, it, expect } from 'vitest';
import { isSuit, shipDisplayName, suitName } from './ship-names.js';

/**
 * Turning Elite's internal names into readable ones.
 *
 * ★ EVERY CASE HERE CAME OUT OF PRODUCTION ★
 *
 * The squadron dashboard displayed `$TacticalSuit_Class1_Name;` as a ship. Chasing it turned up
 * three separate faults, and the values below are the real rows that caused them rather than
 * examples invented afterwards.
 */

describe('suits are not ships', () => {
  it('MANDATORY: a suit never appears as a ship', () => {
    /*
     * THE ONE THAT WAS VISIBLE. `LoadGame` reports whatever the commander logged out IN, so an
     * on-foot logout put a suit in a chart headed "what the squadron flies".
     */
    expect(shipDisplayName('TacticalSuit_Class2')).toBeNull();
    expect(shipDisplayName('UtilitySuit_Class1')).toBeNull();
    expect(shipDisplayName('FlightSuit')).toBeNull();
  });

  it('recognises suits from the RAW name, not the localised one', () => {
    // Filtering on the localised name would let the broken token through — it is exactly the
    // field that is wrong for upgraded suits.
    expect(isSuit('TacticalSuit_Class2')).toBe(true);
    expect(isSuit('FlightSuit')).toBe(true);
    expect(isSuit('Explorer_NX')).toBe(false);
    expect(isSuit('python_nx')).toBe(false);
  });

  it('names suits the way commanders do, with the grade', () => {
    /*
     * Frontier's internal names match nothing anybody says: Tactical is the Dominator, Utility is
     * the Maverick, Exploration is the Artemis.
     */
    expect(suitName('TacticalSuit_Class2')).toBe('Dominator Suit, Grade 2');
    expect(suitName('UtilitySuit_Class5')).toBe('Maverick Suit, Grade 5');
    expect(suitName('ExplorationSuit_Class1')).toBe('Artemis Suit');
    expect(suitName('FlightSuit')).toBe('Flight Suit');
  });

  it('MANDATORY: the grade comes from the raw name, which is the only reliable source', () => {
    /*
     * Production showed `UtilitySuit_Class4` AND `UtilitySuit_Class5` both localising to
     * `$UtilitySuit_Class1_Name;` — Frontier registered only the grade-1 string. Trusting the
     * localised name would have merged every grade into one and mislabelled them all.
     */
    expect(suitName('UtilitySuit_Class4')).toBe('Maverick Suit, Grade 4');
    expect(suitName('UtilitySuit_Class5')).toBe('Maverick Suit, Grade 5');
    expect(suitName('UtilitySuit_Class4')).not.toBe(suitName('UtilitySuit_Class5'));
  });
});

describe('ships', () => {
  it('resolves the lowercase names Loadout sends', () => {
    /*
     * `Loadout` is the event that actually tracks what somebody is flying, and it carries the hull
     * in lowercase with NO `Ship_Localised` at all. Anything relying on Frontier's localisation
     * gets nothing from the one event that is always current.
     */
    expect(shipDisplayName('panthermkii')).toBe('Panther Clipper Mk II');
    expect(shipDisplayName('python_nx')).toBe('Python Mk II');
    expect(shipDisplayName('explorer_nx')).toBe('Caspian Explorer');
    expect(shipDisplayName('lakonminer')).toBe('Type-11 Prospector');
  });

  it('resolves the same hull whatever case the journal used', () => {
    // `LoadGame` sends `Explorer_NX`, `Loadout` sends `explorer_nx`. One ship, one slice.
    expect(shipDisplayName('Explorer_NX')).toBe(shipDisplayName('explorer_nx'));
    expect(shipDisplayName('FerDeLance')).toBe('Fer-de-Lance');
    expect(shipDisplayName('CobraMkIII')).toBe('Cobra Mk III');
  });

  it('ignores a localised name when it knows the hull itself', () => {
    // Our mapping is the source of truth; theirs is the fallback. Otherwise a future Frontier bug
    // silently becomes our display name again.
    expect(shipDisplayName('anaconda', 'Something Else')).toBe('Anaconda');
  });

  it('falls back to the localised name for a hull nobody has mapped', () => {
    // A ship added next patch should read correctly before anybody updates the table.
    expect(shipDisplayName('brand_new_hull', 'Brand New Hull')).toBe('Brand New Hull');
  });
});

describe('MANDATORY: a localisation token never reaches a page', () => {
  it('refuses the token even as a fallback', () => {
    /*
     * THE BACKSTOP. Whatever else is unmapped or wrong, `$…;` must never be rendered — that string
     * on the dashboard is what started this investigation.
     */
    expect(shipDisplayName('SomeNewSuit_Class3', '$SomeNewSuit_Class1_Name;')).toBeNull();
    expect(shipDisplayName('unknown_hull', '$Unknown_Name;')).toBeNull();
  });

  it('returns null rather than an internal identifier', () => {
    // `panthermkii` on a member's profile is not better than an empty field; it is just a
    // different kind of wrong, and one that looks like a bug to whoever reads it.
    expect(shipDisplayName('some_unmapped_thing')).toBeNull();
  });

  it('handles absent values without inventing one', () => {
    expect(shipDisplayName(null)).toBeNull();
    expect(shipDisplayName(undefined)).toBeNull();
    expect(shipDisplayName('')).toBeNull();
  });
});
