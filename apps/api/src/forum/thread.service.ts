import { AppError, ErrorCode, Permission } from '@grims/shared';
import type { AclBoundClient } from '../authz/acl-db.service.js';
import { assertSlug, satisfiesMask, type CategoryService } from './category.service.js';
import type { ReindexQueue } from './reindex.port.js';
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
  readonly lastPostAt: string | null;
  readonly createdAt: string;
  readonly author: { handle: string; displayName: string };
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
        lastPostAt: true,
        createdAt: true,
        author: { select: { handle: true, displayName: true } },
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
        lastPostAt: true,
        createdAt: true,
        author: { select: { handle: true, displayName: true } },
      },
    });

    if (row === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Thread not found.');
    }
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

    const created = await db.forumThread.create({
      data: { categoryId: category.id, authorId, slug, title },
      select: { id: true, slug: true },
    });

    // A new thread has content to index. Enqueued here rather than at P8, because
    // the call site is the thing that gets forgotten.
    await this.reindex.enqueue({ kind: 'thread', id: created.id, reason: 'created' });

    return created;
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

function toView(r: {
  id: string;
  categoryId: string;
  slug: string;
  title: string;
  kind: string;
  isPinned: boolean;
  isLocked: boolean;
  postCount: number;
  lastPostAt: Date | null;
  createdAt: Date;
  author: { handle: string; displayName: string };
}): ThreadView {
  return {
    id: r.id,
    categoryId: r.categoryId,
    slug: r.slug,
    title: r.title,
    kind: String(r.kind),
    isPinned: r.isPinned,
    isLocked: r.isLocked,
    postCount: r.postCount,
    lastPostAt: r.lastPostAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    author: r.author,
  };
}
