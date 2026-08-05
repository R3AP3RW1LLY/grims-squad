import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { Public } from '../auth/auth.guard.js';
import { User, type CurrentUser } from '../auth/current-user.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import { SupportService } from './support.service.js';

/**
 * Help & Support — the asking side. Two doors on one controller:
 *
 *   the MEMBER door   session-authenticated, like every other signed-in surface. CSRF-checked
 *                     on writes, because the credential is a cookie.
 *   the GUEST door    @Public(), authenticated by the one-time token the start route hands
 *                     over — the device-token discipline, applied to a conversation. No CSRF,
 *                     because there is no cookie for a cross-site page to ride; the token in
 *                     the Authorization header IS the proof the caller was handed it.
 *
 * Guests POLL. The SSE stream authenticates by session and a guest has none; inventing a
 * token-authenticated stream for the one audience that is a stranger would be a second live
 * system to keep safe. The widget polls every few seconds while open, which is what live chat
 * was for twenty years before server push.
 *
 * The officers' side lives in support-console.controller.ts, behind SUPPORT_AGENT.
 */
@Controller('v1/support')
export class SupportController {
  constructor(@Inject(SupportService) private readonly support: SupportService) {}

  #me(caller: CurrentUser | undefined): string {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    }
    return caller.userId;
  }

  // ── The member door ────────────────────────────────────────────────────────

  @Get('conversations')
  async list(@User() caller: CurrentUser | undefined) {
    return { conversations: await this.support.listForMember(this.#me(caller)) };
  }

  @Post('conversations')
  async start(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
    @Body() body: { subject?: string; body?: string },
  ) {
    const userId = this.#me(caller);
    csrf(req);
    return this.support.startForMember(userId, body.subject, body.body);
  }

  @Get('conversations/:id')
  async read(@User() caller: CurrentUser | undefined, @Param('id') id: string) {
    return this.support.readForMember(this.#me(caller), id);
  }

  @Post('conversations/:id/messages')
  async post(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: { body?: string; attachmentId?: string },
  ) {
    const userId = this.#me(caller);
    csrf(req);
    return { message: await this.support.postAsMember(userId, id, body.body, body.attachmentId) };
  }

  // ── The guest door ─────────────────────────────────────────────────────────

  /**
   * A guest starts a conversation. The token in the answer is shown ONCE — the widget keeps it
   * in that browser, and losing it means starting a fresh conversation.
   *
   * Open by design, like starting a device link: creating a conversation grants nothing and
   * reads nothing, and the start limiter in the service bounds what a loop can cost.
   */
  @Public()
  @Post('guest/conversations')
  async guestStart(@Body() body: { name?: string; subject?: string; body?: string }) {
    return this.support.startForGuest(body.name, body.subject, body.body);
  }

  /**
   * The guest's own transcript. No id parameter, deliberately: the token names the
   * conversation, so there is nothing to enumerate and nothing to get wrong.
   */
  @Public()
  @Get('guest/conversation')
  async guestRead(@Req() req: FastifyRequest) {
    return this.support.readForGuest(bearer(req));
  }

  @Public()
  @Post('guest/messages')
  async guestPost(@Req() req: FastifyRequest, @Body() body: { body?: string }) {
    return { message: await this.support.postAsGuest(bearer(req), body.body) };
  }
}

/** The guest token, off the Authorization header. Empty means the service answers "not available". */
function bearer(req: FastifyRequest): string {
  const header = req.headers['authorization'];
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function csrf(req: FastifyRequest): void {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);
}
