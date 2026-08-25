'use client';

import { useState } from 'react';
import { apiPatch } from '../../../../../lib/api-client';

/**
 * Sharing a personal plan with the squadron.
 *
 * ★ SQUADRON OWNER, 2026-08-24 ★
 *
 * "we want to add a feature that allows users to make their plans available for the entire squadron
 * to view without it being a squadron plan etc."
 *
 * ★ WHAT SHARING DOES, SAID ON THE CONTROL ITSELF ★
 *
 * Every member can read it and haul to any project it has spawned. Nobody else can change it — the
 * plan stays yours, and only you can edit it. That distinction is the entire feature, and a toggle
 * labelled "Share" without it invites somebody to assume the opposite in either direction: either
 * that they are handing the plan over, or that sharing is harmless because nobody can see much.
 *
 * ★ NOT SHOWN TO ANYONE BUT THE AUTHOR ★
 *
 * The service refuses a caller who is not, so this is a rendering decision rather than the rule. But
 * showing a control that will be refused is how a member concludes the app is broken.
 */
export function SharePlan({
  planId,
  shared,
}: {
  planId: string;
  shared: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [on, setOn] = useState(shared);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (): Promise<void> => {
    const next = !on;
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/v1/logistics/colony/plans/${encodeURIComponent(planId)}/visibility`, {
        shared: next,
      });
      setOn(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={busy}
          aria-pressed={on}
          className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-panel)] px-4 py-2 text-sm text-[var(--color-text-primary)] hover:border-[var(--color-border-active)] disabled:opacity-50"
        >
          {busy ? 'Saving…' : on ? 'Stop sharing with the squadron' : 'Share with the squadron'}
        </button>

        {/*
          The consequence, in the present tense, next to the control. "Others can read this" is what
          a member needs to weigh — not "sharing is enabled", which describes a setting rather than
          what it does.
        */}
        <span className="text-xs text-[var(--color-text-dim)]">
          {on
            ? 'Every member can read this plan and haul to its builds. Only you can change it.'
            : 'Only you can see this plan.'}
        </span>
      </div>

      {error !== null && (
        <p className="m-0 text-sm text-[var(--color-semantic-hostile)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
