import { describe, it, expect } from 'vitest';
import {
  TELEMETRY_CATALOGUE,
  REQUIRED_CATEGORY,
  undescribedEvents,
  categoryOf,
} from './telemetry-catalogue.js';
import { JOURNAL_EVENTS, NEVER_SENT, isSendable } from './journal-events.js';

/**
 * The catalogue a member reads before deciding what to switch off.
 *
 * ★ WHY THESE ARE MANDATORY UNDER OPT-OUT ★
 *
 * When telemetry was opt-in, an event missing from the settings page was simply
 * never collected — annoying, harmless. Now the default is collect, so an event
 * that is gathered and NOT described is gathered without disclosure. That is
 * the difference between a privacy notice and a secret.
 */

describe('everything collected is described', () => {
  it('MANDATORY: no allowlisted event is missing from the catalogue', () => {
    /*
     * The one that matters. An event added to JOURNAL_EVENTS without a
     * catalogue entry is collected by default, invisible on the settings page,
     * and impossible for a member to switch off.
     */
    expect(undescribedEvents()).toEqual([]);
  });

  it('MANDATORY: every described event is one we actually collect', () => {
    // The reverse. A toggle for something never sent tells a member they have
    // controlled something they have not.
    const known = new Set(Object.keys(JOURNAL_EVENTS));
    const described = TELEMETRY_CATALOGUE.flatMap((g) => g.entries.map((e) => e.event));
    expect(described.filter((e) => !known.has(e))).toEqual([]);
  });

  it('describes what each event reveals, not just its name', () => {
    // "MultiSellExplorationData" tells a member nothing. A sentence about what
    // it discloses is the whole point of the catalogue.
    for (const group of TELEMETRY_CATALOGUE) {
      for (const entry of group.entries) {
        expect(entry.reveals.length, `${entry.event} has no description`).toBeGreaterThan(20);
        expect(entry.label, `${entry.event} has no label`).not.toBe(entry.event);
      }
    }
  });
});

describe('the required category', () => {
  it('MANDATORY: exactly one group is required, and it is session', () => {
    /*
     * Promotion eligibility is computed from it. More than one required group
     * would be scope creep in the one place a member cannot argue with; none
     * would let somebody silently stop qualifying for promotions.
     */
    const required = TELEMETRY_CATALOGUE.filter((g) => g.required);
    expect(required).toHaveLength(1);
    expect(required[0]?.category).toBe(REQUIRED_CATEGORY);
    expect(REQUIRED_CATEGORY).toBe('session');
  });

  it('the required group explains WHY in its own words', () => {
    // A control that cannot move and does not say why reads as a bug.
    const required = TELEMETRY_CATALOGUE.find((g) => g.required);
    expect(required?.purpose).toMatch(/promotion/i);
  });
});

describe('what is never transmitted', () => {
  it('MANDATORY: private messages and the friends list never leave the machine', () => {
    /*
     * These carry the CONTENT of somebody else's words. A member can consent to
     * sharing their own data; they cannot consent on behalf of the commander
     * who messaged them.
     */
    for (const e of ['SendText', 'ReceiveText', 'Friends']) {
      expect(isSendable(e), `${e} must never be sent`).toBe(false);
    }
  });

  it('MANDATORY: Died IS sent, for the killboard', () => {
    /*
     * Removed from the never-send list on 2026-07-29. It names another
     * commander — but so does PVPKill, which was always sent, and a killboard
     * needs both sides of a fight. Excluding one while sending the other was
     * the real inconsistency.
     */
    expect(isSendable('Died')).toBe(true);
    expect(NEVER_SENT).not.toContain('Died');
    expect(categoryOf('Died')).toBe('combat');
  });

  it('nothing on the never-send list is in the catalogue', () => {
    // Offering a toggle for something never transmitted would be a control
    // over nothing.
    /*
     * `Set<string>`, not `Set<JournalEventName>`. The never-send list holds
     * names that are deliberately NOT in the allowlist union — that is the
     * whole point of it — so a narrowly typed set cannot even be asked about
     * them.
     */
    const described = new Set<string>(
      TELEMETRY_CATALOGUE.flatMap((g) => g.entries.map((e) => e.event)),
    );
    for (const e of NEVER_SENT) expect(described.has(e), `${e} is described but never sent`).toBe(false);
  });
});

describe('categoryOf', () => {
  it('returns the CONSENT category, not the internal label', () => {
    /*
     * `JOURNAL_EVENTS` maps to labels like 'ranks' and 'squadron' which share a
     * consent category. Comparing a label against a stored category would
     * silently match nothing and let every opt-out through.
     */
    expect(categoryOf('Rank')).toBe('profile');
    expect(categoryOf('SquadronStartup')).toBe('profile');
    expect(categoryOf('Loadout')).toBe('fleet');
    expect(categoryOf('LoadGame')).toBe('session');
  });

  it('returns null for something we do not collect', () => {
    expect(categoryOf('SendText')).toBeNull();
    expect(categoryOf('NotAnEvent')).toBeNull();
  });
});
