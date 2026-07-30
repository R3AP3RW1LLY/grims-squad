import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, Req, Inject } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import type { SignatureInput, SignatureView } from '@grims/shared';
import type { BannerIdentity } from './banner-identity.js';

/*
 * Facts about THIS squadron, in one place.
 *
 * Hardcoded rather than configured because they are not settings — a second squadron running this
 * code would fork it, and a config key nobody ever changes is a config key that goes stale while
 * looking authoritative.
 */
const SQUADRON_NAME = 'GRIM’S SQUAD';
const SQUADRON_ALLEGIANCE = 'Blood Brothers from Alrai';
import { User, type CurrentUser } from '../auth/current-user.js';
import { Public } from '../auth/auth.guard.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import { AclDbService } from '../authz/acl-db.service.js';
import { PermissionService } from '../authz/permission.service.js';
import { CategoryService, type CategoryView } from './category.service.js';
import { ThreadService, type ThreadView, type PostView } from './thread.service.js';
import { GrantService, type GrantView, type GranteeCandidate } from './grant.service.js';
import { PostService, type RevisionView } from './post.service.js';
import { EngageService, type ReactionCount, type SubscriptionLevel } from './engage.service.js';
import { NotifyService } from './notify.service.js';
import { GatedDiscordDm, replyDmText } from './discord-dm.port.js';
import { SearchService, renderSnippet, type SearchResult } from './search.service.js';
import { ModerationService } from './moderation.service.js';
import { SignatureService } from './signature.service.js';
import { ReviewQueueService, type HeldPost } from '../ai/review-queue.service.js';

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
    @Inject(EngageService) private readonly engage: EngageService,
    @Inject(SearchService) private readonly search: SearchService,
    @Inject(ModerationService) private readonly moderation: ModerationService,
    @Inject(NotifyService) private readonly notify: NotifyService,
    @Inject(SignatureService) private readonly signatures: SignatureService,
    @Inject(ReviewQueueService) private readonly review: ReviewQueueService,
  ) {}

  /**
   * The DM sender, built per request from the environment.
   *
   * ★ STILL GATED, AND THE GATE IS THE DEFAULT ★
   *
   * `DISCORD_DM_ALLOWLIST` unset means NOBODY is messaged and every attempt is recorded. A sender
   * that defaulted to "everyone" and was narrowed by config would be one missing variable away from
   * DMing 107 people.
   */
  #dmSender(): GatedDiscordDm {
    return new GatedDiscordDm(
      process.env['DISCORD_BOT_TOKEN'],
      process.env['DISCORD_DM_ALLOWLIST'],
    );
  }

  /**
   * Notifies everybody who should hear about a new reply.
   *
   * ★ FAILURES HERE NEVER FAIL THE REPLY ★
   *
   * The member has already posted. Taking their request down because Discord was slow, or because a
   * notification row could not be written, would lose their words to punish somebody else's outage.
   * So this is wrapped and swallowed — deliberately, and it is the only place in the forum that
   * swallows anything.
   */
  async #fanOut(
    db: Awaited<ReturnType<AclDbService['forCaller']>>,
    target: Parameters<NotifyService['recipientsFor']>[1],
    threadTitle: string,
  ): Promise<void> {
    try {
      const recipients = await this.notify.recipientsFor(db, target);
      if (recipients.length === 0) return;

      await this.notify.writeInApp(db, recipients, target);

      const sender = this.#dmSender();
      const base = process.env['PUBLIC_URL'] ?? 'https://45-63-35-93.sslip.io';
      const link = `/forum/${target.categorySlug}/${target.threadSlug}`;

      await Promise.all(
        recipients
          .filter((r) => r.wantsDiscordDm && r.discordId !== null)
          .map((r) =>
            sender.send(r.discordId as string, replyDmText(r.reason, threadTitle, link, base)),
          ),
      );
    } catch {
      // See the note above. The reply is already stored; nothing here is worth losing it over.
    }
  }

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
    return { categories: await this.categories.list(db, await this.#mask(caller), caller?.userId) };
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
    const threads = await this.threads.listByCategory(db, slug, mask);

    /*
     * Opening a board marks it seen, so the "new posts" dot clears.
     *
     * AFTER the threads are read, deliberately: marking first would clear the indicator for content
     * the caller had not been shown yet if the second read failed. Awaited rather than fired and
     * forgotten — an unawaited write here would race the member's next page load and sometimes
     * leave the dot up, which reads as the feature not working.
     */
    if (caller !== undefined) {
      await this.categories.markSeen(db, caller.userId, category.id);
    }

    return { category, threads };
  }

  @Public()
  @Get('categories/:slug/threads/:threadSlug')
  async thread(
    @User() caller: CurrentUser | undefined,
    @Param('slug') slug: string,
    @Param('threadSlug') threadSlug: string,
  ): Promise<{
    thread: ThreadView;
    posts: PostView[];
    signatures: Record<string, SignatureView>;
    identities: Record<string, BannerIdentity>;
  }> {
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
      this.threads.bySlug(db, slug, threadSlug, mask, caller?.userId ?? null),
      this.threads.postsFor(db, slug, threadSlug, mask, caller?.userId ?? null),
    ]);
    /*
     * Counted ONCE, here, after both reads succeeded — not inside `bySlug`, which runs three times
     * across this request and its internals. Deliberately not awaited: the reader gets their thread
     * without waiting on a counter, and a failure loses a number rather than a page.
     */
    void this.threads.recordView(db, thread.id);

    /*
     * ★ SIGNATURES KEYED BY AUTHOR, NOT ATTACHED PER POST ★
     *
     * A thread with forty replies from twelve people has twelve signatures. Attaching one to each
     * post would send the same block twelve times over and make the response grow with the
     * conversation rather than with the number of people in it.
     *
     * Deduplicated before the query, so this is ONE read however long the thread is.
     */
    const authorIds = [...new Set(posts.map((p) => p.authorId))];
    const [signatures, identities] = await Promise.all([
      this.signatures.forUsers(db, authorIds),
      /*
       * ★ WITHOUT THIS, EVERY SOURCED LAYER RENDERS AS NOTHING ★
       *
       * A banner text layer stores a SOURCE — "my Combat rank" — resolved when it is drawn. The
       * generator passed the renderer a real identity, so everything appeared there; this endpoint
       * passed none, so the same banner drew correctly against an empty person and looked like a
       * feature that did not work.
       */
      this.signatures.identitiesFor(db, authorIds, SQUADRON_NAME, SQUADRON_ALLEGIANCE),
    ]);

    return {
      thread,
      posts,
      signatures: Object.fromEntries(signatures),
      identities: Object.fromEntries(identities),
    };
  }

  /**
   * Marks a reply as the answer, or clears the mark.
   *
   * PUT rather than POST: setting the answer twice must leave one answer, and an idempotent verb
   * says so at the protocol level rather than in a comment. The body carries the desired STATE,
   * which is also what makes un-marking the same call rather than a second endpoint.
   */
  @Put('categories/:slug/threads/:threadSlug/posts/:postId/solution')
  async solution(
    @User() caller: CurrentUser | undefined,
    @Param('slug') slug: string,
    @Param('threadSlug') threadSlug: string,
    @Param('postId') postId: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    }
    const db = await this.acl.forCaller(caller.userId);
    const mask = await this.#mask(caller);
    const solution = (body as { solution?: unknown } | null)?.solution !== false;

    await this.threads.markSolution(db, slug, threadSlug, postId, { userId: caller.userId, mask }, solution);
    return { ok: true };
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

    /*
     * The opening post, read by the same helper a reply uses — so a thread is started with the
     * editor exactly as a reply is written, and there is one place that decides what a body may be.
     *
     * This used to be absent entirely: a thread was created with a title and no posts. Nothing
     * called it, because there was no "new thread" screen, so an empty thread was never seen.
     */
    const openingPost = readBody(body);

    const db = await this.acl.forCaller(caller.userId);
    const mask = await this.#mask(caller);
    const category = await this.categories.bySlug(db, slug, mask);

    /*
     * A muted member cannot start a thread either. Checked here as well as on replies, because
     * `create` is a different write path — and a sanction that stops one and not the other is a
     * sanction with a hole in it.
     */
    await this.moderation.assertMayPost(db, caller.userId);

    return this.threads.create(
      db,
      { categoryId: category.id, title, body: openingPost },
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

  /**
   * Posts waiting for a human, oldest first.
   *
   * Requires AI_REVIEW — narrower than AI_TOOLS_ADMIN, and held by officers and by the webmaster.
   */
  @Get('review/held')
  async heldPosts(
    @User() caller: CurrentUser | undefined,
  ): Promise<{ posts: HeldPost[]; total: number }> {
    const c = requireSession(caller, 'Sign in first.');
    const db = await this.acl.forCaller(c.userId);
    const mask = await this.#mask(caller);

    const [posts, total] = await Promise.all([
      this.review.held(db, mask),
      this.review.heldCount(db, mask),
    ]);
    return { posts, total };
  }

  /**
   * Releases a held post, or refuses it.
   *
   * PUT with the decision in the body rather than two routes: deciding the same post twice must
   * settle on one state, and an idempotent verb says so at the protocol level.
   */
  @Put('review/held/:postId')
  async decideHeld(
    @User() caller: CurrentUser | undefined,
    @Param('postId') postId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ ok: true }> {
    const c = requireSession(caller, 'Sign in first.');
    csrf(req);

    const decision = (body as { decision?: unknown } | null)?.decision;
    if (decision !== 'release' && decision !== 'refuse') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Say whether to release or refuse it.');
    }

    const db = await this.acl.forCaller(c.userId);
    await this.review.decide(db, postId, decision, {
      userId: c.userId,
      mask: await this.#mask(caller),
    });
    return { ok: true };
  }

  /**
   * The caller's own forum signature.
   *
   * ★ ALWAYS THE CALLER'S — THERE IS NO `:userId` HERE ★
   *
   * Somebody else's signature arrives with their posts, already rendered. An endpoint that took a
   * user id would be a second, unnecessary way to read one, and the first thing anybody would try
   * is passing an id that is not theirs.
   */
  @Get('signature')
  async mySignature(@User() caller: CurrentUser | undefined): Promise<{ signature: SignatureView }> {
    const c = requireSession(caller, 'Sign in first.');
    const db = await this.acl.forCaller(c.userId);
    return { signature: await this.signatures.mine(db, c.userId, publicOrigin()) };
  }

  /** Saves part of the caller's signature. PUT, because saving the same thing twice is one result. */
  @Put('signature')
  async saveSignature(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ signature: SignatureView }> {
    const c = requireSession(caller, 'Sign in first.');
    csrf(req);
    const db = await this.acl.forCaller(c.userId);
    return {
      signature: await this.signatures.save(
        db,
        c.userId,
        (body ?? {}) as SignatureInput,
        publicOrigin(),
      ),
    };
  }

  /**
   * Who the caller can usefully @mention in this thread.
   *
   * Separate from the grant autocomplete because the two answer different questions and carry
   * different permissions: granting is an admin act, mentioning is what every member does. Sharing
   * one endpoint would mean either requiring FORUM_MODERATE to mention somebody, or dropping the
   * check that makes granting safe.
   */
  @Get('threads/:threadId/mention-candidates')
  async mentionCandidates(
    @User() caller: CurrentUser | undefined,
    @Param('threadId') threadId: string,
    @Query('q') q: string | undefined,
  ): Promise<{ candidates: GranteeCandidate[] }> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    }
    const db = await this.acl.forCaller(caller.userId);
    return { candidates: await this.grants.mentionCandidates(db, threadId, q ?? '') };
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
    const replyToId = (body as { replyToId?: unknown } | null)?.replyToId;

    const post = await this.posts.create(
      db,
      threadId,
      bodyMd,
      c.userId,
      await this.#mask(caller),
      typeof replyToId === 'string' ? replyToId : undefined,
    );

    /*
     * The thread is re-read for its title and slug, THROUGH THE SERVICE. `create` deliberately does
     * not return them — that would make a write path carry presentation data for a notification's
     * benefit — and the controller does not query models itself, which is what the static ACL guard
     * exists to keep true.
     */
    const thread = await this.threads.notificationTarget(db, threadId);

    if (thread !== null) {
      await this.#fanOut(
        db,
        {
          threadId,
          threadTitle: thread.title,
          categorySlug: thread.categorySlug,
          threadSlug: thread.slug,
          actorId: c.userId,
          replyToAuthorId: post.replyToAuthorId,
          mentionedUserIds: post.mentions,
        },
        thread.title,
      );
    }

    return { id: post.id, bodyHtml: post.bodyHtml, editCount: post.editCount };
  }

  /**
   * The original source of a post, for the editor to start from.
   *
   * Fetched only when somebody presses Edit — see `PostService.source` for why it is not a field
   * on the thread response.
   */
  @Get('posts/:postId/source')
  async postSource(
    @User() caller: CurrentUser | undefined,
    @Param('postId') postId: string,
  ): Promise<{ bodyDoc: unknown | null; bodyMd: string | null }> {
    const c = requireSession(caller, 'Sign in to edit.');
    const db = await this.acl.forCaller(c.userId);
    return this.posts.source(db, postId, c.userId, await this.#mask(caller));
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

  /*
   * ★ REACTIONS AND SUBSCRIPTIONS (P2.4) ★
   *
   * Neither needs a permission of its own: if you can SEE a thread you can react and follow, and if
   * you cannot the service's own read returns 404 and there is nothing to act on. Deliberately
   * weaker than posting, which needs the category's post_perm — reading and following are the same
   * capability, speaking is a different one.
   */

  @Post('posts/:postId/reactions')
  async react(
    @User() caller: CurrentUser | undefined,
    @Param('postId') postId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ reactions: ReactionCount[] }> {
    const c = requireSession(caller, 'Sign in to react.');
    csrf(req);

    const emoji = (body as { emoji?: unknown } | null)?.emoji;
    if (typeof emoji !== 'string') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Which reaction?');
    }

    const db = await this.acl.forCaller(c.userId);
    return { reactions: await this.engage.toggleReaction(db, postId, emoji, c.userId) };
  }

  /**
   * Follows or unfollows a thread.
   *
   * PUT rather than POST: the caller states the desired STATE — watching, muted or none — rather
   * than an action, so sending it twice is not a second event. That matters for a button somebody
   * can double-click.
   */
  @Put('threads/:threadId/subscription')
  async subscribe(
    @User() caller: CurrentUser | undefined,
    @Param('threadId') threadId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ level: SubscriptionLevel | 'none' }> {
    const c = requireSession(caller, 'Sign in to follow a thread.');
    csrf(req);

    const level = (body as { level?: unknown } | null)?.level;
    if (level !== 'watching' && level !== 'muted' && level !== 'none') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Follow, mute, or neither.');
    }

    const db = await this.acl.forCaller(c.userId);
    return this.engage.setThreadSubscription(db, threadId, c.userId, level);
  }

  @Get('threads/:threadId/subscription')
  async mySubscription(
    @User() caller: CurrentUser | undefined,
    @Param('threadId') threadId: string,
  ): Promise<{ level: SubscriptionLevel | 'none' }> {
    const c = requireSession(caller, 'Sign in to see whether you follow this.');
    const db = await this.acl.forCaller(c.userId);
    return this.engage.subscriptionFor(db, threadId, c.userId);
  }

  /**
   * Searches posts the caller can see (P2.5, INV-024).
   *
   * ★ @Public, AND THE FILTER IS STILL EXACT ★
   *
   * An anonymous visitor may search the public boards — the joining guides are the most useful thing
   * on the site to somebody who has not joined, and making them unsearchable would be perverse.
   *
   * The caller's visible categories are resolved SERVER-SIDE from their session, never from the
   * request, and passed into the query's WHERE clause. There is no post-filter step: an anonymous
   * search for a term that appears only in the officers' board returns zero hits AND zero total,
   * because the count is computed over the same filtered set.
   */
  @Public()
  @Get('search')
  async searchPosts(
    @User() caller: CurrentUser | undefined,
    @Query('q') q: string | undefined,
    @Query('offset') offset: string | undefined,
  ): Promise<{ result: SearchResult; snippets: string[] }> {
    const db = await this.acl.forCaller(caller?.userId);
    const visible = await this.acl.visibleCategoryIdsFor(caller?.userId);

    const result = await this.search.search(
      db,
      q ?? '',
      visible,
      caller?.userId ?? null,
      Number.parseInt(offset ?? '0', 10) || 0,
    );

    return {
      result,
      /*
       * Snippets rendered HERE rather than in the client. `renderSnippet` escapes the member text
       * and only then converts the markers to <mark> — an ordering that has to happen exactly once,
       * so it happens on the server where there is one implementation of it.
       */
      snippets: result.hits.map((h) => renderSnippet(h.snippet)),
    };
  }

  /*
   * ★ MODERATION (P2.6, INV-009) ★
   *
   * Every route below funnels into ModerationService, which writes the member-facing record and the
   * audit row in ONE transaction. Nothing here writes either directly — a second writer would be a
   * second chance to write one without the other.
   *
   * A reason is required on all of them and is validated in the service, not here: the member is
   * shown it, so "is this good enough to show somebody" is one decision in one place.
   */

  @Post('threads/:threadId/moderate/lock')
  async lockThread(
    @User() caller: CurrentUser | undefined,
    @Param('threadId') threadId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ ok: true }> {
    const c = requireSession(caller, 'Sign in to moderate.');
    csrf(req);
    const raw = body as { locked?: unknown; reason?: unknown } | null;
    const db = await this.acl.forCaller(c.userId);
    await this.moderation.setLocked(
      db,
      threadId,
      raw?.locked !== false,
      c.userId,
      await this.#mask(caller),
      raw?.reason,
    );
    return { ok: true };
  }

  @Post('threads/:threadId/moderate/pin')
  async pinThread(
    @User() caller: CurrentUser | undefined,
    @Param('threadId') threadId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ ok: true }> {
    const c = requireSession(caller, 'Sign in to moderate.');
    csrf(req);
    const raw = body as { pinned?: unknown; reason?: unknown } | null;
    const db = await this.acl.forCaller(c.userId);
    await this.moderation.setPinned(
      db,
      threadId,
      raw?.pinned !== false,
      c.userId,
      await this.#mask(caller),
      raw?.reason,
    );
    return { ok: true };
  }

  /**
   * Warns, mutes, bans or unbans a member.
   *
   * One route with an `action` rather than four, because the shape is identical and the difference
   * is a word the moderator chooses. Four near-identical handlers would drift on the reason
   * handling, which is the part that must not.
   */
  @Post('members/:userId/moderate')
  async moderateMember(
    @User() caller: CurrentUser | undefined,
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ ok: true; expiresAt?: string }> {
    const c = requireSession(caller, 'Sign in to moderate.');
    csrf(req);

    const raw = body as
      | { action?: unknown; reason?: unknown; hours?: unknown; appealThreadId?: unknown }
      | null;
    const mask = await this.#mask(caller);
    const db = await this.acl.forCaller(c.userId);

    switch (raw?.action) {
      case 'warn':
        await this.moderation.warn(db, userId, c.userId, mask, raw.reason);
        return { ok: true };
      case 'mute': {
        const { expiresAt } = await this.moderation.mute(
          db,
          userId,
          typeof raw.hours === 'number' ? raw.hours : Number.NaN,
          c.userId,
          mask,
          raw.reason,
        );
        return { ok: true, expiresAt };
      }
      case 'ban':
        await this.moderation.ban(
          db,
          userId,
          c.userId,
          mask,
          raw.reason,
          typeof raw.appealThreadId === 'string' ? raw.appealThreadId : null,
        );
        return { ok: true };
      case 'unban':
        await this.moderation.unban(db, userId, c.userId, mask, raw.reason);
        return { ok: true };
      default:
        throw new AppError(ErrorCode.VALIDATION_FAILED, 'Warn, mute, ban or unban.');
    }
  }

  /** A member's moderation history. Moderators only. */
  @Get('members/:userId/moderation')
  async memberModeration(
    @User() caller: CurrentUser | undefined,
    @Param('userId') userId: string,
  ): Promise<{ history: Array<{ action: string; reason: string; createdAt: string; actorHandle: string }> }> {
    const c = requireSession(caller, 'Sign in to read moderation history.');
    const db = await this.acl.forCaller(c.userId);
    return { history: await this.moderation.historyFor(db, userId, await this.#mask(caller)) };
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

/**
 * Reads a post body — either Markdown or a rich document.
 *
 * ★ THE CLIENT CHOOSES THE FORM, NOT THE SAFETY ★
 *
 * `bodyDoc` takes precedence when both arrive, because a client that sent both is the rich
 * editor also supplying a plain-text fallback, and the document is the higher-fidelity one.
 *
 * Nothing is validated here beyond the shape of the envelope: the document is checked by
 * `validateDocument` inside the service, which is the single place that decides what a document
 * may contain. A second, looser check here would be a second answer to that question.
 */
function readBody(body: unknown): string | { doc: unknown } {
  const raw = body as { bodyMd?: unknown; bodyDoc?: unknown } | null;

  if (raw?.bodyDoc !== undefined && raw.bodyDoc !== null) {
    return { doc: raw.bodyDoc };
  }
  if (typeof raw?.bodyMd === 'string') return raw.bodyMd;

  throw new AppError(ErrorCode.VALIDATION_FAILED, 'Write something first.');
}

function csrf(req: FastifyRequest): void {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);
}

/**
 * The origin members share links from.
 *
 * Same source and same fallback as the notification links, deliberately: two places deriving the
 * public address separately is how a DM and a signature end up pointing at different hosts.
 */
function publicOrigin(): string {
  return process.env['PUBLIC_URL'] ?? 'https://45-63-35-93.sslip.io';
}
