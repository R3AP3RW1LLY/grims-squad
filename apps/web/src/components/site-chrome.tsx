/**
 * Persistent site chrome: background, navigation and footer.
 *
 * All three live in the ROOT LAYOUT rather than on each page. For the footer
 * that is not a convenience — the Frontier non-commercial attribution must be
 * present on every rendered page (INV-029), and a per-page footer makes that a
 * thing every future page author has to remember. Structure enforces it.
 */

/** Divisions, in the order they appear on the recruitment brief. */
export const DIVISIONS = [
  {
    name: 'Iron Legion',
    role: 'Combat · Conflict Zones · Bounty Hunting',
    blurb: 'Ship-to-ship warfare, from wing assassinations to full conflict-zone deployments.',
    glyph: 'M12 2 4 6v6c0 5 3.4 9.1 8 10 4.6-.9 8-5 8-10V6l-8-4Z',
  },
  {
    name: 'Xeno Interdiction Corps',
    role: 'Anti-Xeno Operations',
    blurb: 'Thargoid interceptors and scouts. Guardian tech, caustic sinks, and steady nerves.',
    glyph: 'M12 3c3 3 6 4.5 9 4.5-1.5 6-4.5 10.5-9 13.5-4.5-3-7.5-7.5-9-13.5C6 7.5 9 6 12 3Z',
  },
  {
    name: 'Sable Directorate',
    role: 'Background Simulation · Influence',
    blurb: 'The quiet war. Influence, states, expansions — who actually holds a system.',
    glyph: 'M4 20V10m5 10V4m5 16v-7m5 7V7',
  },
  {
    name: 'Vanguard Survey',
    role: 'Exploration · Exobiology',
    blurb: 'First footfalls, biological signals and the long dark beyond the bubble.',
    glyph: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-18v18M3 12h18',
  },
  {
    name: 'Void Logistics',
    role: 'Trade · Hauling · Community Goals',
    blurb: 'Bulk freight, community goals and the supply lines that make operations possible.',
    glyph: 'M3 8h13v8H3V8Zm13 3h3.5L22 14v2h-6v-5ZM6 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm12 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  },
  {
    name: 'Deepcore Prospectors',
    role: 'Mining',
    blurb: 'Core, laser and subsurface. Painite rings, hotspots and full cargo racks.',
    glyph: 'M12 2 3 9l9 13 9-13-9-7Zm0 0v20M3 9h18',
  },
  {
    name: 'Carrier Command',
    role: 'Fleet Carrier Operations',
    blurb: 'Jump schedules, tritium logistics and forward bases wherever the squadron needs one.',
    glyph: 'M2 12h20M6 12V8h12v4M9 12v6h6v-6',
  },
] as const;

/* -------------------------------------------------------------- background */

/**
 * Purely decorative, and marked so. A screen reader announcing "starfield"
 * would add nothing but noise before every page's real content.
 */
export function DeepField() {
  return (
    <>
      <div className="deepfield" aria-hidden="true" />
      <div className="nebula" aria-hidden="true" />
    </>
  );
}

/* --------------------------------------------------------------------- nav */

const NAV_LINKS = [
  { href: '/situation', label: 'Situation' },
  { href: '/market', label: 'Market' },
  { href: '/shipyard', label: 'Shipyard' },
  { href: '/forum', label: 'Comms' },
] as const;

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-border-hairline)] bg-[color-mix(in_srgb,var(--color-surface-void)_78%,transparent)] backdrop-blur-md">
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-[1440px] items-center gap-6 px-6 py-3.5"
      >
        <a href="/" className="group flex items-center gap-3">
          <SquadronMark />
          <span className="flex flex-col leading-none">
            <span
              className="text-[15px] tracking-[0.22em] text-[var(--color-brand-orange-bright)]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              GRIM&rsquo;S SQUAD
            </span>
            <span className="mt-1 font-mono text-[10px] tracking-[0.3em] text-[var(--color-text-secondary)]">
              NO QUARTER IN THE VOID
            </span>
          </span>
        </a>

        <ul className="ml-auto hidden list-none items-center gap-1 p-0 lg:flex">
          {NAV_LINKS.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                className="px-3 py-2 text-sm tracking-wide text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <a
          href="/v1/auth/discord"
          className="ml-auto inline-flex items-center gap-2 border border-[var(--color-border-active)] px-4 py-2 text-sm text-[var(--color-brand-orange-bright)] transition-colors hover:bg-[var(--color-surface-panel-hover)] lg:ml-0"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          <DiscordGlyph />
          SIGN IN
        </a>
      </nav>
    </header>
  );
}

