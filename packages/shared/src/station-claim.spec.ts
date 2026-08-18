import { describe, expect, it } from 'vitest';
import {
  readClaimOwnership,
  stationClaimKey,
  stationNameFromClaimKey,
} from './station-claim.js';

/**
 * The key an officer's claim is stored under, and the one the ranking reads back.
 *
 * ★ WHAT THIS IS REALLY GUARDING ★
 *
 * Not the string concatenation. The failure available here is that a claim is accepted, stored,
 * listed back to the officer who made it, and silently ignored by the ordering it exists to
 * change — because the writer and the reader disagree about where the station name starts.
 *
 * `colony-purchases.service.ts` reads the tail after the first separator and matches it against a
 * station name. Every assertion below is about that round trip holding.
 */

describe('the claim key', () => {
  it('★ MANDATORY: what is written comes back out ★', () => {
    const key = stationClaimKey('3107576660434', 'Wescott Platform');
    expect(stationNameFromClaimKey(key)).toBe('Wescott Platform');
  });

  it('★ MANDATORY: a station name containing a slash survives the round trip ★', () => {
    /*
     * The reader rejoins everything after the FIRST separator, so the right half may contain one.
     * A writer that split on the last, or a reader that took only the second segment, would hand
     * the ranking "Ceos" for a station called "Ceos/Hutton" and quietly match the wrong place.
     */
    const key = stationClaimKey('123', 'Jameson Memorial/Annex');
    expect(stationNameFromClaimKey(key)).toBe('Jameson Memorial/Annex');
  });

  it('★ MANDATORY: a slash in the SYSTEM half cannot move the split point ★', () => {
    // The address is numeric in practice, but the fallback is a system NAME typed by a person.
    // One slash there would truncate every station name claimed in that system.
    const key = stationClaimKey('Col 285/Sector', 'Wescott Platform');
    expect(stationNameFromClaimKey(key)).toBe('Wescott Platform');
  });

  it('trims, because a trailing space makes a second primary key for one station', () => {
    expect(stationClaimKey('  123  ', '  Wescott Platform  ')).toBe('123/Wescott Platform');
  });

  it('refuses to build a key with a missing half rather than storing a broken one', () => {
    // '' is a value the caller checks. A key like "/Wescott Platform" or "123/" would be a row that
    // can never match anything and can never be found again to withdraw.
    expect(stationClaimKey('', 'Wescott Platform')).toBe('');
    expect(stationClaimKey('123', '   ')).toBe('');
  });
});

describe('what an officer is allowed to claim', () => {
  it('accepts the two the ranking understands', () => {
    expect(readClaimOwnership('squadron')).toBe('squadron');
    expect(readClaimOwnership('member')).toBe('member');
  });

  it('★ MANDATORY: anything else is refused, not defaulted ★', () => {
    /*
     * The schema says a third value "should degrade to 'not ours' rather than break the sort" —
     * correct for a row already in the table, wrong for somebody pressing a button. Storing a claim
     * that ranks as unowned would look like it worked and change nothing, which is the exact
     * failure this whole feature was written to end.
     */
    for (const bad of ['neutral', 'SQUADRON', '', null, undefined, 1, {}]) {
      expect(readClaimOwnership(bad), `${String(bad)} must be refused`).toBeNull();
    }
  });
});
