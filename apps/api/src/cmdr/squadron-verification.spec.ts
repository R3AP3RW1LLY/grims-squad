import { describe, it, expect } from 'vitest';
import {
  statusOf,
  awaitingSquadronCheck,
  sameSquadron,
  evaluateSquadron,
  expectedSquadronName,
  type VerificationState,
} from './squadron-verification.service.js';

/**
 * Squadron membership as a check separate from the commander name.
 *
 * ★ THE FAILURE THIS EXISTS TO PREVENT ★
 *
 * Proving you control a commander name proves nothing about whether you are in
 * THIS squadron. They were one step, so anybody who verified a name was treated
 * as a member — a stranger could reach members-only pages by verifying a
 * commander they genuinely own.
 */

const base: VerificationState = {
  cmdrName: 'PEBBLEMERCAHNT',
  isVerified: true,
  inaraSquadron: null,
  squadronVerifiedAt: null,
  squadronClaimedAt: null,
  squadronCheckedAt: null,
};

const AT = new Date('2026-07-28T20:00:00Z');

describe('the three states', () => {
  it('MANDATORY: no verified name is unverified', () => {
    expect(statusOf(null)).toBe('unverified');
    expect(statusOf({ ...base, isVerified: false })).toBe('unverified');
    expect(statusOf({ ...base, cmdrName: null })).toBe('unverified');
  });

  it('MANDATORY: a proven name with no confirmed squadron is PARTIAL', () => {
    /*
     * The state that matters. Folding it into "unverified" would tell somebody
     * their proof had failed when it had not; folding it into "verified" would
     * admit people who are not in the squadron.
     */
    expect(statusOf(base)).toBe('partial');
  });

  it('MANDATORY: both proven is verified', () => {
    expect(statusOf({ ...base, squadronVerifiedAt: AT })).toBe('verified');
  });

  it('a member in a DIFFERENT squadron is partial, not verified', () => {
    // Inara answered, and the answer was somebody else's squadron. They are as
    // unconfirmed as a member Inara has never heard of.
    expect(statusOf({ ...base, inaraSquadron: 'Some Other Squad', squadronCheckedAt: AT })).toBe(
      'partial',
    );
  });
});

describe('who the sweep asks about', () => {
  it('MANDATORY: only members who said they applied', () => {
    /*
     * Inara allows two requests a minute globally (INV-033). Polling every
     * partially-verified member forever would spend that budget on people who
     * have not applied and starve the ones who just did.
     */
    expect(awaitingSquadronCheck(base)).toBe(false);
    expect(awaitingSquadronCheck({ ...base, squadronClaimedAt: AT })).toBe(true);
  });

  it('stops asking once they are confirmed', () => {
    expect(
      awaitingSquadronCheck({ ...base, squadronClaimedAt: AT, squadronVerifiedAt: AT }),
    ).toBe(false);
  });

  it('never asks about an unverified member', () => {
    // No proven name means nothing to ask Inara about.
    expect(awaitingSquadronCheck({ ...base, isVerified: false, squadronClaimedAt: AT })).toBe(
      false,
    );
  });
});

describe('matching the squadron name', () => {
  const OURS = "Grim's Squad";

  it('MANDATORY: matches across every apostrophe in use', () => {
    /*
     * ★ THE ONE THAT WOULD HAVE REJECTED REAL MEMBERS ★
     *
     * The name exists here with a straight quote, with U+2019 (which is what
     * the Discord role uses), and with whatever Inara stored after somebody
     * typed it by hand. A plain equality check matches one of the three and
     * silently rejects the rest, with a failure that looks like Inara being
     * wrong rather than like a character encoding.
     */
    expect(sameSquadron("Grim's Squad", OURS)).toBe(true);
    expect(sameSquadron('Grim’s Squad', OURS)).toBe(true);
    expect(sameSquadron('Grims Squad', OURS)).toBe(true);
    expect(sameSquadron('  GRIM’S   SQUAD  ', OURS)).toBe(true);
  });

  it('does not match a different squadron', () => {
    expect(sameSquadron('Grim Squadron', OURS)).toBe(false);
    expect(sameSquadron('The Dark Wheel', OURS)).toBe(false);
  });

  it('MANDATORY: an empty or missing name never matches', () => {
    // Otherwise a normalised empty string equals a normalised empty string and
    // everybody with no squadron set is silently confirmed.
    expect(sameSquadron(null, OURS)).toBe(false);
    expect(sameSquadron('', OURS)).toBe(false);
    expect(sameSquadron('   ', OURS)).toBe(false);
    expect(sameSquadron(OURS, null)).toBe(false);
  });
});

describe('reading one Inara answer', () => {
  it('records what Inara said, whatever it was', () => {
    // A member in the wrong squadron can then be told WHICH one, rather than a
    // bare "not a member" — they need different things from that page.
    expect(evaluateSquadron('The Dark Wheel', "Grim's Squad")).toEqual({
      matched: false,
      reported: 'The Dark Wheel',
    });
  });

  it('treats blank as nothing reported', () => {
    expect(evaluateSquadron('   ', "Grim's Squad")).toEqual({ matched: false, reported: null });
    expect(evaluateSquadron(undefined, "Grim's Squad")).toEqual({ matched: false, reported: null });
  });

  it('confirms a match', () => {
    expect(evaluateSquadron('Grim’s Squad', "Grim's Squad").matched).toBe(true);
  });
});

describe('which squadron is ours', () => {
  it('is configurable', () => {
    expect(expectedSquadronName({ INARA_SQUADRON_NAME: 'Test Squad' })).toBe('Test Squad');
  });

  it('MANDATORY: falls back to the real name, never to blank', () => {
    /*
     * A blank default would make `sameSquadron` compare against nothing, and
     * every genuine member would read as an outsider on any deployment that
     * forgot to set the variable.
     */
    expect(expectedSquadronName({})).toBe("Grim's Squad");
    expect(expectedSquadronName({ INARA_SQUADRON_NAME: '  ' })).toBe("Grim's Squad");
  });
});
