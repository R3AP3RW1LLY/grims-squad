import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission } from '@grims/shared';
import { RequiresPermission } from '../authz/requires-permission.guard.js';
import { AdminGateGuard, RequiresTwoFactor } from '../auth/admin-gate.guard.js';
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
 *
 * ★ AND BEHIND THE SECOND FACTOR, LIKE THE ADMIN CONSOLE ★
 *
 * The admin controller's exact idiom — `AdminGateGuard` + `@RequiresTwoFactor()`. What this
 * board says is what the whole squadron is told is being built; rewriting it is admin-console
 * work, and enrolment without a fresh code in THIS session is what a stolen cookie has. The
 * member-facing read above carries neither decorator: reading the roadmap is every member's.
 *
 * ★ EVERY ROUTE HERE MUTATES, AND THAT IS NOW LOAD-BEARING ★
 *
 * The promote panel's read used to sit in this class, which meant an idle webmaster's thread page
 * asked a step-up-gated question, was refused, and rendered no panel — a control that vanished
 * rather than one that said why. It moved to `RoadmapPromotableController` below, gated on
 * SITE_CONFIG alone. What is left in here is create, edit, move, archive, restore, promote and
 * the console's own list: writes, and the screen you do them from. A read added to this class
 * again would degrade to invisibility the same way, so it belongs below instead.
 */
@UseGuards(AdminGateGuard)
@RequiresTwoFactor()
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
}

/**
 * The promote panel's PROBE: is this thread on the Feature Requests board, and is it already on
 * the roadmap?
 *
 * ★ SITE_CONFIG, AND DELIBERATELY NOT BEHIND THE SECOND FACTOR ★
 *
 * This route lived on the manage controller above, and being there is what made the panel
 * disappear. The step-up window is eight hours of admin ACTIVITY; a webmaster reading the forum
 * all afternoon is not doing admin activity, so nine hours after their last code the thread page
 * asked this question, was refused, and drew no panel at all. Not a locked button with a reason —
 * nothing. The feature simply stopped existing for its only user, and the page could not tell
 * that from "this is not a Feature Requests thread".
 *
 * A refusal must never degrade to invisibility. So the READ moved here, where it is gated on the
 * webmaster's bit alone, and every MUTATION stayed above with `AdminGateGuard` and
 * `@RequiresTwoFactor()` on it: promote, create, edit, move, archive, restore.
 *
 * ★ WHY LOWERING THIS GATE IS SAFE, STATED PLAINLY ★
 *
 * What it discloses to a SITE_CONFIG holder — the only people it answers at all — is two facts
 * about a thread they are already reading: which board it is on, and whether a roadmap card
 * points at it. The board is on their screen. The card is on /roadmap, which every signed-in
 * member may read. Nothing here changes anything, and the thread is resolved through the
 * caller's own bound client, so a thread they cannot see is `promotable: false` exactly as if it
 * were an ordinary thread.
 *
 * The step-up still bites where it matters: pressing Promote hits the guarded route above and is
 * refused with the admin gate's own sentence, which the panel shows. A visible control that says
 * why it refused is the honest shape; an invisible one is not.
 */
@Controller('v1/roadmap/promotable')
@RequiresPermission(Permission.SITE_CONFIG)
export class RoadmapPromotableController {
  constructor(@Inject(RoadmapService) private readonly roadmap: RoadmapService) {}

  /**
   * `promotable` is resolved server-side by the same slug-or-name test publish uses, never by
   * comparing the URL — which is what once killed the panel the day the board was renamed.
   */
  @Get(':threadId')
  async cardForThread(@User() caller: CurrentUser | undefined, @Param('threadId') threadId: string) {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    }
    return this.roadmap.cardForThread(caller.userId, threadId);
  }
}

function csrf(req: FastifyRequest): void {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);
}
