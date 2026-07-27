import { Controller, Get, Post, Body, Param, Req, Inject } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission } from '@grims/shared';
import { User, type CurrentUser } from '../auth/current-user.js';
import { RequiresPermission } from '../authz/requires-permission.guard.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import { CMDR_SERVICE } from './cmdr.tokens.js';
import type { CmdrService, ClaimRecord, QueueEntry } from './cmdr.service.js';

function readString(body: unknown, key: string): string {
  const v = (body as Record<string, unknown> | null)?.[key];
  if (typeof v !== 'string') {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `${key} is required.`);
  }
  return v;
}

@Controller('v1')
export class CmdrController {
  constructor(@Inject(CMDR_SERVICE) private readonly cmdr: CmdrService) {}

  /** The member declares their own commander name. Creates a pending claim. */
  @Post('me/cmdr')
  async declare(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<ClaimRecord> {
    const userId = requireUser(caller);
    csrf(req);
    // The user id comes from the SESSION. A member can only ever declare for
    // themselves, so there is no id in the body to tamper with.
    return this.cmdr.declare(userId, readString(body, 'cmdrName'));
  }

  /**
   * The officer queue.
   *
   * MEMBER_MANAGE, not a bespoke permission: approving who a member claims to
   * be is member management, and inventing a permission for every action makes
   * the mask harder to reason about without making it more precise.
   */
  @RequiresPermission(Permission.MEMBER_MANAGE)
  @Get('admin/cmdr-claims')
  async queue(): Promise<{ claims: QueueEntry[] }> {
    return { claims: await this.cmdr.pendingQueue() };
  }

  @RequiresPermission(Permission.MEMBER_MANAGE)
  @Post('admin/cmdr-claims/:id/approve')
  async approve(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<{ approved: true }> {
    const officerId = requireUser(caller);
    csrf(req);
    // The service refuses self-approval. Enforced there rather than here so it
    // holds for any future caller — a bot command, an admin script — and not
    // only for this route.
    await this.cmdr.approve(id, officerId);
    return { approved: true };
  }

  @RequiresPermission(Permission.MEMBER_MANAGE)
  @Post('admin/cmdr-claims/:id/reject')
  async reject(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ rejected: true }> {
    const officerId = requireUser(caller);
    csrf(req);
    await this.cmdr.reject(id, officerId, readString(body, 'reason'));
    return { rejected: true };
  }
}

function csrf(req: FastifyRequest): void {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);
}

function requireUser(caller: CurrentUser | undefined): string {
  if (caller === undefined) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
  }
  return caller.userId;
}
