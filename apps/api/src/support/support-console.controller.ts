import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission } from '@grims/shared';
import { RequiresPermission } from '../authz/requires-permission.guard.js';
import { User, type CurrentUser } from '../auth/current-user.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import { SupportService } from './support.service.js';

/**
 * Help & Support — the answering side.
 *
 * ★ GATED AT THE CLASS, SO A ROUTE CANNOT FORGET ★
 *
 * `@RequiresPermission(SUPPORT_AGENT)` on the controller covers every route it will ever grow.
 * The guard reads handler-then-class, so a per-route decorator could only ever NARROW this —
 * and support-console-gate.spec.ts fails the build if the class-level gate goes missing.
 *
 * Replies carry the officer's own identity — the service records their user id, and both
 * consoles render their display name and Discord avatar on the message. Answering as yourself
 * is the owner's explicit ask; there is no "the squadron says" voice here except the `system`
 * lines the room itself writes on close and reopen.
 */
@Controller('v1/support/console')
@RequiresPermission(Permission.SUPPORT_AGENT)
export class SupportConsoleController {
  constructor(@Inject(SupportService) private readonly support: SupportService) {}

  #me(caller: CurrentUser | undefined): string {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    }
    return caller.userId;
  }

  /** The badge: how many open conversations hold words no officer has seen. */
  @Get('badge')
  async badge(@User() caller: CurrentUser | undefined) {
    this.#me(caller);
    return this.support.consoleBadge();
  }

  @Get('conversations')
  async list(@User() caller: CurrentUser | undefined, @Query('status') status?: string) {
    this.#me(caller);
    return {
      conversations: await this.support.consoleList(status === 'closed' ? 'closed' : 'open'),
    };
  }

  @Get('conversations/:id')
  async read(@User() caller: CurrentUser | undefined, @Param('id') id: string) {
    this.#me(caller);
    return this.support.consoleRead(id);
  }

  @Post('conversations/:id/messages')
  async reply(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: { body?: string; attachmentId?: string },
  ) {
    const officerId = this.#me(caller);
    csrf(req);
    return {
      message: await this.support.replyAsOfficer(officerId, id, body.body, body.attachmentId),
    };
  }

  @Patch('conversations/:id/close')
  async close(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
  ) {
    const officerId = this.#me(caller);
    csrf(req);
    await this.support.transition(officerId, id, 'close');
    return { ok: true };
  }

  @Patch('conversations/:id/reopen')
  async reopen(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
  ) {
    const officerId = this.#me(caller);
    csrf(req);
    await this.support.transition(officerId, id, 'reopen');
    return { ok: true };
  }
}

function csrf(req: FastifyRequest): void {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);
}
