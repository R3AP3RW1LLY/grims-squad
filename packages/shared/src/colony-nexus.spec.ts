import { describe, expect, it } from 'vitest';
import { describeNexus, nexusTrade, type NexusSystem } from './colony-nexus.js';

/**
 * What a group of our own systems can supply each other.
 *
 * ★ SQUADRON OWNER, 2026-08-24 ★
 *
 * "a nexus that will predict trade routes, and work like the raven colonial nexus system."
 *
 * The half worth having is not the routes — it is the GAPS. A member can guess a refinery wants
 * ore; what they cannot see without this is that nothing in the whole group produces it, so every
 * tonne is a haul from outside, permanently, long after construction is finished.
 */

const sys = (over: Partial<NexusSystem> & { systemName: string }): NexusSystem => ({
  exports: [],
  imports: [],
  ...over,
});

describe('what a group of systems can feed each other', () => {
  it('matches an export in one system to an import in another', () => {
    const report = nexusTrade([
      sys({ systemName: 'Alpha', exports: ['Steel'] }),
      sys({ systemName: 'Beta', imports: ['Steel'] }),
    ]);

    expect(report.links).toEqual([
      { commodity: 'Steel', from: 'Alpha', to: 'Beta', flyableNow: false },
    ]);
    expect(report.gaps).toEqual([]);
  });

  it('★ MANDATORY: a route is only FLYABLE when both ends are actually standing ★', () => {
    /*
     * ★ SQUADRON OWNER, 2026-08-25 ★
     *
     * "Real where we have it, predicted elsewhere" — and a group is routinely a mixture: one station
     * finished and selling into the market mirror, three still being hauled to.
     *
     * Presenting a predicted route identically to a real one sends somebody to a station that does
     * not exist. That is the most expensive way this feature could be wrong, because a wasted trip
     * is measured in hours.
     */
    const both = nexusTrade([
      sys({ systemName: 'Alpha', exports: ['Steel'], basis: 'measured' }),
      sys({ systemName: 'Beta', imports: ['Steel'], basis: 'measured' }),
    ]);
    expect(both.links[0]?.flyableNow, 'both standing').toBe(true);

    const half = nexusTrade([
      sys({ systemName: 'Alpha', exports: ['Steel'], basis: 'measured' }),
      sys({ systemName: 'Beta', imports: ['Steel'], basis: 'predicted' }),
    ]);
    expect(half.links[0]?.flyableNow, 'the buyer does not exist yet').toBe(false);
  });

  it('defaults to predicted, so nothing claims to be real without being told', () => {
    /*
     * A caller that supplies no basis has not told us the station is standing. Assuming otherwise
     * would invent knowledge and mark a paper route flyable.
     */
    const report = nexusTrade([
      sys({ systemName: 'Alpha', exports: ['Steel'] }),
      sys({ systemName: 'Beta', imports: ['Steel'] }),
    ]);

    expect(report.links[0]?.flyableNow).toBe(false);
  });

  describe('a system with nothing planned', () => {
    it('★ MANDATORY: is listed, not silently dropped ★', () => {
      /*
       * Squadron owner's call. A system quietly missing from its own group reads as a bug — a
       * pattern this codebase keeps finding — and naming it is also the nudge to go and plan it.
       */
      const report = nexusTrade([
        sys({ systemName: 'Alpha', exports: ['Steel'] }),
        sys({ systemName: 'Empty', basis: 'unknown' }),
      ]);

      expect(report.unplanned).toEqual(['Empty']);
      expect(report.systems, 'and it still counts as part of the group').toBe(2);
    });

    it('★ MANDATORY: contributes nothing, even if lists were supplied ★', () => {
      /*
       * `unknown` means we have no basis for those lists. Honouring them anyway would put invented
       * trade into the gaps — the one output somebody is meant to act on.
       */
      const report = nexusTrade([
        sys({ systemName: 'Alpha', imports: ['Steel'] }),
        sys({ systemName: 'Empty', exports: ['Steel'], basis: 'unknown' }),
      ]);

      expect(report.links, 'no route from a system with nothing built').toEqual([]);
      expect(report.gaps, 'and the demand is still a gap').toEqual([
        { commodity: 'Steel', wantedBy: ['Alpha'] },
      ]);
    });
  });

  it('★ MANDATORY: a commodity NOBODY produces is a gap, named ★', () => {
    /*
     * The line no per-system view can show, and the one somebody acts on. A permanent import means
     * a permanent haul from outside the group unless the plans change — which is exactly the sort of
     * thing worth knowing before committing a fortnight to it.
     */
    const report = nexusTrade([
      sys({ systemName: 'Alpha', imports: ['Beryllium'] }),
      sys({ systemName: 'Beta', imports: ['Beryllium'] }),
    ]);

    expect(report.links).toEqual([]);
    expect(report.gaps).toEqual([{ commodity: 'Beryllium', wantedBy: ['Alpha', 'Beta'] }]);
  });

  it('★ MANDATORY: a system does not feed itself ★', () => {
    /*
     * A station exporting ore and another in the SAME system wanting it is an internal matter — no
     * route, nothing flown between systems. Counting it would fill the list with pairs nobody flies
     * and bury the ones somebody would.
     */
    const report = nexusTrade([sys({ systemName: 'Alpha', exports: ['Steel'], imports: ['Steel'] })]);

    expect(report.links).toEqual([]);
  });

  it('★ MANDATORY: produced only by the system that wants it is still a gap ★', () => {
    /*
     * From the group's point of view nothing can supply it: if that one system is not finished
     * first, the demand has nowhere to go. Reporting it as satisfied would be the most confident
     * kind of wrong.
     */
    const report = nexusTrade([
      sys({ systemName: 'Alpha', exports: ['Steel'], imports: ['Steel'] }),
      sys({ systemName: 'Beta', exports: ['Copper'] }),
    ]);

    expect(report.links).toEqual([]);
    expect(report.gaps).toEqual([{ commodity: 'Steel', wantedBy: ['Alpha'] }]);
  });

  it('reports what is produced with no buyer as surplus, not as a fault', () => {
    /*
     * Selling outward is often the whole point of building a system. It is surfaced because it is
     * the other half of the same question — and because two systems both exporting the same thing
     * and neither buying it is worth noticing before the second one is built.
     */
    const report = nexusTrade([
      sys({ systemName: 'Alpha', exports: ['Gold'] }),
      sys({ systemName: 'Beta', exports: ['Gold'] }),
    ]);

    expect(report.surplus).toEqual([{ commodity: 'Gold', soldBy: ['Alpha', 'Beta'] }]);
    expect(report.gaps).toEqual([]);
  });

  it('★ MANDATORY: matches case-insensitively, or one commodity reads as two ★', () => {
    // The catalogue, the market dump and the journal do not agree on case.
    const report = nexusTrade([
      sys({ systemName: 'Alpha', exports: ['Steel'] }),
      sys({ systemName: 'Beta', imports: ['  steel '] }),
    ]);

    expect(report.links).toHaveLength(1);
    expect(report.links[0]?.commodity, 'labelled as the buyer spelled it, not lowercased').toBe(
      'steel',
    );
  });

  it('pairs every supplier with every buyer', () => {
    const report = nexusTrade([
      sys({ systemName: 'Alpha', exports: ['Steel'] }),
      sys({ systemName: 'Beta', exports: ['Steel'] }),
      sys({ systemName: 'Gamma', imports: ['Steel'] }),
    ]);

    expect(report.links).toEqual([
      { commodity: 'Steel', from: 'Alpha', to: 'Gamma', flyableNow: false },
      { commodity: 'Steel', from: 'Beta', to: 'Gamma', flyableNow: false },
    ]);
  });

  it('ignores blank commodities rather than making a nameless row', () => {
    const report = nexusTrade([
      sys({ systemName: 'Alpha', exports: ['   '] }),
      sys({ systemName: 'Beta', imports: [''] }),
    ]);

    expect(report.links).toEqual([]);
    expect(report.gaps).toEqual([]);
    expect(report.surplus).toEqual([]);
  });

  describe('what the member is told', () => {
    it('★ MANDATORY: gaps lead ★', () => {
      /*
       * "Four systems feed each other" is pleasant and changes nothing. "Nothing you are building
       * produces this" is the sentence somebody acts on, so it goes first — the same ordering every
       * other panel on this platform uses.
       */
      const lines = describeNexus(
        nexusTrade([
          sys({ systemName: 'Alpha', exports: ['Steel'], imports: ['Beryllium'] }),
          sys({ systemName: 'Beta', imports: ['Steel'] }),
        ]),
      );

      expect(lines[0]).toMatch(/permanent haul from outside/i);
      expect(lines.join(' ')).toMatch(/supplied from inside the group/i);
    });

    it('★ MANDATORY: a group of one says so rather than showing an empty table ★', () => {
      /*
       * Nothing to compare against, which is a real answer — and an empty panel is what a failed
       * load looks like too.
       */
      expect(describeNexus(nexusTrade([sys({ systemName: 'Alpha' })]))).toEqual([
        'A group needs more than one system before anything can feed anything else.',
      ]);
    });

    it('says when two systems simply have nothing to do with each other', () => {
      const lines = describeNexus(
        nexusTrade([sys({ systemName: 'Alpha' }), sys({ systemName: 'Beta' })]),
      );

      expect(lines).toEqual([
        'These systems do not trade with each other, and none of them needs what the others make.',
      ]);
    });

    it('says when the group is empty', () => {
      expect(describeNexus(nexusTrade([]))).toEqual(['No systems in this group yet.']);
    });
  });
});
