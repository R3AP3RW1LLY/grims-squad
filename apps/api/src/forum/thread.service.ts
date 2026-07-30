import { AppError, ErrorCode, Permission } from '@grims/shared';
import type { AclBoundClient } from '../authz/acl-db.service.js';
import { assertSlug, satisfiesMask, type CategoryService } from './category.service.js';
import type { ReindexQueue } from './reindex.port.js';
import { renderPostBody } from './sanitize.js';
import { validateDocument, renderDocument, documentToText } from './rich-doc.js';
import type { NotifyService } from './notify.service.js';

/**
 * Threads — the conversations inside a category.
 *
 * ★ POSTING REQUIRES A DISCORD MEMBERSHIP, STRUCTURALLY ★
 *
 * Squadron owner, 2026-07-29: "all forum users must be in our discord."
 *
 * Enforced by the schema rather than a check in this file: `ForumThread.authorId`
 * is NOT NULL with a required relation to `users`, and the only way to hold a
 * user row is Discord OAuth against the guild. There is no representation for an
 * anonymous author, so there is no code path to forget to guard. `authorId`
 * always comes from the SESSION and is never accepted from a request body.
 *
 * ★ VISIBILITY IS THE BOUND CLIENT'S JOB, NOT THIS FILE'S ★
 *
 * Reads go through a client bound by `AclDbService` (INV-002). A thread in a
 * category the caller cannot see does not come back, so "gated thread returns
 * 404, never 403" falls out of the data layer rather than being asserted here.
 */

export interface ThreadView {
  readonly id: string;
  readonly categoryId: string;
  readonly slug: string;
  readonly title: string;
  readonly kind: string;
  readonly isPinned: boolean;
  readonly isLocked: boolean;
  readonly postCount: number;
  readonly viewCount: number;
  readonly lastPostAt: string | null;
  readonly createdAt: string;
  /**
   * The opener.
   *
   * `avatarUrl` is a path on OUR API, never Discord's CDN — the same convention the roster and
   * profile serializers use. `img-src 'self'` in the CSP is what makes that a rule rather than a
   * preference: a Discord URL here would simply fail to load, which is the correct outcome, since
   * it would otherwise report every forum reader to a third party.
   */
  readonly author: { handle: string; displayName: string; avatarUrl: string | null };
  /**
   * Who posted most recently, when that is not the opener.
   *
   * Null when the thread has no replies — showing the author twice would imply activity that has
   * not happened, which is precisely what somebody scanning a board is trying to judge.
   */
  readonly lastPoster: { handle: string; displayName: string; avatarUrl: string | null } | null;
}

/**
 * One post as a reader sees it.
 *
 * `bodyHtml` is pre-sanitised (INV-035), which is what makes it safe to embed without
 * escaping. There is deliberately no `bodyMd` field: the author's raw Markdown exists
 * so an edit can start from their text, and it has no business on a read path.
 */
export interface PostView {
  readonly id: string;
  readonly bodyHtml: string;
  readonly editedAt: string | null;
  readonly editCount: number;
  readonly createdAt: string;
  readonly author: { handle: string; displayName: string };
}

export interface CreateThreadInput {
  readonly categoryId: string;
  readonly title: string;
  readonly slug?: string;
  /**
   * The OPENING POST. Markdown, or a rich document from the editor.
   *
   * ★ REQUIRED, AND IT WAS NOT ★
   *
   * `create` originally took a title alone and produced a thread with no posts — a row that renders
   * as an empty page nobody can reply to usefully. It was invisible because nothing in the UI
   * called it: there was no "new thread" screen at all, which is how a thread with no body survived
   * review.
   *
   * A thread IS its opening post. Making the body part of creation means the two cannot exist
   * apart, rather than relying on a caller to remember a second request that might fail.
   */
  readonly body: string | { doc: unknown };
}

