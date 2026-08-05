import { Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission } from '@grims/shared';
import { RequiresPermission } from '../authz/requires-permission.guard.js';
import { AdminGateGuard, RequiresTwoFactor } from '../auth/admin-gate.guard.js';
import { User, type CurrentUser } from '../auth/current-user.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import { SuggestionsService } from './suggestions.service.js';

/**
 * The webmaster's inbox — review and verdict.
 *
 * ★ GATED AT THE CLASS, SO A ROUTE CANNOT FORGET ★
 *
 * The support console's discipline, one tier up: `@RequiresPermission(SITE_CONFIG)` on the
 * controller covers every route it will ever grow, and suggestions-gate.spec.ts fails the build
 * if the class-level gate goes missing.
 *
 * SITE_CONFIG because the owner named the WEBMASTER as the reviewer — "a suggestion box feature
 * that sends the webmaster user submitted ideas". It is the bit that already means "runs the
 * website" (only the webmaster tier holds it), it gates the Feature Requests board's post_perm,
 * and using the same bit for the inbox means the reviewer and the publisher cannot drift to
 * different tiers. SUPPORT_AGENT would hand every officer a queue the owner addressed to one
 * role; MEMBER_MANAGE is about people, not the platform.
 *
 * ★ AND BEHIND THE SECOND FACTOR, LIKE THE ADMIN CONSOLE ★
 *
 * `AdminGateGuard` + `@RequiresTwoFactor()` — the admin controller's exact idiom. The inbox
 * reads members' private words before any verdict, which is admin-console material: enrolment
 * alone would let a stolen session cookie read the queue, and the third check is the one that
 * mechanism cannot see anything wrong with. The /app console already steps the webmaster up,
 * so the honest cost is nothing; a session without a fresh code gets the gate's own sentence.
 */
@UseGuards(AdminGateGuard)
@RequiresTwoFactor()
@Controller('v1/suggestions/inbox')
@RequiresPermission(Permission.SITE_CONFIG)
export class SuggestionsInboxController {
  constructor(@Inject(SuggestionsService) private readonly suggestions: SuggestionsService) {}

  #me(caller: CurrentUser | undefined): string {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    }
    return caller.userId;
  }

  /** Everything waiting for a verdict, oldest first — a queue is worked in arrival order. */
  @Get()
  async list(@User() caller: CurrentUser | undefined) {
    this.#me(caller);
    return { suggestions: await this.suggestions.inbox() };
  }

  /**
   * The tab badge: how many suggestions await a verdict. The support console's badge shape —
   * a bare count the /app tab label re-reads on every `suggestions` nudge, refused (like every
   * route here) for anybody without the webmaster's bit or a fresh second factor, which the
   * badge renders as no pill at all.
   */
  @Get('badge')
  async badge(@User() caller: CurrentUser | undefined) {
    this.#me(caller);
    return this.suggestions.inboxBadge();
  }

  /** One click: a Feature Requests thread, credited to the sender, who is told personally. */
  @Post(':id/publish')
  async publish(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
  ) {
    const webmasterId = this.#me(caller);
    csrf(req);
    return this.suggestions.publish(webmasterId, id);
  }

  /** The other verdict. The sender is told plainly; the box stays open. */
  @Post(':id/decline')
  async decline(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
  ) {
    const webmasterId = this.#me(caller);
    csrf(req);
    await this.suggestions.decline(webmasterId, id);
    return { ok: true };
  }
}

function csrf(req: FastifyRequest): void {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);
}
