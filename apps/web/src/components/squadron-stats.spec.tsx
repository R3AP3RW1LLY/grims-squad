import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SquadronStatsBand } from './squadron-stats';

/**
 * P1.9 — live squadron statistics.
 *
 * Two properties worth protecting, both easy to "simplify" away later.
 */
const STATS = {
  members: 42,
  activeThisMonth: 17,
  activityThisMonth: 1_204,
  verifiedCommanders: 9,
  foundedYear: 2006,
  generatedAt: '2026-07-27T08:00:00.000Z',
};

describe('squadron stats', () => {
  it('MANDATORY: renders NOTHING when the stats are unavailable', () => {
    // A row of zeros is a CLAIM — "nobody was active this month" — made on no
    // evidence at all, when the truth is that we could not reach our own API.
    // Silence is honest; zero is not.
    expect(renderToStaticMarkup(<SquadronStatsBand stats={null} />)).toBe('');
  });

  it('MANDATORY: contains no member name, handle or id', () => {
    // Counts are public — squadron size is on Inara anyway. WHO those people
    // are is governed by INV-027. The API returns no identifiers, and this
    // asserts the component cannot start rendering any.
    const html = renderToStaticMarkup(<SquadronStatsBand stats={STATS} />);
    expect(html).not.toMatch(/handle|displayName|cmdrName|userId/i);
  });

  it('shows the counts it was given', () => {
    const html = renderToStaticMarkup(<SquadronStatsBand stats={STATS} />);
    expect(html).toContain('42');
    expect(html).toContain('17');
    expect(html).toContain('1,204');
  });

  it('states WHEN the numbers were taken', () => {
    // "This month" is a rolling total and means nothing without a date. Saying
    // when also avoids implying they are live to the second.
    const html = renderToStaticMarkup(<SquadronStatsBand stats={STATS} />);
    expect(html).toContain('2026-07-27 08:00');
  });

  it('derives years flying from the founding year rather than hardcoding it', () => {
    const html = renderToStaticMarkup(
      <SquadronStatsBand stats={{ ...STATS, foundedYear: 2016 }} />,
    );
    expect(html).toContain('Founded 2016');
    expect(html).toContain(String(new Date().getUTCFullYear() - 2016));
  });
});
