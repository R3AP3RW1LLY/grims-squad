import Image from 'next/image';
import { MobileNav } from './mobile-nav';
import { NavDropdown, type NavChild } from './nav-dropdown';
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

/**
 * The PUBLIC navbar.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "the Public navbar should only have a Forum link that takes people to the forum page and only
 * shows them publically viewable forum categories please. then we need a nav group dropdown for
 * Shipyard that has outfitter as the first link and public builds as the second link remove
 * everything else please. we will add to this as we grow the site."
 *
 * ★ WHAT WAS REMOVED, AND WHY THAT IS THE POINT ★
 *
 * Situation, Market, Recruiting and Guides all came out. Every one of them was a real page, and
 * that was the problem: a visitor arriving from Discord met six choices before they had any reason
 * to care about the difference between them. Two destinations they can actually use — read what the
 * squadron says, and build a ship — is a front door rather than a directory.
 *
 * The pages still exist and are still linked from where they belong. This is a nav, not an index.
 *
 * ★ DASHBOARD IS NOT HERE, AND CANNOT BE ★
 *
 * "Dashboard should be the first link ... but only visible if a user is logged in." This component
 * only renders for a visitor with NO session — `(site)/layout.tsx` swaps in `AuthedNav` the moment
 * there is one, and that bar already leads with Dashboard. So the condition is satisfied by which
 * component renders rather than by a check inside one, which is why there is no `signedIn` prop
 * here to get wrong.
 */
export const NAV_LINKS: ReadonlyArray<
  { href: string; label: string } | { label: string; children: readonly NavChild[] }
> = [
  /*
   * ★ /forum IS PUBLIC NOW ★
   *
   * It sat in `(hub)` and redirected anybody without a session to sign in. A "Forum" link that
   * bounces a visitor to Discord OAuth is not a forum link, it is a sign-in button wearing one.
   *
   * What they see is decided by the ACL, not by this nav: category visibility is a `viewPerm`
   * bitmask, and the guest mask holds FORUM_VIEW_PUBLIC and nothing else. So an anonymous reader
   * gets exactly the public categories — the same filter a member's own reads go through, one mask
   * lower.
   */
  { href: '/forum', label: 'Forum' },
  {
    label: 'Shipyard',
    children: [
      { href: '/shipyard', label: 'Outfitter', hint: 'Fit any ship in the game, no account needed' },
      {
        href: '/shipyard/public',
        label: 'Public builds',
        hint: 'Ships our commanders have published',
      },
    ],
  },
  /*
   * ★ GROWING THE PUBLIC BAR, AS INVITED — SQUADRON OWNER, 2026-08-02 ★
   *
   * "we will add to this as we grow the site please", said while cutting this bar back to Forum and
   * Shipyard. This is the first addition, and it is here because the owner made the pages public:
   * "this will also be available to the public for use".
   *
   * Squadron builds is deliberately still absent — "Squadron builds should not be publically
   * accessible at all!" Nothing here is a shortcut past a permission: every one of these pages
   * checks TRADE_QUERY or SHIPYARD_VIEW against the caller's own mask, and the guest mask holds
   * both. The bar shows what a visitor may open, and the pages decide.
   */
  {
    label: 'Logistics',
    children: [
      {
        href: '/logistics/commodities',
        label: 'Commodities',
        hint: 'Live prices across the bubble, no account needed',
      },
      {
        href: '/logistics/freight-office',
        label: 'Freight Office',
        hint: 'Plan a hauling run and get the route',
      },
    ],
  },
] as const;

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-border-hairline)] bg-[color-mix(in_srgb,var(--color-surface-void)_78%,transparent)] backdrop-blur-md">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-[var(--nav-h)] max-w-[1440px] items-center gap-3 px-4 sm:gap-6 sm:px-6"
      >
        <a href="/" className="group flex items-center gap-3">
          {/*
            The BADGE only, not the full lockup. At 40px the lockup would render
            the wordmark about 2mm high; keeping the words as real HTML text
            means they stay crisp at any zoom, are read by screen readers, and
            are indexable. alt="" because the adjacent text already names us —
            announcing it twice is noise.
          */}
          <Image
            src="/brand/badge-128.png"
            alt=""
            width={40}
            height={40}
            priority
            className="h-8 w-8 shrink-0 sm:h-10 sm:w-10"
          />
          <span className="flex flex-col leading-none">
            <span
              className="text-[15px] tracking-[0.22em] text-[var(--color-brand-orange-bright)]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              GRIM&rsquo;S SQUAD
            </span>
            {/* Dropped below `sm`: at 360px the badge, wordmark, strapline and
                two buttons cannot all fit, and the strapline is the one that
                repeats verbatim in the hero directly below. */}
            <span className="mt-1 hidden font-mono text-[10px] tracking-[0.3em] text-[var(--color-text-secondary)] sm:block">
              NO QUARTER IN THE VOID
            </span>
          </span>
        </a>

        <ul className="ml-auto hidden list-none items-center gap-1 p-0 lg:flex">
          {NAV_LINKS.map((l) =>
            'children' in l ? (
              <li key={l.label}>
                <NavDropdown label={l.label} children={l.children} />
              </li>
            ) : (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="px-3 py-2 text-sm tracking-wide text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
                >
                  {l.label}
                </a>
              </li>
            ),
          )}
        </ul>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          {/* Two doors, deliberately distinct. NEW arrivals are not yet in the
              Discord server, so "sign in" would fail for them with a membership
              error that reads like a rejection. */}
          {/*
            Both labels shorten below `md` (768px). At full length they are ~3x wider
            than before, and two of them plus the wordmark overflow a phone
            viewport — which on a sticky header means the sign-in button is
            simply unreachable. `sm` (640px) is still too narrow once the
            wordmark is counted, so the switch happens at `md`. The accessible name stays the FULL label via
            aria-label, so a screen reader hears "Join Grim's Squad now"
            regardless of which visual variant the viewport is showing.
          */}
          <a
            href="/join"
            aria-label="Join Grim's Squad now"
            className="inline-flex items-center gap-2 whitespace-nowrap bg-[var(--color-brand-orange)] px-3 py-2 text-sm text-[var(--color-text-on-accent)] transition-opacity hover:opacity-90 sm:px-4"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            <DiscordGlyph />
            <span className="hidden md:inline" aria-hidden="true">
              JOIN GRIM&rsquo;S SQUAD NOW
            </span>
            <span className="md:hidden" aria-hidden="true">
              JOIN
            </span>
          </a>
          <a
            href="/v1/auth/discord"
            aria-label="Squadron portal sign in"
            className="hidden items-center gap-2 whitespace-nowrap border border-[var(--color-border-active)] px-3 py-2 text-sm text-[var(--color-brand-orange-bright)] transition-colors hover:bg-[var(--color-surface-panel-hover)] sm:inline-flex sm:px-4"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            <span className="hidden md:inline" aria-hidden="true">
              SQUADRON PORTAL SIGN IN
            </span>
            <span className="md:hidden" aria-hidden="true">
              SIGN IN
            </span>
          </a>

          {/*
            FLATTENED for the phone. A dropdown inside a slide-out panel is a menu inside a menu:
            two taps to reach a link that has room to simply be listed. The panel is already
            vertical, so grouping costs nothing there.
          */}
          <MobileNav
            links={NAV_LINKS.flatMap((l) =>
              'children' in l ? l.children.map((c) => ({ href: c.href, label: c.label })) : [l],
            )}
          />
        </div>
      </nav>
    </header>
  );
}

