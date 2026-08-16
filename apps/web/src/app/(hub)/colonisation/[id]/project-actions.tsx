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
  const abandoned = project.abandonedAt !== null;

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

        {/*
          ★ ANY MEMBER, NOT JUST AN OFFICER — SQUADRON OWNER, 2026-08-12 ★

          "someone without the companion app completed a project and it did not update ... this
          causes our members to go buy materials for a project thats completed and not needed."

          The person who discovers a build is finished is almost never an officer: it is whoever
          flew out with a full hold and found nothing to deliver to. `Close this build` below is
          gated on directing the project, so until now they had no way to tell anybody and the next
          member repeated the trip.

          It closes rather than flags because it is reversible, audited against them by name, and
          announced at once — where flagging would leave the wasted trips running until an officer
          noticed, which is the behaviour being fixed.
        */}
        {closed ? null : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void call('/report-built', 'PATCH')}
            className={`${BTN} border-[var(--color-semantic-warning)] text-[var(--color-semantic-warning)] hover:bg-[color-mix(in_srgb,var(--color-semantic-warning)_10%,transparent)]`}
            title="Tell the squadron this build is already finished, so nobody else hauls to it."
          >
            It&rsquo;s already built
          </button>
        )}

        {/*
          ★ GIVING UP ON A BUILD — SQUADRON OWNER, 2026-08-15 ★

          "we also need to allow admins to mark builds as abandoned and not always just as complete"

          The third ending, and it exists because the other two were both lies for a build the
          squadron walked away from. Leaving it open keeps asking for materials nobody will haul;
          closing it writes a station that was never finished into the record the squadron measures
          itself by — and closing it was, until now, the only button there was.

          COLONY_MANAGE rather than the poster, matching adoption: abandoning hides the build from
          everybody else and stops work the squadron may have committed playing time to, which was
          never one member's call. The server checks this again; this only decides what to draw.

          The reason is asked for rather than required. An officer who has one should be able to
          give it — the poster is owed it — and one who is tidying up a duplicate should not be made
          to invent prose to finish the job.
        */}
        {canManage ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (abandoned) {
                void call('/abandoned', 'PATCH', { abandoned: false });
                return;
              }
              const note = window.prompt(
                'Why is this build being abandoned? The member who posted it will see this.',
                '',
              );
              // A cancelled prompt returns null, and that is the officer changing their mind — not
              // an empty reason. Only a real answer, including a deliberate blank, goes through.
              if (note === null) return;
              void call('/abandoned', 'PATCH', { abandoned: true, note });
            }}
            className={
              abandoned
                ? `${BTN} border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)]`
                : `${BTN} border-[var(--color-semantic-hostile)] text-[var(--color-semantic-hostile-bright)] hover:bg-[color-mix(in_srgb,var(--color-semantic-hostile)_10%,transparent)]`
            }
            title={
              abandoned
                ? 'Put this build back on the boards.'
                : 'Take this build off the boards. Only you, other officers and the member who posted it will see it.'
            }
          >
            {abandoned ? 'Bring this build back' : 'Abandon this build'}
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
          ★ ADOPTING A BUILD, AND HANDING IT BACK — SQUADRON OWNER, 2026-08-05 ★

          "give admins the option after the fact to turn a project into a squadron project"

          `owner` was decided once at creation and nothing could change it, so a member's build
          that the squadron then rallied behind could never be made official — and could never be
          the current effort, because that marker is squadron-only.

          Officers only, in both directions: adopting a build commits the squadron's playing time,
          which is not the poster's to commit. Whoever posted it keeps the credit either way.
        */}
        {canManage ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void call('/owner', 'PATCH', {
                owner: project.owner === 'squadron' ? 'personal' : 'squadron',
              })
            }
            className={`${BTN} border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)]`}
          >
            {project.owner === 'squadron' ? 'Hand back to the poster' : 'Make it a squadron project'}
          </button>
        ) : null}

        {/*
          ★ DRAWN ON THE RULE THE SERVER ACTUALLY ENFORCES ★

          This turned on the REQUIRED tonnage — "the site has not reported what it needs yet" — while
          the server refuses on DELIVERIES, because that is what deleting would erase. The two come
          apart in the exact case Delete exists for: somebody mistypes a market id, the site reports
          its needs, nobody hauls a tonne, and the owner is left with a build they cannot remove.
          Reported by the squadron owner: "we need to be able to delete projects if we own the
          project".

          Still gated rather than always drawn — a button that exists in order to be refused
          teaches people to distrust the page — but now on the same question the server asks.
        */}
        {mayDirect && project.deliveryCount === 0 ? (
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
