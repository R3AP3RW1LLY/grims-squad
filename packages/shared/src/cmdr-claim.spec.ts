import { describe, expect, it } from 'vitest';
import { resolveClaim, type ExistingClaim } from './cmdr-claim.js';

/**
 * Two accounts, one commander name.
 *
 * ★ WHY THIS HAS TO BE DECIDED BEFORE THE FIRST MEMBER LINKS ★
 *
 * `cmdrName` is unique across every live verification — a partial unique index the schema documents
 * as something Prisma cannot express (INV-005). So the moment Frontier tells us a member is
 * CMDR Grim and somebody else already holds that name, the write FAILS. At the database, with a
 * constraint error, in the middle of an OAuth callback the member is watching.
 *
 * Deciding it there means deciding it badly. This decides it here, where the rules can be read.
 *
 * ★ THE TIERS ARE THE ANSWER, AND THE SCHEMA ALREADY RANKS THEM ★
 *
 *   3  fdev_capi       Frontier itself said so. Cryptographic.
 *   2  inara_nonce     the member put our nonce in a bio they control.
 *   1  officer_manual  an officer looked at a screenshot.
 *
 * A screenshot is a photograph of a claim. Frontier's OAuth is Frontier answering the question
 * directly. When they disagree, the stronger evidence wins — and the weaker claim is REVOKED rather
 * than deleted, so the history of who claimed what survives being wrong.
 */

const existing = (over: Partial<ExistingClaim> = {}): ExistingClaim => ({
  userId: over.userId ?? 'other-member',
  trustTier: over.trustTier ?? 1,
  method: over.method ?? 'officer_manual',
});

describe('claiming a commander nobody holds', () => {
  it('★ MANDATORY: an unclaimed name is simply granted ★', () => {
    const out = resolveClaim({ userId: 'me', cmdrName: 'Grim', existing: null });

    expect(out.kind).toBe('grant');
  });
});

describe('claiming a commander somebody else holds', () => {
  it('★ MANDATORY: cryptographic proof beats an officer’s screenshot ★', () => {
    /*
     * The common real case: an officer vouched for somebody months ago, and now the actual
     * commander links their Frontier account. Frontier is answering directly; the screenshot was
     * always a photograph of a claim.
     */
    const out = resolveClaim({
      userId: 'me',
      cmdrName: 'Grim',
      existing: existing({ trustTier: 1, method: 'officer_manual' }),
    });

    expect(out.kind).toBe('supersede');
    expect(out.kind === 'supersede' ? out.revokeUserId : null).toBe('other-member');
  });

  it('★ MANDATORY: it beats an Inara nonce too ★', () => {
    // Tier 2 is a member proving control of a bio. Still weaker than Frontier saying it.
    const out = resolveClaim({
      userId: 'me',
      cmdrName: 'Grim',
      existing: existing({ trustTier: 2, method: 'inara_nonce' }),
    });

    expect(out.kind).toBe('supersede');
  });

  it('★ MANDATORY: two cAPI claims on one commander is REFUSED, not silently resolved ★', () => {
    /*
     * This should be impossible — one Frontier account owns one commander — so if it happens,
     * something is wrong that a human needs to look at: a transferred account, a shared login, or a
     * bug in our own storage.
     *
     * Superseding here would let whoever linked most recently take a commander from somebody who
     * also proved it cryptographically. Refusing is the only answer that cannot be abused, and it
     * is loud rather than silent.
     */
    const out = resolveClaim({
      userId: 'me',
      cmdrName: 'Grim',
      existing: existing({ trustTier: 3, method: 'fdev_capi' }),
    });

    expect(out.kind).toBe('refuse');
    expect(out.kind === 'refuse' ? out.reason : '').toMatch(/already|another|officer/i);
  });

  it('★ MANDATORY: re-linking your OWN commander is not a conflict ★', () => {
    /*
     * A member reconnecting after the 25-day ceiling hits this path every time. Treating their own
     * existing claim as somebody else's would refuse the reconnection the platform just asked them
     * to make — and the message would tell them their own name was taken.
     */
    const out = resolveClaim({
      userId: 'me',
      cmdrName: 'Grim',
      existing: existing({ userId: 'me', trustTier: 3, method: 'fdev_capi' }),
    });

    expect(out.kind).toBe('grant');
  });

  it('MANDATORY: the refusal never names the other member', () => {
    /*
     * "CMDR Grim is already claimed by sarahlilac" tells whoever typed it something about another
     * member's account they had no right to learn — and the useful half is the same without it.
     */
    const out = resolveClaim({
      userId: 'me',
      cmdrName: 'Grim',
      existing: existing({ userId: 'sarahlilac', trustTier: 3, method: 'fdev_capi' }),
    });

    expect(out.kind === 'refuse' ? out.reason : '').not.toContain('sarahlilac');
  });
});

describe('what a supersede means for the member who loses it', () => {
  it('★ MANDATORY: revoked, never deleted ★', () => {
    /*
     * The row is the record that somebody once claimed this and an officer approved it. Deleting it
     * erases a decision that was made in good faith; revoking it says what happened and when.
     */
    const out = resolveClaim({
      userId: 'me',
      cmdrName: 'Grim',
      existing: existing({ trustTier: 1 }),
    });

    expect(out.kind === 'supersede' ? out.revoke : false).toBe(true);
  });

  it('MANDATORY: it says why, in words an officer can act on', () => {
    const out = resolveClaim({
      userId: 'me',
      cmdrName: 'Grim',
      existing: existing({ trustTier: 1, method: 'officer_manual' }),
    });

    const note = out.kind === 'supersede' ? out.note : '';
    expect(note).toMatch(/frontier/i);
    expect(note, 'the old method belongs in the record').toMatch(/officer_manual/);
  });
});
