'use client';

import { useState } from 'react';
import { XMarkIcon } from '@heroicons/react/20/solid';

/**
 * Must match apps/api/src/auth/verify-dismissal.ts.
 *
 * The API clears this at logout, which is what makes "dismissed for this
 * session" true rather than "dismissed on this browser forever".
 */
export const VERIFY_DISMISSED_COOKIE = 'gs_verify_dismissed';

export function VerifyBannerView() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  function dismiss() {
    /*
     * A SESSION cookie — no Max-Age, no Expires — so it also dies when the
     * browser closes. Logout clears it explicitly, which is the case that
     * matters: without that, "not now" would quietly become "never" for an
     * obligation nobody has met.
     *
     * SameSite=Lax because it is read on a normal top-level navigation. Not
     * Secure, so it works on localhost as well as over https; it carries
     * nothing worth protecting — its entire content is "this person clicked
     * the X".
     */
    document.cookie = `${VERIFY_DISMISSED_COOKIE}=1; path=/; SameSite=Lax`;
    // Hidden immediately rather than on the next navigation. A dismiss button
    // that needs a reload to work does not read as a dismiss button.
    setDismissed(true);
  }

  return (
    <div className="border-b border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_10%,transparent)]">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
        <p className="text-sm text-[var(--color-text-primary)]">
          <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-orange)]">
            Not verified
          </span>{' '}
          {/*
            Says why it matters to THEM rather than restating the rule. "You are
            not verified" is a status; "your own months will not count" is a
            reason, and people act on reasons.
          */}
          Nobody has confirmed which commander you fly as, so your own months will not count toward
          a rank. Ask a colleague to verify you, or link an Inara key.
        </p>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <a
            href="/settings/commander?tab=verification"
            className="rounded border border-[var(--color-brand-orange)] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-orange)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_14%,transparent)]"
          >
            Sort it out
          </a>
          <button
            type="button"
            onClick={dismiss}
            // Named for what it does and for how long. "Dismiss" alone implies
            // it is gone for good, and it is not — it returns at the next
            // sign-in, and somebody should not be surprised by that.
            aria-label="Hide this until I sign in again"
            title="Hide until next sign-in"
            className="rounded p-1.5 text-[var(--color-brand-orange)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_14%,transparent)]"
          >
            <XMarkIcon aria-hidden="true" className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
