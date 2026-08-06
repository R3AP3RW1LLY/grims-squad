import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/**
 * Every link and every category carries its own icon.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "ensure every category and nav link in the website and companion app have appropriate icons
 * please! make this all look really good!"
 *
 * ★ WHY A TEST AND NOT JUST A CAREFUL AFTERNOON ★
 *
 * Nineteen of thirty-four links had no icon and fell through to the default, so unrelated pages sat
 * under the same glyph. That is worse than a blank: an icon that does not distinguish teaches the
 * eye to stop using icons at all, and the subsection headings had already been through exactly this
 * once — every one of them rendered a wrench, whatever the category was.
 *
 * It rotted because adding a nav item and adding its icon are two edits in two files, and only one
 * of them is required to make the link work. This makes the second one required too.
 */
describe('nav iconography', () => {
  const shell = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'hub-shell.tsx'),
    'utf8',
  );
  const nav = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../api/src/auth/nav.ts'),
    'utf8',
  );

  it('MANDATORY: every nav link has an icon of its own', () => {
    const iconed = new Set([...shell.matchAll(/'(\/[^']*)':\s*\w+Icon/g)].map((m) => m[1] ?? ''));
    const links = [...new Set([...nav.matchAll(/href:\s*'([^']+)'/g)].map((m) => m[1] ?? ''))];

    const missing = links.filter((href) => !iconed.has(href));

    expect(missing, `these nav links would fall back to the default icon:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('MANDATORY: every category has an icon of its own', () => {
    /*
     * The failure that already happened once: three groups rendering the same hardcoded wrench.
     * Three groups with one icon is three groups with no icon.
     */
    const subsections = [...new Set([...nav.matchAll(/subsection:\s*'([^']+)'/g)].map((m) => m[1] ?? ''))];
    const iconed = new Set(
      [...shell.matchAll(/^\s*'?([A-Za-z &]+)'?:\s*\w+Icon,/gm)].map((m) => (m[1] ?? '').trim()),
    );

    const missing = subsections.filter((name) => !iconed.has(name));

    expect(missing, `these categories have no icon: ${missing.join(', ')}`).toEqual([]);
  });
});
