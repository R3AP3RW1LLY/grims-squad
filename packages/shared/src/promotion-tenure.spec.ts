import { describe, expect, it } from 'vitest';
import { tenureMet, tenureReachedAt } from './promotion-tenure.js';

/**
 * Time in the Discord server, as a promotion requirement.
 *
 * ★ SQUADRON OWNER, 2026-08-11 ★
 *
 * "for the initial promotion from cadet to sargeant, the member needs to be in the discord server
 * for 1 calender month ... then add this as a requirement for all other ranks"
 *
 * ★ WHY THE DATE ARITHMETIC IS TESTED THIS HARD ★
 *
 * A promotion is announced to the whole squadron and is tedious to unwind. Every case below is one
 * where "add a month" quietly means something different — the end of a long month, a leap year, a
 * December that rolls the year over — and getting any of them wrong either promotes somebody early
 * in public or holds back somebody who earned it.
 */

const at = (iso: string): Date => new Date(iso);

describe('one calendar month later', () => {
  it('★ MANDATORY: the ordinary case is the same day next month ★', () => {
    // The owner's own example: joined 16 July, eligible 16 August.
    expect(tenureReachedAt(at('2026-07-16T12:00:00Z'), 1).toISOString()).toBe(
      '2026-08-16T12:00:00.000Z',
    );
  });

  it('★ MANDATORY: 31 January clamps to the end of February, it does not roll into March ★', () => {
    /*
     * Rolling over would silently add three days to the requirement for anybody who joined at the
     * end of a long month — a rule that is stricter for some members than others for no reason
     * anybody could explain to them.
     */
    expect(tenureReachedAt(at('2026-01-31T00:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
  });

  it('★ MANDATORY: a leap year gives the 29th ★', () => {
    // 2028 is a leap year. Clamping to 28 here would hold somebody back a day for no reason.
    expect(tenureReachedAt(at('2028-01-31T00:00:00Z'), 1).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
  });

  it('★ MANDATORY: December rolls the year over ★', () => {
    expect(tenureReachedAt(at('2026-12-15T00:00:00Z'), 1).toISOString()).toBe(
      '2027-01-15T00:00:00.000Z',
    );
  });

  it('MANDATORY: twelve months is the same day a year later', () => {
    // The Grand Master General rung. An off-by-one here is eleven months of somebody's time.
    expect(tenureReachedAt(at('2026-03-09T00:00:00Z'), 12).toISOString()).toBe(
      '2027-03-09T00:00:00.000Z',
    );
  });

  it('MANDATORY: multi-month spans cross the year correctly', () => {
    expect(tenureReachedAt(at('2026-11-30T00:00:00Z'), 3).toISOString()).toBe(
      '2027-02-28T00:00:00.000Z',
    );
    expect(tenureReachedAt(at('2026-10-31T00:00:00Z'), 9).toISOString()).toBe(
      '2027-07-31T00:00:00.000Z',
    );
  });

  it('keeps the time of day, so eligibility does not drift by hours', () => {
    expect(tenureReachedAt(at('2026-07-08T23:40:00Z'), 1).toISOString()).toBe(
      '2026-08-08T23:40:00.000Z',
    );
  });
});

describe('whether somebody may be promoted yet', () => {
  it('★ MANDATORY: the two real members, on the day this was written ★', () => {
    /*
     * Both were due Cadet → Sergeant on the August run before this rule existed. This is the whole
     * point of the change, pinned against the actual production data:
     *
     *   r3ap3ractual_22545  joined 2026-07-08  →  34 days  →  promotes
     *   madhatter100690     joined 2026-07-16  →  26 days  →  waits until 16 August
     */
    const now = at('2026-08-11T17:00:00Z');

    expect(tenureMet(at('2026-07-08T00:00:00Z'), 1, now).met, 'r3ap3ractual').toBe(true);

    const madhatter = tenureMet(at('2026-07-16T00:00:00Z'), 1, now);
    expect(madhatter.met, 'madhatter100690').toBe(false);
    expect(madhatter.eligibleAt?.toISOString().slice(0, 10)).toBe('2026-08-16');
    expect(madhatter.reason, 'the refusal must say when, not just no').toMatch(/2026-08-16/);
  });

  it('★ MANDATORY: no join date BLOCKS, and says how to fix it ★', () => {
    /*
     * The owner's choice. A promotion granted on an unknown is one nobody can defend afterwards —
     * and this is deliberately the opposite of the game-activity check, which fails open. There,
     * failing open costs a member a month they earned; here it grants a rank they did not.
     */
    const out = tenureMet(null, 1, at('2026-08-11T00:00:00Z'));
    expect(out.met).toBe(false);
    expect(out.eligibleAt).toBeNull();
    expect(out.reason).toMatch(/no discord join date/i);
    expect(out.reason, 'a refusal nobody can act on is a dead end').toMatch(/officer/i);
  });

  it('★ MANDATORY: eligible exactly ON the day, not the day after ★', () => {
    // Off by one here is a member watching a run pass them over on the morning they qualified.
    const joined = at('2026-07-16T12:00:00Z');
    expect(tenureMet(joined, 1, at('2026-08-16T12:00:00Z')).met, 'to the second').toBe(true);
    expect(tenureMet(joined, 1, at('2026-08-16T11:59:59Z')).met, 'one second early').toBe(false);
  });

  it('MANDATORY: the top of the ladder needs no tenure and is not refused for it', () => {
    // Grand Master General has no next rung; requiring months there would be a rule about nothing.
    expect(tenureMet(null, 0, at('2026-08-11T00:00:00Z')).met).toBe(true);
  });

  it('MANDATORY: higher rungs demand proportionally longer', () => {
    /*
     * The ladder's own cumulativeMonths, now enforced against real tenure: nobody reaches Grand
     * Master General three months after joining, however much they talk.
     */
    const joined = at('2026-01-15T00:00:00Z');
    const now = at('2026-08-11T00:00:00Z'); // just under 7 months

    expect(tenureMet(joined, 6, now).met, '6 months — met').toBe(true);
    expect(tenureMet(joined, 9, now).met, '9 months — not yet').toBe(false);
    expect(tenureMet(joined, 12, now).met, '12 months — not yet').toBe(false);
  });

  it('a met requirement carries no reason to print', () => {
    expect(tenureMet(at('2020-01-01T00:00:00Z'), 1, at('2026-08-11T00:00:00Z')).reason).toBe('');
  });
});
