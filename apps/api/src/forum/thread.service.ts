import { AppError, ErrorCode, Permission } from '@grims/shared';
import type { AclBoundClient } from '../authz/acl-db.service.js';
import { assertSlug, satisfiesMask, type CategoryService } from './category.service.js';
import type { ReindexQueue } from './reindex.port.js';
import { renderPostBody } from './sanitize.js';
import { validateDocument, renderDocument, documentToText } from './rich-doc.js';
import type { NotifyService } from './notify.service.js';
import { ALLOWED_REACTIONS, type ReactionCount } from './engage.service.js';
import { canEditPost } from './post.service.js';

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
  /**
   * Whether THIS caller may mark a reply as the answer.
   *
   * ★ ANSWERED BY THE SERVER, NOT DERIVED IN THE BROWSER ★
   *
   * The obvious client-side version compares the signed-in handle to the thread author's, which
   * gets the common case right and silently excludes moderators — and would have to be corrected
   * in every component that draws the button. Worse, it is a copy of an authorisation rule living
   * somewhere a member can edit. `/me` deliberately does not ship the permission mask, and this is
   * why: capabilities are answered one question at a time, by the side that owns the rule.
   *
   * Presentation only. `markSolution` re-checks.
   */
  readonly canMarkSolution: boolean;
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
  /** The author's id — what the signature map is keyed on. */
  readonly authorId: string;
  readonly bodyHtml: string;
  readonly editedAt: string | null;
  readonly editCount: number;
  readonly createdAt: string;
  readonly author: { handle: string; displayName: string; avatarUrl: string | null };
  /**
   * The post this one answers, when it answers a particular one.
   *
   * * WHO AND WHERE, NEVER WHAT *
   *
   * An excerpt of the parent would be the obvious thing to include and is the wrong thing. The only
   * text we hold that is not already rendered is `bodyMd`, which is the author's UNSANITISED input
   * - and the rule this file already states is that it does not leave the server. An "excerpt"
   * field would be exactly the future consumer that eventually renders it.
   *
   * So this carries an id and a name: enough for "In reply to Grim" with a link that jumps to the
   * post, which is what a reader wants anyway. QUOTING is a compose-time action and happens in the
   * browser, from text already on the page.
   */
  readonly replyTo: { postId: string; author: { handle: string; displayName: string } } | null;
  /** Marked as the answer. At most one per thread - see `markSolution`. */
  readonly isSolution: boolean;
  /** Reaction tallies, already including whether the caller reacted. */
  readonly reactions: readonly ReactionCount[];
  /**
   * Whether THIS caller may rewrite this post.
   *
   * Server-decided, like `canMarkSolution`. It is what puts an Edit button on the guides for
   * officers and the webmaster without the browser knowing why it may.
   */
  readonly canEdit: boolean;
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
    /** Null when signed out — nobody is the author, so no capability is granted. */
    callerId: string | null = null,
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

    return {
      ...toView(row),
      canMarkSolution:
        callerId !== null &&
        (row.authorId === callerId ||
          (callerMask & Permission.FORUM_MODERATE) === Permission.FORUM_MODERATE),
    };
  }

  /**
   * Records that somebody looked at a thread.
   *
   * ★ WHY THIS IS NOT INSIDE `bySlug` ★
   *
   * It was, and it double-counted. `postsFor` resolves the thread through `bySlug` as its ACL step,
   * so one page view produced two increments — and `markSolution` does the same, meaning marking an
   * answer counted as reading the thread. A lookup helper is the wrong place to decide that a HUMAN
   * looked at something; only a route knows that.
   *
   * ★ THE CALLER MUST HAVE ALREADY READ THE THREAD ★
   *
   * This takes an id that can only have come from a successful `bySlug`, and the controller calls
   * it after that resolves. A counter that moved on a refused read would be an oracle for whether
   * a private thread exists — the disclosure the uniform 404 exists to prevent, arriving through a
   * number instead of a status code.
   *
   * Not awaited by callers, and failure is swallowed: a view count is the least important thing on
   * the page, and a reader should not wait on it or lose the page to it.
   *
   * It counts VIEWS, not viewers — a refresh counts again. Deduplicating would mean a row per
   * member per thread, which is the table this project already declined to create for read state.
   */
  async recordView(db: AclBoundClient, threadId: string): Promise<void> {
    await db.forumThread
      .update({ where: { id: threadId }, data: { viewCount: { increment: 1 } } })
      .catch(() => undefined);
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
    /** Null for a signed-out reader: their own reaction state is absent, not false. */
    callerId: string | null = null,
  ): Promise<PostView[]> {
    const thread = await this.bySlug(db, categorySlug, threadSlug, callerMask);

    const rows = await db.forumPost.findMany({
      /*
       * ★ HELD POSTS ARE INVISIBLE TO EVERYONE, INCLUDING THEIR AUTHOR ★
       *
       * Squadron owner, 2026-07-30: "the ai must ingest and moderate all posts before they are
       * visible / posted to the forum". `screenState: 'clear'` is that rule, expressed where it
       * cannot be forgotten — in the query, beside the soft-delete filter it resembles.
       *
       * Showing a member their OWN held post was the tempting exception and is the wrong one: they
       * would see it in the thread, assume it published, and wonder why nobody replied for two
       * days. Being told plainly that it is waiting is kinder than seeing a post that is not there.
       *
       * Officers reviewing held posts read them through the moderation queue, which queries this
       * column the other way round on purpose.
       */
      where: { threadId: thread.id, deletedAt: null, screenState: 'clear' },
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
        isSolution: true,
        authorId: true,
        thread: { select: { isLocked: true, category: { select: { postPerm: true } } } },
        author: { select: { handle: true, displayName: true, avatarStoredHash: true } },
        /*
         * The parent's AUTHOR, not its body. One join rather than a second query per post - a
         * thread with sixty replies would otherwise issue sixty-one reads to render one page.
         */
        replyTo: {
          select: { id: true, author: { select: { handle: true, displayName: true } } },
        },
      },
    });

    /*
     * * ONE GROUPED QUERY FOR THE WHOLE THREAD'S REACTIONS *
     *
     * The per-post `reactionsFor` is right for a toggle response and wrong here: called in a loop
     * it is two queries per post. This is two for the page, whatever its length.
     */
    const postIds = rows.map((p) => p.id);
    const [tallies, mine] = await Promise.all([
      postIds.length === 0
        ? Promise.resolve([])
        : db.forumReaction.groupBy({
            by: ['postId', 'emoji'],
            where: { postId: { in: postIds } },
            _count: { emoji: true },
          }),
      postIds.length === 0 || callerId === null
        ? Promise.resolve([])
        : db.forumReaction.findMany({
            where: { postId: { in: postIds }, userId: callerId },
            select: { postId: true, emoji: true },
          }),
    ]);

    const mineByPost = new Map<string, Set<string>>();
    for (const r of mine) {
      const set = mineByPost.get(r.postId) ?? new Set<string>();
      set.add(r.emoji);
      mineByPost.set(r.postId, set);
    }

    return rows.map((p) => ({
      id: p.id,
      authorId: p.authorId,
      bodyHtml: p.bodyHtml,
      editedAt: p.editedAt?.toISOString() ?? null,
      editCount: p.editCount,
      createdAt: p.createdAt.toISOString(),
      isSolution: p.isSolution,
      author: {
        handle: p.author.handle,
        displayName: p.author.displayName ?? p.author.handle,
        avatarUrl: avatarPath(p.authorId, p.author.avatarStoredHash),
      },
      replyTo:
        p.replyTo === null
          ? null
          : {
              postId: p.replyTo.id,
              author: {
                handle: p.replyTo.author.handle,
                displayName: p.replyTo.author.displayName ?? p.replyTo.author.handle,
              },
            },
      reactions: tallyFor(tallies, mineByPost.get(p.id) ?? new Set(), p.id),
      /*
       * The author, or somebody who maintains a DOCUMENTATION board. Never a moderator on the
       * strength of moderating: a moderator rewriting a member's post produces words attributed to
       * somebody who did not write them. Moderation removes; it does not rewrite.
       *
       * Mirrors `PostService.canEdit` — the button has to agree with the rule, or the guides show
       * an Edit control that always refuses.
       */
      canEdit: canEditPost(
        {
          authorId: p.authorId,
          threadLocked: p.thread.isLocked,
          categoryPostPerm:
            p.thread.category.postPerm === null
              ? null
              : BigInt(p.thread.category.postPerm.toFixed(0)),
        },
        callerId,
        callerMask,
      ),
    }));
  }

  /**
   * Marks one reply as the answer, or clears the mark.
   *
   * * WHO MAY DO THIS *
   *
   * The person who ASKED, or a moderator. Not the author of the reply - otherwise marking your own
   * post as the answer is a button, and on a board this size that is a small status game nobody
   * needs. The member who started the thread is the one who knows whether it was answered.
   *
   * * AT MOST ONE PER THREAD, ENFORCED BY CLEARING FIRST *
   *
   * Two "answers" is the same as none - a reader scrolling for the marker finds two and has to
   * read both anyway. Clear-then-set runs in a transaction so a failure cannot leave a thread with
   * zero marks when it had one.
   */
  async markSolution(
    db: AclBoundClient,
    categorySlug: string,
    threadSlug: string,
    postId: string,
    caller: { userId: string; mask: bigint },
    /** Defaults to MARKING. Un-marking is the deliberate act and reads better written out. */
    solution = true,
  ): Promise<void> {
    const thread = await this.bySlug(db, categorySlug, threadSlug, caller.mask);

    const threadRow = await db.forumThread.findFirst({
      where: { id: thread.id },
      select: { authorId: true },
    });

    const moderates = (caller.mask & Permission.FORUM_MODERATE) === Permission.FORUM_MODERATE;
    if (threadRow?.authorId !== caller.userId && !moderates) {
      throw new AppError(
        ErrorCode.PERMISSION_DENIED,
        'Only the member who started the thread, or a moderator, can mark the answer.',
      );
    }

    /*
     * Scoped to THIS thread. Without `threadId` a caller could pass any post id they can see and
     * mark it as the answer to a different thread - the same class of mistake the reply-target
     * check in `PostService` exists to prevent.
     */
    const post = await db.forumPost.findFirst({
      where: { id: postId, threadId: thread.id, deletedAt: null },
      select: { id: true },
    });
    if (post === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Post not found.');
    }

    await db.$transaction([
      db.forumPost.updateMany({
        where: { threadId: thread.id, isSolution: true },
        data: { isSolution: false },
      }),
      ...(solution
        ? [db.forumPost.update({ where: { id: post.id }, data: { isSolution: true } })]
        : []),
    ]);
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
    /*
     * ★ findFirst, NEVER findUnique, ON AN ACL-BOUND MODEL ★
     *
     * `findUnique` takes a `WhereUniqueInput`, which must carry a unique field at the TOP level.
     * The ACL extension merges its predicate in as `{ AND: [ {id}, {id: {in: [...]}} ] }` — a
     * perfectly good filter and an illegal unique input — so Prisma threw a validation error and
     * EVERY thread creation 500'd, whatever the post contained.
     *
     * `findFirst` accepts an arbitrary filter, so the merged predicate is valid and a category the
     * caller cannot see comes back null exactly as intended rather than blowing up. The fake used
     * in unit tests implements `findUnique` loosely and never enforced Prisma's rule, which is how
     * this reached production-shaped code with a green suite.
     */
    const category = await db.forumCategory.findFirst({
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
    const thread = await db.forumThread.findFirst({
      where: { id: threadId },
      select: { id: true, categoryId: true },
    });
    if (thread === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Thread not found.');
    }

    const target = await db.forumCategory.findFirst({
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
/** Turns the thread-wide reaction rollup into one post's tallies, in the fixed display order. */
function tallyFor(
  tallies: ReadonlyArray<{ postId: string; emoji: string; _count: { emoji: number } }>,
  mine: ReadonlySet<string>,
  postId: string,
): ReactionCount[] {
  return ALLOWED_REACTIONS.map((emoji) => ({
    emoji,
    count: tallies.find((t) => t.postId === postId && t.emoji === emoji)?._count.emoji ?? 0,
    mine: mine.has(emoji),
  })).filter((r) => r.count > 0 || r.mine);
}

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
    /*
     * FALSE from the list projection, always. Nobody marks an answer from a board index, and
     * computing it per row would mean carrying the caller's identity into a function whose whole
     * job is shaping a row. `bySlug` overrides it for the one page that draws the button.
     */
    canMarkSolution: false,
  };
}
