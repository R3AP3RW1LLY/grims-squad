'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ColonyNeed } from '../../../../lib/api';
import { apiDelete, apiGet, apiPost } from '../../../../lib/api-client';

/**
 * Who is on this build, and who is covering what.
 *
 * ★ THE WHOLE FEATURE WAS COMPANION-ONLY ★
 *
 * Join, leave, claim and assign were built, tested, and reachable from the desktop app alone — this
 * controller had no roster routes at all. A member reading the board on the website could see
 * exactly what a build needed and had no way to say they would bring any of it.
 *
 * ★ THE UNCOVERED LIST IS THE POINT ★
 *
 * A roster that shows only who has claimed something answers "who is helping" and leaves the more
 * useful question — what is nobody bringing — to be worked out by comparing two lists by eye. The
 * gap is computed here and named, because it is what somebody arriving to help actually needs.
 */

interface Assignment {
  id: string;
  commodity: string;
  tonnes: number | null;
  /** True when somebody else put this on them, rather than them claiming it. */
  assigned: boolean;
}

interface RosterEntry {
  userId: string;
  name: string;
  joinedAt: string;
  assignments: Assignment[];
  delivered: number;
  /** True for your own row. Decided by the server — the page must not guess at its own identity. */
  you: boolean;
  /** True when this build is the one the member's companion overlay follows. */
  current: boolean;
}

const BTN =
  'rounded border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] ' +
  'transition-colors disabled:opacity-40';

const CHIP =
  'rounded border border-[var(--color-border-hairline)] px-2.5 py-1 font-mono text-[11px] ' +
  'text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-active)] ' +
  'hover:text-[var(--color-text-primary)] disabled:opacity-40';

/**
 * How much of a commodity somebody is taking on.
 *
 * Quarter, half or all of what is left. Three is the right number: two is not a choice and five is
 * a decision. Every button prints the tonnage it works out to, so agreeing to a share never means
 * doing the sum yourself.
 */
const SHARES = [
  { label: '¼', of: 0.25 },
  { label: '½', of: 0.5 },
  { label: 'All', of: 1 },
] as const;

