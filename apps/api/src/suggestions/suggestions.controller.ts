import { Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { User, type CurrentUser } from '../auth/current-user.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import { SuggestionsService } from './suggestions.service.js';

/**
 * The suggestion box — the sending side.
 *
 * Members only, structurally: every route here authenticates by session, because a published
 * suggestion credits its sender by name and credit needs an account. There is deliberately no
 * guest door — the widget invites a guest to sign in instead, which is the honest version of
 * accepting words that could never be attributed.
 *
 * The webmaster's inbox lives in suggestions-inbox.controller.ts, behind SITE_CONFIG.
 */
@Controller('v1/suggestions')
export class SuggestionsController {
  constructor(@Inject(SuggestionsService) private readonly suggestions: SuggestionsService) {}

  #me(caller: CurrentUser | undefined): string {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    }
    return caller.userId;
  }

  @Post()
  async submit(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
    @Body() body: { body?: string },
  ) {
    const userId = this.#me(caller);
    csrf(req);
    return this.suggestions.submit(userId, body.body);
  }

  /** The member's own suggestions, with where each one stands. */
  @Get('mine')
  async mine(@User() caller: CurrentUser | undefined) {
    return { suggestions: await this.suggestions.listMine(this.#me(caller)) };
  }
}

function csrf(req: FastifyRequest): void {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);
}
