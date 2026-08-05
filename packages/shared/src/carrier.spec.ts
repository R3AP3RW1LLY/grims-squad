import { describe, expect, it } from 'vitest';
import {
  CARRIER_STATION_TYPES,
  CALLSIGN_LENGTH,
  formatCallsign,
  isCarrierStationType,
  isCompleteCallsign,
  normaliseCallsign,
  normaliseStationType,
} from './carrier.js';

/**
 * The two facts that made a real carrier unfindable.
 *
 * ★ WHAT ACTUALLY HAPPENED — 2026-08-04 ★
 *
 * The squadron owner's carrier W8K-W1Y was parked at their own build site, catalogued, with a
 * market seen that morning, and the Carriers tab returned nothing for it. Not a rendering fault and
 * not a missing row: `knowledge_items.data->>'type'` said `"FleetCarrier"` and every carrier query
 * asked for `"Drake-Class Carrier"` exactly.
 *
 * Both halves are pinned here because neither is visible from looking at a screen. A vocabulary
 * mismatch renders as an empty list, which is indistinguishable from an honest empty list — and
 * that is precisely why it survived long enough for the owner to report it.
 */

describe('the station-type vocabulary', () => {
  it('★ recognises a carrier under BOTH spellings — the bug, in one assertion ★', () => {
    // The galaxy dump's word.
    expect(isCarrierStationType('Drake-Class Carrier')).toBe(true);
    // The journal's word, written over the dump's by any live Docked event. 673 carrier rows in the
    // dev mirror were in this state, including the owner's own.
    expect(isCarrierStationType('FleetCarrier')).toBe(true);
  });

  it('does not mistake an ordinary station for a carrier', () => {
    expect(isCarrierStationType('Coriolis Starport')).toBe(false);
    expect(isCarrierStationType('Outpost')).toBe(false);
    expect(isCarrierStationType('Space Construction Depot')).toBe(false);
  });

  it('treats an unknown type as not-a-carrier rather than throwing', () => {
    // A station whose type we never learned is NULL in the column, and it is not a carrier.
    expect(isCarrierStationType(null)).toBe(false);
    expect(isCarrierStationType(undefined)).toBe(false);
    expect(isCarrierStationType('')).toBe(false);
  });

  it('carries both spellings in the list every SQL reader binds', () => {
    // Bound as a parameter rather than interpolated, so no query can hand-write one of them again.
    expect([...CARRIER_STATION_TYPES].sort()).toEqual(['Drake-Class Carrier', 'FleetCarrier']);
  });
});

describe('normaliseStationType — stopping the two vocabularies diverging further', () => {
  it('★ turns the journal word into the dump word, which is what the write site now stores ★', () => {
    expect(normaliseStationType('FleetCarrier')).toBe('Drake-Class Carrier');
  });

  it('normalises the other pairs the same column holds under two names', () => {
    expect(normaliseStationType('Coriolis')).toBe('Coriolis Starport');
    expect(normaliseStationType('Orbis')).toBe('Orbis Starport');
    expect(normaliseStationType('Ocellus')).toBe('Ocellus Starport');
    // Journals from before the rename. Same station, older word.
    expect(normaliseStationType('Bernal')).toBe('Ocellus Starport');
    expect(normaliseStationType('AsteroidBase')).toBe('Asteroid base');
    expect(normaliseStationType('SpaceConstructionDepot')).toBe('Space Construction Depot');
  });

  it('passes an already-correct type through untouched', () => {
    expect(normaliseStationType('Drake-Class Carrier')).toBe('Drake-Class Carrier');
    expect(normaliseStationType('Outpost')).toBe('Outpost');
  });

  it('passes an UNRECOGNISED type through rather than dropping it', () => {
    // An unmapped type is still a true fact about the station. Discarding it would be a worse
    // trade than storing a word we happen to have no synonym for.
    expect(normaliseStationType('Something Frontier Added Last Tuesday')).toBe(
      'Something Frontier Added Last Tuesday',
    );
  });

  it('reads nothing as nothing', () => {
    expect(normaliseStationType(null)).toBeNull();
    expect(normaliseStationType(undefined)).toBeNull();
    expect(normaliseStationType('   ')).toBeNull();
  });
});

describe('normaliseCallsign — every way a person types W8K-W1Y', () => {
  /*
   * ★ THE OWNER TYPED IT AS IT IS PRINTED, AND SO WILL EVERYBODY ★
   *
   * The callsign appears on the contacts panel as `W8K-W1Y`. It is stored in the catalogue as
   * `W8K-W1Y`. A member on a phone gets it lower-cased by autocorrect, a member copying from
   * Discord gets a trailing space, and a member typing fast leaves the dash out. All four are the
   * same carrier, and the API, the website's boxed input and the companion's boxed input all
   * resolve them here rather than three times.
   */
  it('★ accepts the dashed form, the bare form, either case, and stray whitespace ★', () => {
    expect(normaliseCallsign('W8K-W1Y')).toBe('W8KW1Y');
    expect(normaliseCallsign('W8KW1Y')).toBe('W8KW1Y');
    expect(normaliseCallsign('w8k-w1y')).toBe('W8KW1Y');
    expect(normaliseCallsign('w8kw1y')).toBe('W8KW1Y');
    expect(normaliseCallsign('  W8K-W1Y  ')).toBe('W8KW1Y');
    expect(normaliseCallsign('W8K - W1Y')).toBe('W8KW1Y');
    // A paste out of a chat line that brought punctuation with it.
    expect(normaliseCallsign('"W8K-W1Y",')).toBe('W8KW1Y');
  });

  it('keeps a partial callsign partial — somebody is still typing', () => {
    expect(normaliseCallsign('W8K')).toBe('W8K');
    expect(normaliseCallsign('w8k-')).toBe('W8K');
    expect(isCompleteCallsign('W8K')).toBe(false);
    expect(isCompleteCallsign('W8K-W1Y')).toBe(true);
    expect(isCompleteCallsign('w8kw1y')).toBe(true);
  });

  it('never returns more characters than a callsign has', () => {
    // A paste of a whole sentence must not become a six-thousand-character LIKE pattern.
    expect(normaliseCallsign('W8K-W1Y is in Hyades Sector').length).toBe(CALLSIGN_LENGTH);
    expect(normaliseCallsign('W8K-W1Y is in Hyades Sector')).toBe('W8KW1Y');
  });

  it('reads a term made entirely of punctuation as nothing at all', () => {
    // The service refuses this rather than running a match on '' that would return the galaxy.
    expect(normaliseCallsign('---')).toBe('');
    expect(normaliseCallsign('   ')).toBe('');
  });
});

describe('formatCallsign — putting the dash back for a person to read', () => {
  it('writes a complete callsign the way the game writes it', () => {
    expect(formatCallsign('W8KW1Y')).toBe('W8K-W1Y');
    expect(formatCallsign('w8k-w1y')).toBe('W8K-W1Y');
  });

  it('does not put a trailing dash on a half-typed one', () => {
    // A refusal sentence quoting `W8K-` back at somebody reads as a fault in the box.
    expect(formatCallsign('W8K')).toBe('W8K');
    expect(formatCallsign('W8')).toBe('W8');
    expect(formatCallsign('')).toBe('');
  });

  it('round-trips through the boxed inputs, which store six bare characters', () => {
    // Both surfaces hold the value without the dash and draw the dash between cells, so this is
    // the exact conversion the search request and the refusal sentence both go through.
    expect(formatCallsign(normaliseCallsign('w8k w1y'))).toBe('W8K-W1Y');
  });
});
