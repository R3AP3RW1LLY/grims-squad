import { describe, expect, it } from 'vitest';
import { needsFreshness } from './needs-freshness.js';

/**
 * How old the figure is that somebody is about to spend credits against.
 *
 * ★ SQUADRON OWNER, 2026-08-12 ★
 *
 * "someone without the companion app completed a project and it did not update ... this causes
 * confusion and causes our members to go buy materials for a project thats completed and not
 * needed."
 *
 * ★ WHY THIS EXISTS RATHER THAN A CLEVERER DETECTION ★
 *
 * We chased the detection first and most of it is impossible. A finished Satellite Installation,
 * Comms Installation or settlement is NOT DOCKABLE — the construction site somebody was delivering
 * to simply stops existing, so no journal event will ever fire for it again, from anyone. EDDN
 * carries seven events and none of them are colonisation. Inara's API has two read endpoints and
 * neither is either. Frontier publishes nothing.
 *
 * So for a build finished by a commander running no tools, there is no signal. That is not a gap in
 * our plumbing; it is the shape of the data.
 *
 * This makes no attempt to detect anything, which is exactly why it covers that case. It says how
 * old the reading is, wherever somebody is about to act on it. A wrong number presented as certain
 * is what costs a member a trip; the same wrong number presented as a fortnight old costs them a
 * question.
 */

const at = (iso: string): Date => new Date(iso);
const NOW = at('2026-08-12T12:00:00Z');

describe('how old the needs figure is', () => {
  it('★ MANDATORY: a reading from today does not warn ★', () => {
    /*
     * The common case, and it must stay quiet. A banner on every project would be read as decoration
     * within a day and then ignored on the one project where it mattered.
     */
    const out = needsFreshness(at('2026-08-12T09:00:00Z'), NOW);
    expect(out.state).toBe('fresh');
    expect(out.warn).toBe(false);
  });

  it('★ MANDATORY: a fortnight-old reading warns, and says how old ★', () => {
    // The reported case: members bought for a build that had already finished.
    const out = needsFreshness(at('2026-07-29T12:00:00Z'), NOW);

    expect(out.state).toBe('stale');
    expect(out.warn).toBe(true);
    expect(out.days).toBe(14);
    expect(out.sentence, 'the age is the whole point — a vague warning is ignorable').toMatch(/14/);
  });

  it('★ MANDATORY: it names the possibility the member has to act on ★', () => {
    /*
     * "Out of date" tells somebody nothing they can do. "May already be built" is the sentence that
     * makes them check before spending, which is the entire purpose.
     */
    const out = needsFreshness(at('2026-07-20T12:00:00Z'), NOW);
    expect(out.sentence).toMatch(/built|complete/i);
  });

  it('★ MANDATORY: never observed is not the same as old ★', () => {
    /*
     * A project posted an hour ago that nobody has docked at yet has no reading at all. Reporting it
     * as infinitely stale would be alarming and wrong — the honest answer is that the figures are
     * the catalogue's estimate rather than anybody's observation.
     */
    const out = needsFreshness(null, NOW);

    expect(out.state).toBe('unknown');
    expect(out.days).toBeNull();
    expect(out.warn).toBe(true);
    expect(out.sentence).toMatch(/nobody has|never/i);
  });

  it('MANDATORY: the boundary is stated exactly', () => {
    // Off-by-one here is a project that warns a day early or, worse, a day late.
    expect(needsFreshness(at('2026-08-10T12:00:00Z'), NOW).state, 'exactly 2 days').toBe('ageing');
    expect(needsFreshness(at('2026-08-05T12:00:00Z'), NOW).state, 'exactly 7 days').toBe('stale');
    expect(needsFreshness(at('2026-08-05T11:59:00Z'), NOW).state, 'just over 7').toBe('stale');
  });

  it('MANDATORY: an ageing reading is mentioned but does not shout', () => {
    /*
     * Three days is worth knowing and not worth a warning banner. The distinction keeps the loud
     * state meaningful — if everything warns, nothing does.
     */
    const out = needsFreshness(at('2026-08-09T12:00:00Z'), NOW);
    expect(out.state).toBe('ageing');
    expect(out.warn).toBe(false);
    expect(out.sentence).toMatch(/3/);
  });

  it('a reading from the future is treated as now, not as negative days', () => {
    // Clock skew between a member's machine and ours must not produce "-1 days ago".
    const out = needsFreshness(at('2026-08-12T18:00:00Z'), NOW);
    expect(out.days).toBe(0);
    expect(out.state).toBe('fresh');
  });

  it('the sentence never tells a member the check is optional', () => {
    /*
     * House rule: member-facing copy says what the page is for, never what is up to them. "You may
     * wish to verify" is an instruction nobody follows.
     */
    for (const iso of ['2026-07-20T12:00:00Z', '2026-08-09T12:00:00Z']) {
      const s = needsFreshness(at(iso), NOW).sentence;
      expect(s).not.toMatch(/if you want|you may wish|optional|up to you/i);
    }
  });
});
