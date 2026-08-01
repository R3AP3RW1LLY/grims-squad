import type { NavItem } from '../lib/api';

/**
 * Which sidebar categories are open.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "make all sidebar categories collapsable, by default the only categories that should be expanded
 * is Squadron and Administration everything else can be collapsed by default"
 *
 * ★ WHY THE RULES ARE NOT IN THE COMPONENT ★
 *
 * Two of them are easy to get wrong and impossible to see when they are: a section holding the page
 * you are on must never be closed, and a stored preference from an older build must not be able to
 * hide the whole sidebar. Both are three lines and both need a test.
 */

export type Section = NavItem['section'];

/** Open on a first visit. Everything else starts closed. */
export const DEFAULT_OPEN: readonly Section[] = ['squadron', 'admin'];

/** Where the choice is remembered. Navigation is a full page load, so without this it resets. */
export const NAV_STORAGE_KEY = 'gmsd.nav.open';

/**
 * The sections that should be open right now.
 *
 * ★ THE SECTION YOU ARE IN IS ALWAYS OPEN ★
 *
 * A member who lands on `/settings/commander` from a link, with "Your account" collapsed, would see
 * a sidebar that does not contain the page they are looking at. Nothing is broken and nothing says
 * so — they simply cannot find where they are. So the current page's section is forced open,
 * whatever the defaults or the stored preference say.
 */
export function openSections(
  stored: readonly Section[] | null,
  currentSection: Section | null,
): Set<Section> {
  const open = new Set<Section>(stored ?? DEFAULT_OPEN);
  if (currentSection !== null) open.add(currentSection);
  return open;
}

/** The section containing `href`, or null when nothing matches. */
export function sectionOf(items: readonly NavItem[], href: string): Section | null {
  return items.find((i) => i.href === href)?.section ?? null;
}

const SECTIONS: readonly string[] = ['squadron', 'personal', 'ai', 'admin'];

/**
 * Reads a stored preference, refusing anything it does not recognise.
 *
 * Returns null — meaning "use the defaults" — rather than an empty set for junk. A parse failure
 * that produced an empty set would collapse every category at once, which looks exactly like the
 * navigation having been taken away, and the user would have no way to know a stale value in local
 * storage was the cause.
 *
 * An empty array that was genuinely SAVED is honoured: closing everything is a choice somebody is
 * allowed to make, and it is trivially undone by clicking a heading.
 */
export function parseStored(raw: string | null): Section[] | null {
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    // Unknown names are dropped rather than rejecting the whole value: a section removed in a later
    // build must not throw away the member's choices about the ones that remain.
    return parsed.filter((v): v is Section => typeof v === 'string' && SECTIONS.includes(v));
  } catch {
    return null;
  }
}

/** Open a closed section, close an open one. */
export function toggleSection(open: ReadonlySet<Section>, section: Section): Set<Section> {
  const next = new Set(open);
  if (next.has(section)) next.delete(section);
  else next.add(section);
  return next;
}
