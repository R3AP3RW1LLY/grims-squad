import { describe, it, expect } from 'vitest';
import { buildCommanderProfile, type ProfileEvent } from './commander-profile.service.js';

/**
 * Where a commander is, in two parts.
 *
 * ★ SQUADRON OWNER, 2026-07-30 ★
 *
 * "show the system they are currently in ... and then in the second column, show the station,
 * settlement, planet or what ever sublocation that is transmitted."
 *
 * ★ WHY THE SUBLOCATION NEEDS TESTS AND THE SYSTEM BARELY DOES ★
 *
 * A system comes from two events and the newer wins. A sublocation comes from FIVE, one of which
 * means the opposite of the others — `Undocked` names a station you are no longer at. Every way of
 * getting that wrong produces a plausible place name rather than an error, which is exactly the
 * kind of wrong that ships.
 */

const at = (iso: string) => new Date(iso);

const ev = (eventType: string, occurredAt: string, payload: Record<string, unknown>): ProfileEvent => ({
  eventType,
  occurredAt: at(occurredAt),
  payload,
});

const build = (events: ProfileEvent[]) => buildCommanderProfile(events, 'PEBBLEMERCHANT', null);

describe('the system', () => {
  it('takes the newer of a jump and a load-in', async () => {
    const p = build([
      ev('Location', '2026-08-01T10:00:00Z', { StarSystem: 'Sol' }),
      ev('FSDJump', '2026-08-01T11:00:00Z', { StarSystem: 'Deciat' }),
    ]);

    expect(p.currentSystem).toBe('Deciat');
  });
});

describe('the sublocation', () => {
  it('names the station when they are docked', () => {
    const p = build([
      ev('FSDJump', '2026-08-01T10:00:00Z', { StarSystem: 'Shinrarta Dezhra' }),
      ev('Docked', '2026-08-01T10:05:00Z', { StationName: 'Jameson Memorial' }),
    ]);

    expect(p.currentSystem).toBe('Shinrarta Dezhra');
    expect(p.currentLocation).toBe('Jameson Memorial');
  });

  it('names the body when they drop out of supercruise at one', () => {
    const p = build([
      ev('FSDJump', '2026-08-01T10:00:00Z', { StarSystem: 'Deciat' }),
      ev('SupercruiseExit', '2026-08-01T10:20:00Z', { Body: 'Deciat 6 A' }),
    ]);

    expect(p.currentLocation).toBe('Deciat 6 A');
  });

  it('names a settlement on approach', () => {
    const p = build([
      ev('Location', '2026-08-01T10:00:00Z', { StarSystem: 'Deciat' }),
      ev('ApproachSettlement', '2026-08-01T10:30:00Z', { Name: 'Garay Terminal' }),
    ]);

    expect(p.currentLocation).toBe('Garay Terminal');
  });

  it('MANDATORY: the newest of the five wins', () => {
    /*
     * Reading only one event type means a member who docks after loading in still shows the body
     * they loaded at — the right event, the wrong answer, and no way to tell from the screen.
     */
    const p = build([
      ev('Location', '2026-08-01T10:00:00Z', { StarSystem: 'Deciat', Body: 'Deciat A' }),
      ev('SupercruiseExit', '2026-08-01T10:10:00Z', { Body: 'Deciat 6' }),
      ev('Docked', '2026-08-01T10:20:00Z', { StationName: 'Garay Terminal' }),
    ]);

    expect(p.currentLocation).toBe('Garay Terminal');
  });

  it('MANDATORY: undocking clears it rather than naming the station they left', () => {
    /*
     * ★ THE BUG THIS EXISTS FOR ★
     *
     * `Undocked` carries a StationName too. Treated like the others it says a commander is AT the
     * station they just departed — and without it at all, somebody who undocks and flies away
     * shows as docked indefinitely. It is the only event that means "no longer anywhere in
     * particular", so it is read as a CLEAR.
     */
    const p = build([
      ev('Docked', '2026-08-01T10:00:00Z', { StationName: 'Jameson Memorial' }),
      ev('Undocked', '2026-08-01T10:40:00Z', { StationName: 'Jameson Memorial' }),
    ]);

    expect(p.currentLocation).toBeNull();
    expect(p.locationSeenAt).toBeNull();
  });

  it('prefers the station over the body when an event carries both', () => {
    // A planetary port reports both. "Jameson Memorial" tells somebody where you are in a way
    // "Shinrarta Dezhra A 1" does not.
    const p = build([
      ev('Location', '2026-08-01T10:00:00Z', {
        StarSystem: 'Shinrarta Dezhra',
        StationName: 'Jameson Memorial',
        Body: 'Shinrarta Dezhra A 1',
      }),
    ]);

    expect(p.currentLocation).toBe('Jameson Memorial');
  });

  it('is null when nothing has ever named one', () => {
    const p = build([ev('FSDJump', '2026-08-01T10:00:00Z', { StarSystem: 'Deciat' })]);

    expect(p.currentSystem).toBe('Deciat');
    expect(p.currentLocation).toBeNull();
  });
});

describe('the two timestamps are independent', () => {
  it('MANDATORY: dates the docking from the docking, not from the jump', () => {
    /*
     * They age at different rates — somebody can sit docked for an hour after arriving. One shared
     * timestamp would make a current docking look an hour old, or a stale one look fresh, and the
     * second of those is the reason anybody reads the timestamp at all.
     */
    const p = build([
      ev('FSDJump', '2026-08-01T10:00:00Z', { StarSystem: 'Deciat' }),
      ev('Docked', '2026-08-01T11:30:00Z', { StationName: 'Garay Terminal' }),
    ]);

    expect(p.systemSeenAt).toBe('2026-08-01T10:00:00.000Z');
    expect(p.locationSeenAt).toBe('2026-08-01T11:30:00.000Z');
  });
});
