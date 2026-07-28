import { describe, it, expect } from 'vitest';
import { isInSquadron } from './inara-link.service.js';
import { expectedSquadronName } from '@grims/shared';

/**
 * Confirming a commander is in Grim's Squad, per Inara.
 *
 * Human decision, 2026-07-27: Inara is used for exactly TWO things — validating
 * the commander name and checking squadron membership. Everything else comes
 * from the journals via the companion app.
 *
 * ★ SUPERSEDED 2026-07-28: THIS IS NOW A GATE ★
 *
 * It used to be informational — "shown to officers, never blocks anything" — on
 * the reasoning that plenty of real members never set a squadron on Inara and
 * refusing them would punish people for not using a third-party site we do not
 * run.
 *
 * The squadron owner has since made it part of verification: a proven commander
 * name with no confirmed squadron is PARTIALLY verified, and the member is told
 * how to join and asked to say when they have. The old reasoning still holds
 * for the people it described — which is exactly why the middle state exists
 * rather than a flat refusal.
 *
 * The COMPARISON is what this file tests, and it is unchanged. It now lives in
 * @grims/shared so the twenty-minute re-check uses the same rule; two copies
 * would drift into a member the website accepts and the sweep rejects.
 */
describe('isInSquadron', () => {
  it('recognises the squadron', () => {
    expect(isInSquadron(expectedSquadronName())).toBe(true);
  });

  it('MANDATORY: tolerates how a human actually types it', () => {
    // A member types this into Inara by hand. An apostrophe they omitted, a
    // trailing space, or different capitalisation is the same squadron — and
    // treating it as a different one would flag real members as outsiders.
    for (const variant of [
      "grim's squad",
      'GRIMS SQUAD',
      'Grims Squad',
      "  Grim's Squad  ",
      "Grim’s Squad", // typographic apostrophe, which is what phones produce
    ]) {
      expect(isInSquadron(variant), variant).toBe(true);
    }
  });

  it('does not match a different squadron', () => {
    for (const other of ['The Fatherhood', 'Grim Reapers', 'Squad', 'Grims Squadron Two']) {
      expect(isInSquadron(other), other).toBe(false);
    }
  });

  it('treats "no squadron set" as not a match, without erroring', () => {
    // The common case for somebody who barely uses Inara. It means UNKNOWN, and
    // the UI says so rather than calling them an outsider.
    expect(isInSquadron(null)).toBe(false);
    expect(isInSquadron('')).toBe(false);
  });
});
