'use client';

import { useEffect, useState } from 'react';
import type { RichDocument } from '@grims/shared';
import { RichEditor } from '../../../../../components/editor/rich-editor';
import { apiCall } from '../../../../../lib/api-client';

/**
 * Rewriting an existing post, in place.
 *
 * ★ WHY THIS EXISTS ★
 *
 * Squadron owner, 2026-07-30: "for the guides, i need to be able to edit this with the text editor
 * as the webmaster, officers too! we need to get this done! as we need to add and update the
 * processes etc".
 *
 * The guides describe a joining process that changes — Inara's flow, the Discord invite, what the
 * companion app is called this year. A guide nobody can correct is a guide that becomes wrong and
 * then becomes a support burden, so editing them is not a convenience.
 *
 * ★ THE SOURCE IS FETCHED, NOT DERIVED FROM WHAT IS ON SCREEN ★
 *
 * The page holds rendered HTML. Reconstructing a document from it would be a lossy parse of our
 * own output, and every round trip through the editor would degrade somebody's layout a little
 * more — the exact bug `doc-convert` is written to avoid.
 *
 * So the original tree is loaded when the editor opens. That also keeps it off the read path: the
 * document would otherwise ship alongside the HTML for every post to every reader, doubling the
 * page so a handful of people need not wait once.
 *
 * ★ A MARKDOWN POST OPENS AS MARKDOWN ★
 *
 * Older posts — the seeded guides, every reply written before the rich editor — have no document.
 * Loading one into the rich editor would silently convert it, which is a rewrite of somebody's
 * text they did not ask for. Those get a plain textarea, and stay Markdown until their author
 * chooses otherwise.
 */

export function PostEditor({
  postId,
  onCancel,
}: {
  readonly postId: string;
  readonly onCancel: () => void;
}) {
  const [source, setSource] = useState<
    { kind: 'doc'; doc: RichDocument } | { kind: 'md'; md: string } | null
  >(null);
  const [doc, setDoc] = useState<RichDocument | null>(null);
  const [md, setMd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void apiCall<{ bodyDoc: RichDocument | null; bodyMd: string | null }>(
      'GET',
      `/v1/forum/posts/${encodeURIComponent(postId)}/source`,
    )
      .then((res) => {
        if (!live) return;
        if (res.bodyDoc !== null) {
          setSource({ kind: 'doc', doc: res.bodyDoc });
        } else {
          setSource({ kind: 'md', md: res.bodyMd ?? '' });
          setMd(res.bodyMd ?? '');
        }
      })
      .catch((e: Error) => {
        if (live) setError(e.message);
      });
    return () => {
      // Guards against setting state after the card closed the editor mid-flight.
      live = false;
    };
  }, [postId]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiCall('PATCH', `/v1/forum/posts/${encodeURIComponent(postId)}`, {
        body: source?.kind === 'md' ? { bodyMd: md } : { bodyDoc: doc },
      });
      /*
       * A full reload rather than swapping in HTML we rendered ourselves. The server generated the
       * markup and is the authority on it; a second renderer in the browser would eventually
       * disagree with the first, and the disagreement would only show up after a save.
       */
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (error !== null && source === null) {
    return (
      <div className="rounded border border-[var(--color-border-hairline)] px-4 py-3">
        <p role="alert" className="text-sm text-[var(--color-brand-orange-bright)]">
          {error}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="mt-3 font-mono text-[11px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          CANCEL
        </button>
      </div>
    );
  }

  if (source === null) {
    return <p className="py-6 text-sm text-[var(--color-text-secondary)]">Loading the original…</p>;
  }

  const nothingToSave = source.kind === 'md' ? md.trim() === '' : doc === null;

  return (
    <div>
      {source.kind === 'doc' ? (
        <RichEditor initial={source.doc} onChange={setDoc} disabled={busy} />
      ) : (
        <>
          <textarea
            value={md}
            onChange={(e) => setMd(e.target.value)}
            disabled={busy}
            rows={14}
            aria-label="Post text"
            className="w-full rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] disabled:opacity-60"
          />
          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
            {/*
              Says WHY it looks different, so somebody who expected the toolbar knows this is the
              post's format rather than a broken editor.
            */}
            This post was written in Markdown, so it stays in Markdown — converting it would rewrite
            the original.
          </p>
        </>
      )}

      {error !== null && (
        <p role="alert" className="mt-3 text-sm text-[var(--color-brand-orange-bright)]">
          {error}
        </p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || nothingToSave}
          className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-4 py-2 text-sm text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-active)] disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="font-mono text-[11px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] disabled:opacity-50"
        >
          CANCEL
        </button>
      </div>
    </div>
  );
}
