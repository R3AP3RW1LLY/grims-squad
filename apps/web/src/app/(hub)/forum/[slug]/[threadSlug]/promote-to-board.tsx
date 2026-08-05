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
 *
 * ★ THE PANEL IS NOT GATED ON THE STEP-UP; THE BUTTON IS ★
 *
 * The probe behind it used to sit on the admin-gated manage controller, so a webmaster who had
 * been reading the forum for longer than the eight-hour step-up window saw no panel at all — the
 * feature quietly ceased to exist for the one person it is for, and the page could not tell that
 * refusal apart from "this is not a Feature Requests thread".
 *
 * The probe is now gated on the permission alone. Promote still posts to the guarded route, and
 * when the step-up has lapsed the admin gate's own sentence — "Confirm your authenticator code to
 * continue." — arrives through the error path below and is shown, with the route to satisfy it.
 * A control that refuses out loud is honest; one that disappears is not.
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
        <div role="alert" className="space-y-1">
          <p className="text-xs text-[var(--color-semantic-hostile-bright)]">{problem}</p>
          {/*
            ★ A STEP-UP REFUSAL GETS SOMEWHERE TO GO ★

            Told to confirm an authenticator code on a page with nowhere to type one, the
            reasonable conclusion is that two-factor is broken — the same trap the roles editor
            fixed with an in-place modal. There is no code box on a forum thread and there should
            not be one, so this points at the console's own step-up instead. Derived from the
            message rather than from a flag because the API is the only thing that knows which
            refusal this was.
          */}
          {/authenticator|two-factor/i.test(problem) && (
            <p className="text-xs text-[var(--color-text-secondary)]">
              Confirm your code in the{' '}
              <a
                href="/app"
                className="text-[var(--color-brand-cyan-bright)] underline-offset-2 hover:underline"
              >
                admin console
              </a>
              , then come back to this thread — nothing here is lost.
            </p>
          )}
        </div>
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
