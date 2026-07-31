import { AppError, ErrorCode, Permission } from '@grims/shared';
import type { AclBoundClient } from '../authz/acl-db.service.js';
import { satisfiesMask } from '../forum/category.service.js';

/**
 * The queue of posts waiting for a human.
 *
 * ★ WHY THIS EXISTS AT ALL ★
 *
 * Squadron owner, 2026-07-30: "if a post is flagged, it must be submitted for human review in the
 * moderation area of the /app tab we will be building."
 *
 * Screening holds posts; this is where they stop being held. A queue nobody can work is just a way
 * of deleting posts slowly, so this shipped alongside screening rather than after it.
 *
 * ★ TWO REASONS A POST IS HERE, AND THE REVIEWER NEEDS BOTH ★
 *
 * The model objected, or the model could not be reached. A reader cannot tell those apart — that is
 * deliberate, and tested — but an officer working a backlog absolutely must: forty posts held
 * because a GPU was off is a completely different afternoon from forty the model flagged.
 */

export interface HeldPost {
  readonly id: string;
  readonly threadId: string;
  readonly threadTitle: string;
  readonly categorySlug: string;
  readonly bodyHtml: string;
  readonly authorHandle: string;
  readonly authorName: string;
  readonly createdAt: string;
  /**
   * Why it is here.
   *
   * `flagged` means the model objected and `categories` says what to. `unavailable` means the
   * screener could not be reached and nobody has judged this post at all — which usually means it
   * is fine and just needs a glance.
   */
  readonly reason: 'flagged' | 'unavailable';
  readonly categories: readonly string[];
  /** The model's own words. For the reviewer only; never sent to the author. */
  readonly modelReason: string | null;
}

export class ReviewQueueService {
  constructor(
    /*
     * Optional. Without it the queue works exactly as before and simply learns nothing — which is
     * what every unit test of moderation wants, and what a deployment without an embedding model
     * gets.
     */
    private readonly decisions: {
      record(entry: {
        postId: string | null;
        text: string;
        shouldFlag: boolean;
        modelFlagged: boolean;
        source: 'review' | 'report';
        decidedBy: string | null;
      }): Promise<void>;
    } | null = null,
  ) {}

  /**
   * Everything waiting, oldest first.
   *
   * ★ OLDEST FIRST, NOT NEWEST ★
   *
   * A moderation queue sorted newest-first quietly abandons the bottom of itself: the post that
   * has waited longest is the one furthest from anybody's attention, and it is also the member most
   * likely to have given up on the squadron. Oldest first means the queue drains.
   */
  async held(db: AclBoundClient, callerMask: bigint, limit = 50): Promise<HeldPost[]> {
    this.#assertMayReview(callerMask);

    const rows = await db.forumPost.findMany({
      where: { screenState: 'held', deletedAt: null },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        threadId: true,
        bodyHtml: true,
        screenVerdict: true,
        createdAt: true,
        author: { select: { handle: true, displayName: true } },
        thread: { select: { title: true, category: { select: { slug: true } } } },
      },
    });

    return rows.map((r) => {
      const verdict = (r.screenVerdict ?? {}) as {
        verdict?: unknown;
        categories?: unknown;
        reason?: unknown;
      };

      return {
        id: r.id,
        threadId: r.threadId,
        threadTitle: r.thread.title,
        categorySlug: r.thread.category.slug,
        bodyHtml: r.bodyHtml,
        authorHandle: r.author.handle,
        authorName: r.author.displayName ?? r.author.handle,
        createdAt: r.createdAt.toISOString(),
        /*
         * Defaults to `unavailable` rather than `flagged`. A post with no stored verdict was held
         * because nothing judged it — presenting that as "the model flagged this" would put an
         * accusation on a post nobody objected to.
         */
        reason: verdict.verdict === 'flagged' ? 'flagged' : 'unavailable',
        categories: Array.isArray(verdict.categories)
          ? verdict.categories.filter((c): c is string => typeof c === 'string')
          : [],
        modelReason: typeof verdict.reason === 'string' ? verdict.reason : null,
      };
    });
  }

  /** How many are waiting. For the badge on the tab, so a filling queue is visible without opening it. */
  async heldCount(db: AclBoundClient, callerMask: bigint): Promise<number> {
    this.#assertMayReview(callerMask);
    return db.forumPost.count({ where: { screenState: 'held', deletedAt: null } });
  }

  /**
   * Publishes a held post, or refuses it.
   *
   * ★ REFUSED IS NOT DELETED ★
   *
   * A refused post keeps its row and its text. INV-022 is about soft deletion being recoverable,
   * and the same reasoning applies harder here: this is a decision a human made about somebody's
   * writing, and "we removed it" needs to survive the member asking why.
   *
   * ★ AND IT RECORDS WHO ★
   *
   * `reviewedBy` is the session's user, never a parameter. A moderation decision with no name
   * against it is one nobody can be asked about.
   */
  async decide(
    db: AclBoundClient,
    postId: string,
    decision: 'release' | 'refuse',
    reviewer: { userId: string; mask: bigint },
  ): Promise<void> {
    this.#assertMayReview(reviewer.mask);

    const post = await db.forumPost.findFirst({
      where: { id: postId, screenState: 'held', deletedAt: null },
      // The body and the verdict come back too: this decision becomes a labelled example, and the
      // example needs the text that was judged and what the model said about it.
      select: { id: true, bodyMd: true, screenVerdict: true },
    });
    if (post === null) {
      /*
       * Cloaked as not-found, and it usually IS: two officers working the same queue means one of
       * them decides a post the other is still looking at. A distinct "already decided" error would
       * be more precise and would also confirm the post exists to anybody probing ids.
       */
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That post is not waiting for review.');
    }

    await db.forumPost.update({
      where: { id: post.id },
      data: {
        screenState: decision === 'release' ? 'clear' : 'refused',
        reviewedAt: new Date(),
        reviewedBy: reviewer.userId,
      },
    });

    /*
     * ★ THE DECISION IS THE LESSON ★
     *
     * Squadron owner, 2026-07-31: "can we train the model based on wither a moderator passes a post
     * in review or dismisses it?"
     *
     * `release` means the model was wrong to flag; `refuse` means it was right. Recorded as a
     * labelled example so a similar post later carries this officer's judgement as precedent.
     *
     * Not awaited into the failure path: the moderation decision has already been written and must
     * stand whether or not we manage to learn from it. Losing an example is a smaller harm than
     * failing a decision an officer has made.
     */
    void this.decisions
      ?.record({
        postId: post.id,
        text: post.bodyMd,
        // What the HUMAN concluded. Refusing means it should have been held.
        shouldFlag: decision === 'refuse',
        // Always true here: only flagged or unavailable posts reach this queue. Kept explicit so
        // the drift figures can tell reviews apart from reports.
        modelFlagged: true,
        source: 'review',
        decidedBy: reviewer.userId,
      })
      .catch(() => undefined);
  }

  /**
   * Reviewing requires AI_REVIEW.
   *
   * Narrower than AI_TOOLS_ADMIN, which also carries kill switches and quota overrides — and held
   * by officers and by the webmaster, the latter automatically, because AI_REVIEW is deliberately
   * outside SQUADRON_STANDING_PERMISSIONS.
   */
  #assertMayReview(mask: bigint): void {
    if (!satisfiesMask(mask, Permission.AI_REVIEW)) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'You cannot review held posts.');
    }
  }
}
