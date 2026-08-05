import { AppError, ErrorCode } from '@grims/shared';
import type { AclBoundClient } from '../authz/acl-db.service.js';

/**
 * Reactions and subscriptions (P2.4).
 *
 * ★ BOTH ARE GATED BY VISIBILITY, NOT BY A PERMISSION ★
 *
 * There is no REACT or SUBSCRIBE permission, and adding one would be inventing a rule nobody
 * asked for. The rule that already exists is the right one: if you can SEE a thread you can react
 * to it and follow it, and if you cannot see it neither action is available — because the thread
 * is read through the caller's ACL-bound client first, so an invisible thread is a 404 and there
 * is nothing to act on.
 *
 * That is deliberately weaker than posting, which needs the category's `post_perm`. Reading and
 * following are the same capability; speaking is a different one.
 */

/**
 * The reactions a member may use.
 *
 * ★ A FIXED SET, AND WHY ★
 *
 * Arbitrary emoji look like a small feature and are not. They are a text field rendered to every
 * reader, which means a moderation surface — somebody will eventually react with something
 * unpleasant, and a fixed set makes that impossible rather than reportable. They are also a
 * rendering problem: not every glyph exists on every platform, and a reaction that shows as a box
 * on half the squadron's devices is worse than no reaction.
 *
 * Seven, chosen to cover what a squadron forum actually needs: agreement, thanks, acknowledgement,
 * amusement, and "this is the answer". Nothing negative — a downvote on a member's post in a group
 * this size is a moderation problem waiting to happen, and there is a reply box for disagreement.
 */
export const ALLOWED_REACTIONS = ['👍', '🙏', 'o7', '😄', '🎯', '🔧', '👀'] as const;
export type Reaction = (typeof ALLOWED_REACTIONS)[number];

export interface ReactionCount {
  readonly emoji: string;
  readonly count: number;
  /** Whether the CALLER reacted, so the UI can show their own state without a second request. */
  readonly mine: boolean;
}

export type SubscriptionLevel = 'watching' | 'muted';

export class EngageService {
  /**
   * Adds or removes the caller's reaction. One call, because a reaction is a toggle.
   *
   * ★ IDEMPOTENT BY CONSTRUCTION ★
   *
   * The primary key is (postId, userId, emoji), so "react twice" cannot create two rows. The toggle
   * reads first to decide which way to go — and a race between two clicks resolves to one of the two
   * states rather than an error, because `deleteMany` and `upsert` both tolerate losing.
   */
  async toggleReaction(
    db: AclBoundClient,
    postId: string,
    emoji: string,
    userId: string,
  ): Promise<ReactionCount[]> {
    if (!(ALLOWED_REACTIONS as readonly string[]).includes(emoji)) {
      /*
       * Named in the message rather than a bare rejection: a client sending an unsupported emoji is
       * a bug in our own UI, and the message should say enough to fix it.
       */
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `That reaction is not one of ours. Allowed: ${ALLOWED_REACTIONS.join(' ')}`,
      );
    }

    const post = await this.#visiblePost(db, postId);

    const existing = await db.forumReaction.findUnique({
      where: { postId_userId_emoji: { postId: post.id, userId, emoji } },
      select: { emoji: true },
    });

    if (existing === null) {
      await db.forumReaction.create({ data: { postId: post.id, userId, emoji } });
    } else {
      await db.forumReaction.deleteMany({ where: { postId: post.id, userId, emoji } });
    }

    return this.reactionsFor(db, post.id, userId);
  }

  /**
   * The reaction counts on a post.
   *
   * Grouped in the DATABASE rather than by fetching rows and counting. A popular post could carry
   * a hundred reactions, and pulling every row to produce seven numbers would be work proportional
   * to popularity for a result that is not.
   */
  async reactionsFor(db: AclBoundClient, postId: string, userId: string | null): Promise<ReactionCount[]> {
    const grouped = await db.forumReaction.groupBy({
      by: ['emoji'],
      where: { postId },
      _count: { emoji: true },
    });

    const mine =
      userId === null
        ? []
        : (
            await db.forumReaction.findMany({
              where: { postId, userId },
              select: { emoji: true },
            })
          ).map((r) => r.emoji);

    /*
     * Ordered by the ALLOWED list rather than by count, deliberately. A list that reorders itself as
     * people react makes the buttons move under the cursor — and a member who meant to click 'o7'
     * ends up clicking something else.
     */
    return ALLOWED_REACTIONS.map((emoji) => {
      const row = grouped.find((g) => g.emoji === emoji);
      return {
        emoji,
        count: row?._count.emoji ?? 0,
        mine: mine.includes(emoji),
      };
    }).filter((r) => r.count > 0 || r.mine);
  }

  /**
   * Follows or unfollows a thread.
   *
   * `muted` is a real state, not an absent row: a member watching a whole CATEGORY needs a way to
   * silence one thread inside it, and deleting their subscription would leave the category
   * subscription still notifying them. `recipientsFor` excludes `muted` explicitly for that reason.
   */
  async setThreadSubscription(
    db: AclBoundClient,
    threadId: string,
    userId: string,
    level: SubscriptionLevel | 'none',
  ): Promise<{ level: SubscriptionLevel | 'none' }> {
    // Through the bound client: an invisible thread cannot be followed.
    const thread = await db.forumThread.findFirst({
      where: { id: threadId, deletedAt: null },
      select: { id: true },
    });
    if (thread === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Thread not found.');
    }

    if (level === 'none') {
      await db.forumSubscription.deleteMany({ where: { threadId: thread.id, userId } });
      return { level: 'none' };
    }

    /*
     * `upsert` on the unique (userId, threadId), so following twice is not an error and changing
     * from watching to muted is the same call.
     */
    await db.forumSubscription.upsert({
      where: { userId_threadId: { userId, threadId: thread.id } },
      create: { userId, threadId: thread.id, level },
      update: { level },
    });

    return { level };
  }

  /** The caller's own subscription state for a thread, for rendering the follow button. */
  async subscriptionFor(
    db: AclBoundClient,
    threadId: string,
    userId: string,
  ): Promise<{ level: SubscriptionLevel | 'none' }> {
    const sub = await db.forumSubscription.findUnique({
      where: { userId_threadId: { userId, threadId } },
      select: { level: true },
    });
    return { level: sub === null ? 'none' : (sub.level as SubscriptionLevel) };
  }

  /**
   * A post the caller can see.
   *
   * ForumPost is not an ACL-bearing model — a post's visibility is entirely its thread's — so this
   * reaches it THROUGH the thread, which IS ACL-bound. Same reasoning as `postsFor`.
   */
  async #visiblePost(db: AclBoundClient, postId: string): Promise<{ id: string }> {
    const post = await db.forumPost.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true, threadId: true },
    });
    if (post === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Post not found.');
    }

    /*
     * The thread read is what actually enforces visibility: the post lookup above is not filtered,
     * because ForumPost carries no ACL. If the thread comes back null the caller cannot see the
     * post either, whatever the first query returned.
     */
    const thread = await db.forumThread.findFirst({
      where: { id: post.threadId, deletedAt: null },
      select: { id: true },
    });
    if (thread === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Post not found.');
    }

    return { id: post.id };
  }
}
