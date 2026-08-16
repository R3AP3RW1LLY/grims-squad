import { describe, expect, it } from 'vitest';
import { renderBuildBook, type BookPlan } from './build-book.js';

/**
 * The build book.
 *
 * ★ SQUADRON OWNER ★
 *
 * "the build guide generator is also not anywhere i can find it?"
 *
 * It was never built. What existed were one-off scripts in a scratch directory that read hardcoded
 * JSON off one machine and printed one system's book once. This is the same output, generated from
 * a plan that actually lives in the database, for any system, on demand.
 *
 * ★ WHAT IT IS FOR ★
 *
 * A member flying a colonisation run has the game in front of them and a planner in a browser they
 * cannot see at the same time. The book is the plan on paper — or on a second monitor — with the
 * build id and body id on every row, so it can be read straight into the game's own planner without
 * translating anything.
 *
 * That is why the ids matter more than the prose: a row without its build id is a row somebody has
 * to go and look up, and looking it up is the thing the book exists to stop.
 */

const plan = (over: Partial<BookPlan> = {}): BookPlan => ({
  systemName: over.systemName ?? 'Col 285 Sector GL-W c2-12',
  architect: over.architect ?? 'CMDR Pebblemerchant',
  generatedAt: over.generatedAt ?? new Date('2026-08-16T12:00:00Z'),
  sites: over.sites ?? [
    { order: 1, buildId: 'hermes', displayName: 'Coriolis Starport', body: 'B 8 a', tier: 1, totalTonnes: 22_000, built: false },
    { order: 2, buildId: 'ourea', displayName: 'Refinery Hub', body: 'A 1 f', tier: 2, totalTonnes: 4_500, built: true },
  ],
});

describe('what every row must carry', () => {
  it('★ MANDATORY: the build id and the body id are on every row ★', () => {
    /*
     * The entire point. The book is read beside the game, and a row without its ids is a row the
     * member has to go and look up — which is the work the book exists to remove.
     */
    const html = renderBuildBook(plan());

    expect(html).toContain('hermes');
    expect(html).toContain('B 8 a');
    expect(html).toContain('ourea');
    expect(html).toContain('A 1 f');
  });

  it('the system and the architect are named', () => {
    const html = renderBuildBook(plan());

    expect(html).toContain('Col 285 Sector GL-W c2-12');
    expect(html).toContain('CMDR Pebblemerchant');
  });

  it('★ MANDATORY: what is already built is marked ★', () => {
    /*
     * A book that does not distinguish them sends somebody to build a station that is standing. It
     * is the same failure as an open project that is actually finished, printed onto paper where
     * nothing can correct it.
     */
    const html = renderBuildBook(plan());

    expect(html).toMatch(/built/i);
  });
});

describe('it is one file, openable anywhere', () => {
  it('★ MANDATORY: no external stylesheet, script or image ★', () => {
    /*
     * It is opened from a downloads folder, often offline, and printed. Anything fetched from a
     * network is a page that renders differently — or blank — exactly when somebody needs it.
     */
    const html = renderBuildBook(plan());

    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<img[^>]+src="http/i);
  });

  it('MANDATORY: it is a complete document, not a fragment', () => {
    // Saved to disk and double-clicked. A fragment renders as quirks-mode soup.
    const html = renderBuildBook(plan());

    expect(html.trimStart().toLowerCase()).toMatch(/^<!doctype html>/);
    expect(html).toContain('</html>');
  });

  it('MANDATORY: it carries print rules, because printing is the point', () => {
    expect(renderBuildBook(plan())).toContain('@media print');
  });
});

describe('the numbers', () => {
  it('★ MANDATORY: the total is the sum of what is NOT yet built ★', () => {
    /*
     * The figure a member plans hauling around. Including finished sites would overstate the work
     * remaining by everything already delivered — on the one document somebody carries away from
     * the screen that could have corrected it.
     */
    const html = renderBuildBook(plan());

    expect(html).toContain('22,000');
    expect(html, 'the finished 4,500 must not be added in').not.toContain('26,500');
  });

  it('tonnages are grouped, because six digits unspaced are misread', () => {
    const html = renderBuildBook(
      plan({ sites: [{ order: 1, buildId: 'zeus', displayName: 'Ocellus', body: 'A 2', tier: 3, totalTonnes: 1_250_000, built: false }] }),
    );

    expect(html).toContain('1,250,000');
  });
});

describe('safety', () => {
  it('★ MANDATORY: a system or commander name cannot inject markup ★', () => {
    /*
     * Names reach this from the planner, where a member typed them. This file is written to disk and
     * opened in a browser — a book that executes what somebody typed into a plan name is a book that
     * cannot be handed round the squadron.
     */
    const html = renderBuildBook(
      plan({ systemName: '<script>alert(1)</script>', architect: '"><img onerror=alert(1)>' }),
    );

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;script&gt;');
  });

  it('an empty plan renders a book that says so, rather than a broken one', () => {
    // A plan with no sites is a real state — somebody just created it. A blank page reads as the
    // generator having failed.
    const html = renderBuildBook(plan({ sites: [] }));

    expect(html).toMatch(/nothing planned|no sites|empty/i);
  });
});
