'use client';

import { useState } from 'react';
import type { RichDocument } from '@grims/shared';
import { RichEditor } from '../../../../../components/editor/rich-editor';
import { apiPost } from '../../../../../lib/api-client';

/**
 * Writing a reply, with the rich editor.
 *
 * ★ WHY THE EDITOR IS HERE AND NOT ONLY ON GUIDES ★
 *
 * Owner chose that every member gets it, not just officers. That decision is safe because of where
 * the safety lives: the server accepts a validated node tree and generates the HTML itself, so a
 * member cannot supply markup at all. The editor being open to everybody adds upload volume and
 * moderation surface — both real — but it does not add an injection surface.
 *
 * ★ THE DOCUMENT IS THE ONLY THING SENT ★
 *
 * No HTML crosses the wire. `bodyDoc` goes up, the server validates and renders, and the reply
 * comes back as HTML the server produced. There is deliberately no path where a client-supplied
 * string becomes page markup.
 */
export function ReplyComposer({
  threadId,
  locked,
  canPost,
  replyTo = null,
  onClearReplyTo,
  insert,
}: {
  readonly threadId: string;
  readonly locked: boolean;
  readonly canPost: boolean;
  /**
   * The post being answered, when the reader picked one.
   *
   * A reply with no target is still a reply to the THREAD — that is the common case and needs no
   * ceremony. Naming a target only matters when a thread has several conversations in it, which
   * is exactly when a reader cannot tell what a bare reply is answering.
   */
  readonly replyTo?: { postId: string; displayName: string } | null;
  readonly onClearReplyTo?: () => void;
  readonly insert?: { nonce: number; doc: RichDocument };
}) {
  const [doc, setDoc] = useState<RichDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * A locked thread or no posting permission means no composer at all, rather than a disabled one.
   * A greyed-out box invites somebody to work out how to enable it; an explanation of why it is not
   * there answers the question instead. The server re-checks both regardless.
   */
  if (locked) {
    return (
      <div className="mt-10 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3">
        <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
          This thread is read-only. If you are stuck on a step or something here is wrong, post in
          the help board — somebody will see it there.
        </p>
      </div>
    );
  }

  if (!canPost) {
    return (
      <div className="mt-10 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3">
        <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
          You can read this board but not post in it.
        </p>
      </div>
    );
  }

  async function submit() {
    if (doc === null) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/v1/forum/threads/${encodeURIComponent(threadId)}/posts`, {
        bodyDoc: doc,
        /*
         * Omitted, not sent as null, when replying to the thread at large. The server treats an
         * absent target as "the thread"; sending null would make it validate a field that means
         * the same thing as not sending one.
         */
        ...(replyTo === null ? {} : { replyToId: replyTo.postId }),
      });
      /*
       * A full reload rather than appending the new post to local state. The server generated the
       * HTML, so it is the authority on what the reply looks like — rendering our own guess would
       * be a second renderer that could disagree with it. The thread page is server-rendered, so a
       * reload is the cheapest way to be correct.
       */
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mt-10">
      <h2 className="mb-3 font-mono text-xs tracking-[0.3em] text-[var(--color-text-secondary)]">
        REPLY
      </h2>

      {replyTo !== null && (
        /*
         * Shown WITH a way out. A reply target set by a click three screens up is invisible by the
         * time somebody starts typing, and a reply that silently threads under the wrong post is
         * how a conversation stops making sense.
         */
        <div className="mb-3 flex items-center justify-between gap-3 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-3 py-2">
          <span className="text-xs text-[var(--color-text-secondary)]">
            Replying to <span className="text-[var(--color-text-primary)]">{replyTo.displayName}</span>
          </span>
          <button
            type="button"
            onClick={onClearReplyTo}
            className="font-mono text-[11px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            CLEAR
          </button>
        </div>
      )}

      <RichEditor
        onChange={setDoc}
        disabled={busy}
        placeholder="Write a reply. Use the toolbar for headings, images and video."
        {...(insert === undefined ? {} : { insert })}
      />

      {error !== null && (
        <p role="alert" className="mt-3 text-sm text-[var(--color-brand-orange-bright)]">
          {error}
        </p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void submit()}
          // Disabled on an EMPTY document, which `toDocument` reports as null — the same rule the
          // server applies, so the button cannot offer to send something that will be refused.
          disabled={busy || doc === null}
          className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-4 py-2 text-sm text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-active)] disabled:opacity-50"
        >
          {busy ? 'Posting…' : 'Post reply'}
        </button>
        {doc === null && (
          <span className="text-xs text-[var(--color-text-secondary)]">Write something first.</span>
        )}
      </div>
    </div>
  );
}
