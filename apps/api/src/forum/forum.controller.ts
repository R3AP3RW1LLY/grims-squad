import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, Inject } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { User, type CurrentUser } from '../auth/current-user.js';
import { Public } from '../auth/auth.guard.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import { AclDbService } from '../authz/acl-db.service.js';
import { PermissionService } from '../authz/permission.service.js';
import { CategoryService, type CategoryView } from './category.service.js';
import { ThreadService, type ThreadView, type PostView } from './thread.service.js';
import { GrantService, type GrantView, type GranteeCandidate } from './grant.service.js';
import { PostService, type RevisionView } from './post.service.js';

/**
 * The forum's HTTP surface.
 *
 * ★ EVERY READ GOES THROUGH A BOUND CLIENT, AND THAT IS THE WHOLE SECURITY STORY ★
 *
 * This controller resolves the caller's principal once and hands a bound client
 * to the services (INV-002). It performs no visibility check of its own — a check
 * here would be a second place to get it wrong, and the second route onto the
 * same data is the one that gets forgotten.
 *
 * ★ READS ARE @Public, WRITES ARE NOT ★
 *
 * Squadron owner, 2026-07-29: "all forum users must be in our discord." That is a
 * rule about PARTICIPATING. Reading is governed per-category by `viewPerm`, and an
 * anonymous caller resolves to `ANONYMOUS` (mask 0) — so they see categories
 * marked public and nothing else. If every category is created members-only, the
 * board is members-only, without that being hard-coded here.
 *
 * Writing requires a session, because `authorId` is NOT NULL and comes from that
 * session. There is no anonymous author to represent.
 */
@Controller('v1/forum')
export class ForumController {
  constructor(
    @Inject(AclDbService) private readonly acl: AclDbService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(CategoryService) private readonly categories: CategoryService,
    @Inject(ThreadService) private readonly threads: ThreadService,
    @Inject(GrantService) private readonly grants: GrantService,
    @Inject(PostService) private readonly posts: PostService,
  ) {}

