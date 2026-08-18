'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { needsFreshness } from '@grims/shared/needs-freshness';
import type { UnattachedHolding } from '../../../../lib/api';
import { apiPost } from '../../../../lib/api-client';

/**
 * "Your carrier is holding 800 t this build needs — attach it?"
 *
 * ★ SQUADRON OWNER, 2026-08-16 ★
 *
 * Asked who should see this and where, the answer was: the carrier's owner, on the project page.
 *
 * ★ WHY IT IS NOT ON THE CARRIERS TAB ★
 *
 * The tab is where somebody goes when they already know a carrier is involved. The whole point of
 * this prompt is the member who does NOT know — whose app pushed a manifest days ago and who has
 * never opened that tab. So it sits above the tab content, on every tab of the project page, and is
 * the first thing on screen when the answer is yes.
 *
 * ★ AND IT IS ONLY EVER ABOUT THE READER'S OWN CARRIER ★
 *
 * The server decides that (`unattachedHoldingFor`, scoped on `updated_by_id`) and sends down an
 * empty list for everybody else. A carrier nobody has attached is deliberately on no squadron
 * board, so this must never become a way to see inside one.
 */

const BUTTON =
  'rounded border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors ' +
  'disabled:opacity-40';

export function AttachPrompt({
  projectId,
  holdings,
}: {
  projectId: string;
  holdings: readonly UnattachedHolding[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * Dismissal lasts the page visit and is not stored. A member who says "not now" has answered the
   * question for now; writing that down would need a table, and the prompt disappears for good the
   * moment they attach — which is the resolution this is actually asking for.
   */
  const [hidden, setHidden] = useState<readonly string[]>([]);

  const showing = holdings.filter((h) => !hidden.includes(h.marketId));
  if (showing.length === 0) return null;

  const attach = async (marketId: string): Promise<void> => {
    setBusy(true);
    try {
      await apiPost(
        `/v1/logistics/colony/projects/${encodeURIComponent(projectId)}/carriers`,
        { marketId },
      );
      setError(null);
      router.refresh();
    } catch (err) {
      // The hub's own sentence. It names the actual condition and the actual remedy.
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-8 space-y-2">
      {error === null ? null : (
        <p className="m-0 rounded border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_7%,transparent)] px-3 py-2 text-sm text-[var(--color-semantic-warning)]">
          {error}
        </p>
      )}

      {showing.map((h) => (
        <div
          key={h.marketId}
          className="rounded border border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_6%,transparent)] px-4 py-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
            <p className="m-0 text-sm text-[var(--color-text-primary)]">
              <span className="font-mono text-[var(--color-brand-orange)]">{h.name}</span> is
              holding{' '}
              <span className="font-mono tabular-nums">{h.tonnes.toLocaleString()} t</span> this
              build needs.
            </p>

            {/*
              ★ "IS HOLDING" IS A CLAIM ABOUT NOW — AUDIT, 2026-08-18 ★

              The reading behind it may be four minutes or a fortnight old, and this sentence was
              identical either way. A member who loaded cargo, closed the app, and later sold it
              elsewhere was told in the present tense that the carrier still had it, with nothing to
              argue with.

              Dated through the same `needsFreshness` every other colonisation surface uses, so the
              prompt and the needs table cannot describe the same staleness in different words.
            */}
            {(() => {
              const verdict = needsFreshness(
                h.seenAt === null ? null : new Date(h.seenAt),
                new Date(),
              );
              return (
                <p
                  className={`m-0 basis-full text-xs ${
                    verdict.warn
                      ? 'text-[var(--color-semantic-warning)]'
                      : 'text-[var(--color-text-secondary)]'
                  }`}
                >
                  {verdict.sentence}
                </p>
              );
            })()}

            <span className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                className={`${BUTTON} border-[var(--color-brand-orange)] text-[var(--color-brand-orange)] hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_14%,transparent)]`}
                onClick={() => void attach(h.marketId)}
              >
                {busy ? 'Attaching…' : 'Attach it'}
              </button>
              <button
                type="button"
                disabled={busy}
                className={`${BUTTON} border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)]`}
                onClick={() => setHidden((prev) => [...prev, h.marketId])}
              >
                Not now
              </button>
            </span>
          </div>

          {/*
            ★ THE BREAKDOWN, BECAUSE ONE NUMBER IS NOT ENOUGH TO DECIDE ON ★

            "800 t this build needs" could be one commodity the build is desperate for or eight it
            barely wants. Attaching is cheap to undo, but a prompt that will not say what it is
            about is one members learn to dismiss without reading.

            Each figure is already clamped server-side to what is OUTSTANDING, so these add up to
            the headline and to what the carriers tab will show once it is attached.
          */}
          <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-0.5 p-0">
            {h.lines.map((l) => (
              <li
                key={l.commodity}
                className="font-mono text-[11px] text-[var(--color-text-secondary)]"
              >
                {l.commodity}{' '}
                <span className="tabular-nums text-[var(--color-text-primary)]">
                  {l.tonnes.toLocaleString()} t
                </span>
              </li>
            ))}
          </ul>

          <p className="m-0 mt-2 text-[11px] text-[var(--color-text-dim)]">
            Attaching puts it on this build&rsquo;s carriers tab and takes what is aboard off the
            shopping list. It stays yours, and you can take it off again at any time.
          </p>
        </div>
      ))}
    </div>
  );
}
