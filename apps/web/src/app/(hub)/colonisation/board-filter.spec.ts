import { describe, expect, it } from 'vitest';
import { BOARD_FILTERS, boardHref, filterBoard, resolveFilter, visibleFilters } from './board-filter';

/**
 * The board's status filter.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "on the Members' and Squadron pages on both web and companion app, we need to add view filters
 * one for inprogress and one for complete"
 *
 * ★ THE BUG THIS FILE EXISTS TO PREVENT, WHICH THE CODEBASE HAS ALREADY HAD ONCE ★
 *
 * `board-sort-links.tsx` builds every href as `${basePath}?sort=${key}`. That is fine while sort is
 * the only control on the page and silently wrong the moment there are two: choosing a sort would
 * drop the filter, choosing a filter would drop the sort, and each control would appear to reset
 * the other at random.
 *
 * `page-tabs.tsx` documents the same class of bug from the other direction — a `?` appended to a
 * basePath that already carries a query yields `?a=1?tab=b`, and the control simply never selects.
 *
 * So the href is built in one place, from all of the state, and both controls call it.
 */

describe('resolving what the reader asked for', () => {
  it('★ MANDATORY: nothing chosen means in progress ★', () => {
    /*
     * The filters exist because the board fills with finished builds. Defaulting to "all" would
     * leave the page exactly as it is today and make the filter something every member has to set
     * on every single visit.
     */
    expect(resolveFilter(undefined)).toBe('in-progress');
  });

  it('★ MANDATORY: a value we do not recognise falls back rather than showing nothing ★', () => {
    // A stale link, a typo, or a member editing the URL. An unrecognised filter matching no project
    // would render an empty board that looks like the squadron has stopped building.
    expect(resolveFilter('nonsense')).toBe('in-progress');
    expect(resolveFilter('')).toBe('in-progress');
  });

  it('every offered filter resolves to itself', () => {
    for (const f of BOARD_FILTERS) expect(resolveFilter(f.key)).toBe(f.key);
  });
});

describe('building the href', () => {
  it('★ MANDATORY: changing the filter keeps the sort ★', () => {
    const href = boardHref({ basePath: '/colonisation/members', sort: 'nearest', filter: 'complete' });

    expect(href).toContain('sort=nearest');
    expect(href).toContain('filter=complete');
  });

  it('★ MANDATORY: changing the sort keeps the filter ★', () => {
    // The same assertion from the other control's side, because the failure is symmetrical and a
    // test of only one direction would pass with the bug still present in the other.
    const href = boardHref({ basePath: '/colonisation/squadron', sort: 'stalled', filter: 'abandoned' });

    expect(href).toContain('filter=abandoned');
    expect(href).toContain('sort=stalled');
  });

  it('★ MANDATORY: exactly one question mark, whatever is set ★', () => {
    /*
     * `?a=1?b=2` is the shape `page-tabs.tsx` warns about: it parses as a single parameter whose
     * value contains a question mark, so the control never matches its own link and never appears
     * selected.
     */
    const href = boardHref({ basePath: '/colonisation/members', sort: 'best', filter: 'all' });

    expect(href.split('?')).toHaveLength(2);
  });

  it('the defaults are left out, so a plain link stays plain', () => {
    /*
     * Not cosmetic. The board's canonical URL is the one a member sends a squadmate, and
     * `?sort=best&filter=in-progress` on every link would make the default view look like a
     * deliberately narrowed one.
     */
    expect(boardHref({ basePath: '/colonisation/members', sort: 'best', filter: 'in-progress' })).toBe(
      '/colonisation/members',
    );
  });

  it('★ MANDATORY: a value cannot smuggle in a second parameter ★', () => {
    /*
     * The property that matters, rather than the exact spelling of the escape: an unencoded `&` in
     * a value would end that parameter and start another, so a crafted value could set a control
     * the link was never meant to touch. Every current value is resolved before it arrives here —
     * which is precisely why this is asserted now, because the next one added may not be.
     *
     * The space becoming `+` rather than `%20` is URLSearchParams doing the correct thing; both
     * decode identically, so the test asserts the danger and not the dialect.
     */
    const href = boardHref({ basePath: '/x', sort: 'best', filter: 'in-progress', extra: 'a b&c' });

    expect(href).toContain('%26');
    expect(href.split('&')).toHaveLength(1);
  });
});

