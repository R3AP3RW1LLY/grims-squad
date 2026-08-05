/**
 * Tabs within a page.
 *
 * ★ REAL LINKS, NOT CLIENT STATE ★
 *
 * The obvious build is `useState` and a couple of buttons. This is `<a>` tags
 * against a query parameter instead, and it buys three things that matter:
 *
 *  - The tab survives a refresh, and can be linked to. "Look at the
 *    verification tab" is a URL rather than an instruction.
 *  - Each tab renders on the SERVER with only the data it needs.
 *  - It works before the JavaScript has loaded, and for anything that does not
 *    run it at all.
 *
 * The cost is a navigation per tab change. On server-rendered pages this small
 * that is imperceptible, and it is the right trade for a settings screen
 * somebody visits occasionally rather than an app they live in.
 */

export interface PageTab {
  readonly key: string;
  readonly label: string;
  /**
   * Rendered after the label, inside the link — a live counter pill, typically.
   *
   * A NODE rather than a number, so a tab whose count must stay current (the admin console's
   * Support tab rides the SSE stream) can bring its own client component while these tabs stay
   * server-rendered links. Absent for the tabs that are just names, which is nearly all of them.
   */
  readonly badge?: React.ReactNode;
}

/**
 * Appends `tab=` with the right separator.
 *
 * ★ A basePath MAY ALREADY CARRY A QUERY ★
 *
 * This used to be a bare `${basePath}?tab=${key}`, which was fine while every caller passed a plain
 * path. The colonisation project page passes its filters along so a member who set a 200 ly radius
 * and then opened Carriers does not come back to a silently reset shopping list — and that produced
 * `...?withinLy=200&sort=cheapest?tab=buy`, a second question mark that makes the whole tail one
 * malformed parameter value. The tab still rendered; it simply never selected.
 */
function withTab(basePath: string, key: string): string {
  return `${basePath}${basePath.includes('?') ? '&' : '?'}tab=${key}`;
}

export function PageTabs({
  tabs,
  current,
  basePath,
}: {
  tabs: readonly PageTab[];
  current: string;
  basePath: string;
}) {
  return (
    <nav aria-label="Sections" className="flex flex-wrap gap-1">
      {tabs.map((tab, index) => {
        const active = tab.key === current;
        return (
          <a
            key={tab.key}
            /*
             * The first tab links to the bare path rather than `?tab=whatever`.
             * It is the default, so carrying a parameter that changes nothing
             * makes two URLs for one page — and the tidier one is what people
             * copy out of the address bar.
             */
            href={index === 0 ? basePath : withTab(basePath, tab.key)}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'rounded border border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_12%,transparent)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-orange-bright)]'
                : 'rounded border border-[var(--color-border-hairline)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)]'
            }
          >
            {tab.label}
            {tab.badge}
          </a>
        );
      })}
    </nav>
  );
}

/**
 * Resolves `?tab=` to a real tab.
 *
 * Anything unrecognised falls to the first tab rather than rendering nothing. A
 * hand-edited or stale URL should show the default page, not a blank one.
 */
export function resolveTab(tabs: readonly PageTab[], requested: unknown): string {
  const first = tabs[0]?.key ?? '';
  if (typeof requested !== 'string') return first;
  return tabs.some((t) => t.key === requested) ? requested : first;
}
