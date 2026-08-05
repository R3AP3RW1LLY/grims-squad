'use client';

import { useState } from 'react';
import { apiGet, apiPost } from '../../../lib/api-client';
import type { SuggestionInboxRow } from '../../../lib/api';
import { formatLocal } from '../../../lib/time';

/**
 * The webmaster's suggestion inbox — the reviewing side of the box.
 *
 * ★ ONE QUEUE, TWO VERDICTS ★
 *
 * Every row is a member's idea, oldest first, worn with their identity — the owner's design
 * routes these to the webmaster, and the two buttons are the whole workflow: PUBLISH turns it
 * into a Feature Requests thread the squadron votes on (credited to the sender), DECLINE
 * records the review and tells them kindly. Either way the row leaves the queue and the sender
 * hears personally.
 *
 * Times are absolute and in the WEBMASTER's stored timezone (INV-025) — a queue is worked
 * against a clock, and "4m ago" hides the idea that has been waiting since Tuesday.
 */

/** What the last verdict did, shown where the row was — the click deserves an answer. */
interface Verdict {
  readonly kind: 'published' | 'held' | 'declined';
  readonly threadLink: string | null;
}

export function Suggestions({
  initial,
  viewerTz,
}: {
  readonly initial: readonly SuggestionInboxRow[];
  readonly viewerTz: string;
}) {
  const [rows, setRows] = useState<readonly SuggestionInboxRow[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const reload = (): void => {
    apiGet<{ suggestions: SuggestionInboxRow[] }>('/v1/suggestions/inbox')
      .then((r) => setRows(r.suggestions))
      .catch(() => {
        // A transient miss must not blank the queue; the next verdict reloads it again.
      });
  };

  const act = (id: string, run: () => Promise<Verdict>): void => {
    setBusyId(id);
    setProblem(null);
    run()
      .then((v) => {
        setVerdict(v);
        reload();
      })
      .catch((err: unknown) => {
        // The server's own sentence — "a colleague reviewed this" is actionable, and reloading
        // shows the queue they acted on.
        setProblem(err instanceof Error ? err.message : 'That did not go through.');
        reload();
      })
      .finally(() => setBusyId(null));
  };

  const publish = (id: string): void =>
    act(id, async () => {
      const r = await apiPost<{ threadLink: string; held: boolean }>(
        `/v1/suggestions/inbox/${id}/publish`,
      );
      return { kind: r.held ? 'held' : 'published', threadLink: r.held ? null : r.threadLink };
    });

  const decline = (id: string): void =>
    act(id, async () => {
      await apiPost(`/v1/suggestions/inbox/${id}/decline`);
      return { kind: 'declined', threadLink: null };
    });

  return (
    <div className="space-y-4">
      {problem !== null && (
        <p
          role="alert"
          className="rounded border border-[var(--color-brand-orange)] px-4 py-3 text-sm text-[var(--color-brand-orange)]"
        >
          {problem}
        </p>
      )}

      {verdict !== null && (
        <p
          role="status"
          className="rounded border border-[var(--color-border-hairline)] px-4 py-3 text-sm text-[var(--color-text-secondary)]"
        >
          {verdict.kind === 'published' && verdict.threadLink !== null ? (
            <>
              Published — the sender has been told.{' '}
              <a
                href={verdict.threadLink}
                className="text-[var(--color-brand-cyan-bright)] underline-offset-2 hover:underline"
              >
                Open the thread
              </a>
              .
            </>
          ) : verdict.kind === 'held' ? (
            'Published, but screening HELD the opening post — release it in the moderation queue. The sender has not been told yet; the bell rings when the post is visible.'
          ) : (
            'Declined — the sender has been told, kindly.'
          )}
        </p>
      )}

      {rows.length === 0 ? (
        <section className="rounded border border-[var(--color-border-hairline)] p-8 text-center">
          <p className="text-lg text-[var(--color-text-primary)]">The inbox is empty.</p>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            Members send ideas from the Help &amp; Support widget&rsquo;s suggestion view. Each
            one lands here for your verdict.
          </p>
        </section>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded border border-[var(--color-border-hairline)] p-4"
            >
              <p className="flex flex-wrap items-center gap-2 font-mono text-xs text-[var(--color-text-secondary)]">
                <img
                  src={`/v1/media/avatars/${row.sender.id}`}
                  alt=""
                  className="h-5 w-5 rounded-full object-cover"
                  onError={(e) => {
                    // No stored avatar answers 404 by design; the name still identifies them.
                    e.currentTarget.style.display = 'none';
                  }}
                />
                <span className="text-[var(--color-text-primary)]">{row.sender.displayName}</span>
                · {formatLocal(row.createdAt, viewerTz)}
              </p>
              <p className="mt-2 text-sm whitespace-pre-wrap text-[var(--color-text-primary)]">
                {row.body}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => publish(row.id)}
                  className="rounded border border-[var(--color-brand-cyan-bright)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] disabled:opacity-50"
                >
                  {busyId === row.id ? 'Working…' : 'Publish for a vote'}
                </button>
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => decline(row.id)}
                  className="rounded border border-[var(--color-border-hairline)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                >
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
