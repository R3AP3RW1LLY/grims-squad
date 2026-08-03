'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ColonyProject } from '../../../../lib/api';
import { apiDelete, apiPatch } from '../../../../lib/api-client';

/**
 * What can be done to a project, rather than to its cargo.
 *
 * ★ EVERY CONTROL HERE HAD A ROUTE AND NO BUTTON ★
 *
 * `isPriority` has been stored since the table existed, is rendered as a badge in three places, and
 * could not be set from any screen in either application — the PATCH route was written, tested, and
 * reachable only by hand. Closing had no route at all, so a build nobody ever docks at again reads
 * "Live" for ever at the top of a board, offering work nobody is doing.
 *
 * ★ WHY THIS IS A CLIENT COMPONENT AND THE PAGE IS NOT ★
 *
 * The page is server-rendered and stays that way. Only the four buttons need a browser, and after
 * one succeeds `router.refresh()` re-runs the server component — so the badge, the status tile and
 * the board all move together, from one source, without a second copy of the state living here.
 */

const BTN =
  'rounded border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] ' +
  'transition-colors disabled:opacity-40';

export function ProjectActions({
  project,
  canManage,
  isPoster,
}: {
  project: ColonyProject;
  /** COLONY_MANAGE. Governs the squadron's builds and the current-effort marker. */
  canManage: boolean;
  /** Whether the reader posted this. Governs their own build. */
  isPoster: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * The same rule the server enforces, drawn rather than guessed at. A squadron project is the
   * squadron's effort, so an officer directs it; a personal one belongs to whoever posted it, and
   * rank does not change that. The server re-checks — this only decides what to draw.
   */
  const mayDirect = project.owner === 'squadron' ? canManage : isPoster;
  const closed = project.completedAt !== null;

  if (!mayDirect && !canManage) return null;

  const call = async (path: string, method: 'PATCH' | 'DELETE', body?: unknown): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const route = `/v1/logistics/colony/projects/${encodeURIComponent(project.id)}${path}`;
      if (method === 'DELETE') {
        await apiDelete(route);
        // Gone, so there is nothing left to refresh into. Back to the board it came from.
        router.push('/colonisation/squadron');
        return;
      }

      await apiPatch(route, body);
      /*
       * The server component re-runs, so the badge, the status tile and the board all move together
       * from one source. Keeping a copy of the state here would be a second thing to get wrong.
       */
      router.refresh();
    } catch (err) {
      /*
       * The server's own sentence, not a paraphrase. The refusals here are the interesting part —
       * "people have already hauled to this build, close it instead" is a real explanation, and
       * replacing it with "something went wrong" throws away the only useful thing said.
       */
      setError(err instanceof Error ? err.message : 'That did not work. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {/*
          The current-effort marker is squadron-only. A member marking their own build as the
          squadron's priority would be pointing the whole squadron at it, which is not theirs to do.
        */}
        {project.owner === 'squadron' && canManage ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void call('/priority', 'PATCH', { isPriority: !project.isPriority })}
            className={
              project.isPriority
                ? `${BTN} border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_12%,transparent)] text-[var(--color-brand-orange-bright)]`
                : `${BTN} border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)]`
            }
          >
            {project.isPriority ? 'Current effort' : 'Make current effort'}
          </button>
        ) : null}

        {mayDirect ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void call(closed ? '/reopen' : '/close', 'PATCH')}
            className={`${BTN} border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)]`}
          >
            {closed ? 'Reopen' : 'Close this build'}
          </button>
        ) : null}

        {/*
          Delete is drawn only while nothing has been hauled. The server refuses either way, but a
          button that exists in order to be refused is a button that teaches people to distrust the
          page — and `required` is zero exactly when the site has never reported a depot, which is
          the mistyped-market-id case delete is for.
        */}
        {mayDirect && project.required === 0 ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void call('', 'DELETE')}
            className={`${BTN} border-[var(--color-semantic-hostile-bright)] text-[var(--color-semantic-hostile-bright)] hover:bg-[color-mix(in_srgb,var(--color-semantic-hostile-bright)_12%,transparent)]`}
          >
            Delete
          </button>
        ) : null}
      </div>

      {error === null ? null : (
        <p className="m-0 mt-3 rounded border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_7%,transparent)] px-3 py-2 text-sm text-[var(--color-semantic-warning)]">
          {error}
        </p>
      )}
    </div>
  );
}
