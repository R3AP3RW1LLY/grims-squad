/**
 * Squadron membership, as a check separate from the commander name.
 *
 * ★ WHY THESE ARE TWO THINGS ★
 *
 * Proving you control a commander name proves nothing about whether you are in
 * THIS squadron. They were one step, so anybody who verified a name was treated
 * as a member — which is backwards for a squadron platform, and would have let
 * a stranger reach members-only pages by verifying a commander they genuinely
 * own.
 *
 * ★ THE STATES, AND WHY THERE ARE THREE ★
 *
 *   unverified   no verified commander name yet
 *   partial      name proven, squadron not confirmed
 *   verified     both
 *
 * `partial` exists because it is the honest description of somebody who has
 * done everything we asked and is waiting on Inara. Collapsing it into
 * "unverified" would tell a member their proof had failed when it had not, and
 * collapsing it into "verified" would admit people who are not in the squadron.
 */

/** How a member stands, and why. */
export type SquadronStatus = 'unverified' | 'partial' | 'verified';

/*
 * The NAME COMPARISON lives in @grims/shared, not here.
 *
 * The worker's twenty-minute re-check needs exactly the same rule, and two
 * copies would drift into a member the website accepts and the sweep rejects —
 * flickering between partially and fully verified with nothing in any log to
 * explain it. Re-exported so callers in this app have one import.
 */
export { expectedSquadronName, sameSquadron, evaluateSquadron } from '@grims/shared';
export type { SquadronCheckOutcome } from '@grims/shared';

export interface VerificationState {
  readonly cmdrName: string | null;
  readonly isVerified: boolean;
  /** The squadron Inara last reported for them, verbatim. */
  readonly inaraSquadron: string | null;
  readonly squadronVerifiedAt: Date | null;
  /** When they said they had applied. Their claim, never proof. */
  readonly squadronClaimedAt: Date | null;
  readonly squadronCheckedAt: Date | null;
}

/** Where a member stands right now. */
export function statusOf(state: VerificationState | null): SquadronStatus {
  if (state === null || !state.isVerified || state.cmdrName === null) return 'unverified';
  return state.squadronVerifiedAt === null ? 'partial' : 'verified';
}

/**
 * Should the sweep spend an Inara call on this member?
 *
 * ★ ONLY IF THEY ASKED FOR IT ★
 *
 * Inara is capped at two requests a minute globally (INV-033). Re-checking
 * every partially-verified member forever would spend that budget on people who
 * have not applied and are not going to, and starve the ones who just did.
 *
 * So a claim is required. It is not evidence — Inara decides — but it is the
 * difference between a member waiting on us and a name sitting in a table.
 */
export function awaitingSquadronCheck(state: VerificationState): boolean {
  return (
    state.isVerified &&
    state.cmdrName !== null &&
    state.squadronVerifiedAt === null &&
    state.squadronClaimedAt !== null
  );
}
