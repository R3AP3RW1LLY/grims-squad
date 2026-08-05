'use client';

import { useState } from 'react';
import { apiGet, apiPost } from '../../../lib/api-client';
import type { QueuedTrainingImage } from '../../../lib/api';
import { formatLocal } from '../../../lib/time';

/**
 * Approving the screenshots members offer for training.
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * "where do admins approve images that are submitted on the /gmsd-ai/train page? i can not find it
 * at all and we need this working! ... we have images waiting to be approved!"
 *
 * They could not find it because it did not exist. The permission existed — `AI_TRAINING`, whose
 * own definition reads "webmaster + AI_TRAINING holders approve". The schema existed, down to
 * `reviewNote`, `reviewedBy`, `reviewedAt` and an index commented "the review queue: everything
 * waiting, oldest first". The uploader promised members an officer would look. The only missing
 * piece was somewhere to look FROM, so every submission sat in `pending` where nothing could list
 * it.
 *
 * ★ THE PICTURE IS THE POINT ★
 *
 * A row of captions with no images would be unreviewable: the entire judgement is whether the
 * description matches what is in frame, and a caption reading "Krait Mk II docked at an orbis, night
 * side" is either exactly right or completely wrong depending on a picture you have to see. So each
 * row leads with the image at a size you can actually judge, and the caption sits beside it.
 *
 * ★ WHY A REJECTION MAKES YOU TYPE ★
 *
 * The schema said it first: "a rejection with no reason teaches them nothing and they will submit
 * the same thing again". The API refuses a rejection without a note, and this asks for it inline
 * rather than behind a modal — the reason is written while looking at the picture it is about.
 * Approving needs no note and does not ask for one; there is nothing to explain about yes.
 *
 * Times are absolute and in the REVIEWER's stored timezone (INV-025). A queue worked oldest-first
 * is worked against a clock, and "3d ago" hides the submission that has been waiting since the
 * launch.
 */

/** What the last decision did, shown where the row was — the click deserves an answer. */
interface Verdict {
  readonly kind: 'approved' | 'rejected';
  readonly who: string;
}

export function TrainingImages({
  initial,
  viewerTz,
}: {
  readonly initial: readonly QueuedTrainingImage[];
  readonly viewerTz: string;
}) {
  const [rows, setRows] = useState<readonly QueuedTrainingImage[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  /** Per-row rejection reasons, kept while the reviewer types. */
  const [notes, setNotes] = useState<Record<string, string>>({});

  const reload = (): void => {
    apiGet<{ queue: QueuedTrainingImage[] }>('/v1/ai/corpus/queue')
      .then((r) => setRows(r.queue))
      .catch(() => {
        // A transient miss must not blank the queue; the next decision reloads it again.
      });
  };

  const decide = (row: QueuedTrainingImage, decision: 'approved' | 'rejected'): void => {
    const note = (notes[row.id] ?? '').trim();

    /*
     * Checked here as well as in the service. The server is the authority — but bouncing off it to
     * be told something this page already knows would cost a round trip and read as a failure
     * rather than as the form asking for one more thing.
     */
    if (decision === 'rejected' && note === '') {
      setProblem('Say why it was refused — the member is shown this, so it is how they learn.');
      return;
    }

    setBusyId(row.id);
    setProblem(null);

    apiPost(`/v1/ai/corpus/${row.id}/review`, {
      decision,
      ...(note === '' ? {} : { note }),
    })
      .then(() => {
        setVerdict({
          kind: decision,
          who: row.submittedBy.cmdrName ?? row.submittedBy.displayName,
        });
        setNotes((n) => {
          const next = { ...n };
          delete next[row.id];
          return next;
        });
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
          {verdict.kind === 'approved'
            ? `Approved — it joins the pool for the next training run, and ${verdict.who} can see it was accepted.`
            : `Refused — ${verdict.who} is shown the reason you gave.`}
        </p>
      )}

      {rows.length === 0 ? (
        <section className="rounded border border-[var(--color-border-hairline)] p-8 text-center">
          <p className="text-lg text-[var(--color-text-primary)]">Nothing is waiting.</p>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            Members offer screenshots from{' '}
            <a
              href="/gmsd-ai/train"
              className="text-[var(--color-brand-cyan-bright)] underline-offset-2 hover:underline"
            >
              Help Train the Bot
            </a>
            . Each one lands here, oldest first, for your verdict.
          </p>
        </section>
      ) : (
        <ul className="space-y-4">
          {rows.map((row) => {
            const who = row.submittedBy.cmdrName ?? row.submittedBy.displayName;
            return (
              <li
                key={row.id}
                className="rounded border border-[var(--color-border-hairline)] p-4"
              >
                <div className="flex flex-col gap-4 md:flex-row">
                  {/*
                    A plain <img>, not next/image: the source is an API route serving stored bytes
                    behind a UUID, and the optimiser has nothing to add to an image shown once in a
                    review queue.
                  */}
                  <img
                    src={`/v1/media/uploads/${row.uploadId}`}
                    alt={row.description}
                    className="w-full rounded border border-[var(--color-border-hairline)] object-contain md:max-w-[22rem]"
                  />

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-mono text-xs text-[var(--color-text-secondary)]">
                      <span className="text-[var(--color-text-primary)]">{who}</span>·{' '}
                      {formatLocal(row.createdAt, viewerTz)}
                    </p>

                    <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]">
                      {row.category}
                      {row.shipType === null ? null : ` · ${row.shipType}`}
                    </p>

                    <p className="mt-2 text-sm whitespace-pre-wrap text-[var(--color-text-primary)]">
                      {row.description}
                    </p>

                    {row.notes === null || row.notes.trim() === '' ? null : (
                      <p className="mt-2 text-sm whitespace-pre-wrap text-[var(--color-text-secondary)]">
                        {row.notes}
                      </p>
                    )}

                    <label
                      htmlFor={`reject-note-${row.id}`}
                      className="mt-4 block text-xs text-[var(--color-text-secondary)]"
                    >
                      Reason, if you refuse it — the member is shown this
                    </label>
                    <input
                      id={`reject-note-${row.id}`}
                      value={notes[row.id] ?? ''}
                      onChange={(e) =>
                        setNotes((n) => ({ ...n, [row.id]: e.currentTarget.value }))
                      }
                      placeholder="e.g. the caption describes a different ship"
                      className="mt-1 w-full rounded border border-[var(--color-border-hairline)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-brand-cyan-bright)]"
                    />

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => decide(row, 'approved')}
                        className="rounded border border-[var(--color-brand-cyan-bright)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)] disabled:opacity-50"
                      >
                        {busyId === row.id ? 'Working…' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => decide(row, 'rejected')}
                        className="rounded border border-[var(--color-border-hairline)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                      >
                        Refuse
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
