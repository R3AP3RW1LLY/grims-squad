import { Controller, Get, Post, Body, Param, Req, Inject } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { User, type CurrentUser } from '../auth/current-user.js';
import { Public } from '../auth/auth.guard.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import { AclDbService } from '../authz/acl-db.service.js';
import { PermissionService } from '../authz/permission.service.js';
import { CategoryService, type CategoryView } from './category.service.js';
import { ThreadService, type ThreadView } from './thread.service.js';

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
  ): Promise<{ thread: ThreadView }> {
    const db = await this.acl.forCaller(caller?.userId);
    const mask = await this.#mask(caller);
    return { thread: await this.threads.bySlug(db, slug, threadSlug, mask) };
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
}

function csrf(req: FastifyRequest): void {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);
}
