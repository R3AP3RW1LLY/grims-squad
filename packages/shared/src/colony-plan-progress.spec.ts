import { describe, expect, it } from 'vitest';
import { planProgress, siteProgress, type ProgressSite } from './colony-plan-progress.js';

/**
 * How much of a plan has actually been built.
 *
 * ★ SQUADRON OWNER, 2026-08-11 ★
 *
 * "can we track what has been built please? and can we track the remaining To haul or add in the To
 * haul card the remaining | whats been hauled"
 *
 * ★ THE DISTINCTION EVERY TEST HERE DEFENDS ★
 *
 * A plan of eighty-one sites with three posted has three MEASURED tonnages and seventy-eight
 * catalogue ESTIMATES. Blending them into one confident "13% hauled" presents a guess as a fact, on
 * the figure a squadron plans a fortnight around. Everything below exists to keep those two apart.
 */

const site = (over: Partial<ProgressSite> = {}): ProgressSite => ({
  id: over.id ?? 's',
  totalTonnes: over.totalTonnes === undefined ? 6_721 : over.totalTonnes,
  project: over.project === undefined ? null : over.project,
});

describe('one planned site', () => {
  it('★ MANDATORY: no project means PLANNED, and nothing is claimed as hauled ★', () => {
    /*
     * `hauled: null`, not zero. Zero is a measurement — "we looked and nothing has been delivered".
     * Null is the truth: nobody has placed this site, so there is nothing to have delivered to.
     */
    const out = siteProgress(site());
    expect(out.state).toBe('planned');
    expect(out.hauled).toBeNull();
    expect(out.remaining).toBe(6_721);
    expect(out.measured, 'a catalogue figure is not a measurement').toBe(false);
  });

  it('★ MANDATORY: a posted project mid-haul is BUILDING, with real figures ★', () => {
    const out = siteProgress(
      site({ project: { required: 9_919, remaining: 3_200, completedAt: null } }),
    );
    expect(out.state).toBe('building');
    expect(out.hauled).toBe(6_719);
    expect(out.remaining).toBe(3_200);
    expect(out.total, 'the site’s own figure beats the catalogue once it reports').toBe(9_919);
    expect(out.measured).toBe(true);
  });

  it('★ MANDATORY: a project posted an hour ago is STARTED, not built and not under way ★', () => {
    /*
     * Counting a freshly posted project as built would overstate the number somebody steers a
     * fortnight by. It is not "building" either — the owner asked for the two to be told apart on
     * 2026-08-11, because a site nobody has hauled to needs a first load and one at 12,400 of
     * 33,000 t already has somebody flying it.
     */
    const out = siteProgress(
      site({ project: { required: 9_919, remaining: 9_919, completedAt: null } }),
    );
    expect(out.state).toBe('started');
    expect(out.hauled).toBe(0);
  });

  it('★ MANDATORY: one tonne delivered moves it from started to building ★', () => {
    // The boundary between the two states, stated exactly. Anything hauled means somebody is on it.
    const out = siteProgress(
      site({ project: { required: 9_919, remaining: 9_918, completedAt: null } }),
    );
    expect(out.state).toBe('building');
    expect(out.hauled).toBe(1);
  });

  it('★ MANDATORY: nothing outstanding is COMPLETE, even without a completion date ★', () => {
    // The depot reporting zero remaining is the site saying it is finished; waiting for a flag the
    // journal may never send would leave finished builds showing as in progress for ever.
    const out = siteProgress(
      site({ project: { required: 9_919, remaining: 0, completedAt: null } }),
    );
    expect(out.state).toBe('complete');
    expect(out.remaining).toBe(0);
    expect(out.hauled).toBe(9_919);
  });

  it('★ MANDATORY: a posted site nobody has docked at falls back to the catalogue ★', () => {
    /*
     * `required` is zero until a commander's journal reports the bill of materials — which is NOT
     * the same as a site that wants nothing. Without this fallback a plan's total would collapse
     * the moment somebody posted a project, which reads as the estimate having been wrong.
     */
    const out = siteProgress(
      site({ project: { required: 0, remaining: 0, completedAt: null } }),
    );
    expect(out.state, 'posted, and nobody has hauled to it').toBe('started');
    expect(out.total, 'the plan total must not collapse on posting').toBe(6_721);
    expect(out.remaining).toBe(6_721);
    expect(out.measured, 'a fallback to the catalogue is not measured').toBe(false);
  });

  it('a site with no build chosen contributes nothing rather than NaN', () => {
    const out = siteProgress(site({ totalTonnes: null }));
    expect(out.total).toBe(0);
    expect(out.remaining).toBe(0);
  });
});

describe('the whole plan, rolled up', () => {
  it('★ MANDATORY: measured and estimated sites are counted separately ★', () => {
    /*
     * The headline number the owner asked to be honest about. Three posted of eighty-one means the
     * page can say "measured across 3 builds, estimated for 78" instead of one confident figure.
     */
    const out = planProgress([
      site({ id: 'a', project: { required: 10_000, remaining: 2_000, completedAt: null } }),
      site({ id: 'b', project: { required: 10_000, remaining: 0, completedAt: null } }),
      site({ id: 'c' }),
      site({ id: 'd' }),
    ]);

    expect(out.measuredSites).toBe(2);
    expect(out.estimatedSites).toBe(2);
    expect(out.complete).toBe(1);
    expect(out.building).toBe(1);
    expect(out.planned).toBe(2);
  });

  it('★ MANDATORY: the three totals agree with each other ★', () => {
    /*
     * hauled + remaining must equal total, or the card is three numbers that contradict themselves
     * in front of somebody deciding what to fly tonight.
     */
    const out = planProgress([
      site({ id: 'a', project: { required: 10_000, remaining: 2_000, completedAt: null } }),
      site({ id: 'b', project: { required: 5_000, remaining: 0, completedAt: null } }),
      site({ id: 'c', totalTonnes: 6_721 }),
    ]);

    expect(out.hauledTonnes + out.remainingTonnes).toBe(out.totalTonnes);
    expect(out.hauledTonnes).toBe(8_000 + 5_000);
    expect(out.remainingTonnes).toBe(2_000 + 6_721);
  });

  it('MANDATORY: the share is null for an empty plan, not zero percent', () => {
    // "0% hauled" about a plan with nothing in it reads as a failure to start. It is not a plan yet.
    expect(planProgress([]).pctHauled).toBeNull();
    expect(planProgress([site({ totalTonnes: null })]).pctHauled).toBeNull();
  });

  it('MANDATORY: a fully hauled plan reads 100, and an untouched one reads 0', () => {
    expect(
      planProgress([site({ project: { required: 100, remaining: 0, completedAt: null } })]).pctHauled,
    ).toBe(100);
    expect(planProgress([site({ totalTonnes: 500 })]).pctHauled).toBe(0);
  });
});
