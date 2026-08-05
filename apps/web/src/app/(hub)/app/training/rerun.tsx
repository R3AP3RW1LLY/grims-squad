'use client';

import { useState } from 'react';
import { apiCall } from '../../../../lib/api-client';

/**
 * Asks the worker to run one source now.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "if any of the ingestion sources stall, we need to show a button to re-trigger or refresh or
 * something that will re-start the ingestion process."
 *
 * ★ IT SAYS "REQUESTED", NOT "STARTED" ★
 *
 * The API publishes on a Postgres channel and the resident worker picks it up. If that worker is
 * down, nothing runs — and a button that claimed the job had started would be the same class of lie
 * as the stalled run it exists to clear.
 *
 * So the wording is honest and the page keeps refreshing itself every thirty seconds. Within one
 * refresh the row either says "Training now" or it does not, and that answer is a fact rather than
 * a promise.
 */
export function RerunButton({ source, label }: { readonly source: string; readonly label: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  async function send(): Promise<void> {
    setState('sending');
    try {
      await apiCall('POST', `/v1/ai/training/${encodeURIComponent(source)}/rerun`);
      setState('sent');
    } catch {
      setState('failed');
    }
  }

  if (state === 'sent') {
    return (
      <span className="font-mono text-[11px] text-[var(--color-semantic-success)]">
        Requested — watch the state above
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={state === 'sending'}
      onClick={() => void send()}
      title={`Run the ${label} ingest now`}
      className="rounded border border-[var(--color-brand-orange)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-brand-orange-bright)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_12%,transparent)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {state === 'sending' ? 'Sending…' : state === 'failed' ? 'Try again' : 'Run now'}
    </button>
  );
}
