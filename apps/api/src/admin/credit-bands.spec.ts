import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIN_CREDIT_COHORT } from './dashboard.store.js';

/**
 * The wealth chart, and what stops it identifying anybody.
 *
 * ★ THREE GUARDS, AND EACH ONE MATTERS ★
 *
 * Squadron owner, 2026-07-30, asked for a credits chart and said to anonymise it. Banding alone
 * does not anonymise — it hides an exact figure while leaving a person perfectly visible:
 *
 *   - `show_credits` is an opt-in that defaults to FALSE, so nobody appears who has not said yes.
 *   - The query returns only COUNTS. It cannot leak a balance because it never selects one.
 *   - A minimum cohort, because with two members opted in, "one in 100M–1bn, one in 10bn+" tells
 *     anybody who knows the two of them exactly what each is worth — while looking anonymised,
 *     which is worse than showing nothing.
 *
 * These are asserted against the SOURCE as well as the behaviour: the SQL is a raw string, so a
 * future edit could drop the join or start selecting a user id, and nothing else would notice.
 */

const STORE = readFileSync(join(process.cwd(), 'src', 'admin', 'dashboard.store.ts'), 'utf8');

/** The credits query, isolated from the rest of the file. */
const CREDITS_SQL = (() => {
  const start = STORE.indexOf("SELECT band, COUNT(*)::bigint AS pilots");
  const end = STORE.indexOf('`,', start);
  return STORE.slice(start, end);
})();

describe('the credits query', () => {
  it('MANDATORY: only includes members who opted in', () => {
    /*
     * `show_credits` defaults to false. Without this join the chart would publish the balance band
     * of every member who has ever launched the game — which nobody agreed to, and which is not
     * fixed by the fact that it is a band.
     */
    expect(CREDITS_SQL).toContain('privacy_settings');
    expect(CREDITS_SQL).toMatch(/show_credits\s*=\s*true/);
  });

  it('MANDATORY: never selects a balance or an identity out of the database', () => {
    /*
     * The outer query returns `band` and a count, and nothing else. A balance that never leaves
     * the database cannot be leaked by a later mistake in the API or the page.
     */
    const outer = CREDITS_SQL.slice(0, CREDITS_SQL.indexOf('FROM ('));
    expect(outer).toContain('COUNT(*)');
    expect(outer).not.toMatch(/user_id/);
    expect(outer).not.toMatch(/Credits/);
  });

  it('uses fixed bands rather than quantiles', () => {
    /*
     * Quantiles move with the population, so a member could watch a boundary shift and learn
     * something about one other person. Fixed thresholds do not move when somebody joins.
     */
    expect(CREDITS_SQL).toContain('10000000');
    expect(CREDITS_SQL).not.toMatch(/percentile|ntile|median/i);
  });

  it('reads the latest balance per member, not every login they have ever made', () => {
    // Otherwise somebody who plays daily is counted a hundred times and one who plays weekly once,
    // and the chart describes play frequency while claiming to describe wealth.
    expect(CREDITS_SQL).toContain('DISTINCT ON (t.user_id)');
    expect(CREDITS_SQL).toContain('occurred_at DESC');
  });
});

describe('the anonymity floor', () => {
  it('MANDATORY: is high enough that one person cannot be a band', () => {
    /*
     * With a floor of two, a chart reading "one here, one there" is a statement about two named
     * people to anybody who knows who opted in. Five is the point at which a band holding one
     * person stops being a statement about that person.
     */
    expect(MIN_CREDIT_COHORT).toBeGreaterThanOrEqual(5);
  });

  it('is applied in application code, where the reasoning lives', () => {
    // Not in SQL: "too few people to be anonymous" is a disclosure decision, and burying it in a
    // HAVING clause puts it where nobody reviewing privacy would think to look.
    expect(STORE).toContain('MIN_CREDIT_COHORT');
    expect(STORE).toContain('function bandedCredits');
  });

  it('drops empty bands rather than showing them as zero', () => {
    /*
     * An empty band is itself a statement — "nobody here is under ten million" — and on a chart
     * about money that is exactly the kind of thing people read into.
     */
    expect(STORE).toMatch(/filter\(\(b\) => b\.pilots > 0\)/);
  });
});
