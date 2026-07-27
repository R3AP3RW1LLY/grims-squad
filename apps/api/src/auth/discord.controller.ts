import { Public } from './auth.guard.js';
import { postLoginDestination } from './post-login-destination.js';
import { PermissionService } from '../authz/permission.service.js';
import { TotpService } from './totp.service.js';
import { Controller, Get, Query, Req, Res, Inject, Optional } from '@nestjs/common';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { AppError, ErrorCode } from '@grims/shared';
import { issueCsrfToken } from '../common/csrf.js';
import { DiscordAuthService } from './discord.service.js';
import { SessionService } from './session.service.js';

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

/**
 * Where to send the browser after login.
 *
 * ★ WHY THIS IS NEEDED AT ALL ★
 *
 * `safeRedirectPath` returns a PATH, and in production that is exactly right:
 * Caddy serves the API and the web app from ONE origin under /v1, so `/` lands
 * on the site. Locally they are separate ports, so the same relative redirect
 * lands on the API's own root and answers "Cannot GET /" — a login that
 * completed successfully and then dumped the member on a JSON error.
 *
 * Empty by default, which preserves the production behaviour exactly. Set to
 * http://localhost:5000 for local development.
 *
 * ★ WHY THIS IS NOT AN OPEN REDIRECT ★
 *
 * The base comes from OUR configuration and the path from `safeRedirectPath`,
 * which is allowlisted. A caller controls neither. Concatenating a
 * caller-supplied base here would be the classic hole — hence the base is read
 * once, from the environment, and never from the request.
 */
const WEB_BASE_URL = (process.env['WEB_BASE_URL'] ?? '').replace(/\/+$/, '');

/** Absolute when a base is configured, relative when it is not. */
function afterLogin(path: string): string {
  return `${WEB_BASE_URL}${path}`;
}
export const NONCE_COOKIE = IS_SECURE ? '__Host-gs_oauth_nonce' : 'gs_oauth_nonce';

@Controller('v1/auth/discord')
@Public()
export class DiscordAuthController {
  constructor(
    @Optional() @Inject(DiscordAuthService) private readonly svc: DiscordAuthService | null,
    @Optional() @Inject(SessionService) private readonly sessions: SessionService | null,
    /*
     * Both @Optional: this controller must keep working when neither is
     * configured. Without them the callback simply falls back to the requested
     * path, which is the behaviour it had before routing existed — a login that
     * succeeds and lands somewhere reasonable beats a login that 500s because a
     * convenience is unavailable.
     */
    @Optional() @Inject(PermissionService) private readonly permissions: PermissionService | null,
    @Optional() @Inject(TotpService) private readonly totp: TotpService | null,
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
      reply.redirect(afterLogin('/?login=cancelled'), 302);
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

    // Issue the session. Until this existed, login identified a member and then
    // did nothing with it — the loop did not close.
    if (this.sessions !== null) {
      const session = await this.sessions.issue(result.userId, {
        userAgent: req.headers['user-agent'] ?? null,
        // Hashed here, never stored raw (INV-012 spirit).
        ipHash: hashIp(req.ip),
      });
      const c = this.sessions.cookieOptions({ secure: IS_SECURE });
      // Access token gets the SHORT max-age, not the refresh lifetime: a
      // 30-day access cookie would outlive its own 15-minute signature and sit
      // in the browser being sent on every request long after it is useless.
      jar(reply).setCookie(c.accessName, session.accessToken, { ...c.options, maxAge: 900 });
      jar(reply).setCookie(c.refreshName, session.refreshToken, c.options);
      // CSRF token is readable by scripts ON PURPOSE — the double-submit pattern
      // requires the page to read it and echo it in a header.
      jar(reply).setCookie(c.csrfName, issueCsrfToken(), { ...c.options, httpOnly: false });
    }

    /*
     * Route them, rather than telling them where to go.
     *
     * An unsecured admin is sent into the onboarding flow automatically; a
     * secured one lands in the console; everyone else lands on their own
     * dashboard. Failing here must not fail the LOGIN, which has already
     * succeeded — so a broken lookup falls back to the requested path.
     */
    let destination = result.redirectTo;
    try {
      if (this.permissions !== null && this.totp !== null) {
        destination = await postLoginDestination({
          mask: await this.permissions.effectiveMask(result.userId),
          twoFactorEnrolled: await this.totp.isEnrolled(result.userId),
          requested: result.redirectTo === '/' ? undefined : result.redirectTo,
        });
      }
    } catch {
      /* the session is already issued; a routing hiccup is not worth a 500 */
    }

    reply.redirect(afterLogin(destination), 302);
  }
}

/**
 * Hashes a client IP before it is stored.
 *
 * A raw IP is personal data and the privacy policy does not offer to keep one.
 * The hash is still useful for "was this session resumed from somewhere new",
 * which is all it is for.
 */
function hashIp(ip: string | undefined): string | null {
  if (ip === undefined || ip === '') return null;
  return createHash('sha256').update(ip).digest('hex');
}
