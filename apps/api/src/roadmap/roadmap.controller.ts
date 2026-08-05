import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission } from '@grims/shared';
import { RequiresPermission } from '../authz/requires-permission.guard.js';
import { User, type CurrentUser } from '../auth/current-user.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import { RoadmapService } from './roadmap.service.js';

/**
 * The roadmap's reading side — every signed-in member.
 *
 * No permission bit, deliberately, and the /roadmap nav entry agrees (`requires: null`): the
 * board says what is being built for the platform the whole squadron shares, the same standing
 * as the changelog it sits beside. Thread links are still composed per reader through their own
 * bound client, so the ungated card never carries a gated address.
 */
@Controller('v1/roadmap')
export class RoadmapController {
  constructor(@Inject(RoadmapService) private readonly roadmap: RoadmapService) {}

  @Get()
  async board(@User() caller: CurrentUser | undefined) {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    }
    return { cards: await this.roadmap.board(caller.userId) };
  }
}

/**
 * The webmaster's board — create, edit, move, archive, promote.
 *
 * ★ GATED AT THE CLASS, SO A ROUTE CANNOT FORGET ★
 *
 * The support console's discipline: `@RequiresPermission(SITE_CONFIG)` covers every route this
 * class will ever grow, and suggestions-gate.spec.ts fails the build if it goes missing.
 * SITE_CONFIG for the same reason as the suggestion inbox: the owner made the kanban
 * WEBMASTER-ONLY management, and one bit covering the inbox, the publish flow and the board
 * means the pipeline cannot drift across tiers.
 */
@Controller('v1/roadmap/manage')
@RequiresPermission(Permission.SITE_CONFIG)
export class RoadmapManageController {
  constructor(@Inject(RoadmapService) private readonly roadmap: RoadmapService) {}

  #me(caller: CurrentUser | undefined): string {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    }
    return caller.userId;
  }

  /** The live board plus the archive. */
  @Get()
  async list(@User() caller: CurrentUser | undefined) {
    return this.roadmap.manageList(this.#me(caller));
  }

  @Post('cards')
  async create(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
    @Body() body: { title?: string; body?: string; column?: string },
  ) {
    const callerId = this.#me(caller);
    csrf(req);
    return { card: await this.roadmap.create(callerId, body) };
  }

  @Patch('cards/:id')
  async edit(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: { title?: string; body?: string },
  ) {
    const callerId = this.#me(caller);
    csrf(req);
    return { card: await this.roadmap.edit(callerId, id, body) };
  }

  /** Column + position — the ↑ / ↓ / ← / → buttons all land here. */
  @Patch('cards/:id/move')
  async move(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: { column?: string; position?: number },
  ) {
    this.#me(caller);
    csrf(req);
    await this.roadmap.move(id, body.column, body.position);
    return { ok: true };
  }

  @Patch('cards/:id/archive')
  async archive(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
  ) {
    this.#me(caller);
    csrf(req);
    await this.roadmap.archive(id);
    return { ok: true };
  }

  @Patch('cards/:id/restore')
  async restore(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
  ) {
    this.#me(caller);
    csrf(req);
    await this.roadmap.restore(id);
    return { ok: true };
  }

  /** "Promote to board": a Feature Requests thread becomes an Ideas card, once. */
  @Post('promote')
  async promote(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
    @Body() body: { threadId?: string },
  ) {
    const webmasterId = this.#me(caller);
    csrf(req);
    return this.roadmap.promote(webmasterId, body.threadId);
  }

  /**
   * Whether a thread is already on the board — what the thread page's panel renders from.
   * Refused (as every route here is) for anybody without the webmaster's bit, which is exactly
   * how the panel stays invisible to everyone else: the page treats the refusal as "no panel".
   */
  @Get('thread/:threadId')
  async cardForThread(@User() caller: CurrentUser | undefined, @Param('threadId') threadId: string) {
    this.#me(caller);
    return { card: await this.roadmap.cardForThread(threadId) };
  }
}

function csrf(req: FastifyRequest): void {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);
}
