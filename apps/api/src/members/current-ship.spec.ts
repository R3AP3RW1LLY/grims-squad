import { describe, expect, it } from 'vitest';
import { buildCommanderProfile, type ProfileEvent } from './commander-profile.service.js';

/**
 * The ship a member is actually flying.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "not all of my ships are being shown, infact the one im currently flying is not even visible or
 * hilighting like it was before."
 *
 * Both halves of that were true, and both came from one wrong assumption. The builder marked the
 * current ship rather than adding it, with the note "it is already in the hangar list".
 *
 * It is not. `StoredShips` lists ships in STORAGE — `ShipsHere` is what is parked where you are
 * standing, `ShipsRemote` is everything else — and the hull you are sitting in is in neither,
 * because it is not stored. You are flying it.
 *
 * ★ AND THE EVENT IS OFTEN HOURS OLD ★
 *
 * `StoredShips` only fires at a shipyard. Production, at the moment of the report:
 *
 *   StoredShips  2026-08-05 18:39   Caspian Explorer, Lynx Highliner,
 *                                   Type-11 Prospector, Python Mk II
 *   Loadout      2026-08-06 15:29   panthermkii "sovereign of the hoard"
 *
 * Twenty-one hours apart. The dashboard listed four ships, highlighted none of them, and the one
 * being flown was invisible — exactly as reported.
 *
 * `Loadout` fires on every ship change and every login, so it is always current. It is the only
 * honest answer to "what are they in right now", and the fleet has to include it.
 */

const ev = (name: string, iso: string, payload: Record<string, unknown>): ProfileEvent =>
  ({ eventType: name, occurredAt: new Date(iso), payload }) as ProfileEvent;

/** The squadron owner's own rows, from the report. */
const STORED_YESTERDAY = ev('StoredShips', '2026-08-05T18:39:10Z', {
  StarSystem: 'Nervi',
  ShipsHere: [],
  ShipsRemote: [
    { ShipType: 'Explorer_NX', ShipType_Localised: 'Caspian Explorer', StarSystem: 'Nervi' },
    { ShipType: 'mediumtransport01', ShipType_Localised: 'Lynx Highliner', StarSystem: 'Nervi' },
    { ShipType: 'LakonMiner', ShipType_Localised: 'Type-11 Prospector', StarSystem: 'Nervi' },
    { ShipType: 'pythonmkii', ShipType_Localised: 'Python Mk II', StarSystem: 'Nervi' },
  ],
});

const FLYING_NOW = ev('Loadout', '2026-08-06T15:29:27Z', {
  Ship: 'panthermkii',
  ShipName: 'sovereign of the hoard',
});

function profile(events: ProfileEvent[]) {
  return buildCommanderProfile(events, null, null);
}

describe('the ship being flown appears in the fleet', () => {
  it('MANDATORY: it is listed even when StoredShips has never heard of it', () => {
    const { fleet: ships } = profile([STORED_YESTERDAY, FLYING_NOW]);

    const names = ships.map((s) => s.shipType);
    expect(
      names,
      'the hull the member is sitting in is missing from their own fleet list',
    ).toContain('Panther Clipper Mk II');
  });

  it('MANDATORY: it is the one marked current', () => {
    const { fleet: ships } = profile([STORED_YESTERDAY, FLYING_NOW]);

    const current = ships.filter((s) => s.current);
    expect(current, 'no ship is highlighted, or more than one is').toHaveLength(1);
    expect(current[0]?.shipType).toBe('Panther Clipper Mk II');
  });

  it('MANDATORY: every stored ship is still listed', () => {
    /*
     * The other half of the report — "not all of my ships are being shown". Adding the current one
     * must not cost any of the others.
     */
    const { fleet: ships } = profile([STORED_YESTERDAY, FLYING_NOW]);

    for (const expected of [
      'Caspian Explorer',
      'Lynx Highliner',
      'Type-11 Prospector',
      'Python Mk II',
    ]) {
      expect(ships.map((s) => s.shipType), `${expected} vanished from the fleet`).toContain(expected);
    }
    expect(ships).toHaveLength(5);
  });

  it('MANDATORY: a ship that IS in storage is not listed twice', () => {
    /*
     * The original note was right about this much: a duplicate row reads as owning two of them.
     * `ShipsHere` does contain the current hull immediately after docking, before it is swapped.
     */
    const dockedWithIt = ev('StoredShips', '2026-08-06T15:30:00Z', {
      StarSystem: 'Nervi',
      ShipsHere: [{ ShipType: 'panthermkii', ShipType_Localised: 'Panther Clipper Mk II' }],
      ShipsRemote: [],
    });

    const { fleet: ships } = profile([dockedWithIt, FLYING_NOW]);

    expect(ships.filter((s) => s.shipType === 'Panther Clipper Mk II')).toHaveLength(1);
    expect(ships.filter((s) => s.current)).toHaveLength(1);
  });

  it('MANDATORY: the name the member gave it survives', () => {
    /*
     * "sovereign of the hoard" is on the Loadout and nowhere else. A fleet row that says only
     * "Panther Clipper Mk II" throws away the one part a member wrote themselves.
     */
    const { fleet: ships } = profile([STORED_YESTERDAY, FLYING_NOW]);
    const current = ships.find((s) => s.current);

    expect(current?.name).toBe('sovereign of the hoard');
  });

  it('a member with no Loadout at all still gets their stored fleet', () => {
    // Somebody who has paired but not flown since. Four ships, none current, no crash.
    const { fleet: ships } = profile([STORED_YESTERDAY]);

    expect(ships).toHaveLength(4);
    expect(ships.some((s) => s.current)).toBe(false);
  });
});
