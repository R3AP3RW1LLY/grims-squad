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

/**
 * Subcategories, which are collapsed unless somebody opens them.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "make this collapsable and make it closed by default please!"
 *
 * ★ WHY THEY GET THEIR OWN STORAGE KEY ★
 *
 * A subcategory and a section are the same control with different defaults — sections Squadron and
 * Administration start OPEN, every subcategory starts CLOSED. Sharing one stored set would make an
 * absent entry ambiguous: for a section it means "use the default open list", for a subcategory it
 * means closed, and one value cannot mean both.
 */
export const SUBSECTION_STORAGE_KEY = 'gmsd.nav.subsections.open';

/**
 * Which subcategories are open.
 *
 * ★ THE ONE HOLDING THE CURRENT PAGE IS ALWAYS OPEN ★
 *
 * Same rule as sections, and it matters more here: a subcategory is closed by default, so landing
 * on the Outfitter from a link would otherwise show a sidebar with the Shipyard collapsed and no
 * indication that the page you are on lives inside it.
 */
export function openSubsections(
  stored: readonly string[] | null,
  currentSubsection: string | null,
): Set<string> {
  const open = new Set<string>(stored ?? []);
  if (currentSubsection !== null) open.add(currentSubsection);
  return open;
}

/** The subcategory containing `href`, or null. */
export function subsectionOf(items: readonly NavItem[], href: string): string | null {
  return items.find((i) => i.href === href)?.subsection ?? null;
}

/**
 * Reads stored subcategory names.
 *
 * Unlike sections, junk here falls back to an EMPTY set rather than to a default list — closed is
 * the default, so an unreadable value costs nothing and collapsing everything is exactly what a
 * first visit looks like anyway.
 */
export function parseStoredSubsections(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Open a closed subcategory, close an open one. */
export function toggleSubsection(open: ReadonlySet<string>, name: string): Set<string> {
  const next = new Set(open);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  return next;
}
