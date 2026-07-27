import { Controller, Get, Post, Delete, Body, Param, Req, Inject } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission } from '@grims/shared';
import { User, type CurrentUser } from '../auth/current-user.js';
import { RequiresPermission } from '../authz/requires-permission.guard.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import { CMDR_SERVICE, NONCE_SERVICE, INARA_LINK } from './cmdr.tokens.js';
import type { CmdrService, ClaimRecord, QueueEntry } from './cmdr.service.js';
import type { NonceService } from '@grims/shared';
import type { InaraLinkService, LinkStatus } from './inara-link.service.js';

function readString(body: unknown, key: string): string {
  const v = (body as Record<string, unknown> | null)?.[key];
  if (typeof v !== 'string') {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `${key} is required.`);
  }
  return v;
}

@Controller('v1')
export class CmdrController {
  constructor(
    @Inject(CMDR_SERVICE) private readonly cmdr: CmdrService,
    @Inject(NONCE_SERVICE) private readonly nonce: NonceService,
    @Inject(INARA_LINK) private readonly inara: InaraLinkService,
  ) {}

  // --------------------------------------------------------- Inara API key
  /**
   * Links the member's own Inara API key (trust tier 2).
   *
   * There is NO commander-name field. The name comes back from Inara, which is
   * what makes this verification rather than self-declaration — see
   * InaraLinkService. Adding one here would defeat the whole design.
   *
   * `source` distinguishes the website from the companion app, because a key
   * added in the app shows up here with no action from the member.
   */
  @Post('me/inara')
  async linkInara(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ cmdrName: string | null; verified: boolean }> {
    const userId = requireUser(caller);
    csrf(req);
    const b = body as Record<string, unknown> | null;
    const source = b?.['source'] === 'app' ? 'app' : 'web';
    const r = await this.inara.link(userId, readString(b, 'apiKey'), source);
    // Deliberately NOT spreading the result: no key, ever, in any response.
    return { cmdrName: r.cmdrName, verified: r.verified };
  }

  /** Whether a key is on file, and the verified name. Never the key itself. */
  @Get('me/inara')
  async inaraStatus(@User() caller: CurrentUser | undefined): Promise<LinkStatus> {
    return this.inara.status(requireUser(caller));
  }

  /** Re-checks the stored key against Inara, and reconciles the nickname. */
  @Post('me/inara/refresh')
  async refreshInara(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
  ): Promise<{ cmdrName: string | null; verified: boolean; error: string | null }> {
    const userId = requireUser(caller);
    csrf(req);
    return this.inara.refresh(userId);
  }

  /**
   * Removes the stored key.
   *
   * Does NOT un-verify the commander name — the member proved it, and removing
   * the credential is a privacy choice rather than a retraction.
   */
  @Delete('me/inara')
  async unlinkInara(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
  ): Promise<{ unlinked: true }> {
    const userId = requireUser(caller);
    csrf(req);
    await this.inara.unlink(userId);
    return { unlinked: true };
  }

  /**
   * Starts Inara verification (trust tier 2).
   *
   * Returns a code the member pastes into their Inara profile. The WORKER then
   * polls Inara and completes it — this route never calls Inara itself, because
   * the global limiter allows two calls a minute and a member must never be
   * waiting on that queue inside an HTTP request (INV-031, INV-033).
   */
  @Post('me/cmdr/inara')
  async startInara(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ nonce: string; expiresAt: string; instructions: string }> {
    const userId = requireUser(caller);
    csrf(req);

    const claim = await this.nonce.issue(userId, readString(body, 'cmdrName'));
    return {
      nonce: claim.claimNonce,
      expiresAt: claim.nonceExpiresAt.toISOString(),
      instructions:
        'Add this code anywhere in your Inara profile bio, then leave it there. We check every few minutes and it can take up to an hour. You can remove it once you are verified.',
    };
  }

  /** Where the member's own verification stands. */
  @Get('me/cmdr')
  async myClaim(
    @User() caller: CurrentUser | undefined,
  ): Promise<{ pending: { cmdrName: string; nonce: string; expiresAt: string } | null }> {
    const userId = requireUser(caller);
    const claim = await this.nonce.pendingFor(userId);
    return {
      pending:
        claim === null
          ? null
          : {
              cmdrName: claim.cmdrName,
              nonce: claim.claimNonce,
              expiresAt: claim.nonceExpiresAt.toISOString(),
            },
    };
  }

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
