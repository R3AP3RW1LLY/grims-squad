import { describe, it, expect } from 'vitest';
import { isInSquadron, SQUADRON_NAME } from './inara-link.service.js';

/**
 * Confirming a commander is in Grim's Squad, per Inara.
 *
 * Human decision, 2026-07-27: Inara is used for exactly TWO things — validating
 * the commander name and checking squadron membership. Everything else comes
 * from the journals via the companion app.
 *
 * ★ THIS IS A SIGNAL, NOT A GATE ★
 *
 * Plenty of real members never set a squadron on Inara at all. Refusing them
 * would punish people for not using a third-party site we do not run, so the
 * result is shown to officers and never blocks anything.
 */
describe('isInSquadron', () => {
  it('recognises the squadron', () => {
    expect(isInSquadron(SQUADRON_NAME)).toBe(true);
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
