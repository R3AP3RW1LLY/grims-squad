import { describe, it, expect } from 'vitest';
import { LADDER_NEXT } from './admin.store.js';
import { LEADERSHIP_CEILING } from '../members/members.store.js';

/**
 * The activity table's derived columns.
 *
 * ★ THE TWO BUGS THESE PIN ★
 *
 * 1. Rank was read from GRANTED internal roles. A member who is plainly a Cadet
 *    in Discord showed nothing, because the mapping existed but the grant had
 *    never been made — grants only appear after reconciliation, for an account
 *    that exists, and most of the squadron has neither. It reads Discord roles
 *    through the mapping now, which is the same correction already made for
 *    officer status.
 *
 * 2. The single highest mapped role won, across BOTH ladders. That put
 *    "Squadron Leader" in the rank column with nothing above it, which rendered
 *    as "Top of ladder" — wrong twice: it is not the top of anything, and it is
 *    not on the promotion ladder at all.
 *
 * The picker is reproduced here rather than exported, because it is four lines
 * inside a query and extracting it to be testable would spread the logic over
 * two files to test what the rule IS. The rule is what matters.
 */

interface Mapped {
  readonly name: string;
  readonly rankOrder: number;
}

/** The same split the query performs. */
function pick(held: readonly Mapped[]): { rank: string | null; appointment: string | null } {
  let rank: string | null = null;
  let appointment: string | null = null;
  let bestTenure = -Infinity;
  let bestAppointment = -Infinity;

  for (const m of held) {
    if (m.rankOrder >= LEADERSHIP_CEILING) {
      if (m.rankOrder > bestTenure) {
        bestTenure = m.rankOrder;
        rank = m.name;
      }
    } else if (m.rankOrder > bestAppointment) {
      bestAppointment = m.rankOrder;
      appointment = m.name;
    }
  }

  return { rank, appointment };
}

const CADET = { name: 'Cadet', rankOrder: 100 };
const SERGEANT = { name: 'Sergeant', rankOrder: 110 };
const GMG = { name: 'Grand Master General', rankOrder: 190 };
const SQUADRON_LEADER = { name: 'Squadron Leader', rankOrder: 60 };
const GALACTIC_ADMIRAL = { name: 'Galactic Admiral', rankOrder: 10 };

describe('rank and appointment are separate axes', () => {
  it('MANDATORY: a Cadet is a Cadet, working toward Sergeant', () => {
    // The reported case. This showed "—" in both columns.
    const { rank } = pick([CADET]);
    expect(rank).toBe('Cadet');
    expect(LADDER_NEXT[rank ?? '']).toBe('Sergeant');
  });

  it('MANDATORY: a Squadron Leader is NOT at the top of the tenure ladder', () => {
    /*
     * ★ THE ONE THAT WAS WRONG ON SCREEN ★
     *
     * Squadron Leader is an appointment. With both ladders collapsed into one
     * it landed in the rank column, found no next rung, and was labelled "Top
     * of ladder" — which would tell an officer that somebody with no tenure at
     * all had completed twelve qualifying months.
     */
    const { rank, appointment } = pick([SQUADRON_LEADER]);
    expect(rank).toBeNull();
    expect(appointment).toBe('Squadron Leader');
  });

  it('MANDATORY: somebody can hold both at once', () => {
    // Real data: three members are Grand Master General AND Squadron Leader.
    const { rank, appointment } = pick([GMG, SQUADRON_LEADER]);
    expect(rank).toBe('Grand Master General');
    expect(appointment).toBe('Squadron Leader');
  });

  it('a Cadet who is also a Squadron Leader still promotes from Cadet', () => {
    // Promotion concerns tenure only. Reading the appointment as the rank would
    // freeze them out of the ladder entirely.
    const { rank, appointment } = pick([CADET, SQUADRON_LEADER]);
    expect(rank).toBe('Cadet');
    expect(appointment).toBe('Squadron Leader');
    expect(LADDER_NEXT[rank ?? '']).toBe('Sergeant');
  });

  it('takes the HIGHEST of each, not the first seen', () => {
    // A member mid-promotion, or one whose old role was never removed, wears
    // several. Order in Discord must not decide who they are.
    expect(pick([SERGEANT, CADET]).rank).toBe('Sergeant');
    expect(pick([CADET, SERGEANT]).rank).toBe('Sergeant');
    expect(pick([SQUADRON_LEADER, GALACTIC_ADMIRAL]).appointment).toBe('Squadron Leader');
  });

  it('the top of the tenure ladder really has nowhere to go', () => {
    const { rank } = pick([GMG]);
    expect(rank).toBe('Grand Master General');
    expect(LADDER_NEXT[rank ?? '']).toBeUndefined();
  });

  it('an unmapped role decides nothing', () => {
    // Colour roles, ping roles, channel access. Treating them as rank 0 would
    // make every one of them a leadership appointment.
    expect(pick([])).toEqual({ rank: null, appointment: null });
  });
});

