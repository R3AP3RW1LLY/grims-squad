import { describe, it, expect } from 'vitest';
import {
  JOURNAL_EVENTS,
  EVENT_FIELDS,
  isAllowedEvent,
  pickAllowedFields,
  isLiveGameSession,
} from './journal-events.js';

/**
 * What the companion app is allowed to send (P1.11).
 *
 * ★ THE PRIVACY DESIGN IS THE ORDERING ★
 *
 * Elite's journal holds hundreds of event types and a great deal that is
 * nobody's business. The app filters on the MEMBER'S OWN MACHINE, before
 * anything is transmitted — because "we promise to throw it away" is a far
 * weaker promise than never having received it.
 *
 * These tests exist so that adding an event, or widening a field list, is a
 * deliberate act that shows up in review rather than something that drifts in
 * with a feature.
 */
describe('the event allowlist', () => {
  it('MANDATORY: is an ALLOWLIST — an unlisted event is refused', () => {
    // The failure mode of a blocklist is that every new game update adds
    // events nobody has thought about, and they flow straight through.
    for (const denied of [
      'Bounty',
      'FSDJump',
      'Docked',
      'SendText',
      'ReceiveText',
      'Friends',
      'Died',
      'CommitCrime',
      'Statistics',
      'Materials',
    ]) {
      expect(isAllowedEvent(denied), denied).toBe(false);
    }
  });

  it('allows exactly the six events we use', () => {
    expect(Object.keys(JOURNAL_EVENTS).sort()).toEqual([
      'LoadGame',
      'Loadout',
      'Progress',
      'Rank',
      'SquadronStartup',
      'StoredShips',
    ]);
  });

  it('MANDATORY: never sends chat', () => {
    // SendText and ReceiveText carry private conversations, including direct
    // messages. There is no version of this product that needs them.
    expect(isAllowedEvent('SendText')).toBe(false);
    expect(isAllowedEvent('ReceiveText')).toBe(false);
  });
});

describe('field-level filtering', () => {
  it('MANDATORY: drops a member’s credit balance from LoadGame', () => {
    /*
     * LoadGame carries Credits, Loan and the Frontier account ID alongside the
     * commander name. We need to know they PLAYED; we do not need their bank
     * balance to establish that, and a squadron site holding it invites
     * comparisons nobody asked for.
     */
    const raw = {
      Commander: 'GRIM',
      Ship: 'Anaconda',
      Credits: 1_204_998_221,
      Loan: 0,
      FID: 'F1234567',
      GameMode: 'Open',
      Odyssey: true,
    };
    const picked = pickAllowedFields('LoadGame', raw);

    expect(picked['Commander']).toBe('GRIM');
    expect(picked).not.toHaveProperty('Credits');
    expect(picked).not.toHaveProperty('Loan');
    expect(picked).not.toHaveProperty('FID');
  });

  it('MANDATORY: the Frontier account ID is never kept, from any event', () => {
    // FID identifies the person to Frontier. It is not ours to hold, and it
    // appears in more events than anyone remembers.
    for (const name of Object.keys(EVENT_FIELDS)) {
      expect(EVENT_FIELDS[name as keyof typeof EVENT_FIELDS], name).not.toContain('FID');
    }
  });

  it('omits an absent field rather than writing undefined', () => {
    // An explicit undefined survives Object.keys and reads as "we have this and
    // it is empty" rather than "we do not have this".
    const picked = pickAllowedFields('LoadGame', { Commander: 'GRIM' });
    expect(Object.keys(picked)).toEqual(['Commander']);
  });

  it('keeps what each event is actually for', () => {
    expect(pickAllowedFields('Rank', { Combat: 7, Trade: 4, Explore: 8 })).toEqual({
      Combat: 7,
      Trade: 4,
      Explore: 8,
    });
    expect(
      pickAllowedFields('SquadronStartup', { SquadronName: "Grim's Squad", CurrentRank: 3 }),
    ).toEqual({ SquadronName: "Grim's Squad", CurrentRank: 3 });
  });

  it('every allowed event has a field list', () => {
    // An event allowed with no field list would pick nothing and look like a
    // silent failure rather than a configuration mistake.
    for (const name of Object.keys(JOURNAL_EVENTS)) {
      expect(EVENT_FIELDS[name as keyof typeof EVENT_FIELDS], name).toBeDefined();
      expect(EVENT_FIELDS[name as keyof typeof EVENT_FIELDS].length).toBeGreaterThan(0);
    }
  });
});

describe('live game only', () => {
  it('MANDATORY: rejects a Legacy session', () => {
    // Horizons 3.8 describes a different galaxy state. Recording it against a
    // member's current standing would be wrong, and it is the rule Inara
    // states plainly for its own uploads.
    expect(isLiveGameSession({ Commander: 'GRIM', Odyssey: false })).toBe(false);
    expect(isLiveGameSession({ Commander: 'GRIM' })).toBe(false);
  });

  it('accepts a live session', () => {
    expect(isLiveGameSession({ Commander: 'GRIM', Odyssey: true })).toBe(true);
  });
});
