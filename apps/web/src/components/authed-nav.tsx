import Image from 'next/image';
import { AccountMenu } from './account-menu';
import { NAV_LINKS } from './site-chrome';
import { NavDropdown } from './nav-dropdown';
import type { MeResponse } from '../lib/api';

/**
 * The navbar a signed-in member sees ON THE PUBLIC SITE.
 *
 * ★ A DIFFERENT BAR, NOT THE PUBLIC ONE WITH EXTRAS ★
 *
 * The public navbar sells the squadron: "Join", "Sign in", the strapline, the
 * recruitment pitch. None of that is useful to somebody who has already joined,
 * and leaving it there means the most valuable strip of the page is spent
 * advertising to existing members.
 *
 * ★ BUT IT IS NOT THE SIDEBAR EITHER — SQUADRON OWNER, 2026-08-01 ★
 *
 * "even when im logged in i dont want all that clutter up there! it should just
 * show the public stuff and dashboard if im logged in and on the homepage."
 *
 * This used to render every `squadron` entry the server sent — Dashboard, Forum,
 * Roster, Outfitter, Squadron builds, Operations, BGS, Fleet — which turned the
 * marketing site's header into a second copy of the hub sidebar, and one that grew
 * every time a page was added.
 *
 * The hub has a sidebar for that, and it is better at it. THIS bar is on the public
 * pages, where the job is: get me back to the members area, and let me use the two
 * things that work without one. So it is the same list the public bar shows, with
 * Dashboard in front of it.
 *
 * ★ DASHBOARD COMES FROM THE SERVER, NOT FROM A STRING ★
 *
 * Taken out of `me.nav` rather than hard-coded, so the one case where it must NOT
 * appear still works: while an admin is unsecured the server sends an EMPTY nav
 * (see me.controller.ts), and a hard-coded link would offer a door the guard is
 * about to refuse.
 */
export function AuthedNav({ me }: { me: MeResponse }) {
  const dashboard = me.nav.find((i) => i.href === '/dashboard') ?? null;

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-border-hairline)] bg-[color-mix(in_srgb,var(--color-surface-void)_78%,transparent)] backdrop-blur-md">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-[var(--nav-h)] max-w-[1440px] items-center gap-3 px-4 sm:gap-6 sm:px-6"
      >
        <a href="/dashboard" className="flex shrink-0 items-center gap-3">
          <Image
            src="/brand/badge-128.png"
            alt=""
            width={40}
            height={40}
            priority
            className="h-8 w-8 sm:h-9 sm:w-9"
          />
          {/* The strapline is dropped here. It is recruitment copy, and this bar
              is for members who have already read it. */}
          <span
            className="hidden text-[15px] tracking-[0.22em] text-[var(--color-brand-orange-bright)] sm:block"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            GRIM&rsquo;S SQUAD
          </span>
        </a>

        {/*
          While an admin is unsecured the server sends an EMPTY nav, so this
          renders nothing. That is intended — see me.controller.ts — but an
          empty bar with no explanation looks like a broken page, so the prompt
          below takes its place.
        */}
        <ul className="ml-4 hidden list-none items-center gap-1 p-0 md:flex">
          {/*
            Dashboard first, and only when the server offered it. Everything after it is the
            PUBLIC list, shared with the signed-out bar so the two cannot drift into disagreeing
            about what this site has.
          */}
          {dashboard !== null && (
            <li>
              <a
                href={dashboard.href}
                className="px-3 py-2 text-sm tracking-wide text-[var(--color-text-primary)] transition-colors hover:text-[var(--color-brand-orange-bright)]"
              >
                {dashboard.label}
              </a>
            </li>
          )}
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

        {me.mustSecureAccount && (
          <a
            href="/onboarding/security"
            className="ml-4 hidden rounded border border-[var(--color-brand-orange)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-orange)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_12%,transparent)] sm:block"
          >
            Secure your account
          </a>
        )}

        <div className="ml-auto flex items-center gap-3">
          {/*
            The admin console is a SEPARATE button rather than another nav link.
            It is a different mode with different consequences, and one of the
            few places where making somebody notice they are switching into it is
            worth the pixel.

            Hidden while the account is unsecured, because the guard will refuse
            them anyway — offering a door that is locked teaches people the
            interface lies. The banner tells them what to do instead.
          */}
          {me.isAdmin && !me.mustSecureAccount && (
            <a
              href="/app"
              className="hidden rounded border border-[var(--color-brand-cyan-bright)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-cyan-bright)_12%,transparent)] sm:block"
            >
              Admin
            </a>
          )}
          <AccountMenu me={me} />
        </div>
      </nav>
    </header>
  );
}
