import { AppError, ErrorCode } from '@grims/shared';
import type { AclBoundClient } from '../authz/acl-db.service.js';

/**
 * Members reporting a published post.
 *
 * ★ WHY THIS EXISTS, AND IT IS NOT ONLY ABOUT MODERATION ★
 *
 * Squadron owner, 2026-07-31, on the screening feedback loop: it should get better over time.
 *
 * A moderator only ever sees posts the screener FLAGGED, so a review queue can only ever teach it
 * "you over-flagged". Nothing in that loop says "you should have flagged this" — a wrongly CLEARED
 * post never reaches anybody. Fed back alone it drifts steadily toward permissiveness, which is
 * exactly the "fuck you looser!" failure, automated and slow enough to go unnoticed.
 *
 * A report is the only source of that missing signal. It is load-bearing for the AI, as well as
 * being the ordinary thing a forum needs.
 *
 * ★ A REPORT DOES NOT HIDE THE POST, AND THAT IS DELIBERATE ★
 *
 * The obvious implementation holds the post the moment somebody reports it. That hands every member
 * a button that silences any other member instantly — in a squadron of a hundred people, during an
 * argument, that button WILL be used that way.
 *
 * So a report is a CLAIM, not a verdict. The post stays up, an officer decides, and only their
 * decision changes anything. The cost is that genuinely bad content stays visible until an officer
 * looks; the alternative cost is that anyone can silence anyone, which is worse and irreversible in
 * a way a few minutes of visibility is not.
 */
export class ReportService {
  constructor(
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
   * Records a member's report.
   *
   * ★ ONE PER MEMBER PER POST ★
   *
   * Otherwise a determined member reports the same post fifty times, the drift figures read it as
   * fifty independent judgements, and the screener learns a great deal from one person's opinion.
   * Silently idempotent rather than an error: somebody clicking twice has not done anything wrong,
   * and telling them off for it teaches them not to report next time.
   */
  async report(
    db: AclBoundClient,
    postId: string,
    reporter: { userId: string },
  ): Promise<{ ok: true }> {
    const post = await db.forumPost.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true, bodyMd: true, screenState: true, authorId: true },
    });

    /*
     * Cloaked as not-found rather than "you cannot see that". The ACL client already limits this to
     * posts the reporter can read, and a distinct error would confirm a post exists to somebody
     * probing ids.
     */
    if (post === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That post is not available.');
    }

    /*
     * Reporting your own post is almost always a misclick, and the signal would be worthless — an
     * author is not an independent judge of their own writing.
     */
    if (post.authorId === reporter.userId) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'You cannot report your own post.');
    }

    // Already waiting for an officer. Nothing to add, and no reason to say so.
    if (post.screenState === 'held') return { ok: true };

    /*
     * `decidedBy: null` marks it PENDING — a claim nobody has upheld. `shouldFlag: false` records
     * what is true right now: no human has said this should have been flagged. An officer upholding
     * it is what flips that, and until then this row must not teach the screener anything.
     *
     * `modelFlagged: false` is the whole point of the record: the screener let this through, and a
     * member disagreed. That pairing is the false-negative signal the review queue can never
     * produce.
     */
    await this.decisions?.record({
      postId: post.id,
      text: post.bodyMd,
      shouldFlag: false,
      modelFlagged: false,
      source: 'report',
      decidedBy: null,
    });

    return { ok: true };
  }
}

/**
 * What a member is told after reporting.
 *
 * Says what happens next and names no outcome. Promising action would be a promise an officer has
 * not made, and saying "we will review it" then leaving it visible reads as inaction rather than as
 * the deliberate choice it is.
 */
export const REPORTED_MESSAGE =
  'Thanks — an officer will take a look. The post stays up until they decide.';
