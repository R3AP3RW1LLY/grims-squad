'use client';

import { useState } from 'react';
import { apiPost } from '../../../../lib/api-client';

/**
 * Moving on from the companion step.
 *
 * ★ MARKED SEEN, NOT INSTALLED ★
 *
 * The step is satisfied by having been through it. Requiring a paired device would wall out
 * anybody whose machine cannot run the app, and the squadron would rather have them in the forum
 * than nowhere.
 *
 * ★ AND IT MOVES ON EVEN IF THE MARK FAILS ★
 *
 * If the call errors, the member still continues. The worst case is being shown this page once
 * more, which costs them ten seconds; the alternative is a member stuck on an onboarding page they
 * cannot leave because a bookkeeping write failed.
 */
export function CompanionStep() {
  const [busy, setBusy] = useState(false);

  async function go(): Promise<void> {
    setBusy(true);
    await apiPost('/v1/me/onboarding/companion', {}).catch(() => undefined);
    /*
     * A full navigation, not a router push. The next destination is decided by the onboarding gate
     * on the SERVER, which has to be asked again now that this step is done — a client-side
     * transition would carry the old answer and bounce them straight back here.
     */
    window.location.href = '/dashboard';
  }

  return (
    <div className="mt-10 flex flex-wrap items-center gap-4">
      <a
        href="/companion"
        target="_blank"
        rel="noreferrer"
        className="rounded border border-[var(--color-brand-cyan-bright)] px-6 py-3 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] transition-opacity hover:opacity-80"
      >
        Get the app
      </a>
      {/*
        Opens in a new tab, so pressing it does not abandon onboarding — somebody downloading an
        installer should come back to a page that is still where they left it.
      */}
      <button
        type="button"
        onClick={() => void go()}
        disabled={busy}
        className="rounded border border-[var(--color-border-hairline)] px-6 py-3 font-mono text-[12px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] disabled:opacity-50"
      >
        {busy ? 'One moment…' : 'Continue to the site'}
      </button>
    </div>
  );
}
