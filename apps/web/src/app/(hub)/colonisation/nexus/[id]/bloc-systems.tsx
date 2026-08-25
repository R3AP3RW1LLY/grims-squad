'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiDelete, apiPatch, apiPost } from '../../../../../lib/api-client';

/**
 * Adding and removing the systems in a group, and choosing who may see it.
 *
 * ★ SHARING IS READ-ONLY, AND THE WORDS SAY SO ★
 *
 * Sharing a group never lets anybody else change it — `owner` decides editing, `visibility` decides
 * seeing, and the two are deliberately different questions. The control is therefore worded as
 * "let the squadron see this", not "share", because "share" is the word people read as "collaborate
 * on".
 */

const FIELD =
  'rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] ' +
  'px-3 py-1.5 text-sm text-[var(--color-text-primary)]';

/** The roles the gap analysis understands. Anything else is stored as "no role decided". */
const ROLES = [
  'extraction',
  'refinery',
  'industrial',
  'hightech',
  'agriculture',
  'tourism',
  'military',
  'colony',
] as const;

export function BlocSystems({
  blocId,
  systems,
  mayEdit,
  owner,
  visibility,
}: {
  blocId: string;
  systems: string[];
  mayEdit: boolean;
  owner: 'squadron' | 'personal';
  visibility: 'private' | 'squadron';
}) {
  const router = useRouter();
  const [systemName, setSystemName] = useState('');
  const [role, setRole] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Drawn only for somebody who may actually use it. The app once rendered every editing control
   * unconditionally and offered a member a full editor whose every click the API refused.
   */
  if (!mayEdit) {
    return (
      <p className="text-xs text-[var(--color-text-secondary)]">
        This group belongs to{' '}
        {owner === 'squadron' ? 'the squadron' : 'another member'}, so it is yours to read rather
        than to change.
      </p>
    );
  }

  const run = async (work: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await work();
      router.refresh();
      setSystemName('');
    } catch (err) {
      // The server's own sentence — it names the thing to change.
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const add = (): Promise<void> =>
    run(() =>
      apiPost(`/v1/logistics/colony/blocs/${encodeURIComponent(blocId)}/systems`, {
        systemName,
        role: role === '' ? null : role,
      }),
    );

  const remove = (name: string): Promise<void> =>
    run(() =>
      apiDelete(
        `/v1/logistics/colony/blocs/${encodeURIComponent(blocId)}/systems/${encodeURIComponent(name)}`,
      ),
    );

  const setShared = (shared: boolean): Promise<void> =>
    run(() =>
      apiPatch(`/v1/logistics/colony/blocs/${encodeURIComponent(blocId)}/visibility`, { shared }),
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            Add a system
          </span>
          <input
            value={systemName}
            onChange={(e) => setSystemName(e.target.value)}
            placeholder="Col 285 Sector GL-W c2-12"
            className={`${FIELD} w-72`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            What it is for
          </span>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={FIELD}>
            {/*
              The role is what the squadron DECIDED, not what the bodies suggest. A system with
              perfect extraction bodies that officers chose to make military IS military.
            */}
            <option value="">Not decided</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={busy || systemName.trim() === ''}
          onClick={() => void add()}
          className="rounded border border-[var(--color-brand-cyan-bright)] bg-[color-mix(in_srgb,var(--color-brand-cyan-bright)_12%,transparent)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)] transition-opacity hover:opacity-80 disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {systems.length === 0 ? null : (
        <div className="flex flex-wrap gap-2">
          {systems.map((name) => (
            <span
              key={name}
              className="flex items-center gap-2 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-3 py-1.5"
            >
              <span className="font-mono text-xs text-[var(--color-text-primary)]">{name}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(name)}
                aria-label={`Remove ${name} from this group`}
                className="text-[var(--color-text-secondary)] hover:text-[var(--color-semantic-hostile)] disabled:opacity-50"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/*
        A squadron group is every member's by definition, so there is nothing to decide about who
        may see it — offering the control would imply otherwise.
      */}
      {owner === 'personal' ? (
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <input
            type="checkbox"
            checked={visibility === 'squadron'}
            disabled={busy}
            onChange={(e) => void setShared(e.target.checked)}
          />
          Let the squadron see this group. They can read it; only you can change it.
        </label>
      ) : null}

      {error === null ? null : (
        <p className="text-sm text-[var(--color-semantic-hostile)]">{error}</p>
      )}
    </div>
  );
}
