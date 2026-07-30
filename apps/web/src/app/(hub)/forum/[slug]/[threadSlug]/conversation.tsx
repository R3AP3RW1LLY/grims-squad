'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { RichDocument, SignatureView } from '@grims/shared';
import type { HubPost } from '../../../../../lib/api';
import { formatLocal } from '../../../../../lib/time';
import { Avatar } from '../../../../../components/forum/identity';
import { ReplyComposer } from './reply-composer';
import { PostEditor } from './post-editor';
import { SignatureBlock } from '../../../../../components/forum/signature-block';
import type { BannerIdentity } from '../../../../../components/forum/banner-render';
import { apiCall } from '../../../../../lib/api-client';

/**
 * The conversation: every post, and the box you answer in.
 *
 * ★ WHY POSTS AND COMPOSER ARE ONE COMPONENT ★
 *
 * Because "Reply to this post" and "Quote this post" are messages FROM a post TO the composer.
 * Split across a server-rendered list and an island composer, that message has nowhere to travel
 * without a store or a custom event — both of which are ways of writing state that React already
 * models directly.
 *
 * The posts still arrive fully rendered from the server; this component re-renders them, but their
 * bodies are the same pre-sanitised HTML (INV-035), untouched.
 *
 * ★ QUOTING READS THE PAGE, NOT THE DATABASE ★
 *
 * A quote is built from the post's rendered TEXT, taken from the DOM. That is deliberate: the only
 * unrendered copy we hold is `bodyMd`, the author's unsanitised input, and the read path does not
 * ship it. Reading `textContent` gets exactly what the reader can see, already stripped of markup
 * by the browser — so a quote can never smuggle anything back in.
 */

/** How much of a post a quote carries before it is cut. */
const QUOTE_LIMIT = 600;

export function Conversation({
  posts,
  viewerTz,
  threadId,
  locked,
  canPost,
  canMarkSolution,
  boardSlug,
  threadSlug,
  signatures,
  identities,
}: {
  readonly posts: readonly HubPost[];
  readonly viewerTz: string;
  readonly threadId: string;
  readonly locked: boolean;
  readonly canPost: boolean;
  /** Whether this caller may mark the answer. Server-decided; re-checked on write. */
  readonly canMarkSolution: boolean;
  readonly boardSlug: string;
  readonly threadSlug: string;
  /** Keyed by author id. Absent means the member has none, or turned theirs off. */
  readonly signatures: Record<string, SignatureView>;
  /** What each author's banner layers resolve to. Without it every sourced layer draws empty. */
  readonly identities: Record<string, BannerIdentity>;
}) {
  const [replyTo, setReplyTo] = useState<{ postId: string; displayName: string } | null>(null);
  const [insert, setInsert] = useState<{ nonce: number; doc: RichDocument } | undefined>(undefined);
  const nonce = useRef(0);
  const bodies = useRef(new Map<string, HTMLDivElement | null>());

  /*
   * ★ THE ANSWER FLOATS, THE REST STAY IN ORDER ★
   *
   * Only the marked answer moves. Sorting by anything else — score, recency — would mean a reader
   * cannot follow the conversation, because reply three would sit above the reply it answers.
   * A forum is a transcript first and a ranking second.
   *
   * The floated post keeps its original position too, so the thread still reads straight through;
   * `pinned` below renders a COPY at the top rather than removing it from the sequence.
   */
  const solution = useMemo(() => posts.find((p) => p.isSolution) ?? null, [posts]);

  const quote = useCallback(
    (post: HubPost) => {
      const text = (bodies.current.get(post.id)?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const clipped = text.length > QUOTE_LIMIT ? `${text.slice(0, QUOTE_LIMIT).trimEnd()}…` : text;

      nonce.current += 1;
      setInsert({
        nonce: nonce.current,
        doc: {
          version: 1,
          content: [
            {
              type: 'blockquote',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: `${post.author.displayName} wrote:`, marks: [{ type: 'italic' }] },
                  ],
                },
                { type: 'paragraph', content: [{ type: 'text', text: clipped }] },
              ],
            },
            // An empty paragraph after the quote, so the caret lands somewhere you can type.
            { type: 'paragraph' },
          ],
        },
      });
      setReplyTo({ postId: post.id, displayName: post.author.displayName });
    },
    [],
  );

  return (
    <>
      {solution !== null && (
        <div className="mb-8">
          <h2 className="mb-2 font-mono text-xs tracking-[0.3em] text-[var(--color-brand-cyan-bright)]">
            ANSWERED
          </h2>
          <PostCard
            post={solution}
            viewerTz={viewerTz}
            boardSlug={boardSlug}
            threadSlug={threadSlug}
            canPost={canPost && !locked}
            canMarkSolution={canMarkSolution}
            onReply={setReplyTo}
            onQuote={quote}
            registerBody={() => undefined}
            {...(signatures[solution.authorId] === undefined
              ? {}
              : { signature: signatures[solution.authorId] })}
            {...(identities[solution.authorId] === undefined
              ? {}
              : { identity: identities[solution.authorId] })}
            /* A copy, floated for scanning. The original stays in sequence below. */
            floated
          />
        </div>
      )}

      <div className="space-y-6">
        {posts.map((post, i) => (
          <PostCard
            key={post.id}
            post={post}
            index={i + 1}
            viewerTz={viewerTz}
            boardSlug={boardSlug}
            threadSlug={threadSlug}
            canPost={canPost && !locked}
            canMarkSolution={canMarkSolution && i > 0}
            onReply={setReplyTo}
            onQuote={quote}
            registerBody={(el) => bodies.current.set(post.id, el)}
            {...(signatures[post.authorId] === undefined
              ? {}
              : { signature: signatures[post.authorId] })}
            {...(identities[post.authorId] === undefined
              ? {}
              : { identity: identities[post.authorId] })}
          />
        ))}
      </div>

      <ReplyComposer
        threadId={threadId}
        locked={locked}
        canPost={canPost}
        replyTo={replyTo}
        onClearReplyTo={() => setReplyTo(null)}
        {...(insert === undefined ? {} : { insert })}
      />
    </>
  );
}

