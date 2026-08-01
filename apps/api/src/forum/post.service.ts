import { AppError, ErrorCode, Permission } from '@grims/shared';
import { withYouTubeThumbnails, type ThumbnailStore } from './youtube-thumbnail.js';
import type { ScreeningService } from '../ai/screening.service.js';
import type { AclBoundClient } from '../authz/acl-db.service.js';
import { satisfiesMask } from './category.service.js';
import { renderPostBody } from './sanitize.js';
import { validateDocument, renderDocument, documentToText, mentionedUserIds } from './rich-doc.js';
import type { ReindexQueue } from './reindex.port.js';
import type { ModerationService } from './moderation.service.js';

/**
 * Posts — writing, editing and deleting them.
 *
 * ★ TWO INVARIANTS LIVE HERE ★
 *
 * INV-035  every body is sanitised BEFORE STORAGE, by the one function that does it.
 * INV-022  content is SOFT-deleted, leaves a moderator-visible tombstone, and stays
 *          recoverable. Nothing a user does removes a row.
 *
 * Neither is enforced by a guard above this file. `renderPostBody` is the only way a
 * body reaches the database, and there is no `delete` call anywhere in this service —
 * which is a property somebody can check by reading it, rather than a rule to remember.
 */

/** A revision, for the edit history a moderator can read. */
export interface RevisionView {
  readonly editedAt: string;
  readonly editedByHandle: string;
}

export interface PostWritten {
  readonly id: string;
  readonly bodyHtml: string;
  readonly editCount: number;
}

/**
 * How long an author has to fix their own typo without it counting as an edit.
 *
 * Nothing to do with permissions — the revision is written either way. This only governs
 * whether `editedAt` is set, which is what puts "edited" next to somebody's name. Fixing a
 * word ten seconds after posting is not the kind of edit anybody needs flagged, and a forum
 * that flags it teaches members to post twice instead.
 */
const GRACE_MS = 3 * 60 * 1000;

export class PostService {
  constructor(
    private readonly reindex: ReindexQueue,
    /*
     * Injected so a mute is enforced where posting happens, rather than in a guard somebody could
     * add a second route around. A sanction that does not stop the thing it names is not a
     * sanction.
     */
    private readonly moderation: ModerationService,
    /*
     * Optional, so the service still constructs in every test that does not care about video
     * previews. Absent means posts save exactly as before, with the CSS placeholder — which is
     * also what happens in production when YouTube is unreachable.
     */
    private readonly thumbnails: ThumbnailStore | null = null,
    /*
     * Optional for the same reason as the thumbnail store: a unit test of posting should not need
     * an AI. Absent means posts publish immediately, which is exactly what happens today and what
     * happens in any deployment where screening has not been configured.
     */
    private readonly screening: ScreeningService | null = null,
  ) {}

