'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OpRow } from '../../../lib/api';
import { apiPost, apiDelete, ApiCallError } from '../../../lib/api-client';

/**
 * The operations board, and saying whether you are coming.
 *
 * ★ THE SEAT COUNT IS THE WHOLE POINT OF THE ROW ★
 *
 * A member scanning this is answering one question — is there room, and am I in. So going, capacity
 * and standby sit together and read at a glance, and the button says what will actually happen
 * rather than a generic "sign up": committing to a full op puts you on standby, and being told that
 * afterwards feels like a refusal even though it is not.
 */

const TYPE_TEXT: Record<string, string> = {
  bgs: 'BGS',
  combat: 'Combat',
  mining: 'Mining',
  trade: 'Trade',
  exploration: 'Exploration',
  rescue: 'Rescue',
  social: 'Social',
  training: 'Training',
};

const STATE_TEXT: Record<string, string> = {
  yes: 'You are in',
  standby: 'You are on standby',
  maybe: 'You said maybe',
  no: 'You said no',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function OpsBoard({ ops }: { ops: OpRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (id: string, work: () => Promise<unknown>): Promise<void> => {
    setBusy(id);
    setProblem(null);
    try {
      await work();
      router.refresh();
    } catch (err) {
      setProblem(err instanceof ApiCallError ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(null);
    }
  };

  if (ops.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        Nothing on the board. Wing leads can post an op from the admin area, and it appears here for
        everybody the moment it does.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {problem !== null ? (
        <p className="m-0 rounded border border-[var(--color-semantic-hostile-bright)] px-3 py-2 text-sm text-[var(--color-semantic-hostile-bright)]">
          {problem}
        </p>
      ) : null}

      {ops.map((op) => {
        /*
         * Whether committing now would seat them or queue them. Worked out here so the BUTTON can
         * say it — being told "you are on standby" only after pressing "I'm in" reads as a refusal,
         * which is exactly what standby is not.
         */
        const full = op.capacity !== null && op.going >= op.capacity;
        const mine = op.mine;

        return (
          <article
            key={op.id}
            className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-4"
          >
            <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="m-0 text-base text-[var(--color-text-primary)]">
                {op.title}
                <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-brand-orange-bright)]">
                  {TYPE_TEXT[op.opType] ?? op.opType}
                </span>
              </h3>
              <span className="font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">
                {when(op.startsAt)}
              </span>
            </header>

            <p className="m-0 mb-3 font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">
              <span className="text-[var(--color-semantic-success)]">{op.going} going</span>
              {op.capacity === null ? ' · no limit' : ` of ${op.capacity}`}
              {/*
                Shown even at zero when the op is full, because an empty standby queue on a full op
                is the most encouraging thing the row can say: you would be first.
              */}
              {op.standby > 0 || full ? ` · ${op.standby} on standby` : ''}
              {' · posted by '}
              {op.createdBy}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy === op.id}
                onClick={() => void run(op.id, () => apiPost(`/v1/ops/${op.id}/signup`, { state: 'yes' }))}
                className="rounded border border-[var(--color-brand-orange)] px-3 py-1.5 text-sm text-[var(--color-brand-orange-bright)] hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_12%,transparent)] disabled:opacity-50"
              >
                {full && mine !== 'yes' ? 'Join the standby queue' : "I'm in"}
              </button>
              <button
                type="button"
                disabled={busy === op.id}
                onClick={() => void run(op.id, () => apiPost(`/v1/ops/${op.id}/signup`, { state: 'maybe' }))}
                className="rounded border border-[var(--color-border-hairline)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
              >
                Maybe
              </button>
              {mine !== null ? (
                <button
                  type="button"
                  disabled={busy === op.id}
                  onClick={() => void run(op.id, () => apiDelete(`/v1/ops/${op.id}/signup`))}
                  className="text-sm text-[var(--color-text-secondary)] underline hover:text-[var(--color-semantic-hostile-bright)] disabled:opacity-50"
                >
                  Withdraw
                </button>
              ) : null}

              {mine !== null ? (
                <span
                  className={`ml-auto font-mono text-xs ${
                    mine === 'yes'
                      ? 'text-[var(--color-semantic-success)]'
                      : mine === 'standby'
                        ? 'text-[var(--color-semantic-warning)]'
                        : 'text-[var(--color-text-secondary)]'
                  }`}
                >
                  {STATE_TEXT[mine] ?? mine}
                </span>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
