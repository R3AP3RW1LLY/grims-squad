'use client';

import { useState } from 'react';
import type { RecruitStatus } from '../../../lib/api';
import { apiPost, ApiCallError } from '../../../lib/api-client';

/**
 * The member's link, the reward ladder, and their recruits.
 *
 * ★ THE READER WHO CANNOT RECRUIT YET MATTERS MOST ★
 *
 * They are one Inara key or one month away, and this feature only works if they cross that line. So
 * a refusal is rendered as the next step, and the ladder is shown to everybody — the reward has to
 * be legible before anybody has earned it, or nobody starts.
 */

const MILESTONE_TEXT: Record<string, string> = {
  joined: 'Joined',
  stayed: 'Stayed a week',
  verified: 'Verified commander',
  flying: 'Scoring on a board',
  cadet: 'Made Cadet',
};

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function RecruitPanel({ status }: { status: RecruitStatus }) {
  const [link, setLink] = useState(status.link);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const mint = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      /*
       * `apiPost`, not a hand-rolled fetch. It carries the CSRF token, sends the cookies and
       * nothing else, and does the one refresh-and-retry on an expired session — none of which a
       * bespoke call here would do, and all of which this button needs.
       */
      const out = await apiPost<{ link: string }>('/v1/recruit/link');
      setLink(out.link);
    } catch (err) {
      /*
       * The HUB's sentence when there is one. The gate refusals are written to tell a member what
       * to do next — "add your Inara key and this unlocks" — and replacing that with a generic
       * failure would throw away the most useful thing this endpoint says.
       */
      setProblem(
        err instanceof ApiCallError ? err.message : 'Could not reach the hub. Check your connection.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6">
      <section className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] p-5">
        <h2 className="m-0 mb-3 font-[family-name:var(--font-display)] text-lg">Your invite</h2>

        {link !== null ? (
          <div className="flex flex-wrap items-center gap-3">
            <code className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-raised)] px-3 py-2 font-mono text-sm text-[var(--color-brand-cyan-bright)]">
              {link}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(link).then(() => {
                  setCopied(true);
                  // Reverts, because a button stuck on "Copied" tells the member nothing the second
                  // time they press it.
                  setTimeout(() => setCopied(false), 2_000);
                });
              }}
              className="rounded border border-[var(--color-brand-orange)] px-3 py-2 text-sm text-[var(--color-brand-orange-bright)] hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_12%,transparent)]"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <p className="m-0 w-full text-xs text-[var(--color-text-secondary)]">
              This link never expires and has no limit. Put it anywhere — a signature, a video
              description, a message to a friend. Everyone who joins through it is credited to you.
            </p>
          </div>
        ) : status.canMint ? (
          <div>
            <button
              type="button"
              onClick={() => void mint()}
              disabled={busy}
              className="rounded border border-[var(--color-brand-orange)] px-4 py-2 text-sm text-[var(--color-brand-orange-bright)] hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_12%,transparent)] disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create my invite link'}
            </button>
            {problem !== null ? (
              <p className="m-0 mt-2 text-sm text-[var(--color-semantic-hostile-bright)]">
                {problem}
              </p>
            ) : null}
          </div>
        ) : (
          /*
           * Not "you cannot do this". The service returns the specific next step, and this member
           * is the whole reason the feature has a growth curve — telling them off would be the one
           * way to guarantee they never come back to it.
           */
          <p className="m-0 text-sm text-[var(--color-text-secondary)]">{status.blockedBecause}</p>
        )}
      </section>

      <section>
        <h2 className="m-0 mb-3 font-[family-name:var(--font-display)] text-lg">
          What a recruit earns you
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <tbody>
              {status.ladder.map((rung) => (
                <tr key={rung.milestone}>
                  <td className="border-t border-[var(--color-border-hairline)] py-2 pr-4">
                    {MILESTONE_TEXT[rung.milestone] ?? rung.milestone}
                  </td>
                  <td className="border-t border-[var(--color-border-hairline)] py-2 text-right font-mono tabular-nums">
                    {rung.points === 0 ? (
                      /*
                       * Said out loud rather than shown as "0". A member who does not know WHY the
                       * join pays nothing will assume the tracker is broken the first time somebody
                       * arrives and their score does not move.
                       */
                      <span className="text-[var(--color-text-secondary)]">
                        nothing — anyone can walk through a door
                      </span>
                    ) : (
                      <span className="text-[var(--color-semantic-success)]">
                        +{rung.points.toLocaleString()}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="m-0 mb-3 font-[family-name:var(--font-display)] text-lg">
          Your recruits
          {status.totalPoints > 0 ? (
            <span className="ml-3 font-mono text-sm text-[var(--color-brand-cyan-bright)]">
              {status.totalPoints.toLocaleString()} pts
            </span>
          ) : null}
        </h2>

        {status.recruits.length === 0 ? (
          <p className="m-0 text-sm text-[var(--color-text-secondary)]">
            Nobody yet. Anyone who joins the Discord through your link appears here, and you are
            credited as they stay, verify, and make Cadet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr>
                  <th className="py-3 pr-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                    Commander
                  </th>
                  <th className="py-3 pr-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                    Joined
                  </th>
                  <th className="py-3 pr-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                    Progress
                  </th>
                  <th className="py-3 text-right font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                    Earned
                  </th>
                </tr>
              </thead>
              <tbody>
                {status.recruits.map((r) => (
                  <tr key={`${r.name}/${r.joinedAt}`}>
                    <td className="border-t border-[var(--color-border-hairline)] py-2.5 pr-4">
                      {r.name}
                    </td>
                    <td className="border-t border-[var(--color-border-hairline)] py-2.5 pr-4 text-[var(--color-text-secondary)]">
                      {when(r.joinedAt)}
                    </td>
                    <td className="border-t border-[var(--color-border-hairline)] py-2.5 pr-4 text-[var(--color-text-secondary)]">
                      {/* The furthest rung reached, not a list — the ladder is the story. */}
                      {MILESTONE_TEXT[r.milestones[r.milestones.length - 1] ?? 'joined'] ?? '—'}
                    </td>
                    <td className="border-t border-[var(--color-border-hairline)] py-2.5 text-right font-mono tabular-nums text-[var(--color-semantic-success)]">
                      {r.points > 0 ? `+${r.points.toLocaleString()}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
