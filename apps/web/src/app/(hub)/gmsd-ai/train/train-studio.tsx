'use client';

import { useRef, useState } from 'react';
/*
 * ★ THE SUBPATH, NOT THE BARREL ★
 *
 * This is a CLIENT component. Importing runtime values from `@grims/shared` pulls the whole barrel
 * into the browser bundle, which reaches `node:crypto` and fails the build with UnhandledSchemeError
 * — surfacing as a 500 on every hub page rather than on this one. `client-imports.spec` caught it,
 * which is exactly what it is for.
 */
import {
  MIN_DESCRIPTION_CHARS,
  MAX_DESCRIPTION_CHARS,
  MIN_TRAINING_EDGE,
  TRAINING_ACCEPT,
  isTrainableImage,
  type CategoryProgress,
} from '@grims/shared/ai-corpus';
import { apiCall } from '../../../../lib/api-client';
import { Section } from '../../../../components/hub-page';
import type { TrainingSubmission } from '../../../../lib/api';

/**
 * The uploader.
 *
 * ★ TWO REQUESTS, AND THAT IS DELIBERATE ★
 *
 * The bytes go to `/v1/media/uploads`, which is the same hardened path every other image on this
 * site takes — quota, decode, re-encode, storage. Then the OFFER goes to `/v1/ai/corpus` with the
 * description attached.
 *
 * One combined multipart endpoint would be fewer round trips and a second upload path to keep
 * correct. There is exactly one place on this site that turns member bytes into a stored image, and
 * it should stay that way.
 *
 * ★ EVERYTHING IS CHECKED BEFORE THE FILE LEAVES THE BROWSER ★
 *
 * Not as security — the server checks all of it again, and must. As courtesy: telling somebody
 * their 800px screenshot is too small after a twelve-megabyte upload on a domestic connection is a
 * worse experience than telling them instantly.
 */

/*
 * Extensions AND MIME types — see TRAINING_ACCEPT. A picker listing MIME types alone hides .jpg
 * files whose registry association reports the non-standard `image/jpg`.
 */
const ACCEPT = TRAINING_ACCEPT;

interface Draft {
  readonly file: File;
  readonly previewUrl: string;
  readonly width: number;
  readonly height: number;
  category: string;
  description: string;
  shipType: string;
  notes: string;
}