export function Crew({ projectId, needs }: { projectId: string; needs: readonly ColonyNeed[] }) {
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const route = `/v1/logistics/colony/projects/${encodeURIComponent(projectId)}`;

  const load = useCallback(async (): Promise<void> => {
    try {
      const answer = await apiGet<{ roster: RosterEntry[] }>(`${route}/roster`);
      setRoster(answer.roster);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the crew.');
    }
  }, [route]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * Every action goes through here so the failure path is one path. The server is where the rules
   * live — whether this member may assign to that one — so a refusal is a SENTENCE to show rather
   * than something the page should have predicted and hidden.
   */
  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  if (roster === null && error === null) {
    return <p className="m-0 text-sm text-[var(--color-text-secondary)]">Reading the crew…</p>;
  }

  const members = roster ?? [];
  const claimed = new Set(members.flatMap((m) => m.assignments.map((a) => a.commodity)));
  const uncovered = needs.filter((n) => n.remaining > 0 && !claimed.has(n.commodity));
  const onIt = members.some((m) => m.you);

  return (
    <div>
      {error === null ? null : (
        <p className="m-0 mb-4 rounded border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_7%,transparent)] px-3 py-2 text-sm text-[var(--color-semantic-warning)]">
          {error}
        </p>
      )}

      <div className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-5">
        {members.length === 0 ? (
          <p className="m-0 text-sm text-[var(--color-text-secondary)]">Nobody has joined yet.</p>
        ) : (
          <ol className="m-0 list-none space-y-3 p-0">
            {members.map((m) => (
              <li
                key={m.userId}
                className="border-t border-[var(--color-border-hairline)] pt-3 first:border-0 first:pt-0"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-sm text-[var(--color-text-primary)]">
                    {m.name}
                    {m.you ? (
                      <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)]">
                        you
                      </span>
                    ) : null}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">
                    {m.delivered > 0 ? `${m.delivered.toLocaleString()} t delivered` : 'nothing yet'}
                  </span>
                </div>

                {m.assignments.length === 0 ? (
                  <p className="m-0 mt-1 text-[11px] text-[var(--color-text-dim)]">
                    not carrying anything in particular
                  </p>
                ) : (
                  <ul className="m-0 mt-2 list-none space-y-1 p-0">
                    {m.assignments.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-baseline justify-between gap-3 text-[11px] text-[var(--color-text-secondary)]"
                      >
                        <span>
                          {a.commodity}
                          {a.tonnes === null ? '' : ` · ${a.tonnes.toLocaleString()} t`}
                          {/* Said out loud: "you took this on" and "somebody asked you to" are
                              different things to read about yourself. */}
                          {a.assigned ? ' (assigned)' : ''}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          className={CHIP}
                          onClick={() =>
                            void act(() =>
                              apiPost(`${route}/unassign`, {
                                commodity: a.commodity,
                                // Sent explicitly: dropping somebody else's is a different
                                // permission from dropping your own, and the server checks it.
                                userId: m.userId,
                              }),
                            )
                          }
                        >
                          Drop
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}

        {/*
          ★ ONE BUTTON, AND IT IS THE ONE THAT APPLIES ★

          Which button is showing IS the answer to "am I on this build", so drawing both would leave
          somebody who had already joined with no way to tell.
        */}
        <div className="mt-5 flex flex-wrap items-center gap-4">
          {onIt ? (
            <>
              <button
                type="button"
                disabled={busy}
                className={`${BTN} border-[var(--color-semantic-hostile-bright)] text-[var(--color-semantic-hostile-bright)] hover:bg-[color-mix(in_srgb,var(--color-semantic-hostile-bright)_12%,transparent)]`}
                onClick={() => void act(() => apiPost(`${route}/leave`))}
              >
                Leave this build
              </button>
              {/*
                ★ THE CURRENT BUILD — SQUADRON OWNER, 2026-08-04 ★

                One build per member, held by the hub. This is what the companion's build overlay
                follows wherever the member flies. Ticking it on another build moves the mark —
                the hub keeps exactly one — which is why this is a checkbox and not a toggle pair.
              */}
              <label className="flex items-center gap-2.5 text-sm text-[var(--color-text-secondary)]">
                <input
                  type="checkbox"
                  checked={members.some((m) => m.you && m.current)}
                  disabled={busy}
                  onChange={(e) =>
                    void act(() =>
                      e.target.checked
                        ? apiPost(`${route}/current`)
                        : apiDelete(`${route}/current`),
                    )
                  }
                />
                This is my current build
              </label>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              className={`${BTN} border-[var(--color-brand-cyan-bright)] bg-[color-mix(in_srgb,var(--color-brand-cyan-bright)_12%,transparent)] text-[var(--color-brand-cyan-bright)] hover:opacity-80`}
              onClick={() => void act(() => apiPost(`${route}/join`))}
            >
              Join this build
            </button>
          )}
        </div>
      </div>

      {uncovered.length === 0 ? null : (
        <div className="mt-5">
          <p className="m-0 mb-2 font-mono text-[11px] text-[var(--color-text-secondary)]">
            Nobody is covering these yet — take a share and it shows against your name.
          </p>
          <ul className="m-0 list-none space-y-1 p-0">
            {uncovered.slice(0, 12).map((n) => (
              <li
                key={n.commodity}
                className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border-hairline)] py-2"
              >
                <span className="text-sm text-[var(--color-text-primary)]">
                  {n.commodity}
                  <span className="ml-3 font-mono text-xs tabular-nums text-[var(--color-text-dim)]">
                    {n.remaining.toLocaleString()} t left
                  </span>
                </span>
                <span className="flex gap-1.5">
                  {SHARES.map((share) => {
                    /*
                     * Rounded up and capped at what is left. A quarter of 4,001 tonnes is 1,000.25,
                     * and a claim in fractions of a tonne is not a thing the game can carry —
                     * rounding up also means three quarter-shares cover the pile rather than
                     * leaving one tonne behind.
                     */
                    const amount = Math.min(n.remaining, Math.ceil(n.remaining * share.of));
                    return (
                      <button
                        key={share.label}
                        type="button"
                        disabled={busy}
                        title={`Take ${amount.toLocaleString()} t of ${n.commodity}`}
                        className={CHIP}
                        onClick={() =>
                          void act(() =>
                            apiPost(`${route}/assign`, { commodity: n.commodity, tonnes: amount }),
                          )
                        }
                      >
                        {share.label}
                        <span className="ml-1.5 text-[var(--color-text-dim)]">
                          {amount.toLocaleString()}
                        </span>
                      </button>
                    );
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