/**
 * A URL-safe slug from a title.
 *
 * Suffixed with a short random tail rather than a counter. A counter needs a read
 * before the write to find the next free number, which two people posting at once
 * both win — and `@@unique([categoryId, slug])` then rejects the second with a
 * database error rather than a message about their title.
 */
export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    // Strip accents rather than transliterate: "Ähnlich" becomes "ahnlich", which
    // is a worse title and a working URL. A slug is an address, not a rendering.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  // A title of nothing but punctuation would produce an empty slug, and an empty
  // slug collides with every other empty slug in the category.
  const stem = base === '' ? 'thread' : base;
  const tail = Math.random().toString(36).slice(2, 8);
  return `${stem}-${tail}`;
}

export class ThreadService {
  /**
   * Renders an opening post, by exactly the same rules a reply follows.
   *
   * Deliberately the same two functions `PostService` uses — `renderPostBody` for Markdown,
   * `validateDocument` + `renderDocument` for a rich document. A separate implementation here would
   * be a second sanitiser, and the second one is the one that gets it wrong.
   */
  private renderBody(body: string | { doc: unknown }): {
    bodyMd: string;
    bodyHtml: string;
    bodyDoc?: unknown;
  } {
    if (typeof body === 'string') {
      const rendered = renderPostBody(body);
      if (rendered.bodyHtml.trim() === '') {
        throw new AppError(ErrorCode.VALIDATION_FAILED, 'Write something first.');
      }
      return rendered;
    }
    const doc = validateDocument(body.doc);
    const bodyHtml = renderDocument(doc);
    if (bodyHtml.trim() === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Write something first.');
    }
    return { bodyMd: documentToText(doc), bodyHtml, bodyDoc: doc };
  }

  constructor(
    private readonly categories: CategoryService,
    private readonly reindex: ReindexQueue,
    /*
     * Injected so the prune happens in the SAME operation as the move. A separate job would leave a
     * window in which a moved thread still had subscribers who cannot see it — short, and exactly
     * the window a reply would land in.
     */
    private readonly notify: NotifyService,
  ) {}