/* ------------------------------------------------------------------ footer */

export function SiteFooter() {
  return (
    <footer className="relative mt-24 border-t border-[var(--color-border-hairline)] bg-[color-mix(in_srgb,var(--color-surface-panel-sunken)_70%,transparent)]">
      <div className="mx-auto max-w-[1440px] px-6 py-12">
        <div className="grid gap-10 md:grid-cols-[2fr_1fr_1fr]">
          <div>
            <span
              className="text-lg tracking-[0.2em] text-[var(--color-brand-orange-bright)]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              GRIM&rsquo;S SQUAD
            </span>
            <p className="mt-3 max-w-[46ch] text-sm text-[var(--color-text-secondary)]">
              An Elite Dangerous squadron operating a player minor faction, a carrier fleet and
              everything from conflict zones to the deep black.
            </p>
          </div>

          <nav aria-label="Squadron">
            <h2 className="font-mono text-[11px] tracking-[0.28em] text-[var(--color-text-secondary)]">
              SQUADRON
            </h2>
            <ul className="mt-4 list-none space-y-2 p-0 text-sm">
              {[
                { href: '/apply', label: 'Apply to join' },
                { href: '/divisions', label: 'Divisions' },
                { href: '/ranks', label: 'Ranks' },
              ].map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    className="text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-brand-cyan-bright)]"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Operations">
            <h2 className="font-mono text-[11px] tracking-[0.28em] text-[var(--color-text-secondary)]">
              OPERATIONS
            </h2>
            <ul className="mt-4 list-none space-y-2 p-0 text-sm">
              {[
                { href: '/situation', label: 'Situation board' },
                { href: '/market', label: 'Commodities' },
                { href: '/shipyard', label: 'Shipyard' },
              ].map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    className="text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-brand-cyan-bright)]"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/*
          INV-029 — the Frontier non-commercial attribution. Rendered from the
          layout so it is present on every page by construction, not by every
          future page author remembering to add it.
        */}
        <div className="mt-12 border-t border-[var(--color-border-subtle)] pt-8">
          <p className="max-w-[80ch] text-xs leading-relaxed text-[var(--color-text-secondary)]">
            Created using assets and imagery from Elite: Dangerous, with the permission of Frontier
            Developments plc, for non-commercial purposes. Not endorsed by Frontier Developments; no
            Frontier Developments employee was involved in the making of this site.
          </p>
          <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
            Ship-fit mathematics ported from Coriolis (MIT) with attribution.
          </p>
          <p
            className="mt-6 text-sm text-[var(--color-brand-orange-bright)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Fly safe, CMDR. o7
          </p>
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ glyphs */

function SquadronMark() {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 34 34"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M17 2 31 10v14L17 32 3 24V10L17 2Z" stroke="var(--color-brand-orange)" strokeWidth="1.5" />
      <path d="M17 9 25 13.5v9L17 27l-8-4.5v-9L17 9Z" stroke="var(--color-brand-cyan)" strokeWidth="1" opacity="0.75" />
      <circle cx="17" cy="17" r="2.5" fill="var(--color-brand-orange)" />
    </svg>
  );
}

function DiscordGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.3 4.9A19.8 19.8 0 0 0 15.4 3.4a13.9 13.9 0 0 0-.7 1.4 18.3 18.3 0 0 0-5.4 0 13.6 13.6 0 0 0-.7-1.4 19.7 19.7 0 0 0-4.9 1.5C.6 9.6-.4 14.1.1 18.6a19.9 19.9 0 0 0 6 3 14.6 14.6 0 0 0 1.3-2.1 12.9 12.9 0 0 1-2-1c.2-.1.3-.2.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4a12.9 12.9 0 0 1-2 1 14.4 14.4 0 0 0 1.3 2.1 19.8 19.8 0 0 0 6-3c.6-5.2-1-9.7-3.6-13.7ZM8.0 15.8c-1.2 0-2.2-1.1-2.2-2.4 0-1.3 1-2.4 2.2-2.4s2.2 1.1 2.2 2.4c0 1.3-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4 0-1.3 1-2.4 2.2-2.4s2.2 1.1 2.2 2.4c0 1.3-1 2.4-2.2 2.4Z" />
    </svg>
  );
}
