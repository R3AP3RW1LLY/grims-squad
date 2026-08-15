/**
 * Two accounts, one commander name.
 *
 * ★ WHY THIS IS DECIDED HERE AND NOT AT THE DATABASE ★
 *
 * `cmdrName` is unique across every live verification — a partial unique index the schema documents
 * as something Prisma cannot express (INV-005). So the moment Frontier tells us a member is
 * CMDR Grim and somebody else already holds that name, the write fails: at the database, with a
 * constraint error, in the middle of an OAuth callback the member is watching.
 *
 * Deciding it there means deciding it badly — a 500, or a catch that guesses. This decides it in
 * one readable place, before the write, with the reasoning attached.
 *
 * ★ THE SCHEMA ALREADY RANKS THE EVIDENCE ★
 *
 *   3  fdev_capi       Frontier itself said so. Cryptographic.
 *   2  inara_nonce     the member put our nonce in a bio they control.
 *   1  officer_manual  an officer looked at a screenshot.
 *
 * A screenshot is a photograph of a claim; Frontier's OAuth is Frontier answering the question. When
 * they disagree the stronger evidence wins, and the weaker claim is REVOKED rather than deleted —
 * the row is the record that somebody claimed this in good faith and an officer agreed, and erasing
 * it would erase a decision rather than correct it.
 */

export type ClaimMethod = 'fdev_capi' | 'inara_nonce' | 'officer_manual';

export interface ExistingClaim {
  readonly userId: string;
  readonly trustTier: number;
  readonly method: ClaimMethod;
}

export interface ClaimInput {
  readonly userId: string;
  readonly cmdrName: string;
  /** Whoever currently holds this commander name, or null when nobody does. */
  readonly existing: ExistingClaim | null;
}

export type ClaimOutcome =
  | { readonly kind: 'grant' }
  | {
      readonly kind: 'supersede';
      readonly revokeUserId: string;
      readonly revoke: true;
      readonly note: string;
    }
  | { readonly kind: 'refuse'; readonly reason: string };

/** The tier a Frontier link always carries. The schema: "Recorded, never inferred." */
const CAPI_TIER = 3;

export function resolveClaim(input: ClaimInput): ClaimOutcome {
  const held = input.existing;

  if (held === null) return { kind: 'grant' };

  /*
   * Their own claim. A member reconnecting after the 25-day ceiling hits this every single time —
   * treating it as a conflict would refuse the reconnection the platform just asked them to make,
   * and tell them their own commander name was taken.
   */
  if (held.userId === input.userId) return { kind: 'grant' };

  if (held.trustTier >= CAPI_TIER) {
    /*
     * Two cryptographic claims on one commander should be impossible — one Frontier account owns
     * one commander — so if it happens, something is wrong that a human should look at: a
     * transferred account, a shared login, or a bug in our own storage.
     *
     * Superseding would let whoever linked most recently take a commander from somebody who also
     * proved it cryptographically. Refusing is the only answer that cannot be abused.
     *
     * The other member is deliberately not named: "already claimed by sarahlilac" tells whoever
     * typed it something about another account they had no right to learn, and the actionable half
     * of the sentence is identical without it.
     */
    return {
      kind: 'refuse',
      reason:
        'That commander is already linked to another account by Frontier. An officer can sort this ' +
        'out — it usually means the account was transferred or a sign-in was shared.',
    };
  }

  return {
    kind: 'supersede',
    revokeUserId: held.userId,
    revoke: true,
    note:
      `Superseded by a Frontier (cAPI) verification, tier ${CAPI_TIER}. The previous claim was ` +
      `${held.method} at tier ${held.trustTier}, which is weaker evidence than Frontier answering ` +
      'directly. Revoked rather than deleted so the original claim remains on the record.',
  };
}
