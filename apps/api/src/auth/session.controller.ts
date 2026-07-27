import { Controller, Post, Get, Req, Res, Inject, Optional } from '@nestjs/common';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { SessionService } from './session.service.js';
import { verifyCsrf, issueCsrfToken } from '../common/csrf.js';
import { Public } from './auth.guard.js';

const IS_SECURE = process.env['NODE_ENV'] === 'production';

interface CookieJar {
  setCookie(name: string, value: string, options?: CookieSerializeOptions): unknown;
  clearCookie(name: string, options?: CookieSerializeOptions): unknown;
}
const jar = (r: FastifyReply): CookieJar => r as unknown as CookieJar;
const cookies = (r: FastifyRequest): Record<string, string | undefined> =>
  (r as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};

@Controller('v1/auth')
export class SessionController {
  constructor(@Optional() @Inject(SessionService) private readonly sessions: SessionService | null) {}

  #svc(): SessionService {
    if (this.sessions === null) {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, 'Sessions are not configured.');
    }
    return this.sessions;
  }

  /**
   * Rotates the session.
   *
   * Public because the ACCESS token is expected to be expired by the time
   * anyone calls this — that is the entire point of refreshing. Authorisation
   * comes from the refresh cookie, which is checked inside.
   */
  @Public()
  @Post('refresh')
  async refresh(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const svc = this.#svc();
    const c = svc.cookieOptions({ secure: IS_SECURE });
    const jarC = cookies(req);

    // CSRF applies here too. Without it, any site could POST to /refresh and
    // silently rotate a visitor's session — harmless on its own, but it hands
    // an attacker a fresh, valid token lifetime whenever they want one.
    verifyCsrf(req.method, jarC[c.csrfName], req.headers['x-csrf-token'] as string | undefined);

    const refresh = jarC[c.refreshName];
    if (typeof refresh !== 'string' || refresh === '') {
      throw new AppError(ErrorCode.REFRESH_TOKEN_INVALID, 'No session to refresh.');
    }

    try {
      const s = await svc.rotate(refresh, {
        userAgent: req.headers['user-agent'] ?? null,
        ipHash: null,
      });
      jar(reply).setCookie(c.accessName, s.accessToken, { ...c.options, maxAge: 900 });
      jar(reply).setCookie(c.refreshName, s.refreshToken, c.options);
      void reply.send({ ok: true });
    } catch (err) {
      // Any refresh failure clears the cookies. Leaving a dead refresh token in
      // the browser means the client retries it forever and — if the family was
      // revoked for REUSE — keeps re-triggering the alarm.
      for (const n of [c.accessName, c.refreshName, c.csrfName]) {
        jar(reply).clearCookie(n, { path: '/' });
      }
      throw err;
    }
  }

  @Public()
  @Post('logout')
  async logout(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const svc = this.#svc();
    const c = svc.cookieOptions({ secure: IS_SECURE });
    const jarC = cookies(req);
    verifyCsrf(req.method, jarC[c.csrfName], req.headers['x-csrf-token'] as string | undefined);

    const refresh = jarC[c.refreshName];
    if (typeof refresh === 'string' && refresh !== '') {
      // Revoke server-side as well as clearing the cookie. Clearing alone would
      // leave a working refresh token in anyone's hands who had already copied
      // it — logout has to mean revoked, not merely forgotten.
      await svc.revokeByRefreshToken(refresh, 'user signed out').catch(() => undefined);
    }
    for (const n of [c.accessName, c.refreshName, c.csrfName]) {
      jar(reply).clearCookie(n, { path: '/' });
    }
    void reply.send({ ok: true });
  }

  /** Who am I? Returns null rather than 401 so the UI can render a signed-out state. */
  @Public()
  @Get('me')
  me(@Req() req: FastifyRequest, @Res() reply: FastifyReply): void {
    const c = this.#svc().cookieOptions({ secure: IS_SECURE });
    if (cookies(req)[c.csrfName] === undefined) {
      jar(reply).setCookie(c.csrfName, issueCsrfToken(), { ...c.options, httpOnly: false });
    }
    void reply.send({ user: req.user ?? null });
  }
}
