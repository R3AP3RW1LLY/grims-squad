import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPEN,
  openSections,
  parseStored,
  sectionOf,
  toggleSection,
  type Section,
} from './nav-sections';
import type { NavItem } from '../lib/api';

const nav = (href: string, section: NavItem['section']): NavItem => ({
  href,
  label: href,
  section,
  blurb: '',
});

const NAV: NavItem[] = [
  nav('/dashboard', 'squadron'),
  nav('/app', 'admin'),
  nav('/settings/commander', 'personal'),
  nav('/gmsd-ai/ask', 'ai'),
];

describe('openSections', () => {
  it('opens Squadron and Administration on a first visit', () => {
    const open = openSections(null, null);
    expect([...open].sort()).toEqual(['admin', 'squadron']);
    expect(DEFAULT_OPEN).toEqual(['squadron', 'admin']);
  });

  it('MANDATORY: the section holding the current page is always open', () => {
    /*
     * Land on /settings/commander from a link with "Your account" collapsed and the sidebar would
     * not contain the page you are looking at. Nothing is broken and nothing says so — you simply
     * cannot find where you are.
     */
    const open = openSections(['squadron'], 'personal');
    expect(open.has('personal')).toBe(true);
  });

  it('honours a stored preference over the defaults', () => {
    const open = openSections(['ai'], null);
    expect([...open]).toEqual(['ai']);
    expect(open.has('squadron')).toBe(false);
  });

  it('honours a deliberately empty preference', () => {
    // Closing everything is a choice somebody is allowed to make, and one click undoes it.
    expect([...openSections([], null)]).toEqual([]);
  });
});

describe('parseStored', () => {
  it('reads a saved list', () => {
    expect(parseStored('["squadron","ai"]')).toEqual(['squadron', 'ai']);
  });

  it('MANDATORY: junk falls back to the defaults, never to nothing', () => {
    /*
     * Returning an empty set would collapse every category at once — indistinguishable from the
     * navigation having been taken away, with a stale local-storage value as the invisible cause.
     */
    expect(parseStored('not json')).toBeNull();
    expect(parseStored('{"a":1}')).toBeNull();
    expect(parseStored('42')).toBeNull();
    expect(parseStored(null)).toBeNull();
  });

  it('drops names it does not recognise but keeps the rest', () => {
    // A section removed in a later build must not throw away choices about the ones that remain.
    expect(parseStored('["squadron","fleet-ops","admin"]')).toEqual(['squadron', 'admin']);
  });
});

describe('sectionOf', () => {
  it('finds the section for a page', () => {
    expect(sectionOf(NAV, '/app')).toBe('admin');
    expect(sectionOf(NAV, '/settings/commander')).toBe('personal');
  });

  it('returns null for a page not in the nav', () => {
    // Plenty of pages are reachable without a nav entry — a forum thread, a member profile.
    expect(sectionOf(NAV, '/forum/thread/1')).toBeNull();
  });
});

describe('toggleSection', () => {
  it('opens what is closed and closes what is open', () => {
    const start = new Set<Section>(['squadron']);
    expect([...toggleSection(start, 'ai')].sort()).toEqual(['ai', 'squadron']);
    expect([...toggleSection(start, 'squadron')]).toEqual([]);
  });

  it('does not mutate the set it was given', () => {
    const start = new Set<Section>(['squadron']);
    toggleSection(start, 'ai');
    expect([...start]).toEqual(['squadron']);
  });
});
