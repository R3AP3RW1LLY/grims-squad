'use client';

import { useState } from 'react';
import { apiPost } from '../../../../../lib/api-client';

/**
 * "Read my plan and tell me what is wrong with it."
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * Chosen from the colonisation suggestions. The planner already SAYS whether a plan is payable and
 * what it becomes; nothing read those findings back in a member's own language, or decided which of
 * eleven problems is the one that will cost them a fortnight.
 *
 * ★ ASKED FOR, NOT AUTOMATIC ★
 *
 * A button rather than something that runs on load. It costs a model call on a machine in the
 * owner's house, and a page that quietly spends that every time somebody glances at a plan would
 * make the assistant slower for everybody who actually asked it something.
 *
 * ★ THE FACTS COME BACK WITH THE REVIEW ★
 *
 * Foldable, and present every time. It is the only way to tell a retrieved fact from a generated
 * sentence — and the only way somebody looking at a review that seems wrong can tell whether the
 * data was wrong or the model was. Every number in it is computed by the simulation; the model
 * explains and prioritises and works nothing out.
 */
export function PlanReview({ planId }: { planId: string }) {
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'asking' } | { kind: 'done'; review: string; facts: string; unavailable: string | null } | { kind: 'failed'; message: string }
  >({ kind: 'idle' });

  const ask = async (): Promise<void> => {
    setState({ kind: 'asking' });
    try {
      const out = await apiPost<{ review: string; facts: string; unavailable: string | null }>(
        `/v1/logistics/colony/plans/${encodeURIComponent(planId)}/review`,
        {},
      );
      setState({ kind: 'done', ...out });
    } catch (e) {
      setState({
        kind: 'failed',
        message: e instanceof Error ? e.message : 'The review could not be fetched.',
      });
    }
  };

  return (
    <div className="mb-4 rounded border border-[var(--color-border-hairline)] px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="m-0 text-sm text-[var(--color-text-primary)]">
          Ask the assistant what is wrong with this plan
        </p>
        <button
          type="button"
          disabled={state.kind === 'asking'}
          onClick={() => void ask()}
          className="rounded-md border border-[var(--color-border-hairline)] px-3 py-1 text-xs text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-subtle)] disabled:opacity-50"
        >
          {state.kind === 'asking' ? 'Reading it…' : state.kind === 'done' ? 'Ask again' : 'Review this plan'}
        </button>
      </div>

      <p className="m-0 mt-1 text-[11px] text-[var(--color-text-dim)]">
        {/*
          Said plainly. Every figure it quotes is computed by the simulation on this page — the
          assistant is reading those findings back, not working anything out, and that is exactly
          why it can be trusted with a fortnight of somebody's hauling.
        */}
        It is given only what the simulation on this page worked out, and is told not to invent
        anything else.
      </p>

      {state.kind === 'failed' ? (
        <p className="m-0 mt-3 text-sm text-[var(--color-semantic-warning)]">{state.message}</p>
      ) : null}

      {state.kind === 'done' ? (
        <div className="mt-3">
          {state.unavailable === null ? null : (
            <p className="m-0 mb-2 text-sm text-[var(--color-semantic-warning)]">
              {state.unavailable}
            </p>
          )}

          {state.review === '' ? null : (
            <div className="whitespace-pre-wrap text-sm text-[var(--color-text-primary)]">
              {state.review}
            </div>
          )}

          {state.facts === '' ? null : (
            <details className="mt-3">
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
                What it was told
              </summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-[var(--color-surface-void)] p-3 text-[11px] text-[var(--color-text-secondary)]">
                {state.facts}
              </pre>
            </details>
          )}
        </div>
      ) : null}
    </div>
  );
}