  /**
   * Threads in a category the caller can see.
   *
   * The category is resolved through `bySlug` FIRST, which 404s when it is not
   * visible — so an invisible category cannot even be enumerated for its thread
   * count. Listing threads by category id without that step would answer "zero
   * threads" for a private category, which confirms the category exists.
   */
  async listByCategory(
    db: AclBoundClient,
    categorySlug: string,
    callerMask: bigint,
  ): Promise<ThreadView[]> {
    const category = await this.categories.bySlug(db, categorySlug, callerMask);

    const rows = await db.forumThread.findMany({
      where: { categoryId: category.id, deletedAt: null },
      orderBy: [{ isPinned: 'desc' }, { lastPostAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        categoryId: true,
        slug: true,
        title: true,
        kind: true,
        isPinned: true,
        isLocked: true,
        postCount: true,
        viewCount: true,
        lastPostAt: true,
        lastPostBy: true,
        createdAt: true,
        authorId: true,
        author: { select: { handle: true, displayName: true, avatarStoredHash: true } },
        lastPoster: {
          select: { id: true, handle: true, displayName: true, avatarStoredHash: true },
        },
      },
    });

    return rows.map(toView);
  }

  /**
   * One thread, or NOT FOUND.
   *
   * ★ 404 FOR EVERY REASON IT COULD BE UNAVAILABLE ★
   *
   * Not visible, not present, and soft-deleted all answer identically. A 403 on
   * the first would confirm the thread exists, and a distinct "deleted" response
   * would confirm it once did — which is the same disclosure a step removed.
   */
  async bySlug(
    db: AclBoundClient,
    categorySlug: string,
    threadSlug: string,
    callerMask: bigint,
  ): Promise<ThreadView> {
    const category = await this.categories.bySlug(db, categorySlug, callerMask);

    const row = await db.forumThread.findFirst({
      where: { categoryId: category.id, slug: threadSlug, deletedAt: null },
      select: {
        id: true,
        categoryId: true,
        slug: true,
        title: true,
        kind: true,
        isPinned: true,
        isLocked: true,
        postCount: true,
        viewCount: true,
        lastPostAt: true,
        lastPostBy: true,
        createdAt: true,
        authorId: true,
        author: { select: { handle: true, displayName: true, avatarStoredHash: true } },
        lastPoster: {
          select: { id: true, handle: true, displayName: true, avatarStoredHash: true },
        },
      },
    });

    if (row === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Thread not found.');
    }

    /*
     * ★ THE VIEW COUNT IS BUMPED HERE, AFTER THE ACL CHECK, AND NOT AWAITED ★
     *
     * After, because a counter that moves for a thread the caller could not read would leak that
     * the thread exists — the same disclosure the 404 above is written to avoid, arriving through
     * a number instead of a status code.
     *
     * Not awaited, because a view count is the least important thing on the page and a reader
     * should not wait on a write to see a post. A failure is swallowed for the same reason: the
     * thread renders, and the count is approximate, which is what a view count has always been.
     *
     * It counts VIEWS, not viewers — a refresh counts again. Deduplicating would mean a row per
     * member per thread, which is the table this project already declined to create for read state.
     */
    void db.forumThread
      .update({ where: { id: row.id }, data: { viewCount: { increment: 1 } } })
      .catch(() => undefined);

    return toView(row);
  }

  /**
   * The posts in a thread, oldest first.
   *
   * ★ THE THREAD IS RESOLVED THROUGH `bySlug` FIRST, AND THAT IS THE ACL STEP ★
   *
   * ForumPost is deliberately NOT an ACL-bearing model. Registering it would mean a
   * per-post predicate on a table that grows without limit, when a post's visibility
   * is entirely determined by its thread's — there is no such thing as a post you may
   * read inside a thread you may not.
   *
   * So visibility is enforced by reaching the posts only THROUGH a thread that came
   * back from `bySlug`, which 404s when the thread is invisible, soft-deleted or
   * absent. A future caller that queries `forumPost` by `threadId` directly would
   * bypass this — which is why the thread id it would need can only be obtained from
   * a call that already checked.
   *
   * ★ ORDERED OLDEST FIRST, UNLIKE THE THREAD LIST ★
   *
   * Thread lists are newest-activity-first because you want the live conversation.
   * Posts inside a thread are chronological because they are a sequence — and for the
   * joining guide, step 1 must precede step 2.
   */
  async postsFor(
    db: AclBoundClient,
    categorySlug: string,
    threadSlug: string,
    callerMask: bigint,
  ): Promise<PostView[]> {
    const thread = await this.bySlug(db, categorySlug, threadSlug, callerMask);

    const rows = await db.forumPost.findMany({
      where: { threadId: thread.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        /*
         * `bodyHtml` only — never `bodyMd`.
         *
         * The HTML is what was sanitised before storage (INV-035). The Markdown is the
         * author's original text, kept so an EDIT starts from what they wrote, and
         * shipping it to a reader would put unsanitised input on the wire where some
         * future consumer would eventually render it. A read endpoint has no use for
         * it.
         */
        bodyHtml: true,
        editedAt: true,
        editCount: true,
        createdAt: true,
        author: { select: { handle: true, displayName: true } },
      },
    });

    return rows.map((p) => ({
      id: p.id,
      bodyHtml: p.bodyHtml,
      editedAt: p.editedAt?.toISOString() ?? null,
      editCount: p.editCount,
      createdAt: p.createdAt.toISOString(),
      author: {
        handle: p.author.handle,
        displayName: p.author.displayName ?? p.author.handle,
      },
    }));
  }

  /**
   * Starts a thread. The author is the SESSION's user, never a parameter.
   *
   * `canPost` is recomputed from the category rather than trusted from the
   * client: the list endpoint sends a boolean for rendering, and a boolean sent
   * to a browser is a boolean a browser can change.
   */
  async create(
    db: AclBoundClient,
    input: CreateThreadInput,
    authorId: string,
    callerMask: bigint,
  ): Promise<{ id: string; slug: string }> {
    const title = input.title.trim();
    if (title.length < 3 || title.length > 200) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'A title is between 3 and 200 characters.');
    }