/* ------------------------------------------------------------------ footer */

export function SiteFooter() {
  return (
    <footer className="relative mt-24 border-t border-[var(--color-border-hairline)] bg-[color-mix(in_srgb,var(--color-surface-panel-sunken)_70%,transparent)]">
      <div className="mx-auto max-w-[1440px] px-6 py-12">
        <div className="grid gap-10 md:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
          <div>
            {/* The full lockup belongs here, at a size where "CIRCA 2006" can
                actually be read — the squadron predates Elite Dangerous by
                eight years, which is worth showing rather than burying. */}
            <Image
              src="/brand/lockup-720.png"
              alt="Grim's Squad — circa 2006"
              width={360}
              height={240}
              className="mb-4 h-auto w-[280px] max-w-full"
            />
            <span className="sr-only">Grim&rsquo;s Squad</span>
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
                /*
                 * Kept in step with the navbar above. The footer used to list a Situation board and
                 * a Commodities page that the nav no longer offers — a footer quietly advertising
                 * what the nav dropped is how a site ends up with two answers to "what is here".
                 */
                { href: '/shipyard', label: 'Ship outfitter' },
                { href: '/shipyard/public', label: 'Public builds' },
                { href: '/forum', label: 'Forum' },
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

          <nav aria-label="Legal">
            <h2 className="font-mono text-[11px] tracking-[0.28em] text-[var(--color-text-secondary)]">
              LEGAL
            </h2>
            <ul className="mt-4 list-none space-y-2 p-0 text-sm">
              {[
                { href: '/privacy', label: 'Privacy Policy' },
                { href: '/terms', label: 'Terms of Service' },
              ].map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    className="text-[var(--color-text-secondary)] no-underline transition-colors hover:text-[var(--color-brand-cyan-bright)] hover:underline hover:underline-offset-4"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Resources">
            <h2 className="font-mono text-[11px] tracking-[0.28em] text-[var(--color-text-secondary)]">
              RESOURCES
            </h2>
            <ul className="mt-4 list-none space-y-2 p-0 text-sm">
              <li>
                <a
                  href="/companion"
                  className="text-[var(--color-text-secondary)] no-underline transition-colors hover:text-[var(--color-brand-cyan-bright)] hover:underline hover:underline-offset-4"
                >
                  Companion app
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/R3AP3RW1LLY/grims-squad"
                  // An EXTERNAL link, so it gets the treatment the internal ones
                  // do not need: noopener stops the opened page reaching back
                  // through window.opener, and noreferrer keeps our URLs out of
                  // its analytics.
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-text-secondary)] no-underline transition-colors hover:text-[var(--color-brand-cyan-bright)] hover:underline hover:underline-offset-4"
                >
                  Source on GitHub
                  {/* No visible arrow, by request. The screen-reader text stays:
                      without it there is NO cue at all that the link leaves the
                      site, and that cue was previously carried by the arrow. */}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
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

function DiscordGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.3 4.9A19.8 19.8 0 0 0 15.4 3.4a13.9 13.9 0 0 0-.7 1.4 18.3 18.3 0 0 0-5.4 0 13.6 13.6 0 0 0-.7-1.4 19.7 19.7 0 0 0-4.9 1.5C.6 9.6-.4 14.1.1 18.6a19.9 19.9 0 0 0 6 3 14.6 14.6 0 0 0 1.3-2.1 12.9 12.9 0 0 1-2-1c.2-.1.3-.2.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4a12.9 12.9 0 0 1-2 1 14.4 14.4 0 0 0 1.3 2.1 19.8 19.8 0 0 0 6-3c.6-5.2-1-9.7-3.6-13.7ZM8.0 15.8c-1.2 0-2.2-1.1-2.2-2.4 0-1.3 1-2.4 2.2-2.4s2.2 1.1 2.2 2.4c0 1.3-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4 0-1.3 1-2.4 2.2-2.4s2.2 1.1 2.2 2.4c0 1.3-1 2.4-2.2 2.4Z" />
    </svg>
  );
}
