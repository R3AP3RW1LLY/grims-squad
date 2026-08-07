import { describe, expect, it } from 'vitest';
import {
  buildCommanderProfile,
  PROFILE_EVENT_TYPES,
  type ProfileEvent,
} from './commander-profile.service.js';
import { JOURNAL_EVENTS, EVENT_FIELDS } from '@grims/shared';

/**
 * Where a member is, and the list that decides whether we can tell.
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * "my location is not updating as it should be in /dashboard, it shows me at grims sqwuad
 * sanctuary, but i am at a planetary station! we need this fixed! ... make sure this is shored up
 * so that we dont have this issue with other commanders!"
 *
 * Both events were in the database. Their newest `Docked` was the planetary construction site;
 * their newest `Location` was Grims Squad Sanctuary, twenty-eight minutes older. The builder picks
 * the newest of five events — and the QUERY that feeds it fetched only two of them, so
 * `latest.get('Docked')` was permanently `undefined` and the older event won every time.
 *
 * ★ WHY A TYPE COULD NOT CATCH IT ★
 *
 * `latest.get('Docked')` on a map that was never given a Docked event is a legal `undefined`, and
 * `undefined` is exactly what the builder expects for "this member has never docked". The two
 * lists could disagree for ever without a single compile error or failing test.
 *
 * So the last test here is the one that matters: the events the builder READS must be the events
 * the query FETCHES. That is the invariant, and it is the thing that was broken.
 */

const ev = (name: string, iso: string, payload: Record<string, unknown>): ProfileEvent =>
  ({ eventType: name, occurredAt: new Date(iso), payload }) as ProfileEvent;

/** Production's own rows, from the report. */
const DOCKED_AT_SITE = ev('Docked', '2026-08-05T16:20:26Z', {
  StarSystem: 'Hyades Sector XJ-Z c18',
  StationName: "Planetary Construction Site: Harry's Dysfunctional Society",
  StationType: 'PlanetaryConstructionDepot',
});

const LOCATION_AT_SANCTUARY = ev('Location', '2026-08-05T15:52:43Z', {
  StarSystem: 'Hyades Sector XJ-Z c18',
  StationName: 'Grims Squad Sanctuary',
});

describe('the sublocation on the dashboard', () => {
  it('MANDATORY: the newest event wins, even when an older Location disagrees', () => {
    /*
     * The exact reported case. Docked is 28 minutes newer than Location, and both name a station
     * in the same system — so nothing but the timestamp can decide, and the timestamp says the
     * construction site.
     */
    const profile = buildCommanderProfile(
      [LOCATION_AT_SANCTUARY, DOCKED_AT_SITE],
      'PebbleMerchant',
      null,
    );

    expect(profile.currentLocation).toBe(
      "Planetary Construction Site: Harry's Dysfunctional Society",
    );
    expect(profile.currentSystem).toBe('Hyades Sector XJ-Z c18');
  });

  it('order of arrival does not change the answer', () => {
    // The query returns rows in whatever order it likes; only occurredAt may decide.
    const profile = buildCommanderProfile(
      [DOCKED_AT_SITE, LOCATION_AT_SANCTUARY],
      'PebbleMerchant',
      null,
    );
    expect(profile.currentLocation).toContain('Planetary Construction Site');
  });

  it('undocking clears it rather than leaving them parked at the station they left', () => {
    const profile = buildCommanderProfile(
      [
        DOCKED_AT_SITE,
        ev('Undocked', '2026-08-05T16:40:00Z', {
          StationName: "Planetary Construction Site: Harry's Dysfunctional Society",
        }),
      ],
      'PebbleMerchant',
      null,
    );

    expect(profile.currentLocation).toBeNull();
  });

  it('a settlement approach counts, and so does a supercruise drop', () => {
    const settlement = buildCommanderProfile(
      [
        DOCKED_AT_SITE,
        ev('ApproachSettlement', '2026-08-05T16:50:00Z', { Name: 'Fenrir Reach' }),
      ],
      null,
      null,
    );
    expect(settlement.currentLocation).toBe('Fenrir Reach');

    const drop = buildCommanderProfile(
      [
        DOCKED_AT_SITE,
        ev('SupercruiseExit', '2026-08-05T17:00:00Z', { Body: 'Hyades Sector XJ-Z c18 A 2' }),
      ],
      null,
      null,
    );
    expect(drop.currentLocation).toBe('Hyades Sector XJ-Z c18 A 2');
  });
});

describe('the query fetches everything the builder reads', () => {
  it('MANDATORY: every sublocation event is in PROFILE_EVENT_TYPES', () => {
    /*
     * ★ THIS IS THE BUG, AS AN ASSERTION ★
     *
     * The builder reads these five. The query fetched two. Nothing failed, nothing warned, and the
     * dashboard confidently showed a location half an hour stale — for every member, not just the
     * one who noticed.
     */
    for (const name of ['Docked', 'Location', 'SupercruiseExit', 'ApproachSettlement', 'Undocked']) {
      expect(
        PROFILE_EVENT_TYPES as readonly string[],
        `${name} decides the sublocation but is never fetched, so it can never win`,
      ).toContain(name);
    }
  });

  it('MANDATORY: and everything the system line reads', () => {
    for (const name of ['FSDJump', 'Location']) {
      expect(PROFILE_EVENT_TYPES as readonly string[]).toContain(name);
    }
  });
});

describe('the events the query fetches are events that can exist', () => {
  /*
   * ★ THE SAME BUG, ONE LAYER FURTHER UP — 2026-08-06 ★
   *
   * The test above closed the gap between the BUILDER and the QUERY. It did not close the gap
   * between the query and REALITY: `SupercruiseExit`, `ApproachSettlement` and `Undocked` were
   * added to `PROFILE_EVENT_TYPES` and are not journal events this platform collects at all. They
   * are absent from the events map, so the companion never sends them and the server would discard
   * them if it did.
   *
   * Production, at the moment this was found: ZERO rows of all three, ever. The builder's "newest
   * of five events wins" was in fact "newest of two", and the fix that was written down as done on
   * 2026-08-05 changed nothing a member could see.
   *
   * Squadron owner, 2026-08-06: "my location does not seem to be updating as it should be."
   *
   * An allowlist naming an event nobody collects is not a fix; it is a comment that compiles.
   */
  it('MANDATORY: every fetched event is one the platform actually collects', () => {
    for (const name of PROFILE_EVENT_TYPES) {
      expect(
        JOURNAL_EVENTS[name as keyof typeof JOURNAL_EVENTS],
        `${name} is fetched by the profile query but is not a collectable journal event — it can never have a row`,
      ).toBeDefined();
    }
  });

  it('MANDATORY: Location keeps the body, or a member in space has no sublocation', () => {
    /*
     * The builder reads `StationName ?? Name ?? Body`. The server's field allowlist kept only
     * StarSystem, SystemAddress, StationName and Docked — so `Body` was discarded on ingest and the
     * third branch could never fire. Docked members had a station; everybody else had nothing, for
     * ever, and no amount of fixing the builder would have shown them a planet.
     */
    expect(
      EVENT_FIELDS.Location as readonly string[],
      'Location drops Body on ingest, so a member who is not docked can never have a sublocation',
    ).toContain('Body');
  });
});
