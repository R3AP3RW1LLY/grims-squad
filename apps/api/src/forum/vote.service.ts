import { AppError, ErrorCode, XP_AWARDS, type VoteValue } from '@grims/shared';
import type { AclBoundClient } from '../authz/acl-db.service.js';

/**
 * Voting on forum posts.
 *
 * ★ SQUADRON OWNER, 2026-07-31 ★
 *
 * "we also need upvote, downvote and answer buttons like stack overflow."
 *
 * ★ THREE ACTIONS, ONE ENDPOINT ★
 *
 * Casting, changing and withdrawing a vote are the same gesture from the member's side: they click
 * the arrow. Clicking the arrow they already chose withdraws it; clicking the other one changes
 * it. Modelling that as three endpoints would push the decision into the browser, and the browser
 * does not reliably know what they voted last — a second tab, a stale page, a back button.
 *
 * So the SERVER decides what the click means, from what is already stored. The client sends "the
 * member pressed up on this post" and nothing else.
 */

export interface VoteChange {
  readonly postId: string;
  readonly userId: string;
  readonly authorId: string;
  /** What the vote becomes. Null withdraws it. */
  readonly value: VoteValue | null;
  /** What it was. Null when they had not voted. */
  readonly previous: VoteValue | null;
  /** How much the post's score moves. */
  readonly scoreDelta: number;
  /** Experience for the AUTHOR, which may be negative or zero. */
  readonly xp: ReadonlyArray<{ reason: keyof typeof XP_AWARDS; amount: number; subject: string }>;
}

export interface VoteResult {
  readonly score: number;
  /** What the member's vote is NOW, so the client renders from the server's answer. */
  readonly myVote: VoteValue | null;
}

/**
 * ★ NO CONSTRUCTOR DEPENDENCIES — THE CALLER'S BOUND CLIENT IS THE FIRST ARGUMENT ★
 *
 * Same shape as `GrantService`, and for the same reason (INV-002). A `PrismaClient` injected here
 * would be the PLAIN one, and voting would silently reach posts in categories the member cannot
 * read — which `acl-usage.spec` exists to prevent. Taking the bound client per call makes "you
 * cannot vote on what you cannot see" a property of the call rather than of the wiring.
 */
export class VoteService {
  /**
   * The member pressed up or down on a post.
   *
   * `pressed` is the button, not the desired state. See the note on this class.
   */
  async press(
    db: AclBoundClient,
    postId: string,
    userId: string,
    pressed: VoteValue,
  ): Promise<VoteResult> {
    /*
     * Read through the BOUND client, so a post in a category this member cannot see comes back
     * null — and lands in the not-visible branch below rather than being voted on.
     */
    const post = await db.forumPost.findFirst({
      where: { id: postId, deletedAt: null, screenState: 'clear' },
      select: { authorId: true },
    });
    const authorId = post?.authorId ?? null;

    if (authorId === null) {
      /*
       * NOT_VISIBLE rather than NOT_FOUND (INV-024). A post the member cannot see and a post that
       * does not exist must answer identically, or the vote endpoint becomes a way to enumerate
       * held and deleted posts by watching which ids error differently.
       */
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That post is not available.');
    }

    if (authorId === userId) {
      /*
       * ★ NOT A MATTER OF TRUST ★
       *
       * Everyone can vote — the owner decided that explicitly. This is narrower: self-voting is
       * not an opinion about a post, it is a member adding to their own score, and allowing it
       * would make experience a measure of how many posts somebody has written.
       */
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'You cannot vote on your own post.');
    }

    const row = await db.forumVote.findUnique({
      where: { postId_userId: { postId, userId } },
      select: { value: true },
    });
    const previous = (row?.value ?? null) as VoteValue | null;

    // Pressing the arrow they already chose withdraws it. See the class note.
    const value: VoteValue | null = previous === pressed ? null : pressed;
    const scoreDelta = (value ?? 0) - (previous ?? 0);
    const xp = xpFor(postId, previous, value);

    /*
     * ★ ONE TRANSACTION, AND IT IS NOT OPTIONAL ★
     *
     * The score is denormalised onto the post. If the vote row lands and the score does not, that
     * post is wrong permanently — there is no reconciliation pass, and there should not need to be
     * one. The experience ledger goes in the same transaction for the same reason.
     */
    const score = await db.$transaction(async (tx) => {
      if (value === null) {
        await tx.forumVote.delete({ where: { postId_userId: { postId, userId } } });
      } else {
        await tx.forumVote.upsert({
          where: { postId_userId: { postId, userId } },
          create: { postId, userId, value },
          update: { value },
        });
      }

      /*
       * `increment`, not a read-then-write. Two members voting at the same moment would both read
       * the same score and both write their own idea of the total, and one vote would vanish with
       * nothing recording that it had happened.
       */
      const updated = await tx.forumPost.update({
        where: { id: postId },
        data: { score: { increment: scoreDelta } },
        select: { score: true },
      });

      if (xp.length > 0) {
        /*
         * No skipDuplicates, deliberately: these are signed LEDGER rows — a second upvoter's +10
         * and a withdrawal's −10 share a (user, reason, subject) key with earlier rows and must
         * all land. The xp_events_once_idx unique index names the one-shot reasons explicitly
         * (20260805110000_xp_once_narrowed) and the vote reasons are not among them; before it
         * was narrowed, the second such row violated it and rolled the whole vote back.
         */
        await tx.xpEvent.createMany({
          data: xp.map((e) => ({ userId: authorId, reason: e.reason, amount: e.amount, subject: e.subject })),
        });
      }

      return updated.score;
    });

    return { score, myVote: value };
  }
}

/**
 * The author's experience for a vote transition.
 *
 * ★ WHY THIS IS A PURE FUNCTION AND HAS ITS OWN TESTS ★
 *
 * There are nine transitions (none/up/down → none/up/down) and the arithmetic is easy to get
 * subtly wrong in a way that never throws: an up-vote changed to a down-vote must REMOVE the
 * award and then APPLY the penalty, and a version that only applies the penalty leaves the author
 * permanently ahead. Nothing would ever fail; the totals would just be wrong.
 */
export function xpFor(
  postId: string,
  previous: VoteValue | null,
  value: VoteValue | null,
): Array<{ reason: keyof typeof XP_AWARDS; amount: number; subject: string }> {
  const out: Array<{ reason: keyof typeof XP_AWARDS; amount: number; subject: string }> = [];

  // Undo whatever the old vote was worth.
  if (previous === 1) out.push({ reason: 'postUpvoted', amount: -XP_AWARDS.postUpvoted, subject: postId });
  if (previous === -1) {
    out.push({ reason: 'postDownvoted', amount: -XP_AWARDS.postDownvoted, subject: postId });
  }

  // Apply the new one.
  if (value === 1) out.push({ reason: 'postUpvoted', amount: XP_AWARDS.postUpvoted, subject: postId });
  if (value === -1) out.push({ reason: 'postDownvoted', amount: XP_AWARDS.postDownvoted, subject: postId });

  /*
   * Zero-sum entries are dropped. Nothing changed, and a ledger full of +10/-10 pairs for members
   * toggling a vote makes the history unreadable for no gain — the point of a ledger is that
   * somebody can look at it and understand their score.
   */
  return out.filter((e) => e.amount !== 0);
}
