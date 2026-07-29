'use client';

import { useState } from 'react';
import { XMarkIcon, ArrowDownTrayIcon } from '@heroicons/react/20/solid';
// Shared with the server component that decides whether to render this at all.
// Declared there because Next cannot call a function exported from a client
// module, and the name is needed on both sides.
import { updateDismissedCookie } from './update-banner-rules';

export function UpdateBannerView({ version, days }: { version: string; days: number }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  function dismiss() {
    /*
     * A SESSION cookie — no Max-Age, no Expires — so it lasts until the browser
     * closes and no longer.
     *
     * Unlike the verification prompt, this one genuinely expires on its own:
     * the banner stops after fourteen days regardless, and disappears the
     * moment the member's app reports the new version. So "not now" needs no
     * mechanism to become "never" — the release does that by getting old.
     *
     * SameSite=Lax because it is read on an ordinary top-level navigation. Not
     * Secure, so it works on localhost too; its entire content is "this person
     * clicked the X".
     */
    document.cookie = `${updateDismissedCookie(version)}=1; path=/; SameSite=Lax`;
    // Hidden immediately. A dismiss button that needs a reload does not read as
    // a dismiss button.
    setDismissed(true);
  }

  return (
    <div className="border-b border-[var(--color-brand-cyan-bright)] bg-[color-mix(in_srgb,var(--color-brand-cyan-bright)_10%,transparent)]">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
        <p className="text-sm text-[var(--color-text-primary)]">
          <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]">
            Companion v{version}
          </span>{' '}
          {/*
            ★ NO AUTOMATIC UPDATER, SO SAY WHAT TO DO ★

            The app cannot update itself — there is no signing certificate, so
            an in-app updater would be asking members to run an unsigned binary
            fetched over the wire. The download page is the whole mechanism, and
            a banner that announced a release without saying where to get it
            would be an announcement nobody could act on.
          */}
          A new version of the companion app is available. Download it from your devices page and
          run the installer over the top — your pairing and settings are kept.
        </p>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <a
            href="/settings/devices"
            className="inline-flex items-center gap-2 rounded border border-[var(--color-brand-cyan-bright)] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-cyan-bright)_14%,transparent)]"
          >
            <ArrowDownTrayIcon aria-hidden="true" className="size-4" />
            Get it
          </a>
          <button
            type="button"
            onClick={dismiss}
            /*
              Named for what it does AND for how long. "Dismiss" alone implies
              it is gone for good; this returns if the browser is restarted, and
              stops entirely once the app reports the new version or the release
              passes its window.
            */
            aria-label={`Hide this notice about version ${version}`}
            title={`Hidden until you restart your browser. It stops on its own after ${days} days, or as soon as your app reports v${version}.`}
            className="rounded p-1.5 text-[var(--color-brand-cyan-bright)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-cyan-bright)_14%,transparent)]"
          >
            <XMarkIcon aria-hidden="true" className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