    /*
     * Read through the BOUND client, so a category the caller cannot see is not
     * found — rather than found and then refused, which would confirm it exists.
     */
    const category = await db.forumCategory.findUnique({
      where: { id: input.categoryId },
      select: { id: true, isLocked: true, postPerm: true },
    });
    if (category === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Category not found.');
    }

    if (category.isLocked) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'This category is locked.');
    }

    const postPerm =
      category.postPerm === null ? null : BigInt(category.postPerm.toFixed(0));
    if (!satisfiesMask(callerMask, postPerm)) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'You cannot post in this category.');
    }

    const slug = input.slug ?? slugify(title);
    assertSlug(slug);

    /*
     * Rendered BEFORE the write, so a body that cannot be stored fails without leaving a titled
     * thread with nothing in it. The same reasoning as the post service: the expensive, refusable
     * work happens before anything is persisted.
     */
    const rendered = this.renderBody(input.body);

    const created = await db.forumThread.create({
      data: {
        categoryId: category.id,
        authorId,
        slug,
        title,
        // The counters are set here rather than by a follow-up update: a thread that briefly claims
        // zero posts is a thread a board listing can render as empty.
        postCount: 1,
        lastPostAt: new Date(),
        lastPostBy: authorId,
        /*
         * The opening post, created in the SAME statement. Prisma nests this into one transaction,
         * so a thread cannot exist without its first post — which is the invariant the old
         * title-only signature quietly broke.
         */
        posts: {
          create: [
            {
              authorId,
              bodyMd: rendered.bodyMd,
              bodyHtml: rendered.bodyHtml,
              ...('bodyDoc' in rendered ? { bodyDoc: rendered.bodyDoc as object } : {}),
            },
          ],
        },
      },
      select: { id: true, slug: true },
    });

    // A new thread has content to index. Enqueued here rather than at P8, because
    // the call site is the thing that gets forgotten.
    await this.reindex.enqueue({ kind: 'thread', id: created.id, reason: 'created' });

    return created;
  }

  /**
   * What a notification needs to name a thread: its title, and where it lives.
   *
   * ★ HERE RATHER THAN IN THE CONTROLLER ★
   *
   * The controller did this read directly and the static ACL guard caught it — correctly. It was
   * using a bound client so it was safe, but the guard cannot see that, and an exemption for a
   * CONTROLLER would be the wrong precedent: controllers are where a second, unbound read would
   * eventually be added by somebody who saw the first one and copied it.
   *
   * Returns null for a thread the caller cannot see, so a notification cannot be composed for one.
   */
  async notificationTarget(
    db: AclBoundClient,
    threadId: string,
  ): Promise<{ title: string; slug: string; categorySlug: string } | null> {
    const thread = await db.forumThread.findFirst({
      where: { id: threadId, deletedAt: null },
      select: { title: true, slug: true, category: { select: { slug: true } } },
    });
    if (thread === null) return null;
    return { title: thread.title, slug: thread.slug, categorySlug: thread.category.slug };
  }

  /**
   * Moves a thread to another category. Requires FORUM_MODERATE.
   *
   * ★ THE MOVE THAT CHANGES VISIBILITY IS WHY INV-003 EXISTS ★
   *
   * Moving a thread from a public category to an officer one changes who may read
   * it — and any knowledge chunks already indexed from its posts still carry the
   * OLD visibility. Until they are re-indexed, a Ring 0 retrieval can surface
   * officer content through search or the AI even though the thread itself is
   * correctly hidden.
   *
   * So the enqueue is not bookkeeping; it is the second half of the move.
   */
  async move(
    db: AclBoundClient,
    threadId: string,
    toCategoryId: string,
    callerMask: bigint,
  ): Promise<number> {
    if ((callerMask & Permission.FORUM_MODERATE) !== Permission.FORUM_MODERATE) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'You cannot move threads.');
    }

    // Both ends read through the bound client: a moderator cannot move a thread
    // out of, or into, a branch they cannot see.
    const thread = await db.forumThread.findUnique({
      where: { id: threadId },
      select: { id: true, categoryId: true },
    });
    if (thread === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Thread not found.');
    }

    const target = await db.forumCategory.findUnique({
      where: { id: toCategoryId },
      select: { id: true },
    });
    if (target === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Category not found.');
    }

    if (thread.categoryId === target.id) return 0; // Nothing to do, and nothing to reindex.

    await db.forumThread.update({
      where: { id: thread.id },
      data: { categoryId: target.id },
    });

    /*
     * ★ THE SUBSCRIPTION PRUNE (INV-039, SECOND HALF) ★
     *
     * Moving a thread must remove subscriptions whose holders cannot see where it went. Done AFTER
     * the update, deliberately: `pruneOnMove` reads the destination's viewPerm and the subscriber
     * list, and doing it first would prune against a board the thread had not moved to yet — which
     * is correct only until the update fails.
     *
     * The count is RETURNED rather than logged, so the caller can tell the moderator. A silent
     * prune means somebody loses a subscription with no idea why they stopped hearing about a
     * thread they were following.
     */
    const pruned = await this.notify.pruneOnMove(db, thread.id, target.id);

    await this.reindex.enqueue({ kind: 'thread', id: thread.id, reason: 'moved' });

    return pruned;
  }
}