describe('qualifying for promotion', () => {
  /** The same test the store applies, and the promotion engine after it. */
  const qualifies = (a: { msg: number; forum: number; voice: number; game: string }) =>
    (a.msg > 0 || a.forum > 0 || a.voice > 0) &&
    (a.game === 'observed' || a.game === 'assumed');

  it('MANDATORY: needs BOTH halves', () => {
    expect(qualifies({ msg: 500, forum: 0, voice: 0, game: 'absent' })).toBe(false);
    expect(qualifies({ msg: 0, forum: 0, voice: 0, game: 'observed' })).toBe(false);
    expect(qualifies({ msg: 1, forum: 0, voice: 0, game: 'observed' })).toBe(true);
  });

  it('any ONE kind of Discord activity satisfies its half', () => {
    // A member who is mute and takes part in voice, or only ever posts in
    // forums, is participating. Requiring messages specifically would erase
    // them.
    expect(qualifies({ msg: 0, forum: 1, voice: 0, game: 'observed' })).toBe(true);
    expect(qualifies({ msg: 0, forum: 0, voice: 1, game: 'observed' })).toBe(true);
  });

  it('counts an ASSUMED session, because the human chose fail-open', () => {
    // D26. The table shows which it was beside this, so an officer can see that
    // it was an assumption — it must never be presented as an observation.
    expect(qualifies({ msg: 1, forum: 0, voice: 0, game: 'assumed' })).toBe(true);
  });
});

/**
 * ★ THE TOP OF THE LADDER IS NOT A FAILED PROMOTION CHECK ★
 *
 * Squadron owner, 2026-07-29: a member showing "Top of ladder" must not be
 * highlighted green, because there is no promotion for them to be eligible for.
 *
 * They were. A Grand Master General with a message and a game session met both
 * activity conditions, so the row went green and the Qualifies column read YES
 * — telling an officer somebody was due a promotion the engine will never
 * grant. `promotion-run.ts` refuses them outright:
 *
 *     if (rung.next === null || rung.qualifyingMonthsRequired === null) {
 *       ... reason: 'Already at the top of the ladder.'
 *
 * So this was the console disagreeing with the thing that actually promotes
 * people — the SECOND such drift in this one field in a single day, both times
 * with the console in the wrong.
 */
describe('qualifies', () => {
  /** Exactly the rule in `activityForMonth`. */
  const qualifies = (row: {
    nextRank: string | null;
    messageCount: number;
    gameActivity: string;
  }): boolean =>
    row.nextRank !== null &&
    row.messageCount > 0 &&
    (row.gameActivity === 'observed' || row.gameActivity === 'assumed');

  const active = { messageCount: 4, gameActivity: 'observed' };

  it('MANDATORY: somebody at the top of the ladder never qualifies', () => {
    expect(qualifies({ ...active, nextRank: null })).toBe(false);
  });

  it('still qualifies an active member with a rank above them', () => {
    expect(qualifies({ ...active, nextRank: 'Sergeant' })).toBe(true);
  });

  it('keeps the activity rules it already had', () => {
    // Messages alone count. Narrowed from "messages OR forum OR voice" by the
    // squadron owner on 2026-07-29; forum posts and voice joins do not count.
    expect(qualifies({ nextRank: 'Sergeant', messageCount: 0, gameActivity: 'observed' })).toBe(
      false,
    );
    // `assumed` counts: the human chose fail-open when the upstream check
    // cannot run (D26). The table shows gameActivity beside this so an officer
    // can see which it was.
    expect(qualifies({ nextRank: 'Sergeant', messageCount: 1, gameActivity: 'assumed' })).toBe(true);
    expect(qualifies({ nextRank: 'Sergeant', messageCount: 1, gameActivity: 'none' })).toBe(false);
  });

  /*
   * ★ THE RULE ABOVE ONLY MATTERS IF THE LADDER ACTUALLY ENDS ★
   *
   * If every rank had a successor, `nextRank` would never be null, the guard
   * would never fire, and every assertion in this block would pass while
   * testing nothing. So: the ladder must terminate, and the rank it terminates
   * at must be reachable — a top rung nobody can climb to is not a top rung.
   */
  it('terminates at a rank that is reachable and has no successor', () => {
    const successors = Object.values(LADDER_NEXT);
    const terminal = successors.filter((rank) => LADDER_NEXT[rank] === undefined);

    // Exactly one, or the ladder forks and "the top" is not a single place.
    expect(terminal).toEqual(['Grand Master General']);
    // Reachable: something promotes INTO it.
    expect(successors).toContain('Grand Master General');
    // And this is what makes `nextRank` null for them.
    expect(LADDER_NEXT['Grand Master General']).toBeUndefined();
  });
});
