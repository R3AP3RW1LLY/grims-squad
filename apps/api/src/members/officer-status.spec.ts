import { describe, it, expect } from 'vitest';
import { LEADERSHIP_CEILING } from './members.store.js';

/**
 * Who counts as an officer.
 *
 * ★ THE MISTAKE THIS ENCODES ★
 *
 * The first version read the PERMISSION MASK, which made the webmaster an
 * officer — an account holding every permission on the platform and no standing
 * in the squadron at all. Corrected on the squadron owner's instruction: rank
 * decides, and theirs is Cadet.
 */

/** The rule, as the controller applies it. */
const isOfficer = (rankOrders: ReadonlyArray<number | null>): boolean =>
  rankOrders.some((order) => order !== null && order < LEADERSHIP_CEILING);

// From the seeded ladder. Below 100 describes itself as "Reserved" and
// "Leadership"; 100 and up is earned by qualifying months.
const GALACTIC_ADMIRAL = 10;
const SQUADRON_LEADER = 60;
const CADET = 100;
const GRAND_MASTER_GENERAL = 190;

describe('officer status', () => {
  it('MANDATORY: a Cadet is NOT an officer', () => {
    // The case that prompted the fix.
    expect(isOfficer([CADET])).toBe(false);
  });

  it('MANDATORY: the top of the TENURE ladder is still not an officer', () => {
    /*
     * "Grand Master General" is twelve qualifying months, not an office. The
     * name is the trap: seniority-sounding titles on the tenure ladder outrank
     * nobody, and a rule written from names rather than numbers would get this
     * exactly backwards.
     */
    expect(isOfficer([GRAND_MASTER_GENERAL])).toBe(false);
  });

  it('MANDATORY: a leadership appointment IS an officer', () => {
    expect(isOfficer([SQUADRON_LEADER])).toBe(true);
    expect(isOfficer([GALACTIC_ADMIRAL])).toBe(true);
  });

  it('MANDATORY: holding both makes them an officer', () => {
    // Somebody can be a Cadet by tenure and a Squadron Leader by appointment.
    // The appointment is what puts them on the officers tab.
    expect(isOfficer([CADET, SQUADRON_LEADER])).toBe(true);
  });

  it('MANDATORY: an unmapped Discord role decides nothing', () => {
    /*
     * `null` means the role maps to no internal rank — a colour role, a bot, a
     * channel-access role. Treating null as 0 would make every one of them a
     * leadership appointment, which is the whole squadron.
     */
    expect(isOfficer([null, null])).toBe(false);
  });

  it('somebody with no roles at all is not an officer', () => {
    expect(isOfficer([])).toBe(false);
  });

  it('MANDATORY: the ceiling sits between the two ladders', () => {
    // Squadron Leader is the lowest leadership rank and Cadet the highest
    // non-officer. If these ever meet, one group silently absorbs the other.
    expect(SQUADRON_LEADER).toBeLessThan(LEADERSHIP_CEILING);
    expect(CADET).toBeGreaterThanOrEqual(LEADERSHIP_CEILING);
  });
});