  /**
   * Adds a reply to a thread.
   *
   * The thread is resolved through the CALLER's bound client, so a thread they cannot see
   * is a 404 and there is nothing to reply to. Posting permission then comes from the
   * CATEGORY, not from the thread — a thread does not carry its own post permission, and
   * inventing one here would be a second place for that decision to live.
   */
  async create(
    db: AclBoundClient,
    threadId: string,
    /*
     * EITHER a Markdown string OR a rich document. One shape, two forms, decided by which the
     * client sent — rather than two near-identical methods that would drift apart on the
     * permission and lock checks, which are the parts that matter.
     */
    body: string | { doc: unknown },
    authorId: string,
    callerMask: bigint,
    /**
     * The post being answered, for threaded replies.
     *
     * Optional: a top-level reply answers the thread rather than a person. When present it is what
     * makes a "somebody replied to YOU" notification possible — the strongest signal the forum has,
     * and one a flat reply list cannot express.
     */
    replyToId?: string,
  ): Promise<PostWritten & { replyToAuthorId: string | null; mentions: string[] }> {
    const thread = await db.forumThread.findFirst({
      where: { id: threadId, deletedAt: null },
      select: {
        id: true,
        isLocked: true,
        category: { select: { postPerm: true, isLocked: true } },
      },
    });
    if (thread === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Thread not found.');
    }

    /*
     * A LOCKED thread refuses everybody, moderators included.
     *
     * Deliberate: the joining guides are locked so that "this didn't work for me" lands in
     * the help board where somebody will see it, rather than being appended to the
     * instructions everybody else is reading. A moderator bypass would make the lock
     * advisory, and the one person most likely to reply out of habit is a moderator.
     *
     * Unlocking is a moderator action, and it is a visible one.
     */
    if (thread.isLocked || thread.category.isLocked) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'This thread is locked. If it is a guide, ask in the help board instead — somebody will see it there.',
      );
    }

    const required =
      thread.category.postPerm === null ? null : BigInt(thread.category.postPerm.toFixed(0));
    if (!satisfiesMask(callerMask, required)) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'You cannot post in this board.');
    }

    /*
     * ★ THE MUTE CHECK, AFTER THE PERMISSION CHECK ★
     *
     * Ordering matters and this way round is deliberate. A member who cannot post in a board at all
     * should be told THAT, not told they are muted — telling a non-officer they are "muted" from the
     * officers' board would be both wrong and confusing.
     *
     * Read fresh on every attempt rather than cached: a mute that expired two minutes ago must stop
     * applying, and a member left muted past their sentence reads as the site being broken.
     */
    await this.moderation.assertMayPost(db, authorId);

    const rendered =
      typeof body === 'string' ? this.#render(body) : await this.#renderRich(body.doc, authorId);

    /*
     * ★ THE PARENT IS READ THROUGH THE BOUND CLIENT, AND MUST BE IN THIS THREAD ★
     *
     * Without the thread check, a `replyToId` from another thread would attach a reply to a post the
     * reader cannot see from here — and would notify its author about a conversation they are not
     * part of. Both are silent, and both look like a threading bug rather than a permission one.
     */
    let replyToAuthorId: string | null = null;
    if (replyToId !== undefined) {
      const parent = await db.forumPost.findFirst({
        where: { id: replyToId, threadId: thread.id, deletedAt: null },
        select: { id: true, authorId: true },
      });
      if (parent === null) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, 'That post is not in this thread.');
      }
      replyToAuthorId = parent.authorId;
    }

    /*
     * Mentions are read from the VALIDATED document, not scanned out of the HTML — so the
     * notification logic cannot depend on how the renderer formats an attribute today, and cannot
     * notify an id that was never accepted.
     */
    const mentions =
      'bodyDoc' in rendered ? mentionedUserIds(rendered.bodyDoc as never) : [];

    /*
     * ★ SCREENED BEFORE IT IS WRITTEN ★
     *
     * Squadron owner, 2026-07-30: "the ai must ingest and moderate all posts before they are
     * visible / posted to the forum". Running this after the insert would create a window — however
     * short — in which unscreened writing is readable, and the whole instruction is about there
     * being no such window.
     *
     * Synchronous, which the owner chose: screening is a second or two on a 3060 Ti, about as long
     * as saving a post already takes.
     */
    const screened =
      this.screening === null
        ? null
        : await this.screening.screenPost(rendered.bodyMd, { userId: authorId, surface: 'web' });

    const post = await db.forumPost.create({
      data: {
        threadId: thread.id,
        /*
         * The column defaults to `held`, so an absent screener would hold everything. Stating it
         * explicitly means "screening is not configured" publishes, and "screening said so" decides
         * otherwise — see `ScreeningService.screenPost` for why those differ.
         */
        screenState: screened === null ? 'clear' : screened.state,
        ...(screened === null || screened.state === 'clear'
          ? {}
          : { screenVerdict: screened.verdict as unknown as object }),
        ...(replyToId === undefined ? {} : { replyToId }),
        // From the SESSION, never a request field. There is no anonymous author to
        // represent — `authorId` is NOT NULL with a required relation to `users`.
        authorId,
        bodyMd: rendered.bodyMd,
        bodyHtml: rendered.bodyHtml,
        // Null for a Markdown post, which is how a reader later knows which editor made it.
        ...('bodyDoc' in rendered ? { bodyDoc: rendered.bodyDoc as object } : {}),
      },
      select: { id: true, bodyHtml: true, editCount: true },
    });

    /*
     * Denormalised counters, updated in the same call. `postCount` is what a board listing
     * renders, and recomputing it per row would be a COUNT per thread per page view.
     */
    await db.forumThread.update({
      where: { id: thread.id },
      data: { postCount: { increment: 1 }, lastPostAt: new Date(), lastPostBy: authorId },
    });

    this.reindex.enqueue({ kind: 'post', id: post.id, reason: 'created' });

    /*
     * ★ THE FORUM ACTIVITY COUNTER NOTHING WAS WRITING ★
     *
     * Squadron owner, 2026-07-30: "/app is not tracking forum posts and pebblemerchant i know has
     * 2 posts that have been published by him".
     *
     * `member_activity_days.forum_post_count` was READ in three places — the admin roster, the
     * dashboard totals, and the activity chart's forum line — and written in NONE. Discord messages
     * and voice joins come from the bot, which owns that table; forum posts happen on the website,
     * and nobody ever taught this path to record one. So the column was structurally zero and every
     * reader of it was faithfully reporting nothing.
     *
     * ★ KEYED ON THE DISCORD SNOWFLAKE, WHICH IS WHY THIS IS NOT A ONE-LINER ★
     *
     * That table is keyed on `discord_id`, not on our user id, because it covers every guild member
     * whether or not they have ever signed in. A poster therefore has to be resolved through their
     * linked Discord identity — and somebody with no linked identity simply is not counted, which
     * is correct: they have no row in a table that is keyed by a snowflake they do not have.
     *
     * Fire-and-forget, like the view counter. An activity statistic is not worth failing a post
     * over, and the member has already written the thing.
     */
    void this.#countForumPost(db, authorId).catch(() => undefined);

    /*
     * Returned rather than fanned out HERE. The service does not know the thread's slug or the site
     * URL, and giving it those would make a write path depend on presentation. The controller has
     * both and does the fan-out — which also keeps a slow Discord call off the transaction.
     */
    return { ...post, replyToAuthorId, mentions };
  }

  /**
   * Edits a post.
   *
   * ★ THE REVISION IS WRITTEN BEFORE THE CHANGE, IN ONE TRANSACTION ★
   *
   * The revision records the body as it WAS. Writing it after the update would record the
   * new text, producing a history where every entry matches the current post — which looks
   * like a working audit trail and contains no information at all.
   *
   * In a transaction so an edit can never land without its revision. A post whose previous
   * text was lost is not recoverable, and INV-022's promise is about recoverability.
   */
  /**
   * The ORIGINAL source of a post, for an editor to start from.
   *
   * ★ A SEPARATE REQUEST, NOT A FIELD ON THE READ PATH ★
   *
   * The obvious build adds `bodyDoc` to every post in the thread response. That ships the document
   * tree AND the rendered HTML for every post to every reader — roughly doubling the page — so that
   * the handful of people who might press Edit do not have to wait once.
   *
   * It is also the wrong place for `bodyMd`. That is the author's UNSANITISED input, and the rule
   * the read path states is that it does not leave the server. Here it does, but only to somebody
   * entitled to rewrite it, and only into an editor.
   *
   * ★ SAME PERMISSION AS THE EDIT ITSELF ★
   *
   * Author or moderator. Anything weaker would make this a way to read the raw Markdown of any
   * post — which is not a disclosure of much, but is a disclosure nobody asked for, and the check
   * costs one comparison.
   *
   * A locked thread is deliberately NOT refused here: a moderator may edit a locked post, so they
   * must be able to load it. `edit` applies the lock rule at the point it matters.
   */
  async source(
    db: AclBoundClient,
    postId: string,
    callerId: string,
    callerMask: bigint,
  ): Promise<{ bodyDoc: unknown | null; bodyMd: string | null }> {
    const post = await db.forumPost.findFirst({
      where: { id: postId, deletedAt: null },
      select: {
        authorId: true,
        bodyMd: true,
        bodyDoc: true,
        thread: { select: { category: { select: { postPerm: true } } } },
      },
    });
    if (post === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Post not found.');
    }

    const maintainer = maintainsDocumentation(
      post.thread.category.postPerm === null
        ? null
        : BigInt(post.thread.category.postPerm.toFixed(0)),
      callerMask,
    );
    if (post.authorId !== callerId && !maintainer) {
      throw new AppError(
        ErrorCode.PERMISSION_DENIED,
        'Only the person who wrote a post can edit it.',
      );
    }

    /*
     * A post written in Markdown has no document, and vice versa. Both are returned so the client
     * can pick its editor rather than guess — a Markdown post opened in the rich editor would be
     * silently converted, which is a lossy rewrite of somebody's text they never asked for.
     */
    return { bodyDoc: post.bodyDoc ?? null, bodyMd: post.bodyDoc === null ? post.bodyMd : null };
  }

  /**
   * Records one forum post against today's activity row.
   *
   * UTC day, matching how the bot writes the same table and how promotions count a month. Using
   * the server's local day would put a host in a negative offset one day out at every month
   * boundary, and the figure a member reads would disagree with the one the promotion job used.
   */
  async #countForumPost(db: AclBoundClient, authorId: string): Promise<void> {
    const identity = await db.discordIdentity.findFirst({
      where: { userId: authorId },
      // `userId` too: the month row carries it, and one created here would otherwise have none —
      // which is the column that joins an activity row back to a member.
      select: { discordId: true, userId: true },
    });
    if (identity === null) return;

    const now = new Date();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    await db.memberActivityDay.upsert({
      where: { discordId_day: { discordId: identity.discordId, day } },
      create: { discordId: identity.discordId, day, forumPostCount: 1 },
      update: { forumPostCount: { increment: 1 } },
    });

    /*
     * ★ AND THE MONTH, WHICH WAS NEVER WRITTEN ★
     *
     * Only the DAY row was incremented. Every read of forum activity — the admin dashboard, the
     * activity table, and the promotion eligibility check — goes to `member_activity_months`, and
     * nothing had ever put a forum count there: 0 of 52 monthly rows carried one.
     *
     * So posting on the forum counted towards nothing at all, including promotions, and the column
     * that was supposed to record it read zero for everybody. Nothing failed and nothing was
     * logged; the number was simply always zero, which is indistinguishable from nobody posting.
     *
     * `userId` is set here as well because the month row carries it and a row created by this path
     * would otherwise have none — which is what joins it back to a member.
     */
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    await db.memberActivityMonth.upsert({
      where: { discordId_month: { discordId: identity.discordId, month } },
      create: {
        discordId: identity.discordId,
        month,
        userId: authorId,
        forumPostCount: 1,
      },
      update: { forumPostCount: { increment: 1 } },
    });
  }

  async edit(
    db: AclBoundClient,
    postId: string,
    body: string | { doc: unknown },
    editorId: string,
    callerMask: bigint,
  ): Promise<PostWritten> {
    const post = await db.forumPost.findFirst({
      where: { id: postId, deletedAt: null },
      select: {
        id: true,
        authorId: true,
        bodyMd: true,
        createdAt: true,
        thread: { select: { isLocked: true, category: { select: { postPerm: true } } } },
      },
    });
    if (post === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Post not found.');
    }

    /*
     * ★ ONLY THE AUTHOR REWRITES THEIR OWN WORDS ★
     *
     * Squadron owner, 2026-07-30: "only the creator may edit their own post, moderation can block
     * that post".
     *
     * This used to allow moderators, which is a different and worse thing than it sounds. A
     * moderator editing a member's post produces text attributed to somebody who did not write it,
     * with an "edited" marker that does not say by whom — indistinguishable from the author having
     * said it. Moderation removes, locks and hides; it does not put words in people's mouths.
     *
     * ★ THE ONE EXCEPTION: DOCUMENTATION ★
     *
     * Same owner, same day: "for the guides, i need to be able to edit this with the text editor as
     * the webmaster, officers too! we need to get this done! as we need to add and update the
     * processes etc".
     *
     * The guides are not somebody's opinion, they are the squadron's joining instructions, and a
     * process that changes with a guide nobody may correct becomes wrong and then becomes a support
     * burden. So a board whose `post_perm` demands FORUM_POST_GUIDE is maintained collectively by
     * everybody who holds that bit.
     *
     * Keyed on the CATEGORY'S PERMISSION rather than on its slug. A slug check would silently stop
     * working the day somebody renames the board, and would have to be copied to every new
     * documentation board. The permission is the thing that actually means "this is documentation".
     */
    const isAuthor = post.authorId === editorId;
    const maintainer = maintainsDocumentation(
      post.thread.category.postPerm === null ? null : BigInt(post.thread.category.postPerm.toFixed(0)),
      callerMask,
    );
    if (!isAuthor && !maintainer) {
      throw new AppError(
        ErrorCode.PERMISSION_DENIED,
        'Only the person who wrote a post can edit it. Report it instead if there is a problem with it.',
      );
    }

    /*
     * A locked thread stops the AUTHOR editing but not a documentation maintainer. The guides are
     * locked ON PURPOSE — they are read-only to members — so the lock cannot also be what stops
     * them being kept up to date.
     */
    if (post.thread.isLocked && !maintainer) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'This thread is locked.');
    }

    const rendered =
      typeof body === 'string' ? this.#render(body) : await this.#renderRich(body.doc, editorId);
    if (rendered.bodyMd === post.bodyMd) {
      /*
       * Nothing changed. Returning early rather than writing a revision: a history full of
       * no-op entries is a history nobody reads, and an "edited" marker on a post that is
       * identical to before is a lie.
       */
      const unchanged = await db.forumPost.findUniqueOrThrow({
        where: { id: postId },
        select: { id: true, bodyHtml: true, editCount: true },
      });
      return unchanged;
    }

    const withinGrace = Date.now() - post.createdAt.getTime() < GRACE_MS && isAuthor;

    /*
     * ★ AN EDIT IS NEW CONTENT, AND WAS NOT BEING SCREENED ★
     *
     * Found 2026-07-31 by the guard written for the opening-post bug. Screening ran on create and
     * never again, so a member could publish something clean and then edit abuse into it — the post
     * stays `clear` because nothing re-examines it.
     *
     * The owner's rule is "the ai must ingest and moderate all posts before they are visible", and
     * an edited post is visible content that has never been read. So the same verdict path applies:
     * an edit that trips the screener sends the post back to the queue rather than publishing.
     */
    const rescreened =
      this.screening === null
        ? null
        : await this.screening.screenPost(rendered.bodyMd, { userId: editorId, surface: 'web' });

    const [, updated] = await db.$transaction([
      // The body as it WAS, with who changed it and when.
      db.postRevision.create({
        data: { postId: post.id, bodyMd: post.bodyMd, editedBy: editorId },
      }),
      db.forumPost.update({
        where: { id: post.id },
        data: {
          bodyMd: rendered.bodyMd,
          bodyHtml: rendered.bodyHtml,
          /*
           * Re-stated on every edit. Leaving it alone would keep a post `clear` on the strength of
           * what it used to say, which is exactly the hole this closes.
           */
          screenState: rescreened === null ? 'clear' : rescreened.state,
          ...(rescreened === null || rescreened.state === 'clear'
            ? {}
            : { screenVerdict: rescreened.verdict as unknown as object }),
          ...('bodyDoc' in rendered ? { bodyDoc: rendered.bodyDoc as object } : {}),
          /*
           * The revision is written either way; this only governs the visible "edited"
           * marker. See GRACE_MS — flagging a typo fixed ten seconds later teaches members
           * to post twice instead of editing.
           */
          ...(withinGrace ? {} : { editedAt: new Date() }),
          editCount: { increment: 1 },
        },
        select: { id: true, bodyHtml: true, editCount: true },
      }),
    ]);

    this.reindex.enqueue({ kind: 'post', id: post.id, reason: 'edited' });

    return updated;
  }

  /**
   * Deletes a post — which means marking it deleted (INV-022).
   *
   * ★ THERE IS NO HARD DELETE IN THIS FILE, AND THAT IS CHECKABLE ★
   *
   * The invariant says forum content "never disappears from the database on a user action".
   * The way to be sure of that is for the service to contain no destructive call at all,
   * rather than for every path to remember to use the soft one. A reader can confirm it by
   * searching this file for `.delete(`.
   *
   * What a reader sees depends on who they are, and that is decided by the READ path
   * (`postsFor` filters `deletedAt: null`), not here. This only records the fact.
   */
  async softDelete(
    db: AclBoundClient,
    postId: string,
    actorId: string,
    callerMask: bigint,
  ): Promise<{ id: string; deletedAt: string }> {
    const post = await db.forumPost.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true, authorId: true, threadId: true },
    });
    if (post === null) {
      /*
       * Already-deleted answers the same as never-existed. A distinct "already deleted"
       * would confirm a post once existed, which is the same disclosure a step removed —
       * and on the officers' board the existence of a post is part of what is protected.
       */
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Post not found.');
    }

    const isAuthor = post.authorId === actorId;
    if (!isAuthor && !satisfiesMask(callerMask, Permission.FORUM_MODERATE)) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'You can only delete your own posts.');
    }

    const deletedAt = new Date();
    await db.$transaction([
      /*
       * A final revision capturing the body at the moment of deletion.
       *
       * Without it, "recoverable" would depend on an edit having happened at some point:
       * a post written once and then deleted would have no revision, and restoring it
       * would rely on the row's own bodyMd — which is fine today and is exactly the sort
       * of thing a later "scrub deleted bodies" feature would break. The revision makes
       * recoverability independent of the post row's contents.
       */
      db.postRevision.create({
        data: { postId: post.id, bodyMd: '', editedBy: actorId },
      }),
      db.forumPost.update({ where: { id: post.id }, data: { deletedAt } }),
      // The counter follows, or a thread claims replies a reader cannot find.
      db.forumThread.update({
        where: { id: post.threadId },
        data: { postCount: { decrement: 1 } },
      }),
    ]);

    this.reindex.enqueue({ kind: 'post', id: post.id, reason: 'deleted' });

    return { id: post.id, deletedAt: deletedAt.toISOString() };
  }

  /**
   * Restores a soft-deleted post. Moderators only.
   *
   * The other half of "remains recoverable" — an invariant that promises recovery and
   * ships no way to perform it is a promise about a database, not about the product.
   */
  async restore(
    db: AclBoundClient,
    postId: string,
    callerMask: bigint,
  ): Promise<{ id: string }> {
    if (!satisfiesMask(callerMask, Permission.FORUM_MODERATE)) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'Only a moderator can restore a post.');
    }

    /*
     * Deliberately looks for a DELETED post — `deletedAt: { not: null }`. Restoring a live
     * post is a no-op that would silently succeed and leave somebody wondering whether it
     * worked.
     */
    const post = await db.forumPost.findFirst({
      where: { id: postId, deletedAt: { not: null } },
      select: { id: true, threadId: true },
    });
    if (post === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No deleted post with that id.');
    }

    await db.$transaction([
      db.forumPost.update({ where: { id: post.id }, data: { deletedAt: null } }),
      db.forumThread.update({
        where: { id: post.threadId },
        data: { postCount: { increment: 1 } },
      }),
    ]);

    this.reindex.enqueue({ kind: 'post', id: post.id, reason: 'restored' });

    return { id: post.id };
  }

  /**
   * The edit history of a post. Moderators only.
   *
   * Returns WHEN and BY WHOM, not the old bodies. A moderator deciding whether a post was
   * quietly rewritten needs to know that it was; serving every previous version through an
   * API turns the revision table into a way to read text an author has removed, which is
   * not what it is for. Recovery is a deliberate act with its own path.
   */
  async history(
    db: AclBoundClient,
    postId: string,
    callerMask: bigint,
  ): Promise<RevisionView[]> {
    if (!satisfiesMask(callerMask, Permission.FORUM_MODERATE)) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'Only a moderator can read edit history.');
    }

    // Through the bound client, so an invisible post has no history either.
    const post = await db.forumPost.findFirst({ where: { id: postId }, select: { id: true } });
    if (post === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Post not found.');
    }

    const rows = await db.postRevision.findMany({
      where: { postId },
      orderBy: { editedAt: 'desc' },
      select: { editedAt: true, editor: { select: { handle: true } } },
    });

    return rows.map((r) => ({
      editedAt: r.editedAt.toISOString(),
      editedByHandle: r.editor.handle,
    }));
  }

  /**
   * A RICH body: validate the document, then generate the HTML ourselves.
   *
   * ★ THE CLIENT NEVER SUPPLIES HTML FOR A RICH POST ★
   *
   * `renderDocument` takes `RichDocument`, a type obtainable only from `validateDocument`, so
   * rendering something unvalidated is a compile error rather than a discipline. `bodyMd` is set
   * to the document's plain text — not markup — because search and notification previews want
   * words, and leaving it empty would make every rich post invisible to search.
   */
  async #renderRich(
    bodyDoc: unknown,
    authorId: string,
  ): Promise<{ bodyMd: string; bodyHtml: string; bodyDoc: unknown }> {
    const validated = validateDocument(bodyDoc);

    /*
     * ★ THUMBNAILS ARE FETCHED BEFORE THE HTML IS BUILT ★
     *
     * The document is the source of truth and the HTML is derived from it, so the thumbnail id has
     * to be in the document before rendering — otherwise the stored markup and the stored document
     * would disagree, and an edit would silently drop the preview.
     *
     * A failure here returns the document unchanged rather than throwing: losing a preview is not
     * a reason to refuse somebody's writing.
     */
    const doc =
      this.thumbnails === null
        ? validated
        : await withYouTubeThumbnails(validated, authorId, this.thumbnails).catch(() => validated);

    const bodyHtml = renderDocument(doc);
    if (bodyHtml.trim() === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Write something first.');
    }
    return { bodyMd: documentToText(doc), bodyHtml, bodyDoc: doc };
  }

  /** Sanitises, and refuses a body that came to nothing. */
  #render(bodyMd: string): { bodyMd: string; bodyHtml: string } {
    if (typeof bodyMd !== 'string' || bodyMd.trim() === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Write something first.');
    }
    if (bodyMd.length > 64_000) {
      // Generous — a long guide section is a few thousand characters — and bounded, because
      // an unbounded text column reachable by any member is a storage problem waiting.
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'That post is too long. Split it up.');
    }

    const rendered = renderPostBody(bodyMd);
    if (rendered.bodyHtml.trim() === '') {
      /*
       * Everything in it was rejected. Storing "" would leave the member looking at an
       * empty post with no explanation of what happened to their text.
       */
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Nothing in that post could be displayed safely. If it was mostly HTML, write it as Markdown instead.',
      );
    }
    return rendered;
  }
}