/**
 * The avatar path for a member, or null when they have none.
 *
 * Keyed on `avatarStoredHash` rather than on `avatarUrl` — which, despite its name, holds Discord's
 * avatar HASH, not an address. Emitting that field directly is the mistake this helper exists to
 * make impossible; the profile serializer carries the same note for the same reason.
 */
function avatarPath(userId: string, storedHash: string | null): string | null {
  return storedHash === null ? null : `/v1/media/avatars/${userId}`;
}

function toView(r: {
  id: string;
  categoryId: string;
  slug: string;
  title: string;
  kind: string;
  isPinned: boolean;
  isLocked: boolean;
  postCount: number;
  viewCount: number;
  lastPostAt: Date | null;
  lastPostBy: string | null;
  createdAt: Date;
  authorId: string;
  author: { handle: string; displayName: string; avatarStoredHash: string | null };
  lastPoster: {
    id: string;
    handle: string;
    displayName: string;
    avatarStoredHash: string | null;
  } | null;
}): ThreadView {
  /*
   * The last poster is omitted when it IS the opener.
   *
   * A board row exists to answer "has anything happened here". Showing the same person on both ends
   * of a row with no replies answers it wrongly — it looks like a conversation. `lastPostBy` is also
   * nullable because the relation is `onDelete: SetNull`, so a departed member leaves the thread
   * intact rather than taking it with them; that case reads as "no distinct last poster", which is
   * true and needs no special rendering.
   */
  const distinctLastPoster =
    r.lastPoster !== null && r.lastPoster.id !== r.authorId
      ? {
          handle: r.lastPoster.handle,
          displayName: r.lastPoster.displayName,
          avatarUrl: avatarPath(r.lastPoster.id, r.lastPoster.avatarStoredHash),
        }
      : null;

  return {
    id: r.id,
    categoryId: r.categoryId,
    slug: r.slug,
    title: r.title,
    kind: String(r.kind),
    isPinned: r.isPinned,
    isLocked: r.isLocked,
    postCount: r.postCount,
    viewCount: r.viewCount,
    lastPostAt: r.lastPostAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    author: {
      handle: r.author.handle,
      displayName: r.author.displayName,
      avatarUrl: avatarPath(r.authorId, r.author.avatarStoredHash),
    },
    lastPoster: distinctLastPoster,
  };
}
