'use client';

import { useCallback, useState } from 'react';
import { UserMultiSelect } from '../../../../../components/user-multi-select';
import type { Candidate } from '../../../../../components/user-multi-select-rules';
import { apiCall, apiPost, apiDelete } from '../../../../../lib/api-client';
import type { ThreadGrant } from '../../../../../lib/api';

/**
 * Who may read this thread, besides the people its board already lets in.
 *
 * Squadron owner, 2026-07-29: "non-officers should not have the ability to view unless
 * permission to a specific user is provided this should be done from a dropdown on the post
 * that allows an admin to allow access to one or more users (multi select dropdown that is
 * searchable and autocompletable)".
 *
 * ★ THIS PANEL IS RENDERED BY THE SERVER ONLY FOR SOMEBODY WHO MAY USE IT ★
 *
 * The page fetches existing grants first; a caller who may not manage access gets null and
 * the panel is never rendered. That is presentation, NOT security — every route this
 * component calls re-checks the caller server-side, and the rule that actually matters
 * (`you cannot grant access to a thread you cannot see`) is enforced by reading the thread
 * through the granter's own ACL-bound client.
 *
 * So hiding the panel is a courtesy to people who should not be thinking about it, and
 * nothing here is trusted to enforce anything.
 */

export interface ThreadAccessProps {
  readonly threadId: string;
  readonly initialGrants: readonly ThreadGrant[];
}

export function ThreadAccess({ threadId, initialGrants }: ThreadAccessProps) {
  const [grants, setGrants] = useState<readonly ThreadGrant[]>(initialGrants);
  const [selected, setSelected] = useState<readonly Candidate[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * The search, injected into the component rather than built into it. Keeps the widget
   * testable without a network and means the same component can serve a different search
   * later without being edited.
   *
   * `useCallback` matters here: the component debounces on `search` changing, so a new
   * function identity every render would restart the timer on every keystroke and the
   * request would never fire.
   */
  const search = useCallback(
    async (query: string): Promise<readonly Candidate[]> => {
      const res = await apiCall<{ candidates: Candidate[] }>(
        'GET',
        `/v1/forum/threads/${encodeURIComponent(threadId)}/grants/candidates?q=${encodeURIComponent(query)}`,
      );
      return res.candidates;
    },
    [threadId],
  );

  async function grant() {
    if (selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ grants: ThreadGrant[] }>(
        `/v1/forum/threads/${encodeURIComponent(threadId)}/grants`,
        {
          userIds: selected.map((s) => s.userId),
          reason: reason.trim() === '' ? undefined : reason.trim(),
        },
      );
      /*
       * The server returns the WHOLE grant list, and it replaces local state rather than
       * being appended to it. Appending would drift the moment two admins worked at once —
       * and this is a permissions list, which is the worst place to show somebody a stale
       * view of who has access.
       */
      setGrants(res.grants);
      setSelected([]);
      setReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(userId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiDelete<{ grants: ThreadGrant[] }>(
        `/v1/forum/threads/${encodeURIComponent(threadId)}/grants/${encodeURIComponent(userId)}`,
      );
      setGrants(res.grants);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
        People named here can <strong className="text-[var(--color-text-primary)]">read</strong>{' '}
        this thread even though the board is closed to them. They still cannot reply — posting
        follows the board, not this list.
      </p>

      {grants.length > 0 && (
        <ul className="space-y-2">
          {grants.map((g) => (
            <li
              key={g.userId}
              className="flex items-start justify-between gap-4 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-[var(--color-text-primary)]">
                  {g.displayName === null || g.displayName === g.handle
                    ? g.handle
                    : `${g.displayName} (${g.handle})`}
                </p>
                {/* Who authorised it, so the list is reviewable rather than anonymous. */}
                <p className="mt-0.5 font-mono text-[11px] text-[var(--color-text-secondary)]">
                  granted by {g.grantedByHandle}
                  {g.reason === null ? '' : ` — ${g.reason}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void revoke(g.userId)}
                disabled={busy}
                className="shrink-0 rounded border border-[var(--color-border-hairline)] px-2 py-1 text-xs text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <UserMultiSelect
        selected={selected}
        onChange={setSelected}
        search={search}
        label="Give someone access"
        disabled={busy}
      />

      <div>
        <label
          htmlFor="grant-reason"
          className="block text-sm font-medium text-[var(--color-text-primary)]"
        >
          Why (for the next person reviewing this)
        </label>
        <input
          id="grant-reason"
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
          placeholder="Helping with the BGS report"
          className="mt-2 w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-3 py-2 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] disabled:opacity-60"
        />
      </div>

      {error !== null && (
        <p className="text-sm text-[var(--color-brand-orange-bright)]" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void grant()}
        disabled={busy || selected.length === 0}
        className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-4 py-2 text-sm text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-active)] disabled:opacity-50"
      >
        {busy
          ? 'Working…'
          : selected.length === 0
            ? 'Pick someone first'
            : `Give access to ${selected.length} ${selected.length === 1 ? 'person' : 'people'}`}
      </button>
    </div>
  );
}