export function TrainStudio({
  categories,
  mine,
  canSubmit,
  note,
}: {
  readonly categories: readonly CategoryProgress[];
  readonly mine: readonly TrainingSubmission[];
  readonly canSubmit: boolean;
  readonly note: string;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);

  async function choose(file: File): Promise<void> {
    setError(null);

    /*
     * Judged on type OR extension. A .jpg can arrive as `image/jpg`, or with no type at all when
     * it came from an archive or a network share — and refusing a perfectly good JPEG with "that
     * file type cannot be used" is both wrong and unactionable.
     */
    if (!isTrainableImage(file)) {
      setError('That file cannot be used for training. PNG, JPG or WebP.');
      return;
    }

    /*
     * ★ DIMENSIONS FROM createImageBitmap, NOT FROM AN <img> ★
     *
     * This used to load the file into an `Image` and read `naturalWidth`. That works, and it made
     * the size check depend on the CONTENT SECURITY POLICY: an `<img>` pointed at a blob: URL is
     * subject to `img-src`, and ours did not name blob:. Every file — PNG, JPEG, WebP alike —
     * failed to load and was reported as "could not be read as an image", which sent the owner
     * looking for a problem with their .jpg files that did not exist.
     *
     * `createImageBitmap` decodes the Blob directly. No URL, no element, no policy involved. The
     * CSP is fixed as well (see csp.ts), but the check no longer depends on it having been.
     *
     * Below MIN_TRAINING_EDGE the detail that makes a hull recognisable is simply not in the file,
     * and no amount of upscaling puts it back. Refusing here saves the member the upload.
     */
    const size = await createImageBitmap(file).then(
      (bmp) => {
        const dims = { w: bmp.width, h: bmp.height };
        // Released explicitly: a decoded 4K bitmap is ~33MB, and choosing several files in a row
        // without this walks the tab into a memory ceiling.
        bmp.close();
        return dims;
      },
      () => null,
    );

    if (size === null) {
      setError('That file could not be decoded as an image. It may be corrupt.');
      return;
    }

    const previewUrl = URL.createObjectURL(file);

    if (Math.max(size.w, size.h) < MIN_TRAINING_EDGE) {
      URL.revokeObjectURL(previewUrl);
      setError(
        `That shot is ${size.w}×${size.h}. Training needs at least ${MIN_TRAINING_EDGE}px on the long edge.`,
      );
      return;
    }

    setDraft({
      file,
      previewUrl,
      width: size.w,
      height: size.h,
      category: categories[0]?.key ?? '',
      description: '',
      shipType: '',
      notes: '',
    });
  }

  function clear(): void {
    if (draft !== null) URL.revokeObjectURL(draft.previewUrl);
    setDraft(null);
    if (input.current !== null) input.current.value = '';
  }

  async function send(): Promise<void> {
    if (draft === null) return;
    setBusy(true);
    setError(null);

    try {
      // 1. The bytes, through the ordinary media pipeline.
      const upload = await apiCall<{ id: string }>('POST', '/v1/media/uploads', {
        rawBody: draft.file,
        contentType: draft.file.type,
      });
      if (upload === null) throw new Error('The upload did not complete.');

      // 2. The offer, with the description that makes it worth anything.
      await apiCall('POST', '/v1/ai/corpus', {
        body: {
          uploadId: upload.id,
          category: draft.category,
          description: draft.description,
          shipType: draft.shipType,
          notes: draft.notes,
        },
      });

      clear();
      setSent((n) => n + 1);
      /*
       * Reloaded rather than patched into state. The bars are server-rendered above this component
       * and a submission moves one of them — leaving them stale would show a member their own
       * contribution having no effect, which is the opposite of the point.
       */
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const tooShort =
    draft !== null && draft.description.trim().length < MIN_DESCRIPTION_CHARS;

  return (
    <>
      <Section
        title="Send a screenshot"
        description={`${note} Pick the category it belongs to, and say what is in it — the description is what teaches the model.`}
      >
        {!canSubmit ? (
          <p className="rounded border border-dashed border-[var(--color-border-hairline)] px-5 py-6 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            Your role cannot send training images at the moment. The bars above still show how the
            collection is going.
          </p>
        ) : draft === null ? (
          <div>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              className="block w-full text-sm text-[var(--color-text-secondary)] file:mr-4 file:rounded file:border file:border-[var(--color-border-hairline)] file:bg-[var(--color-surface-panel)] file:px-4 file:py-2 file:text-sm file:text-[var(--color-text-primary)] hover:file:bg-[var(--color-surface-panel-hover)]"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f !== undefined) void choose(f);
              }}
            />
            {sent > 0 && (
              <p className="mt-3 font-mono text-[11px] text-[var(--color-semantic-success)]">
                Thank you — {sent} sent this session.
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,20rem)_1fr]">
            <div>
              {/*
                A plain <img>, not next/image: the source is an object URL for a file that has not
                left the browser. There is no remote host to optimise and no URL the optimiser
                could fetch.
              */}
              <img
                src={draft.previewUrl}
                alt=""
                className="w-full rounded border border-[var(--color-border-hairline)]"
              />
              <p className="mt-2 font-mono text-[11px] text-[var(--color-text-secondary)]">
                {draft.width}×{draft.height}
              </p>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                  Category
                </span>
                <select
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  className="mt-1 w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                >
                  {categories.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label} — {c.approved}/{c.min}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                  What is in the shot
                </span>
                <textarea
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value.slice(0, MAX_DESCRIPTION_CHARS) })
                  }
                  rows={3}
                  placeholder="Krait Mk II, exterior, docked at an orbis starport, night side"
                  className="mt-1 w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                />
                <span
                  className={`font-mono text-[11px] ${
                    tooShort
                      ? 'text-[var(--color-text-secondary)]'
                      : 'text-[var(--color-semantic-success)]'
                  }`}
                >
                  {draft.description.trim().length}/{MIN_DESCRIPTION_CHARS} minimum ·{' '}
                  {MAX_DESCRIPTION_CHARS - draft.description.length} left
                </span>
              </label>

              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                  Ship in the shot
                </span>
                <input
                  value={draft.shipType}
                  onChange={(e) => setDraft({ ...draft, shipType: e.target.value.slice(0, 120) })}
                  placeholder="Krait Mk II — leave blank and we read it from your journal"
                  className="mt-1 w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                />
                <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
                  {/*
                    Said plainly, because a field that fills itself is unnerving when nobody
                    explained it — and because the journal cannot see a shot of somebody else's
                    ship, which is exactly when a member needs to type one.
                  */}
                  Optional. Blank is fine — your companion app usually knows.
                </span>
              </label>

              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                  Anything else worth knowing
                </span>
                <input
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value.slice(0, MAX_DESCRIPTION_CHARS) })}
                  placeholder="System, station, what was happening — optional"
                  className="mt-1 w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                />
              </label>

              {error !== null && (
                <p className="font-mono text-[11px] text-[var(--color-semantic-hostile-bright)]">
                  {error}
                </p>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={busy || tooShort}
                  onClick={() => void send()}
                  className="rounded border border-[var(--color-brand-orange)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-orange-bright)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-orange)_12%,transparent)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? 'Sending…' : 'Send it'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={clear}
                  className="rounded border border-[var(--color-border-hairline)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {error !== null && draft === null && (
          <p className="mt-3 font-mono text-[11px] text-[var(--color-semantic-hostile-bright)]">
            {error}
          </p>
        )}
      </Section>

      {mine.length > 0 && (
        <Section
          title="What you have sent"
          description="Withdrawing removes an image from future training. It cannot remove it from a model already trained — that is how the weights work, not a policy choice."
        >
          <ul className="m-0 list-none space-y-2 p-0">
            {mine.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-[var(--color-text-primary)]">
                    {s.description}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
                    {s.category} · {s.state}
                    {/*
                      The reason, when there is one. A rejection with no reason teaches nothing and
                      the member sends the same thing again.
                    */}
                    {s.reviewNote !== null && ` — ${s.reviewNote}`}
                  </span>
                </span>

                {(s.state === 'pending' || s.state === 'approved') && (
                  <button
                    type="button"
                    onClick={() => {
                      void apiCall('DELETE', `/v1/ai/corpus/${encodeURIComponent(s.id)}`).then(() =>
                        window.location.reload(),
                      );
                    }}
                    className="font-mono text-[11px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-semantic-hostile-bright)]"
                  >
                    Withdraw
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