  /**
   * The caller's mask, for the decisions the data layer cannot make.
   *
   * The ACL filters what comes BACK. `canPost`, and whether a write is allowed at
   * all, are questions about a row that does not exist yet — so the mask is
   * needed here too. Resolved from the session's user id, never from the request.
   */
  async #mask(caller: CurrentUser | undefined): Promise<bigint> {
    if (caller === undefined) return 0n;
    return this.permissions.effectiveMask(caller.userId);
  }

  @Public()
  @Get('categories')
  async listCategories(
    @User() caller: CurrentUser | undefined,
  ): Promise<{ categories: CategoryView[] }> {
    const db = await this.acl.forCaller(caller?.userId);
    return { categories: await this.categories.list(db, await this.#mask(caller)) };
  }

  @Public()
  @Get('categories/:slug/threads')
  async listThreads(
    @User() caller: CurrentUser | undefined,
    @Param('slug') slug: string,
  ): Promise<{ category: CategoryView; threads: ThreadView[] }> {
    const db = await this.acl.forCaller(caller?.userId);
    const mask = await this.#mask(caller);
    /*
     * The category is resolved first and 404s when invisible, so an unauthorised
     * caller cannot even learn the thread COUNT of a private category — "zero
     * threads" would confirm it exists.
     */
    const category = await this.categories.bySlug(db, slug, mask);
    return { category, threads: await this.threads.listByCategory(db, slug, mask) };
  }

  @Public()
  @Get('categories/:slug/threads/:threadSlug')
  async thread(
    @User() caller: CurrentUser | undefined,
    @Param('slug') slug: string,
    @Param('threadSlug') threadSlug: string,
  ): Promise<{ thread: ThreadView; posts: PostView[] }> {
    const db = await this.acl.forCaller(caller?.userId);
    const mask = await this.#mask(caller);
    /*
     * Thread and posts together, in one response. Two round trips would mean a reader
     * could receive the thread and then a 404 for its posts, and a page that has to
     * handle "the thread exists but its contents do not" is a page handling a state
     * that cannot legitimately occur.
     *
     * `postsFor` re-resolves the thread through the same ACL path rather than taking
     * an id from here — one redundant lookup of a tens-of-rows table, in exchange for
     * the posts read being independently safe if it is ever called from anywhere else.
     */
    const [thread, posts] = await Promise.all([
      this.threads.bySlug(db, slug, threadSlug, mask),
      this.threads.postsFor(db, slug, threadSlug, mask),
    ]);
    return { thread, posts };
  }

  /**
   * Starts a thread. Requires a session — see the note on Discord membership.
   *
   * NOT @Public. An unauthenticated caller is refused before any work happens,
   * rather than reaching the service and failing on a null author, because the
   * error a member sees should say "sign in" and not describe a database column.
   */
  @Post('categories/:slug/threads')
  async createThread(
    @User() caller: CurrentUser | undefined,
    @Param('slug') slug: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ id: string; slug: string }> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to post.');
    }
    csrf(req);

    const title = (body as { title?: unknown } | null)?.title;
    if (typeof title !== 'string') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'A title is required.');
    }

    const db = await this.acl.forCaller(caller.userId);
    const mask = await this.#mask(caller);
    const category = await this.categories.bySlug(db, slug, mask);

    return this.threads.create(
      db,
      { categoryId: category.id, title },
      caller.userId,
      mask,
    );
  }

  /*
   * ★ PER-THREAD ACCESS GRANTS ★
   *
   * Squadron owner, 2026-07-29: "non-officers should not have the ability to view
   * unless permission to a specific user is provided this should be done from a
   * dropdown on the post that allows an admin to allow access to one or more users
   * (multi select dropdown that is searchable and autocompletable)".
   *
   * None of the four routes below is @Public, and none of them takes the caller's
   * permissions from the request. Every one resolves the mask server-side from the
   * session and hands the SERVICE a client bound to that caller — which is what makes
   * "you cannot grant access to a thread you cannot see" true without this controller
   * checking anything.
   *
   * The thread is addressed by ID rather than by category-and-slug, unlike the read
   * routes. A grant is administrative: it is issued from a screen that already has the
   * thread loaded, and a slug can change while an id cannot.
   */

  @Get('threads/:threadId/grants')
  async listGrants(
    @User() caller: CurrentUser | undefined,
    @Param('threadId') threadId: string,
  ): Promise<{ grants: GrantView[] }> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to manage access.');
    }
    const db = await this.acl.forCaller(caller.userId);
    return { grants: await this.grants.list(db, threadId) };
  }

  /**
   * Candidates for the dropdown.
   *
   * A GET with the query in the URL, deliberately: it is a read, it is idempotent, and
   * a two-character fragment of a handle is not a secret. The response is capped and
   * filtered server-side so this cannot be used to walk the roster — see
   * `GrantService.search`.
   */
  @Get('threads/:threadId/grants/candidates')
  async grantCandidates(
    @User() caller: CurrentUser | undefined,
    @Param('threadId') threadId: string,
    @Query('q') q: string | undefined,
  ): Promise<{ candidates: GranteeCandidate[] }> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to manage access.');
    }
    const db = await this.acl.forCaller(caller.userId);
    return {
      candidates: await this.grants.search(db, threadId, q ?? '', await this.#mask(caller)),
    };
  }

  /** Grants the named users read access. One request for the whole multi-select. */
  @Post('threads/:threadId/grants')
  async addGrants(
    @User() caller: CurrentUser | undefined,
    @Param('threadId') threadId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ grants: GrantView[] }> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to manage access.');
    }
    csrf(req);

    const raw = body as { userIds?: unknown; reason?: unknown } | null;
    /*
     * Validated to a string[] here rather than trusted. `userIds` arrives from a
     * browser and reaches a `where: { id: { in: … } }` — Prisma parameterises it, so
     * this is not an injection risk, but an array containing an object or a nested
     * array is a 500 rather than a message anybody can act on.
     */
    const userIds = Array.isArray(raw?.userIds) ? raw.userIds : [];
    if (!userIds.every((v): v is string => typeof v === 'string' && v.length > 0)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Pick the people to give access to.');
    }
    const reason = typeof raw?.reason === 'string' && raw.reason.trim() !== '' ? raw.reason.trim() : null;

    const db = await this.acl.forCaller(caller.userId);
    return {
      grants: await this.grants.grant(
        db,
        threadId,
        userIds,
        caller.userId,
        await this.#mask(caller),
        reason,
      ),
    };
  }

  /**
   * Revokes one grant.
   *
   * DELETE, and still CSRF-checked: `verifyCsrf` keys off the METHOD, so a route that
   * changes state must pass through it whichever verb it uses. A DELETE that skipped
   * the check because it carries no body would be exactly the gap CSRF protection is
   * for.
   */
  @Delete('threads/:threadId/grants/:userId')
  async revokeGrant(
    @User() caller: CurrentUser | undefined,
    @Param('threadId') threadId: string,
    @Param('userId') userId: string,
    @Req() req: FastifyRequest,
  ): Promise<{ grants: GrantView[] }> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to manage access.');
    }
    csrf(req);

    const db = await this.acl.forCaller(caller.userId);
    return {
      grants: await this.grants.revoke(db, threadId, userId, await this.#mask(caller)),
    };
  }

  /*
   * ★ POSTS — INV-035 AND INV-022 ★
   *
   * Every body goes through `renderPostBody` inside PostService, which is the only path to
   * a stored body. Nothing here sanitises, and nothing here deletes: `softDelete` marks a
   * row, and a reader can confirm the absence of a hard delete by searching that service.
   */

  @Post('threads/:threadId/posts')
  async reply(
    @User() caller: CurrentUser | undefined,
    @Param('threadId') threadId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ id: string; bodyHtml: string; editCount: number }> {
    const c = requireSession(caller, 'Sign in to reply.');
    csrf(req);
    const bodyMd = readBody(body);

    const db = await this.acl.forCaller(c.userId);
    return this.posts.create(db, threadId, bodyMd, c.userId, await this.#mask(caller));
  }

  /**
   * Edits a post. PATCH, because it changes one field of an existing thing.
   */
  @Patch('posts/:postId')
  async editPost(
    @User() caller: CurrentUser | undefined,
    @Param('postId') postId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ id: string; bodyHtml: string; editCount: number }> {
    const c = requireSession(caller, 'Sign in to edit.');
    csrf(req);
    const bodyMd = readBody(body);

    const db = await this.acl.forCaller(c.userId);
    return this.posts.edit(db, postId, bodyMd, c.userId, await this.#mask(caller));
  }

  /**
   * Deletes a post — soft, always (INV-022).
   *
   * DELETE is the honest verb for what the member is doing, even though the row survives.
   * Naming the route `/soft-delete` would leak an implementation detail into a URL and
   * invite somebody to look for the hard one.
   */
  @Delete('posts/:postId')
  async deletePost(
    @User() caller: CurrentUser | undefined,
    @Param('postId') postId: string,
    @Req() req: FastifyRequest,
  ): Promise<{ id: string; deletedAt: string }> {
    const c = requireSession(caller, 'Sign in to delete.');
    csrf(req);

    const db = await this.acl.forCaller(c.userId);
    return this.posts.softDelete(db, postId, c.userId, await this.#mask(caller));
  }

  /**
   * Restores a deleted post. Moderators only.
   *
   * The other half of "remains recoverable". An invariant promising recovery with no way to
   * perform it is a promise about a database rather than about the product.
   */
  @Post('posts/:postId/restore')
  async restorePost(
    @User() caller: CurrentUser | undefined,
    @Param('postId') postId: string,
    @Req() req: FastifyRequest,
  ): Promise<{ id: string }> {
    const c = requireSession(caller, 'Sign in to restore.');
    csrf(req);

    const db = await this.acl.forCaller(c.userId);
    return this.posts.restore(db, postId, await this.#mask(caller));
  }

  /** When a post was edited and by whom. Moderators only; never the old bodies. */
  @Get('posts/:postId/history')
  async postHistory(
    @User() caller: CurrentUser | undefined,
    @Param('postId') postId: string,
  ): Promise<{ revisions: RevisionView[] }> {
    const c = requireSession(caller, 'Sign in to read edit history.');
    const db = await this.acl.forCaller(c.userId);
    return { revisions: await this.posts.history(db, postId, await this.#mask(caller)) };
  }
}

/**
 * Refuses an anonymous caller before any work happens.
 *
 * Extracted because it was repeated at the top of nine handlers, and a repeated guard is
 * one somebody eventually omits — which on a write route is the whole authorisation story.
 * Returning the narrowed type means the compiler enforces that it was called: without it,
 * `c.userId` does not typecheck.
 */
function requireSession(caller: CurrentUser | undefined, why: string): CurrentUser {
  if (caller === undefined) throw new AppError(ErrorCode.UNAUTHENTICATED, why);
  return caller;
}

/** Reads and validates a post body from a request. */
function readBody(body: unknown): string {
  const raw = (body as { bodyMd?: unknown } | null)?.bodyMd;
  if (typeof raw !== 'string') {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'Write something first.');
  }
  return raw;
}

function csrf(req: FastifyRequest): void {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);
}
