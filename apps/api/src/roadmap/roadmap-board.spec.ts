import { describe, expect, it } from 'vitest';
import {
  COLUMN_LABELS,
  ROADMAP_COLUMNS,
  clampPosition,
  cleanCardBody,
  cleanCardTitle,
  isRoadmapColumn,
  placeInOrder,
} from './roadmap-board.js';

describe('the five columns', () => {
  it('MANDATORY: exactly five, in board order, each with a label', () => {
    expect(ROADMAP_COLUMNS).toEqual(['ideas', 'considering', 'planned', 'building', 'shipped']);
    for (const column of ROADMAP_COLUMNS) {
      expect(COLUMN_LABELS[column].length).toBeGreaterThan(0);
    }
  });

  it('a sixth column cannot be smuggled in as a string', () => {
    expect(isRoadmapColumn('someday')).toBe(false);
    expect(isRoadmapColumn(undefined)).toBe(false);
    expect(isRoadmapColumn('ideas')).toBe(true);
  });
});

describe('the caps', () => {
  it('a title fits a thread title, because promoted cards take theirs from one', () => {
    expect('title' in cleanCardTitle('a'.repeat(200))).toBe(true);
    expect('problem' in cleanCardTitle('a'.repeat(201))).toBe(true);
    expect('problem' in cleanCardTitle('ab')).toBe(true);
  });

  it('an empty body becomes null — the title speaks for itself', () => {
    expect(cleanCardBody('')).toEqual({ body: null });
    expect(cleanCardBody(undefined)).toEqual({ body: null });
    expect(cleanCardBody('  why:  votes  ')).toEqual({ body: 'why:  votes' });
  });
});

describe('the reordering arithmetic', () => {
  it('MANDATORY: placing a card renumbers the whole column 0..n with no gaps', () => {
    const ordered = placeInOrder(['a', 'b', 'c'], 'x', 1);
    expect(ordered).toEqual(['a', 'x', 'b', 'c']);
  });

  it('moving within a column removes the card first, so it cannot occupy two slots', () => {
    expect(placeInOrder(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
    expect(placeInOrder(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
  });

  it('an out-of-range index lands at the nearest real slot rather than erroring', () => {
    // The console's arrows compute from a list that can be seconds stale — a colleague may
    // have archived the row above — and a refusal would turn every such race into a retry.
    expect(placeInOrder(['a', 'b'], 'x', 99)).toEqual(['a', 'b', 'x']);
    expect(placeInOrder(['a', 'b'], 'x', -5)).toEqual(['x', 'a', 'b']);
    expect(clampPosition(99, 3)).toBe(3);
    expect(clampPosition(-1, 3)).toBe(0);
    expect(clampPosition('nonsense', 3)).toBe(3);
  });
});
