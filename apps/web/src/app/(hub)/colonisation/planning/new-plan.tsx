'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiPost } from '../../../../lib/api-client';

/**
 * Starting a plan.
 *
 * ★ TWO FIELDS, AND THE SYSTEM IS THE ONE THAT MATTERS ★
 *
 * Naming it is a convenience. The system is what the whole page is built from: its bodies are
 * fetched on save, which is why the button says what it is about to do rather than just "Create" —
 * a form that pauses for a second with no explanation reads as a form that hung.
 */

const FIELD =
  'rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] ' +
  'px-3 py-1.5 text-sm text-[var(--color-text-primary)]';

export function NewPlan() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [systemName, setSystemName] = useState('');
  const [owner, setOwner] = useState<'personal' | 'squadron'>('personal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const made = await apiPost<{ id: string }>('/v1/logistics/colony/plans', {
        title,
        systemName,
        owner,
      });
      router.push(`/colonisation/planning/${made.id}`);
    } catch (err) {
      /*
       * The server's own sentence. "Only officers can plan on the squadron's behalf" is a real
       * explanation, and replacing it with "something went wrong" throws away the only useful thing
       * that was said.
       */
      setError(err instanceof Error ? err.message : 'That did not work.');
      setBusy(false);
    }
  };

  return (
    <div className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            System
          </span>
          <input
            value={systemName}
            onChange={(e) => setSystemName(e.target.value)}
            placeholder="the system you are claiming"
            className={`${FIELD} w-[240px]`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            Call it
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="a name for this plan"
            className={`${FIELD} w-[220px]`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            Whose
          </span>
          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value === 'squadron' ? 'squadron' : 'personal')}
            className={FIELD}
          >
            <option value="personal">Mine</option>
            <option value="squadron">The squadron&rsquo;s</option>
          </select>
        </label>

        <button
          type="button"
          disabled={busy || systemName.trim() === '' || title.trim() === ''}
          onClick={() => void create()}
          className="rounded border border-[var(--color-brand-cyan-bright)] bg-[color-mix(in_srgb,var(--color-brand-cyan-bright)_12%,transparent)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)] transition-opacity hover:opacity-80 disabled:opacity-40"
        >
          {/* Says what it is about to do, because fetching a system's bodies takes a moment. */}
          {busy ? 'Reading the system…' : 'Start planning'}
        </button>
      </div>

      <p className="m-0 mt-3 text-[11px] text-[var(--color-text-secondary)]">
        The bodies come from what commanders have scanned and shared. A system nobody has surveyed
        yet still gets a plan — it simply has nothing to draw until somebody scans it.
      </p>

      {error === null ? null : (
        <p className="m-0 mt-3 rounded border border-[var(--color-semantic-warning)] px-3 py-2 text-sm text-[var(--color-semantic-warning)]">
          {error}
        </p>
      )}
    </div>
  );
}
