import { Permission, hasPermission, type PermissionMask } from './permissions.js';
import { LEADERSHIP_CEILING } from './nickname.js';

/**
 * Who may hand out an invite, and what a recruit is worth.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "a unique discord invite link for all members that are inara veriefied in our platform! we want
 * this to be a leaderboard item and gamified too please! ... the minimum rant to do this is Cadet"
 *
 * ★ NOTHING IS PAID FOR SOMEBODY ARRIVING ★
 *
 * The single decision this feature stands or falls on. Pay per join and it is an alt-account farm:
 * ten throwaway accounts in an evening tops the board, and the squadron gets ten empty seats and a
 * leaderboard nobody believes. Every point here comes from a milestone a real recruit passes and a
 * throwaway will not, and the largest of them takes a month.
 */

/** How far a recruit has got. In order; each one is banked once and never re-paid. */
export const RECRUIT_MILESTONES = [
  'joined',
  'stayed',
  'verified',
  /*
   * `flying` sits BEFORE `cadet`, and the test that says the ladder ascends is what put it here.
   * The first draft had it last, which was wrong twice over: a recruit can score on a board within
   * days where Cadet takes a qualifying month, and it paid less than the step before it — so a
   * recruiter watching their tracker would have seen the reward go DOWN as their recruit got
   * further in.
   */
  'flying',
  'cadet',
] as const;

export type RecruitMilestone = (typeof RECRUIT_MILESTONES)[number];

/**
 * What each milestone pays.
 *
 * ★ THE SHAPE OF THE LADDER IS THE ANTI-FARMING DESIGN ★
 *
 * `joined` is deliberately zero — it is free to fake, so it buys nothing. `stayed` is the first
 * thing an alt farm will not wait around for. `cadet` is the largest because it is a qualifying
 * month of real activity: by the time a recruit reaches it, they are a squadron member and the
 * recruiter has genuinely grown the squadron.
 */
const POINTS: Record<RecruitMilestone, number> = {
  /** Recorded and shown to the recruiter. Worth nothing, because anybody can walk through a door. */
  joined: 0,
  /** A week later and still here. */
  stayed: 50,
  /** A real commander account behind them — the same bar their recruiter had to clear. */
  verified: 150,
  /** Scoring on any board of their own: present is one thing, flying with us is another. */
  flying: 200,
  /** A qualifying month. The capstone — the one that means somebody actually joined the squadron. */
  cadet: 400,
};

export function milestonePoints(milestone: RecruitMilestone): number {
  // Unknown milestones score zero rather than throwing: a row written by a later version must not
  // stop an older worker, and must certainly not be paid an invented amount.
  return POINTS[milestone] ?? 0;
}

/** Everything the mint gate needs to know about the member asking. */
export interface MintCheck {
  readonly mask: PermissionMask;
  /** `inara_links.verified_at` is set — Inara confirmed their own key and returned a name. */
  readonly inaraVerified: boolean;
  /** Their tenure rank position, or null when they hold no rank role at all. */
  readonly rankOrder: number | null;
}

export type MintRefusal = 'permission' | 'inara' | 'rank';

export interface MintVerdict {
  readonly allowed: boolean;
  /** Why not, so the page can say something the member can act on. Null when allowed. */
  readonly reason: MintRefusal | null;
}

/**
 * May this member mint a personal invite?
 *
 * ★ A REASON, NOT A BOOLEAN ★
 *
 * Three different things stop somebody, and they need three different sentences. "You cannot do
 * this" to a member one Inara key away from being able to is a dead end; "add your Inara key and
 * this unlocks" is an invitation, and this feature exists to get people recruiting.
 *
 * ★ PERMISSION IS CHECKED FIRST, ON PURPOSE ★
 *
 * Somebody whose permission was pulled AND who has not verified would otherwise be told to add an
 * Inara key — and would go and do it, and still be refused. The most specific true answer wins.
 */
export function canMintInvite({ mask, inaraVerified, rankOrder }: MintCheck): MintVerdict {
  if (!hasPermission(mask, Permission.RECRUIT_INVITE)) {
    return { allowed: false, reason: 'permission' };
  }

  /*
   * Verification before rank, because it is the one that protects the door. A link handed to an
   * unverified account is the cheapest possible way for somebody to point the squadron's front
   * door wherever they like.
   */
  if (!inaraVerified) return { allowed: false, reason: 'inara' };

  /*
   * Cadet is `LEADERSHIP_CEILING` — the floor of the tenure ladder, earned at one qualifying
   * month. Everything below it is a leadership appointment rather than tenure, so "Cadet or above"
   * really is a single comparison against that constant rather than a rank name to keep in step.
   */
  if (rankOrder === null || rankOrder < LEADERSHIP_CEILING) {
    return { allowed: false, reason: 'rank' };
  }

  return { allowed: true, reason: null };
}
