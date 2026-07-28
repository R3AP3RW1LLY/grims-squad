import type { NavItem } from '../lib/api';

/**
 * The sidebar on member and admin pages.
 *
 * ★ WHY A SIDEBAR AT ALL, GIVEN THE NAVBAR ★
 *
 * The navbar carries the four or five places everybody goes. The sidebar
 * carries EVERYTHING they can reach, grouped — which is the difference between
 * knowing the site has an audit log and finding it.
 *
 * It renders only what the server said this member can reach, so an ordinary
 * member's sidebar is short and an officer's is long, and neither is shown a
 * heading with nothing under it.
 */

const SECTION_LABELS: Record<NavItem['section'], string> = {
  squadron: 'Squadron',
  personal: 'Your account',
  admin: 'Administration',
};

const ORDER: NavItem['section'][] = ['squadron', 'personal', 'admin'];

export function SideNav({ nav, current }: { nav: NavItem[]; current?: string }) {
  const sections = ORDER.map((section) => ({
    section,
    items: nav.filter((i) => i.section === section),
  })).filter((s) => s.items.length > 0);

  return (
    <nav aria-label="Sections" className="w-full shrink-0 lg:w-56">
      {sections.map(({ section, items }) => (
        <div key={section} className="mb-7">
          <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-text-secondary)]">
            {SECTION_LABELS[section]}
          </h2>
          <ul className="list-none p-0">
            {items.map((item) => {
              const active = current === item.href;
              return (
                <li key={item.href}>
                  <a
                    href={item.href}
                    // aria-current, not just a colour. A screen reader user gets
                    // no benefit from an orange left border.
                    aria-current={active ? 'page' : undefined}
                    className={
                      active
                        ? 'block border-l-2 border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_10%,transparent)] py-2 pl-3 text-sm text-[var(--color-text-primary)]'
                        : 'block border-l-2 border-transparent py-2 pl-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-hairline)] hover:text-[var(--color-text-primary)]'
                    }
                  >
                    {item.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
