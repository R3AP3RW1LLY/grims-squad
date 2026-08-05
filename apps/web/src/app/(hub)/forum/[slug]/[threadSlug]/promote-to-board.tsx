'use client';

import { useState } from 'react';
import { apiPost } from '../../../../../lib/api-client';

/**
 * "Promote to board" — a Feature Requests thread becomes a roadmap card, in Ideas.
 *
 * ★ RENDERED ONLY WHEN THE SERVER SAID SO ★
 *
 * The thread page shows this panel the way it shows the grant controls: it ASKED the API
 * (`getRoadmapThreadCard`, SITE_CONFIG-gated) and got an answer instead of a refusal. Nothing
 * here reasons about the caller's permissions, and the promote route re-checks server-side
 * regardless — this is presentation, not the boundary.
 */

const COLUMN_LABELS: Record<string, string> = {
  ideas: 'Ideas',
  considering: 'Considering',
  planned: 'Planned',
  building: 'Building',
  shipped: 'Shipped',
};

export function PromoteToBoard({
  threadId,
  initialCard,
}: {
  readonly threadId: string;
  readonly initialCard: { readonly id: string; readonly column: string } | null;
}) {
  const [card, setCard] = useState(initialCard);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (card !== null) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-[var(--color-text-primary)]">
          On the board — {COLUMN_LABELS[card.column] ?? card.column}.
        </p>
        <a
          href="/app?tab=roadmap"
          className="text-xs text-[var(--color-brand-cyan-bright)] underline-offset-2 hover:underline"
        >
          Open the roadmap board
        </a>
      </div>
    );
  }

  const promote = (): void => {
    setBusy(true);
    setProblem(null);
    apiPost<{ card: { id: string; column: string } }>('/v1/roadmap/manage/promote', { threadId })
      .then((r) => setCard(r.card))
      .catch((err: unknown) => {
        setProblem(err instanceof Error ? err.message : 'That did not go through.');
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--color-text-secondary)]">
        Put this ask on the roadmap. It lands in Ideas, linked back to this thread and its votes.
      </p>
      {problem !== null && (
        <p role="alert" className="text-xs text-[var(--color-semantic-hostile-bright)]">
          {problem}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={promote}
        className="w-full rounded border border-[var(--color-brand-cyan-bright)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-cyan)_12%,transparent)] disabled:opacity-50"
      >
        {busy ? 'Promoting…' : 'Promote to board'}
      </button>
    </div>
  );
}
