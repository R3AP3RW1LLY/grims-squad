'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OpRow } from '../../../lib/api';
import { apiPost, ApiCallError } from '../../../lib/api-client';

/**
 * Posting an operation, and calling one off.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "the ops/and bgs need admin pages in the administration category on the website please to manage
 * them etc"
 *
 * ★ CAPACITY IS OPTIONAL, AND THE LABEL SAYS SO ★
 *
 * Blank means everybody welcome. An empty number field that silently became zero would post an op
 * nobody may join — indistinguishable from a broken board — so the field is labelled for what
 * leaving it blank DOES rather than for what it is.
 */

const TYPES = ['bgs', 'combat', 'mining', 'trade', 'exploration', 'rescue', 'social', 'training'];

const FIELD =
  'rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-raised)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]';

export function OpsConsole({ ops }: { ops: OpRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [opType, setOpType] = useState('bgs');
  const [startsAt, setStartsAt] = useState('');
  const [capacity, setCapacity] = useState('');
  const [description, setDescription] = useState('');

  const run = async (work: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
      router.refresh();
    } catch (err) {
      setProblem(err instanceof ApiCallError ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6">
      {problem !== null ? (
        <p className="m-0 rounded border border-[var(--color-semantic-hostile-bright)] px-3 py-2 text-sm text-[var(--color-semantic-hostile-bright)]">
          {problem}
        </p>
      ) : null}

      <section>
        <h3 className="m-0 mb-3 font-[family-name:var(--font-display)] text-base">Post an op</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
              What
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Thursday BGS push"
              className={`${FIELD} w-full`}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
              Kind
            </span>
            <select value={opType} onChange={(e) => setOpType(e.target.value)} className={FIELD}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
              When
            </span>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className={FIELD}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
              Seats — blank for no limit
            </span>
            <input
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="everybody"
              inputMode="numeric"
              className={`${FIELD} w-[9rem]`}
            />
          </label>

          <button
            type="button"
            disabled={busy || title.trim() === '' || startsAt === ''}
            onClick={() =>
              void run(async () => {
                await apiPost('/v1/ops', {
                  title,
                  opType,
                  // The browser gives a local wall-clock string; the API stores an instant.
                  startsAt: new Date(startsAt).toISOString(),
                  description,
                  capacity: capacity.trim() === '' ? null : Number(capacity),
                });
                setTitle('');
                setStartsAt('');
                setCapacity('');
                setDescription('');
              })
            }
            className="rounded border border-[var(--color-brand-orange)] px-3 py-1.5 text-sm text-[var(--color-brand-orange-bright)] hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_12%,transparent)] disabled:opacity-50"
          >
            Post
          </button>
        </div>

        <label className="mt-2 flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
            Briefing — what members should bring, and why
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className={`${FIELD} w-full`}
          />
        </label>
      </section>

      <section>
        <h3 className="m-0 mb-3 font-[family-name:var(--font-display)] text-base">On the board</h3>
        {ops.length === 0 ? (
          <p className="m-0 text-sm text-[var(--color-text-secondary)]">Nothing posted.</p>
        ) : (
          <div className="grid gap-2">
            {ops.map((op) => (
              <div
                key={op.id}
                className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border-hairline)] py-2 text-sm"
              >
                <span className="flex-1 text-[var(--color-text-primary)]">{op.title}</span>
                <span className="font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">
                  {/* going / capacity, with the standby queue in brackets. */}
                  {op.going}
                  {op.capacity === null ? '' : `/${op.capacity}`}
                  {op.standby > 0 ? ` (+${op.standby})` : ''}
                </span>
                <span className="font-mono text-xs text-[var(--color-text-secondary)]">
                  {op.status}
                </span>
                {op.status === 'cancelled' || op.status === 'complete' ? null : (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(() => apiPost(`/v1/ops/${op.id}/status`, { status: 'complete' }))
                      }
                      className="text-xs text-[var(--color-text-secondary)] underline hover:text-[var(--color-text-primary)]"
                    >
                      Mark done
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(() => apiPost(`/v1/ops/${op.id}/status`, { status: 'cancelled' }))
                      }
                      className="text-xs text-[var(--color-text-secondary)] underline hover:text-[var(--color-semantic-hostile-bright)]"
                    >
                      Call it off
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