describe('which filters are worth offering', () => {
  it('★ MANDATORY: abandoned is not offered to somebody who can never see one ★', () => {
    /*
     * An abandoned build is hidden from everybody except its poster and officers. A tab that is
     * permanently empty for most of the squadron is not a neutral extra — it teaches people that
     * the controls on this page do not work.
     */
    expect(visibleFilters({ canManage: false, hasAbandoned: false }).map((f) => f.key)).not.toContain(
      'abandoned',
    );
  });

  it('★ MANDATORY: an officer is always offered it ★', () => {
    // They can act on it, so they must be able to find it — including to undo one.
    expect(visibleFilters({ canManage: true, hasAbandoned: false }).map((f) => f.key)).toContain(
      'abandoned',
    );
  });

  it('★ MANDATORY: so is a member who actually has one ★', () => {
    // The poster of an abandoned build can see it. Hiding the tab would leave them with a project
    // that exists, is theirs, and cannot be reached from the board it used to sit on.
    expect(visibleFilters({ canManage: false, hasAbandoned: true }).map((f) => f.key)).toContain(
      'abandoned',
    );
  });

  it('the ordinary filters are always there', () => {
    const keys = visibleFilters({ canManage: false, hasAbandoned: false }).map((f) => f.key);
    expect(keys).toEqual(['in-progress', 'complete', 'all']);
  });
});

describe('splitting a board into the chosen view', () => {
  const p = (over: Partial<{ completedAt: string | null; abandonedAt: string | null }> = {}) => ({
    completedAt: over.completedAt === undefined ? null : over.completedAt,
    abandonedAt: over.abandonedAt === undefined ? null : over.abandonedAt,
  });

  const AT = '2026-08-15T12:00:00Z';

  it('★ MANDATORY: in progress excludes both finished and abandoned ★', () => {
    const out = filterBoard([p(), p({ completedAt: AT }), p({ abandonedAt: AT })], 'in-progress', false);

    expect(out.projects).toHaveLength(1);
  });

  it('★ MANDATORY: a build marked complete AND abandoned is not in the complete view ★', () => {
    /*
     * An officer correcting a wrong "complete". Listing it under complete would put the mistake
     * back on the board they acted to take it off.
     */
    const both = p({ completedAt: AT, abandonedAt: AT });

    expect(filterBoard([both], 'complete', true).projects).toHaveLength(0);
    expect(filterBoard([both], 'abandoned', true).projects).toHaveLength(1);
  });

  it('★ MANDATORY: the counts describe the whole board, not the view ★', () => {
    /*
     * The tabs carry these numbers. Counting after filtering would make every tab report the size
     * of the tab already open — which reads as correct right up until somebody clicks another one.
     */
    const out = filterBoard(
      [p(), p(), p({ completedAt: AT }), p({ abandonedAt: AT })],
      'in-progress',
      true,
    );

    expect(out.counts['in-progress']).toBe(2);
    expect(out.counts.complete).toBe(1);
    expect(out.counts.abandoned).toBe(1);
    expect(out.counts.all).toBe(4);
  });

  it('an empty or malformed timestamp is not a stamp', () => {
    // The same rule the badge count already carries: a blank is not a date, and treating one as
    // "finished" would hide a live build from the people meant to be hauling for it.
    const out = filterBoard([p({ completedAt: '' }), p({ completedAt: 'not a date' })], 'in-progress', false);

    expect(out.projects).toHaveLength(2);
  });

  it('an officer is offered the abandoned tab even on a board with none', () => {
    expect(filterBoard([p()], 'in-progress', true).hasAbandoned).toBe(true);
  });

  it('an ordinary member is offered it only when one of theirs is on the board', () => {
    expect(filterBoard([p()], 'in-progress', false).hasAbandoned).toBe(false);
    expect(filterBoard([p({ abandonedAt: AT })], 'in-progress', false).hasAbandoned).toBe(true);
  });
});
