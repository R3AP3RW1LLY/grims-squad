'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { BadgeDisplay, RichDocument, SignatureView } from '@grims/shared';
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
  canReply,
  canMarkSolution,
  boardSlug,
  threadSlug,
  signatures,
  identities,
  badges,
}: {
  readonly posts: readonly HubPost[];
  readonly viewerTz: string;
  readonly threadId: string;
  readonly locked: boolean;
  /**
   * Whether this caller may REPLY here — the server's `canReply`, which follows the
   * category's `reply_perm` and falls back to `post_perm`. Distinct from starting a thread:
   * on Feature Requests members reply and vote while creation stays the publish flow's.
   */
  readonly canReply: boolean;
  /** Whether this caller may mark the answer. Server-decided; re-checked on write. */
  readonly canMarkSolution: boolean;
  readonly boardSlug: string;
  readonly threadSlug: string;
  /** Keyed by author id. Absent means the member has none, or turned theirs off. */
  readonly signatures: Record<string, SignatureView>;
  /** What each author's banner layers resolve to. Without it every sourced layer draws empty. */
  readonly identities: Record<string, BannerIdentity>;
  /**
   * Up to three showcased badges per author, keyed by author id like the signatures. Already
   * resolved to display data by the page — the catalogue lookup cannot run in a client bundle
   * (see the note there), and unknown keys have already been dropped.
   */
  readonly badges: Record<string, BadgeDisplay[]>;
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
            canReply={canReply && !locked}
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
            badges={badges[solution.authorId] ?? []}
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
            canReply={canReply && !locked}
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
            badges={badges[post.authorId] ?? []}
          />
        ))}
      </div>

      <ReplyComposer
        threadId={threadId}
        locked={locked}
        canReply={canReply}
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
  canReply,
  canMarkSolution,
  onReply,
  onQuote,
  registerBody,
  signature,
  identity,
  badges,
  floated = false,
}: {
  readonly post: HubPost;
  readonly index?: number;
  readonly viewerTz: string;
  readonly boardSlug: string;
  readonly threadSlug: string;
  /** Whether the reader may reply/interact here — the vote rail and reply buttons follow it. */
  readonly canReply: boolean;
  readonly canMarkSolution: boolean;
  readonly onReply: (r: { postId: string; displayName: string }) => void;
  readonly onQuote: (p: HubPost) => void;
  readonly registerBody: (el: HTMLDivElement | null) => void;
  readonly signature?: SignatureView;
  readonly identity?: BannerIdentity;
  /** This author's showcased badges, already resolved and capped. Empty renders nothing. */
  readonly badges: readonly BadgeDisplay[];
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
      /*
       * ★ A LEFT RAIL, LIKE STACK OVERFLOW — squadron owner, 2026-08-01 ★
       *
       * "position the up / down vote buttons and the checkmark icon stacked on the left side of the
       * post."
       *
       * The rail runs the full height of the card rather than sitting inside the body, so the score
       * stays beside a long post while it is being read — the whole reason Stack Overflow puts it
       * there. On a narrow screen the rail turns horizontal (see `VoteRail`) instead of stealing a
       * quarter of the reading width from a phone.
       */
      className={`scroll-mt-24 flex flex-col gap-4 rounded border bg-[var(--color-surface-panel)] p-5 sm:flex-row sm:gap-5 ${
        solution
          ? 'border-[var(--color-brand-cyan-bright)]'
          : 'border-[var(--color-border-hairline)]'
      }`}
    >
      <VoteRail
        post={post}
        canVote={canReply}
        solution={solution}
        canMarkSolution={canMarkSolution && !floated}
        onToggleSolution={() => void toggleSolution()}
      />

      {/* min-w-0 so a long code block or URL inside the body cannot force the whole card wider. */}
      <div className="min-w-0 flex-1">
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
            {/*
              The author's showcased leaderboard badges, capped at three server-side. Icons only,
              with the name on the tooltip — a post header is the reader's space, and three named
              chips would out-shout the name they decorate.
            */}
            {badges.length > 0 && (
              <span className="mt-1 flex flex-wrap gap-1">
                {badges.map((b) => (
                  <span
                    key={b.key}
                    role="img"
                    aria-label={b.name}
                    title={b.name}
                    className="cursor-default rounded-full border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-hover)] px-1.5 py-0.5 text-[13px] leading-none"
                  >
                    {b.icon}
                  </span>
                ))}
              </span>
            )}
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

        {canReply && (
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

        {/* The answer tick moved to the left rail. See VoteRail. */}
      </footer>
      </div>
    </article>
  );
}


/**
 * The vote rail: score, arrows, and the answer tick, stacked down the left of a post.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "position the up / down vote buttons and the checkmark icon stacked on the left side of the post
 * like stack overflow please. label them too."
 *
 * ★ WHY THE LEFT AND NOT THE FOOTER ★
 *
 * They started in the footer, and the footer is the wrong place: a reader working through a long
 * post has the score off-screen exactly while they are forming an opinion about it. Down the left
 * it stays beside them the whole way, which is the entire reason Stack Overflow puts it there.
 *
 * ★ LABELLED, BECAUSE ARROWS ARE NOT SELF-EXPLANATORY ★
 *
 * A bare ▲ next to a number is guessable and not obvious, and the tick is worse — a green check
 * with no word beside it could mean verified, read, or approved. The words are small and quiet, but
 * they are there.
 *
 * ★ HORIZONTAL ON A PHONE ★
 *
 * A fixed left column costs a quarter of the reading width on a narrow screen. Below `sm` the rail
 * lies down above the post instead, which keeps the same controls in the same order without
 * squeezing the text they belong to.
 */
function VoteRail({
  post,
  canVote,
  solution,
  canMarkSolution,
  onToggleSolution,
}: {
  readonly post: HubPost;
  readonly canVote: boolean;
  readonly solution: boolean;
  readonly canMarkSolution: boolean;
  readonly onToggleSolution: () => void;
}) {
  const [score, setScore] = useState(post.score);
  const [mine, setMine] = useState<1 | -1 | null>(post.myVote);

  async function press(value: 1 | -1) {
    const previous = { score, mine };

    /*
     * Predicted with the SAME rule the server uses: pressing the arrow already chosen withdraws
     * the vote. The prediction is only for the paint — the server's answer overwrites it below,
     * because the server is the one that knows what is stored.
     */
    const next = mine === value ? null : value;
    setMine(next);
    setScore(score + ((next ?? 0) - (mine ?? 0)));

    try {
      const res = await apiCall<{ score: number; myVote: 1 | -1 | null }>(
        'POST',
        `/v1/forum/posts/${encodeURIComponent(post.id)}/vote`,
        { body: { value } },
      );
      if (res !== null) {
        setScore(res.score);
        setMine(res.myVote);
      }
    } catch {
      /*
       * Put it back. Unlike a reaction, a score is a NUMBER the member reads and believes —
       * leaving an optimistic value after a refusal (their own post, a post since removed) shows
       * them a total that does not exist anywhere.
       */
      setScore(previous.score);
      setMine(previous.mine);
    }
  }

  return (
    <div className="flex shrink-0 flex-row items-center gap-3 sm:w-16 sm:flex-col sm:gap-2">
      <Arrow
        direction="up"
        active={mine === 1}
        disabled={!canVote}
        onPress={() => void press(1)}
      />

      <span className="flex flex-col items-center leading-none">
        <span
          className={`font-mono text-lg tabular-nums ${
            score > 0
              ? 'text-[var(--color-brand-cyan-bright)]'
              : score < 0
                ? 'text-[var(--color-semantic-hostile-bright)]'
                : 'text-[var(--color-text-secondary)]'
          }`}
        >
          {score > 0 ? `+${score}` : score}
        </span>
        <span className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
          {/* Singular when it is one either way, because "1 votes" reads as a bug in everything else. */}
          {Math.abs(score) === 1 ? 'vote' : 'votes'}
        </span>
      </span>

      <Arrow
        direction="down"
        active={mine === -1}
        disabled={!canVote}
        onPress={() => void press(-1)}
      />

      {/*
        The tick renders for anybody who can mark the answer, AND on a post that already IS the
        answer even when they cannot — a reader needs to see that a thread is answered whether or
        not they are the one who decided it.
      */}
      {(canMarkSolution || solution) && (
        <button
          type="button"
          disabled={!canMarkSolution}
          onClick={onToggleSolution}
          aria-pressed={solution}
          aria-label={solution ? 'Accepted answer' : 'Mark as the answer'}
          title={solution ? 'Accepted answer' : 'Mark as the answer'}
          className={`mt-1 flex flex-col items-center gap-0.5 rounded border px-2 py-1 transition-colors disabled:cursor-default ${
            solution
              ? 'border-[var(--color-semantic-success)] text-[var(--color-semantic-success)]'
              : 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:border-[var(--color-semantic-success)] hover:text-[var(--color-semantic-success)]'
          }`}
        >
          <span className="text-base leading-none">✓</span>
          <span className="font-mono text-[9px] uppercase tracking-[0.14em]">
            {solution ? 'answer' : 'accept'}
          </span>
        </button>
      )}
    </div>
  );
}

/** One arrow, with its word underneath. */
function Arrow({
  direction,
  active,
  disabled,
  onPress,
}: {
  readonly direction: 'up' | 'down';
  readonly active: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const label = direction === 'up' ? 'Upvote' : 'Downvote';

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPress}
      aria-pressed={active}
      aria-label={label}
      title={disabled ? 'Sign in to vote' : label}
      className={`flex w-full flex-col items-center gap-0.5 rounded border px-2 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? direction === 'up'
            ? 'border-[var(--color-brand-cyan-bright)] bg-[color-mix(in_srgb,var(--color-brand-cyan-bright)_12%,transparent)] text-[var(--color-brand-cyan-bright)]'
            : 'border-[var(--color-semantic-hostile-bright)] bg-[color-mix(in_srgb,var(--color-semantic-hostile-bright)_12%,transparent)] text-[var(--color-semantic-hostile-bright)]'
          : 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      <span className="text-sm leading-none">{direction === 'up' ? '▲' : '▼'}</span>
      <span className="font-mono text-[9px] uppercase tracking-[0.14em]">
        {direction === 'up' ? 'up' : 'down'}
      </span>
    </button>
  );
}
