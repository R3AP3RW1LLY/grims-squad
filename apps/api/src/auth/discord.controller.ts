import { Controller, Get, Query, Req, Res, Inject, Optional } from '@nestjs/common';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { DiscordAuthService } from './discord.service.js';

/**
 * P1.1 — the two OAuth endpoints.
 *
 * Session issuance is NOT here. This lands the identity; P1.2 turns it into a
 * session with rotating refresh and reuse detection. Until then the callback
 * completes the login and redirects, and the returned identity goes nowhere —
 * which is why `/v1/auth/discord/callback` is not yet a working sign-in.
 */

/**
 * `__Host-` requires Secure, Path=/ and no Domain, so the browser refuses it
 * over plain http. Locally that would silently break the nonce binding and make
 * every callback fail with an unhelpful error, so the prefix is dropped in dev
 * and ONLY in dev. The security property is unchanged in production, where the
 * prefix is what stops a subdomain from overwriting the cookie.
 */
/**
 * `@fastify/cookie` adds these three members at runtime, but it declares no
 * peerDependency on fastify, so under pnpm's strict layout the `declare module
 * 'fastify'` block inside it has no resolvable target and TypeScript discards
 * it. Re-declaring the augmentation locally does not work either: FastifyReply
 * is generic in v5, and an augmentation must repeat its type parameters exactly.
 *
 * Rather than hoist the whole dependency tree to work around one missing peer
 * entry, we state precisely what the plugin adds and narrow to it at the two
 * call sites. Wrong here means a runtime TypeError on the first login, which is
 * caught by the P1.2 e2e — not something that can quietly ship.
 */
interface CookieJar {
  setCookie(name: string, value: string, options?: CookieSerializeOptions): unknown;
  clearCookie(name: string, options?: CookieSerializeOptions): unknown;
}
const jar = (reply: FastifyReply): CookieJar => reply as unknown as CookieJar;
const cookies = (req: FastifyRequest): Record<string, string | undefined> =>
  (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};

const IS_SECURE = process.env['NODE_ENV'] === 'production';
export const NONCE_COOKIE = IS_SECURE ? '__Host-gs_oauth_nonce' : 'gs_oauth_nonce';

@Controller('v1/auth/discord')
export class DiscordAuthController {
  constructor(
    @Optional() @Inject(DiscordAuthService) private readonly svc: DiscordAuthService | null,
  ) {}

  #service(): DiscordAuthService {
    if (this.svc === null) {
      // Configuration is absent rather than wrong. Saying so plainly beats a
      // 500 that sends someone hunting through code for a missing env var.
      throw new AppError(
        ErrorCode.UPSTREAM_UNAVAILABLE,
        'Discord sign-in is not configured on this instance.',
      );
    }
    return this.svc;
  }

  @Get()
  begin(@Query('redirect') redirect: string | undefined, @Res() reply: FastifyReply): void {
    const { url, nonce } = this.#service().beginLogin(redirect);
    jar(reply).setCookie(NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: IS_SECURE,
      sameSite: 'lax', // must survive the top-level GET back from discord.com
      path: '/',
      maxAge: 600,
      signed: false,
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
    // The member declined the consent screen. That is a choice, not a fault.
    if (oauthError !== undefined) {
      reply.redirect('/?login=cancelled', 302);
      return;
    }
    if (typeof code !== 'string' || typeof state !== 'string') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Missing code or state.');
    }

    const nonce = cookies(req)[NONCE_COOKIE] ?? '';
    const result = await this.#service().completeLogin({ code, state, nonce });

    // Single-use: clear it whatever the outcome, so a back-button replay has
    // nothing left to present.
    jar(reply).clearCookie(NONCE_COOKIE, { path: '/' });

    // TODO(P1.2): issue the session cookie pair here. Until then this redirects
    // an identified-but-not-signed-in user, which is why P1.1 alone does not
    // close the login loop.
    reply.redirect(result.redirectTo, 302);
  }
}
