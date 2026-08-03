import { describe, expect, it, vi } from 'vitest';
import { fetchSystemBodies, mapBody, parentOf } from './edsm-bodies.js';

/**
 * Reading a system's bodies.
 *
 * ★ THE FIXTURES ARE REAL RESPONSES ★
 *
 * Taken off the live EDSM API rather than invented, including the two things a hand-written fixture
 * would have tidied away: a star with no `gravity` field at all, and `terraformingState` being prose
 * ("Not terraformable") rather than a boolean.
 */

const SOL_MOON = {
  bodyId: 4,
  name: 'Moon',
  type: 'Planet',
  subType: 'Rocky body',
  parents: [{ Planet: 3 }, { Star: 0 }],
  distanceToArrival: 493,
  isLandable: false,
  gravity: 0.16567075215550864,
  surfaceTemperature: 250,
  terraformingState: 'Not terraformable',
  rotationalPeriodTidallyLocked: true,
};

const SATURN = {
  bodyId: 13,
  name: 'Saturn',
  type: 'Planet',
  subType: 'Class I gas giant',
  parents: [{ Star: 0 }],
  distanceToArrival: 4729,
  isLandable: false,
  gravity: 1.112,
  surfaceTemperature: 87,
  rings: [{ name: 'D Ring', type: 'Icy' }],
};

function respond(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, text: async () => JSON.stringify(body) });
}

describe('mapping one body', () => {
  it('reads the fields a planner decides by', () => {
    const b = mapBody(SOL_MOON);
    expect(b?.name).toBe('Moon');
    expect(b?.subType).toBe('Rocky body');
    expect(b?.isLandable).toBe(false);
    expect(b?.gravity).toBeCloseTo(0.1657, 3);
    expect(b?.temperature).toBe(250);
  });

  it('reads rings as a flag rather than a list', () => {
    expect(mapBody(SATURN)?.hasRings).toBe(true);
    expect(mapBody(SOL_MOON)?.hasRings).toBe(false);
  });

  it('treats "Not terraformable" as not terraformable', () => {
    /*
     * The field is PROSE, not a boolean — "Candidate for terraforming", "Terraformed" and "Not
     * terraformable" all appear. Truthiness on the string would make every body terraformable,
     * including the ones that say they are not.
     */
    expect(mapBody(SOL_MOON)?.terraformable).toBe(false);
    expect(mapBody({ ...SOL_MOON, terraformingState: 'Candidate for terraforming' })?.terraformable).toBe(true);
    // Absent means unknown, and unknown is not a claim.
    expect(mapBody({ ...SOL_MOON, terraformingState: undefined })?.terraformable).toBe(false);
  });

  it('reads "No atmosphere" and "No volcanism" as absence', () => {
    const bare = mapBody({ ...SOL_MOON, atmosphereType: 'No atmosphere', volcanismType: 'No volcanism' });
    expect(bare?.hasAtmosphere).toBe(false);
    expect(bare?.hasVolcanism).toBe(false);

    const busy = mapBody({ ...SOL_MOON, atmosphereType: 'Thin Carbon dioxide', volcanismType: 'Minor Silicate Vapour Geysers' });
    expect(busy?.hasAtmosphere).toBe(true);
    expect(busy?.hasVolcanism).toBe(true);
  });

  it('drops a body with no id or no name rather than drawing a blank node', () => {
    expect(mapBody({ name: 'Nameless' })).toBeNull();
    expect(mapBody({ bodyId: 7 })).toBeNull();
  });
});

describe('working out what a body orbits', () => {
  it('takes the NEAREST parent, not the furthest', () => {
    /*
     * EDSM orders `parents` from nearest outwards. `[{Planet: 3}, {Star: 0}]` means "a moon of body
     * 3, which orbits body 0" — so the tree needs 3. Taking the last would hang every moon in the
     * system off the star and flatten the diagram.
     */
    expect(parentOf([{ Planet: 3 }, { Star: 0 }])).toBe(3);
  });

  it('skips a barycentre, which is real but cannot be drawn', () => {
    // Two stars orbiting each other have a barycentre with no body of its own. The child attaches
    // to the nearest thing that actually exists on screen.
    expect(parentOf([{ Null: 30 }, { Star: 0 }])).toBe(0);
  });

  it('says nothing for the primary star', () => {
    expect(parentOf(undefined)).toBeNull();
    expect(parentOf([])).toBeNull();
  });
});

describe('fetching a system', () => {
  it('returns the system with its bodies nearest first', async () => {
    const fetcher = respond({
      id64: 10477373803,
      name: 'Sol',
      bodyCount: 40,
      bodies: [SATURN, SOL_MOON],
    });

    const out = await fetchSystemBodies('Sol', fetcher);
    expect(out?.id64).toBe(10477373803);
    expect(out?.bodyCount).toBe(40);
    // Nearest first: the order a system map is read in, and the order somebody flies them.
    expect(out?.bodies.map((b) => b.name)).toEqual(['Moon', 'Saturn']);
  });

  it('URL-encodes a system name with spaces', async () => {
    const fetcher = respond({ id64: 1, name: 'A B', bodies: [] });
    await fetchSystemBodies('Hyades Sector XJ-Z c18', fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('systemName=Hyades%20Sector%20XJ-Z%20c18'),
    );
  });

  it('answers null for a system EDSM has never heard of', async () => {
    /*
     * ★ AN UNKNOWN SYSTEM IS HTTP 200 WITH AN EMPTY OBJECT ★
     *
     * Not a 404. So it has to be detected from the BODY of the response — and returning null lets
     * the page say "we hold nothing for that system" rather than drawing an empty diagram as though
     * the system were genuinely barren.
     */
    expect(await fetchSystemBodies('Nowhere', respond({}))).toBeNull();
  });

  it('answers null on a transport failure rather than throwing', async () => {
    expect(await fetchSystemBodies('Sol', respond({}, false))).toBeNull();
    expect(
      await fetchSystemBodies('Sol', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'not json' })),
    ).toBeNull();
  });
});