function PostCard({
  post,
  index,
  viewerTz,
  boardSlug,
  threadSlug,
  canPost,
  canMarkSolution,
  onReply,
  onQuote,
  registerBody,
  signature,
  identity,
  floated = false,
}: {
  readonly post: HubPost;
  readonly index?: number;
  readonly viewerTz: string;
  readonly boardSlug: string;
  readonly threadSlug: string;
  readonly canPost: boolean;
  readonly canMarkSolution: boolean;
  readonly onReply: (r: { postId: string; displayName: string }) => void;
  readonly onQuote: (p: HubPost) => void;
  readonly registerBody: (el: HTMLDivElement | null) => void;
  readonly signature?: SignatureView;
  readonly identity?: BannerIdentity;
  readonly floated?: boolean;
}) {
  const [reactions, setReactions] = useState(post.reactions);
  const [solution, setSolution] = useState(post.isSolution);
  const [editing, setEditing] = useState(false);

  async function react(emoji: string) {
    /*
     * Optimistic, then corrected by the server's tally. A reaction that waits for a round trip
     * feels broken, and the correction is invisible when it agrees — which is almost always.
     */
    setReactions((current) => {
      const existing = current.find((r) => r.emoji === emoji);
      if (existing === undefined) return [...current, { emoji, count: 1, mine: true }];
      return current
        .map((r) =>
          r.emoji === emoji ? { ...r, mine: !r.mine, count: r.count + (r.mine ? -1 : 1) } : r,
        )
        .filter((r) => r.count > 0 || r.mine);
    });
    try {
      const res = await apiCall<{ reactions: typeof reactions }>(
        'POST',
        `/v1/forum/posts/${encodeURIComponent(post.id)}/reactions`,
        { body: { emoji } },
      );
      if (res?.reactions !== undefined) setReactions(res.reactions);
    } catch {
      // Left as-is. Re-fetching to undo would make a failed reaction flicker twice.
    }
  }

  async function toggleSolution() {
    const next = !solution;
    setSolution(next);
    try {
      await apiCall(
        'PUT',
        `/v1/forum/categories/${encodeURIComponent(boardSlug)}/threads/${encodeURIComponent(threadSlug)}/posts/${encodeURIComponent(post.id)}/solution`,
        { body: { solution: next } },
      );
      // A thread holds one answer, so marking a new one un-marks another card this component
      // does not own. Reloading is the honest way to show that without inventing a store.
      window.location.reload();
    } catch {
      setSolution(!next);
    }
  }

  return (
    <article
      {...(floated ? {} : { id: `post-${index ?? 1}` })}
      className={`scroll-mt-24 rounded border bg-[var(--color-surface-panel)] p-5 ${
        solution
          ? 'border-[var(--color-brand-cyan-bright)]'
          : 'border-[var(--color-border-hairline)]'
      }`}
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-hairline)] pb-3">
        <span className="flex items-center gap-3">
          {/*
            The SIGNATURE avatar wins on the forum, which is the whole point of it existing:
            "the avatar upload should only be displayed on the forums and not replace their global
            avatar that discord imports". Falls back to the Discord one, which is the default.
          */}
          <Avatar
            identity={
              signature?.avatarUrl === undefined || signature.avatarUrl === null
                ? post.author
                : { ...post.author, avatarUrl: signature.avatarUrl }
            }
            size="md"
          />
          <span>
            <span className="block text-sm text-[var(--color-text-primary)]">
              {post.author.displayName}
            </span>
            <span className="block font-mono text-[11px] text-[var(--color-text-secondary)]">
              {formatLocal(post.createdAt, viewerTz)}
              {post.editedAt !== null && ' · edited'}
            </span>
          </span>
        </span>

        {post.replyTo !== null && (
          /*
           * WHO, and a jump. Not an excerpt — the parent is on the same page, and a preview would
           * mean shipping post text twice for something one click away.
           */
          <a
            href={`#post-anchor-${post.replyTo.postId}`}
            className="font-mono text-[11px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            ↑ in reply to {post.replyTo.author.displayName}
          </a>
        )}
      </header>

      <span id={`post-anchor-${post.id}`} className="sr-only" />

      {editing ? (
        /*
         * Replaces the body IN PLACE rather than opening a separate page. A guide is edited while
         * reading it — "this step is out of date" happens with the step on screen, and sending
         * somebody to another route to fix it loses the thing they were looking at.
         */
        <PostEditor postId={post.id} onCancel={() => setEditing(false)} />
      ) : (
        <div
          ref={registerBody}
          /* Same scoped prose styling as the public guides, on existing tokens. */
          className="guide-prose"
          dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
        />
      )}

      {signature !== undefined && !editing && (
        <SignatureBlock signature={signature} {...(identity === undefined ? {} : { who: identity })} />
      )}

      <footer className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-border-hairline)] pt-3">
        {reactions.map((r) => (
          <button
            key={r.emoji}
            type="button"
            onClick={() => void react(r.emoji)}
            aria-pressed={r.mine}
            className={`rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors ${
              r.mine
                ? 'border-[var(--color-border-active)] bg-[var(--color-surface-panel-hover)] text-[var(--color-text-primary)]'
                : 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {r.emoji} {r.count}
          </button>
        ))}

        {post.canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="font-mono text-[11px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            Edit
          </button>
        )}

        {canPost && (
          <span className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => void react('👍')}
              className="font-mono text-[11px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              👍 Upvote
            </button>
            <button
              type="button"
              onClick={() => onQuote(post)}
              className="font-mono text-[11px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              Quote
            </button>
            <button
              type="button"
              onClick={() => onReply({ postId: post.id, displayName: post.author.displayName })}
              className="font-mono text-[11px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              Reply
            </button>
          </span>
        )}

        {canMarkSolution && !floated && (
          <button
            type="button"
            onClick={() => void toggleSolution()}
            aria-pressed={solution}
            className={`rounded border px-2 py-0.5 font-mono text-[11px] transition-colors ${
              solution
                ? 'border-[var(--color-brand-cyan-bright)] text-[var(--color-brand-cyan-bright)]'
                : 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {solution ? '✓ Answer' : 'Mark as answer'}
          </button>
        )}
      </footer>
    </article>
  );
}