/**
 * Whether this caller maintains DOCUMENTATION in a board with this `post_perm`.
 *
 * A board that demands FORUM_POST_GUIDE to post in is a documentation board — that bit exists for
 * exactly one purpose and is held by the webmaster and by officers. Anybody who may write the
 * guides may also correct them, including somebody else's.
 *
 * Two conditions, and both are needed. Holding the bit is not enough (it would let a guide author
 * edit posts on the general board); the board demanding it is not enough (it would let anybody who
 * can see the guides rewrite them).
 */
function maintainsDocumentation(categoryPostPerm: bigint | null, callerMask: bigint): boolean {
  if (categoryPostPerm === null) return false;
  const documentation =
    (categoryPostPerm & Permission.FORUM_POST_GUIDE) === Permission.FORUM_POST_GUIDE;
  return documentation && satisfiesMask(callerMask, Permission.FORUM_POST_GUIDE);
}

/**
 * Whether this caller may edit this post. Presentation only — `edit` re-checks.
 *
 * ★ A FREE FUNCTION, NOT A METHOD ★
 *
 * The thread read path needs the same answer for every post on a page, and it has no reason to
 * hold a `PostService`. Exporting the rule keeps ONE definition of who may edit — the alternative
 * was a copy in the projection, which is how a button and the endpoint behind it drift apart.
 *
 * Answered by the server for the reason `canMarkSolution` is: the browser is deliberately never
 * told the permission mask, so capabilities are answered one question at a time.
 */
export function canEditPost(
  post: { authorId: string; threadLocked: boolean; categoryPostPerm: bigint | null },
  callerId: string | null,
  callerMask: bigint,
): boolean {
  if (callerId === null) return false;
  if (post.authorId === callerId) return !post.threadLocked;
  return maintainsDocumentation(post.categoryPostPerm, callerMask);
}
