import { describe, expect, it } from 'vitest';
import { topUnknown } from './window.js';

/**
 * Naming the unnamed.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "if commodities are unnamed, we need to figure this out and get them added! this is
 * non-negotiable!"
 *
 * The count has been on the live log for weeks with no way to learn which commodities it meant.
 * The symbols were in memory the whole time and cleared hourly without ever being reported.
 */
describe('naming the unnamed commodities on the log', () => {
  it('MANDATORY: says nothing when there is nothing to say', () => {
    // The segment must disappear rather than render an empty bracket on a healthy window.
    expect(topUnknown(new Map())).toBe('');
    expect(topUnknown(undefined)).toBe('');
  });

  it('MANDATORY: names the worst offenders, commonest first', () => {
    const out = topUnknown(
      new Map([
        ['rare_thing', 1],
        ['curatedcommodity', 68],
        ['another', 9],
      ]),
    );

    expect(out).toContain('curatedcommodity×68');
    expect(out.indexOf('curatedcommodity')).toBeLessThan(out.indexOf('another'));
  });

  it('MANDATORY: a long tail is summarised, not printed in full', () => {
    /*
     * A game update can leave dozens unmapped at once. Printing every one would push a hundred
     * symbols onto a line somebody reads at a glance, and the line is the whole point.
     */
    const many = new Map(Array.from({ length: 30 }, (_, i) => [`sym${i}`, 30 - i] as const));
    const out = topUnknown(many);

    expect(out).toContain('+27 more');
    expect(out.split(',').length).toBeLessThanOrEqual(4);
  });
});
