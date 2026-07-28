'use client';

import { useEffect, useRef, useState } from 'react';
import type { MeResponse } from '../lib/api';

/**
 * The signed-in account menu.
 *
 * ★ WHY THIS IS A CLIENT COMPONENT AND THE NAVBAR IS NOT ★
 *
 * A dropdown needs click-outside, Escape, and focus handling, all of which are
 * browser concerns. The identity it renders is fetched on the SERVER and passed
 * in, so nothing here decides who you are — it only decides whether a panel is
 * open.
 */

function initials(name: string): string {
  // Two letters at most. A four-letter monogram in a 36px circle is unreadable,
  // and CMDR names are frequently one word.
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

export function AccountMenu({ me }: { me: MeResponse }) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointer(event: MouseEvent) {
      if (wrap.current !== null && !wrap.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      // Escape closes. A dropdown you can only dismiss by clicking elsewhere is
      // a dropdown a keyboard user is trapped beside.
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const user = me.user;
  if (user === null) return null;

  const personal = me.nav.filter((i) => i.section === 'personal');

  async function signOut() {
    setSigningOut(true);
    try {
      /*
       * A POST, not a link.
       *
       * A GET /logout can be triggered by an <img> on any page on the internet,
       * which turns "sign me out" into something anybody can do to anybody. The
       * CSRF token comes along for the same reason.
       */
      await fetch('/v1/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': readCsrf() },
      });
    } catch {
      // Even if the call failed, go to the signed-out page. The cookies may
      // well be gone, and leaving somebody on a page that still says their name
      // after they asked to leave is worse than a redirect that turns out to be
      // unnecessary.
    }
    window.location.href = '/';
  }

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full border border-[var(--color-border-hairline)] py-1 pl-1 pr-3 transition-colors hover:border-[var(--color-border-active)]"
      >
        <Avatar user={user} />
        <span className="hidden text-sm text-[var(--color-text-primary)] sm:block">
          {user.displayName}
        </span>
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true" className="opacity-60">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-raised)] shadow-xl"
        >
          <div className="border-b border-[var(--color-border-hairline)] px-4 py-3">
            <p className="truncate text-sm text-[var(--color-text-primary)]">{user.displayName}</p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-text-secondary)]">
              {user.rank ?? 'Commander'}
            </p>
          </div>

          <ul className="list-none p-0">
            {personal.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  role="menuitem"
                  className="block px-4 py-2.5 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-panel-hover)] hover:text-[var(--color-text-primary)]"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="border-t border-[var(--color-border-hairline)]">
            <button
              type="button"
              role="menuitem"
              onClick={() => void signOut()}
              disabled={signingOut}
              className="w-full px-4 py-2.5 text-left text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-panel-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Their picture, or their initials.
 *
 * ★ INITIALS, NOT A GENERIC SILHOUETTE ★
 *
 * A placeholder face makes every member without an avatar look like the same
 * stranger. Initials are unmistakably *them*, cost nothing, and cannot fail to
 * load.
 */
export function Avatar({
  user,
  size = 28,
}: {
  user: NonNullable<MeResponse['user']>;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = user.avatarUrl !== null && !failed;

  return showImage ? (
    /*
     * A plain <img>, not next/image.
     *
     * next/image exists to resize and reformat images it does not control. This
     * one is served from our own API at exactly the size we asked Discord for,
     * so the optimiser would add a round trip and a cache entry to produce the
     * bytes we already had.
     */
    <img
      src={user.avatarUrl ?? ''}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-orange)] font-semibold text-[var(--color-text-on-accent)]"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials(user.displayName)}
    </span>
  );
}

function readCsrf(): string {
  const jar = document.cookie.split('; ');
  for (const name of ['__Host-gs_csrf', 'gs_csrf']) {
    const hit = jar.find((c) => c.startsWith(`${name}=`));
    if (hit !== undefined) return decodeURIComponent(hit.slice(name.length + 1));
  }
  return '';
}
