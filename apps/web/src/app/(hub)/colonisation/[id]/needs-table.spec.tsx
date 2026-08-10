import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { barSegments, orderedNeeds } from './needs-table';
import type { ColonyNeed } from '../../../../lib/api';

/**
 * ★ SQUADRON OWNER, 2026-08-09 ★
 *
 * "OUR WEBSITE AND COMPANION APP ARE NOT UPDATING WHEN ITEMS ARE DELIVERED TO THE COLONIZATION
 * PROJECTS, YELLOW SHOULD DEPICT WHATS AVAILABLE ON THE CARRIER, BLUE DENOTES WHAT IS DELIVERED!"
 *
 * ★ IT WAS UPDATING. THAT WAS THE PROBLEM. ★
 *
 * The table filtered on `remaining > 0`, so a commodity's row LEFT the moment it was finished.
 * Hauling the last 730 t of Steel and watching the Steel row disappear is indistinguishable from the
 * page ignoring the delivery — the bar never turned blue because there was no bar left to look at.
 *
 * Measured on production the day it was reported: 207 of 302 need rows hidden, 584,108 tonnes of
 * completed work. Every backend number was correct and current — the sync had applied every depot
 * reading within seconds of it arriving, and the delivery ledger held all 533 rows. The defect was
 * entirely in what the page chose to draw, which is why no API test could have found it.
 *
 * ★ WHY THE LOGIC IS EXPORTED RATHER THAN TESTED THROUGH THE DOM ★
 *
 * This repo has no DOM testing library and every other `.spec.tsx` reads source text. A source test
 * here would assert "the file does not contain `remaining > 0`", which passes the moment somebody
 * reintroduces the filter in a different shape. So the two things that can actually be wrong — what
 * is listed, and how wide the segments are — are ordinary functions, and these are ordinary tests.
 */

const need = (commodity: string, required: number, remaining: number): ColonyNeed =>
  ({ commodity, required, remaining, observedAt: null }) as unknown as ColonyNeed;

describe('every commodity the site asked for stays listed', () => {
  it('★ MANDATORY: a fully delivered commodity is still there ★', () => {
    const rows = orderedNeeds([need('Aluminium', 1186, 1186), need('Steel', 1898, 0)]);

    expect(
      rows.map((n) => n.commodity),
      'Steel was fully delivered and dropped out — which is exactly what a member reads as ' +
        '"the page did not update when I delivered"',
    ).toContain('Steel');
    expect(rows).toHaveLength(2);
  });

  it('★ MANDATORY: the six commodities finished on Pace Expedition all survive ★', () => {
    // The real row set from the build the owner was watching, at the moment they reported it.
    const finished = [
      need('Steel', 1898, 0),
      need('Structural Regulators', 202, 0),
      need('Computer Components', 84, 0),
      need('Military Grade Fabrics', 48, 0),
      need('Reactive Armour', 48, 0),
      need('Micro Controllers', 24, 0),
    ];
    expect(orderedNeeds([...finished, need('Aluminium', 1186, 1186)])).toHaveLength(7);
  });

  it('MANDATORY: outstanding work is listed before finished work', () => {
    // Somebody opening this is planning an evening. What is left comes first; the record settles
    // underneath it.
    const rows = orderedNeeds([
      need('Steel', 1898, 0),
      need('Aluminium', 1186, 1186),
      need('CMM Composite', 712, 0),
      need('Polymers', 238, 100),
    ]);

    expect(rows.map((n) => n.commodity)).toEqual([
      'Aluminium',
      'Polymers',
      'Steel',
      'CMM Composite',
    ]);
  });

  it('keeps an empty list empty rather than inventing a row', () => {
    expect(orderedNeeds([])).toEqual([]);
  });
});

describe('the bar says what the legend promises', () => {
  it('★ MANDATORY: blue is what was delivered ★', () => {
    expect(barSegments({ delivered: 250, staged: 0, required: 1000 }).deliveredPct).toBe(25);
  });

  it('★ MANDATORY: yellow is what is aboard a carrier, and follows the blue ★', () => {
    const { deliveredPct, stagedPct } = barSegments({ delivered: 250, staged: 250, required: 1000 });
    expect(deliveredPct).toBe(25);
    expect(stagedPct).toBe(25);
    // The two together must never claim more of the bar than exists.
    expect(deliveredPct + stagedPct).toBeLessThanOrEqual(100);
  });

  it('MANDATORY: a finished commodity is fully blue', () => {
    expect(barSegments({ delivered: 1898, staged: 0, required: 1898 }).deliveredPct).toBe(100);
  });

  it('MANDATORY: a carrier holding more than the site wants covers it, it does not overflow', () => {
    const { deliveredPct, stagedPct } = barSegments({ delivered: 800, staged: 5000, required: 1000 });
    expect(deliveredPct).toBe(80);
    expect(stagedPct, 'yellow ran past the end of the bar').toBe(20);
  });

  it('never renders a negative segment', () => {
    // `remaining` can exceed `required` on a site whose requirement grew between readings.
    const { deliveredPct, stagedPct } = barSegments({ delivered: -50, staged: -10, required: 1000 });
    expect(deliveredPct).toBe(0);
    expect(stagedPct).toBe(0);
  });
});

describe('the table is wired to the unfiltered list', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(resolve(HERE, 'needs-table.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('MANDATORY: the rows come from orderedNeeds, not from a filter at the call site', () => {
    /*
     * The functions above can be perfect while the component maps something else — which is the
     * exact shape of the original bug, where the arithmetic was right and the list was short.
     */
    expect(source).toMatch(/const rows = orderedNeeds\(needs\)/);
    expect(
      source,
      'the component filters the needs itself again, which is what hid the finished rows',
    ).not.toMatch(/needs\.filter\(\(n\) => n\.remaining > 0\)[\s\S]{0,200}\.map\(/);
  });
});
