import { describe, expect, it } from 'vitest';
import { systemMarket } from './colony-nexus-market.js';

/**
 * Where one system's exports and imports come from.
 *
 * ★ SQUADRON OWNER, 2026-08-25 ★
 *
 * "Real where we have it, predicted elsewhere, and say which is which."
 *
 * Checked against production the day this was written: three of nine planned systems had real
 * markets and six had none. The mixed case is the ordinary one.
 */

describe('deciding what a system trades', () => {
  it('★ MANDATORY: stock is an EXPORT and demand is an IMPORT, not the other way round ★', () => {
    /*
     * The one translation this module exists to perform, and the easiest thing in the whole feature
     * to get backwards. `supply` is the STATION's stock — tonnes it will sell you — so the SYSTEM
     * exports it. Inverting this would reverse every route on the map and still look plausible.
     */
    const report = systemMarket({
      systemName: 'Alpha',
      measured: [
        { commodity: 'Beryllium', supply: 400, demand: 0 },
        { commodity: 'Steel', supply: 0, demand: 900 },
      ],
      predicted: [],
    });

    expect(report.exports).toEqual(['Beryllium']);
    expect(report.imports).toEqual(['Steel']);
    expect(report.basis).toBe('measured');
  });

  it('records both when a station stocks and wants the same commodity', () => {
    const report = systemMarket({
      systemName: 'Alpha',
      measured: [{ commodity: 'Steel', supply: 10, demand: 10 }],
      predicted: [],
    });

    expect(report.exports).toEqual(['Steel']);
    expect(report.imports).toEqual(['Steel']);
  });

  it('★ MANDATORY: a real market WINS, and the prediction is not mixed into it ★', () => {
    /*
     * A system part-way through building has both. Merging them would put entries that can be flown
     * tonight and entries that cannot into one list under one badge — the exact confusion
     * `flyableNow` exists to prevent, and worse here because nothing in a merged list says which
     * half is which.
     */
    const report = systemMarket({
      systemName: 'Alpha',
      measured: [{ commodity: 'Steel', supply: 100, demand: 0 }],
      predicted: [{ exports: ['Gold'], imports: ['Grain'] }],
    });

    expect(report.basis).toBe('measured');
    expect(report.exports, 'the planned Gold is NOT here').toEqual(['Steel']);
    expect(report.imports, 'nor the planned Grain').toEqual([]);
  });

  it('★ MANDATORY: rows that trade nothing fall through to the plan ★', () => {
    /*
     * A station can be in the mirror with zero stock and zero demand for everything — present, but
     * not a market yet. Calling that `measured` would report a standing station that trades
     * nothing, which reads as a bug rather than as the empty market it is.
     */
    const report = systemMarket({
      systemName: 'Alpha',
      measured: [{ commodity: 'Steel', supply: 0, demand: 0 }],
      predicted: [{ exports: ['Gold'], imports: [] }],
    });

    expect(report.basis).toBe('predicted');
    expect(report.exports).toEqual(['Gold']);
  });

  it('uses the plan when there is no mirror data at all', () => {
    const report = systemMarket({
      systemName: 'Alpha',
      measured: [],
      predicted: [
        { exports: ['Gold'], imports: ['Grain'] },
        { exports: ['Silver'], imports: ['Grain'] },
      ],
    });

    expect(report.basis).toBe('predicted');
    expect(report.exports, 'union across the planned stations').toEqual(['Gold', 'Silver']);
    expect(report.imports, 'and deduplicated').toEqual(['Grain']);
  });

  it('deduplicates a commodity sold by several stations in the same system', () => {
    const report = systemMarket({
      systemName: 'Alpha',
      measured: [
        { commodity: 'Steel', supply: 10, demand: 0 },
        { commodity: 'Steel', supply: 50, demand: 0 },
      ],
      predicted: [],
    });

    expect(report.exports).toEqual(['Steel']);
  });

  it('★ MANDATORY: nothing built and nothing planned is `unknown`, not an empty market ★', () => {
    /*
     * The two are not the same. `unknown` is listed under `unplanned` and contributes nothing to the
     * gaps; an empty `predicted` would silently claim we had modelled the system and found it
     * traded nothing — which would be a confident, invisible lie.
     */
    const report = systemMarket({ systemName: 'Empty', measured: [], predicted: [] });

    expect(report.basis).toBe('unknown');
    expect(report.exports).toEqual([]);
    expect(report.imports).toEqual([]);
  });

  it('treats a plan with only empty lists as unplanned', () => {
    const report = systemMarket({
      systemName: 'Empty',
      measured: [],
      predicted: [{ exports: [], imports: [] }],
    });

    expect(report.basis).toBe('unknown');
  });

  it('ignores blank commodity names rather than making a nameless row', () => {
    const report = systemMarket({
      systemName: 'Alpha',
      measured: [{ commodity: '   ', supply: 10, demand: 10 }],
      predicted: [{ exports: ['  '], imports: [''] }],
    });

    expect(report.basis).toBe('unknown');
    expect(report.exports).toEqual([]);
  });

  it('trims names so the mirror and the model agree on one spelling', () => {
    const report = systemMarket({
      systemName: 'Alpha',
      measured: [{ commodity: '  Steel ', supply: 10, demand: 0 }],
      predicted: [],
    });

    expect(report.exports).toEqual(['Steel']);
  });

  it('carries the system name through unchanged', () => {
    expect(
      systemMarket({ systemName: 'Col 285 Sector GL-W c2-12', measured: [], predicted: [] })
        .systemName,
    ).toBe('Col 285 Sector GL-W c2-12');
  });
});
