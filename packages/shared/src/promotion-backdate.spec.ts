import { describe, expect, it } from 'vitest';
import { effectiveGrantAt, GO_LIVE_AT, ROSTER_ARTEFACT_BEFORE } from './promotion-backdate.js';

/**
 * Correcting the rank grant dates the website's own launch created.
 *
 * ★ SQUADRON OWNER, 2026-08-11 ★
 *
 * "we need to start the promotions today! and needs to be retroactive to july when the website
 * went live! based on the actual promotion criteria!"
 *
 * ★ WHAT IS ACTUALLY WRONG, AND WHY NOBODY SAW IT ★
 *
 * Every member's rank grant is stamped between 2026-07-29 and 2026-08-08 — the ten days in which
 * the site went live and officers first built the roster. It records when somebody clicked a button
 * in a new system, NOT when the member held the rank.
 *
 * Qualifying months are counted as `month >= grantedAt`. So for the eleven members granted in
 * August, the August month row (keyed 2026-08-01) is BEFORE their own grant and does not count.
 * They read "0 of 1 qualifying months" on the promotion report while sitting on hundreds of
 * messages — s913427 had 149 in July and 22 in August and was credited with nothing.
 *
 * That is the artefact this corrects, and correcting it IS what "retroactive to July" means: the
 * record should say what was true.
 *
 * ★ THE TWO RULES THAT MAKE IT SAFE ★
 *
 * It only ever moves a grant EARLIER, and it only touches grants from the launch window. A real
 * promotion earned in September must never be dragged back to July by a script re-run.
 */

const at = (iso: string): Date => new Date(iso);

describe('the corrected grant date', () => {
  it('★ MANDATORY: a launch-window grant moves back to the go-live ★', () => {
    /*
     * illuminat3d1: in the Discord since 2025-07-28, granted Cadet on 2026-08-05 when the roster
     * was built. July and August are both months they held the rank; the record said neither was.
     */
    const out = effectiveGrantAt(at('2026-08-05T14:00:00Z'), at('2025-07-28T00:00:00Z'));
    expect(out?.toISOString()).toBe(GO_LIVE_AT.toISOString());
  });

  it('★ MANDATORY: it never predates the member joining the Discord ★', () => {
    /*
     * r3ap3ractual joined on 2026-07-08. Backdating to 1 July would credit them a week they were
     * not here for — inventing history rather than correcting it. Their July is a PART month, so
     * the first month they can claim is August, which falls out of the same comparison the engine
     * already uses (`month >= grantedAt`) without a second rule.
     */
    const out = effectiveGrantAt(at('2026-07-29T00:00:00Z'), at('2026-07-08T09:30:00Z'));
    expect(out?.toISOString()).toBe('2026-07-08T09:30:00.000Z');
  });

  it('★ MANDATORY: a grant is never moved LATER ★', () => {
    // The one direction that could cost somebody a month they had already earned.
    const early = at('2026-07-02T00:00:00Z');
    const out = effectiveGrantAt(early, at('2026-07-20T00:00:00Z'));
    expect(out, 'already earlier than any correction — leave it alone').toBeNull();
  });

  it('★ MANDATORY: a promotion earned AFTER the launch window is untouched ★', () => {
    /*
     * The guard that makes this safe to leave in the repository. Somebody promoted on 15 September
     * has a grant date that is CORRECT, and it is later than the go-live — a naive "move it back to
     * July" would hand them a free rank every time the script ran.
     */
    expect(effectiveGrantAt(at('2026-09-15T00:00:00Z'), at('2026-01-01T00:00:00Z'))).toBeNull();
  });

  it('★ MANDATORY: no join date leaves the grant alone rather than inventing one ★', () => {
    /*
     * We would be guessing. The tenure gate already refuses a member with no join date, so nothing
     * is lost by declining — and a corrected date nobody can justify is worse than an uncorrected
     * one somebody can explain.
     */
    expect(effectiveGrantAt(at('2026-08-06T00:00:00Z'), null)).toBeNull();
  });

  it('MANDATORY: a member who joined mid-August keeps their August date', () => {
    // n_o_d_o joined 2026-08-02 and was granted on the 6th. August is a part month for them either
    // way; September is their first claimable one.
    const out = effectiveGrantAt(at('2026-08-06T00:00:00Z'), at('2026-08-02T00:00:00Z'));
    expect(out?.toISOString()).toBe('2026-08-02T00:00:00.000Z');
  });

  it('MANDATORY: running it twice changes nothing the second time', () => {
    // Idempotence, because this will be run once as a dry run and once for real, and possibly
    // again by somebody checking.
    const first = effectiveGrantAt(at('2026-08-05T00:00:00Z'), at('2025-07-28T00:00:00Z'));
    expect(first).not.toBeNull();
    expect(effectiveGrantAt(first as Date, at('2025-07-28T00:00:00Z'))).toBeNull();
  });

  it('the constants say what they mean', () => {
    expect(GO_LIVE_AT.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    // The launch window closed well before this correction ran; anything later is a real promotion.
    expect(ROSTER_ARTEFACT_BEFORE.toISOString()).toBe('2026-08-12T00:00:00.000Z');
  });
});
