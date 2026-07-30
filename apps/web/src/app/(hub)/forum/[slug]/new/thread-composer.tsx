'use client';

import { useState } from 'react';
import type { RichDocument } from '@grims/shared';
import { RichEditor } from '../../../../../components/editor/rich-editor';
import { apiPost } from '../../../../../lib/api-client';

/**
 * Starting a thread.
 *
 * ★ THIS SCREEN DID NOT EXIST, AND THAT WAS THE BUG ★
 *
 * The rich editor was mounted only on the REPLY composer, so there was no way to start a thread at
 * all — and the API's `createThread` took a title with no body, producing a thread with no posts.
 * Neither was visible in testing precisely because they depended on each other: nothing called the
 * endpoint, so nothing produced an empty thread to notice.
 *
 * The owner found it by trying to write a post and discovering there was nowhere to do it.
 *
 * ★ TITLE AND BODY GO UP TOGETHER ★
 *
 * One request creates both, because a thread IS its opening post. Two requests would mean a title
 * that exists while its body is still in flight — and a failure between them leaves an empty thread
 * on the board with the member's words lost in a form they have already navigated away from.
 */
export function ThreadComposer({ categorySlug }: { readonly categorySlug: string }) {
  const [title, setTitle] = useState('');
  const [doc, setDoc] = useState<RichDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleOk = title.trim().length >= 3 && title.trim().length <= 200;

  async function submit() {
    if (!titleOk || doc === null) return;
    setBusy(true);
    setError(null);
    try {
      const created = await apiPost<{ id: string; slug: string }>(
        `/v1/forum/categories/${encodeURIComponent(categorySlug)}/threads`,
        { title: title.trim(), bodyDoc: doc },
      );
      /*
       * Straight to the new thread. A redirect back to the board would make somebody hunt for what
       * they just wrote, and the server has already told us its slug.
       */
      window.location.href = `/forum/${categorySlug}/${created.slug}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="thread-title"
          className="block text-sm font-medium text-[var(--color-text-primary)]"
        >
          Title
        </label>
        <input
          id="thread-title"
          type="text"
          value={title}
          maxLength={200}
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What is this thread about?"
          className="mt-2 w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-3 py-2 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] disabled:opacity-60"
        />
        {/*
          The limit is shown as it is approached rather than enforced silently by maxLength. A field
          that simply stops accepting characters reads as a broken keyboard.
        */}
        {title.length > 150 && (
          <p className="mt-1 font-mono text-[11px] text-[var(--color-text-secondary)]">
            {200 - title.length} characters left
          </p>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">Opening post</p>
        <RichEditor
          onChange={setDoc}
          disabled={busy}
          placeholder="Write the first post. Use the toolbar for headings, images and video."
        />
      </div>

      {error !== null && (
        <p role="alert" className="text-sm text-[var(--color-brand-orange-bright)]">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !titleOk || doc === null}
          className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-4 py-2 text-sm text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-active)] disabled:opacity-50"
        >
          {busy ? 'Posting…' : 'Start the thread'}
        </button>

        {/*
          Says WHICH part is missing rather than leaving a disabled button unexplained. A control
          that cannot be pressed and does not say why is the most common small cruelty in a form.
        */}
        {!busy && (!titleOk || doc === null) && (
          <span className="text-xs text-[var(--color-text-secondary)]">
            {!titleOk && doc === null
              ? 'Needs a title and an opening post.'
              : !titleOk
                ? title.trim().length === 0
                  ? 'Needs a title.'
                  : 'A title is between 3 and 200 characters.'
                : 'Write the opening post.'}
          </span>
        )}

        <a
          href={`/forum/${categorySlug}`}
          className="ml-auto font-mono text-xs tracking-[0.2em] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          CANCEL
        </a>
      </div>
    </div>
  );
}
