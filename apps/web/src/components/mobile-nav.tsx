'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The mobile navigation menu.
 *
 * Until now the nav links were simply `hidden` below `lg` — so on a phone the
 * Situation, Market, Shipyard and Comms links did not exist at all. Not
 * collapsed, not behind a button: gone. This is the menu they belong in.
 *
 * A client component, deliberately, and the only one on the page. Doing this
 * with a CSS-only `<details>` or a checkbox hack avoids the JavaScript but
 * loses Escape-to-close, focus return, and `aria-expanded` — and a menu a
 * keyboard user cannot dismiss is worse than a slightly larger bundle.
 */

export interface NavLink {
  readonly href: string;
  readonly label: string;
}

export function MobileNav({ links }: { links: readonly NavLink[] }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Escape closes, and focus returns to the button that opened it. Without the
  // return, a keyboard user is dumped at the top of the document and has to
  // tab all the way back to where they were.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // A tap outside closes it. Phones have no Escape key, so without this the
  // only way out is the button itself — which is easy to miss when the panel
  // covers most of the screen.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Stops the page scrolling underneath an open panel — the effect that makes a
  // mobile menu feel broken when you swipe and the wrong thing moves.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        aria-label={open ? 'Close menu' : 'Open menu'}
        className="relative z-50 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center lg:hidden"
      >
        {/*
          Three bars that morph into an X. Animated with transform only —
          transform and opacity are the two properties a browser can composite
          on the GPU, so this stays smooth on a cheap phone where animating
          height or margin would judder.
        */}
        <span className="relative block h-4 w-6" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="absolute left-0 block h-0.5 w-6 rounded-full bg-[var(--color-brand-orange-bright)] transition-all duration-300 ease-out"
              style={{
                top: i === 0 ? 0 : i === 1 ? '7px' : '14px',
                transform: open
                  ? i === 0
                    ? 'translateY(7px) rotate(45deg)'
                    : i === 1
                      ? 'scaleX(0)'
                      : 'translateY(-7px) rotate(-45deg)'
                  : 'none',
                opacity: open && i === 1 ? 0 : 1,
              }}
            />
          ))}
        </span>
      </button>

      {/* Scrim. Rendered always and faded, so it can transition in AND out —
          conditionally mounting it would make the close animation impossible. */}
      <div
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-[color-mix(in_srgb,var(--color-surface-void)_82%,transparent)] backdrop-blur-sm transition-opacity duration-300 lg:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <div
        id="mobile-nav-panel"
        ref={panelRef}
        // `inert` when closed, so its links are not focusable by a keyboard
        // user tabbing through a page where the menu is invisible. React 19
        // types this as a boolean, unlike the bare HTML attribute.
        inert={!open}
        className={`fixed inset-x-0 top-[var(--nav-h)] z-40 origin-top border-b border-[var(--color-border-hairline)] bg-[color-mix(in_srgb,var(--color-surface-void)_96%,transparent)] backdrop-blur-xl transition-all duration-300 ease-out lg:hidden ${
          open
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none -translate-y-3 opacity-0'
        }`}
      >
        <nav aria-label="Mobile">
          <ul className="list-none p-0">
            {links.map((l, i) => (
              <li key={l.href} className="border-b border-[var(--color-border-subtle)] last:border-0">
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="block px-6 py-4 text-lg tracking-wide text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-panel-hover)] hover:text-[var(--color-brand-orange-bright)]"
                  style={{
                    fontFamily: 'var(--font-display)',
                    // Each row arrives a beat after the one above it. Only while
                    // opening — on close they leave together, because a
                    // staggered exit reads as lag rather than polish.
                    transition: 'opacity 300ms ease-out, transform 300ms ease-out',
                    transitionDelay: open ? `${60 + i * 45}ms` : '0ms',
                    opacity: open ? 1 : 0,
                    transform: open ? 'translateX(0)' : 'translateX(-8px)',
                  }}
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </>
  );
}
