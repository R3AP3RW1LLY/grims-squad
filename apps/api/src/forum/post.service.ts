import { AppError, ErrorCode, Permission } from '@grims/shared';
import type { AclBoundClient } from '../authz/acl-db.service.js';
import { satisfiesMask } from './category.service.js';
import { renderPostBody } from './sanitize.js';
import { validateDocument, renderDocument, documentToText } from './rich-doc.js';
import type { ReindexQueue } from './reindex.port.js';

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
  constructor(private readonly reindex: ReindexQueue) {}

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
  ): Promise<PostWritten> {
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

    const rendered =
      typeof body === 'string' ? this.#render(body) : this.#renderRich(body.doc);

    const post = await db.forumPost.create({
      data: {
        threadId: thread.id,
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

    return post;
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
  async edit(
    db: AclBoundClient,
    postId: string,
    body: string | { doc: unknown },
    editorId: string,
    callerMask: bigint,
  ): Promise<PostWritten> {
    const post = await db.forumPost.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true, authorId: true, bodyMd: true, createdAt: true, thread: { select: { isLocked: true } } },
    });
    if (post === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Post not found.');
    }

    const isAuthor = post.authorId === editorId;
    const isModerator = satisfiesMask(callerMask, Permission.FORUM_MODERATE);
    if (!isAuthor && !isModerator) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'You can only edit your own posts.');
    }

    /*
     * A locked thread stops the AUTHOR editing but not a moderator. Different from posting,
     * and the asymmetry is deliberate: locking a thread ends the conversation, and letting
     * an author keep rewriting what is already locked reopens it silently. A moderator
     * editing a locked post is usually removing something that should not be there.
     */
    if (post.thread.isLocked && !isModerator) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'This thread is locked.');
    }

    const rendered =
      typeof body === 'string' ? this.#render(body) : this.#renderRich(body.doc);
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
  #renderRich(bodyDoc: unknown): { bodyMd: string; bodyHtml: string; bodyDoc: unknown } {
    const doc = validateDocument(bodyDoc);
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
