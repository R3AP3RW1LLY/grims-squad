import { Public } from './auth.guard.js';
import { Controller, Get, Query, Req, Res, Inject, Optional } from '@nestjs/common';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { OnboardingService, resolveIntent, type OnboardingIntent } from './onboarding.service.js';

/**
 * The join-the-server endpoints, for visitors who are NOT yet in the guild.
 *
 * Separate from `/v1/auth/discord` on purpose: that flow REFUSES anyone who is
 * not already a member, which for a newcomer is an error that reads like a
 * rejection. This flow exists to put them in.
 */

const IS_SECURE = process.env['NODE_ENV'] === 'production';
const NONCE_COOKIE = IS_SECURE ? '__Host-gs_join_nonce' : 'gs_join_nonce';

interface CookieJar {
  setCookie(name: string, value: string, options?: CookieSerializeOptions): unknown;
  clearCookie(name: string, options?: CookieSerializeOptions): unknown;
}
const jar = (r: FastifyReply): CookieJar => r as unknown as CookieJar;
const cookies = (r: FastifyRequest): Record<string, string | undefined> =>
  (r as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};

@Controller('v1/auth/discord/join')
@Public()
export class OnboardingController {
  constructor(
    @Optional() @Inject(OnboardingService) private readonly svc: OnboardingService | null,
  ) {}

  #service(): OnboardingService {
    if (this.svc === null) {
      throw new AppError(
        ErrorCode.UPSTREAM_UNAVAILABLE,
        'Discord sign-up is not configured on this instance.',
      );
    }
    return this.svc;
  }

  @Get()
  begin(@Query('intent') intent: string | undefined, @Res() reply: FastifyReply): void {
    // Validated HERE against the allowlist, before anything is signed. An
    // unknown intent must never reach the signing step.
    if (typeof intent !== 'string' || resolveIntent(intent) === undefined) {
      reply.redirect('/join?error=unknown-option', 302);
      return;
    }

    const { url, nonce } = this.#service().beginJoin(intent as OnboardingIntent);
    jar(reply).setCookie(NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: IS_SECURE,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });
    reply.redirect(url, 302);
  }

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') oauthError: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (oauthError !== undefined) {
      reply.redirect('/join?error=cancelled', 302);
      return;
    }
    if (typeof code !== 'string' || typeof state !== 'string') {
      reply.redirect('/join?error=invalid', 302);
      return;
    }

    const nonce = cookies(req)[NONCE_COOKIE] ?? '';
    const result = await this.#service().completeJoin({ code, state, nonce });
    jar(reply).clearCookie(NONCE_COOKIE, { path: '/' });

    // `welcome` carries the OUTCOME, not the role id — the page has no business
    // knowing Discord snowflakes, and a snowflake in a URL invites tampering
    // even where it would be harmless.
    const kind = result.roleName === 'Allies' ? 'ally' : 'squadron';
    const status = result.alreadyMember ? 'existing' : 'new';
    reply.redirect(`/join/welcome?as=${kind}&status=${status}`, 302);
  }
}
