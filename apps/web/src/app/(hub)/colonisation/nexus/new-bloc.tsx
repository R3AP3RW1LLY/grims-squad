'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiPost } from '../../../../lib/api-client';

/**
 * Starting a group of systems.
 *
 * ★ ANY MEMBER, WHICH IS THE WHOLE CHANGE — SQUADRON OWNER, 2026-08-24 ★
 *
 * Groups used to be officer-made and squadron-owned, which is why the platform held none of them:
 * the members who wanted to group their own systems were not allowed to.
 *
 * A group starts PRIVATE and stays that way until its creator shares it. That is not a setting to
 * fiddle with later — a group's system list says where somebody is quietly building, months before
 * anything is standing there, so the safe value is the one it begins with.
 */

const FIELD =
  'rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] ' +
  'px-3 py-1.5 text-sm text-[var(--color-text-primary)]';

export function NewBloc() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [owner, setOwner] = useState<'personal' | 'squadron'>('personal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const made = await apiPost<{ id: string }>('/v1/logistics/colony/blocs', {
        name,
        note: note.trim() === '' ? null : note,
        owner,
      });
      router.push(`/colonisation/nexus/${made.id}`);
    } catch (err) {
      /*
       * The server's own sentence. "You already have a group called X" is a real explanation and
       * names the thing to change; "something went wrong" throws that away.
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
            Name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Col 285 Core"
            className={`${FIELD} w-64`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            What it is for
          </span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="The four systems I am building out together"
            className={`${FIELD} w-96 max-w-full`}
          />
        </label>

        {/*
          Shown to everyone, as the plan form does, and it is not the "editor a member with no rank
          could not use" mistake: the DEFAULT is "Me", which every member may choose. Only the
          second option needs the officer bit, and picking it returns the server's own sentence
          naming exactly that. The web has no permission mask to read here, and fetching one to grey
          out a single option would be a request per page load for a refusal that already explains
          itself.
        */}
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            Belongs to
          </span>
          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value === 'squadron' ? 'squadron' : 'personal')}
            className={FIELD}
          >
            <option value="personal">Me</option>
            <option value="squadron">The squadron (officers)</option>
          </select>
        </label>

        <button
          type="button"
          disabled={busy || name.trim() === ''}
          onClick={() => void create()}
          className="rounded border border-[var(--color-brand-cyan-bright)] bg-[color-mix(in_srgb,var(--color-brand-cyan-bright)_12%,transparent)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)] transition-opacity hover:opacity-80 disabled:opacity-40"
        >
          {busy ? 'Making the group…' : 'Make the group'}
        </button>
      </div>

      <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
        A group you make is yours alone until you choose to share it with the squadron.
      </p>

      {error === null ? null : (
        <p className="mt-3 text-sm text-[var(--color-semantic-hostile)]">{error}</p>
      )}
    </div>
  );
}
