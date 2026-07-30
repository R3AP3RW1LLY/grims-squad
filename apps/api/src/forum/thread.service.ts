import { AppError, ErrorCode, Permission } from '@grims/shared';
import type { AclBoundClient } from '../authz/acl-db.service.js';
import { assertSlug, satisfiesMask, type CategoryService } from './category.service.js';
import type { ReindexQueue } from './reindex.port.js';

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
  ): Promise<void> {
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

    if (thread.categoryId === target.id) return; // Nothing to do, and nothing to reindex.

    await db.forumThread.update({
      where: { id: thread.id },
      data: { categoryId: target.id },
    });

    await this.reindex.enqueue({ kind: 'thread', id: thread.id, reason: 'moved' });
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
