import { Controller, Post, Get, Req, Res, Inject, Optional } from '@nestjs/common';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaClient } from '@grims/db';
import { AppError, ErrorCode } from '@grims/shared';
import { SessionService, REFRESH_TTL_SEC } from './session.service.js';
import { verifyCsrf, issueCsrfToken } from '../common/csrf.js';
import { Public } from './auth.guard.js';
import { PermissionService } from '../authz/permission.service.js';
import { TotpService } from './totp.service.js';
import { grantStillValid, sessionLifetimeSec, type GrantState } from './discord-grant.js';
import { PRIVILEGED_PERMISSIONS, describePermissions, requiresTwoFactor } from '@grims/shared';

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
  constructor(
    @Optional() @Inject(SessionService) private readonly sessions: SessionService | null,
    @Optional() @Inject(PermissionService) private readonly permissions: PermissionService | null,
    @Optional() @Inject(TotpService) private readonly totp: TotpService | null,
    @Optional() @Inject(PrismaClient) private readonly db: PrismaClient | null = null,
  ) {}

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
  /**
   * What Discord still says about this member.
   *
   * Reads our stored copy rather than calling Discord: the refresh token's
   * PRESENCE is the signal, because Discord drops it on revocation. Calling out
   * on every refresh would be a request to Discord every fifteen minutes per
   * active member, to learn something we already have on disk.
   */
  async #grantFor(userId: string): Promise<GrantState> {
    if (this.db === null) return { tokenExpiresAt: null, hasRefreshToken: true };

    const identity = await this.db.discordIdentity.findUnique({
      where: { userId },
      select: { tokenExpiresAt: true, refreshTokenEnc: true },
    });

    // No identity row at all is the UNKNOWN case, not the revoked one — see
    // grantStillValid. Left alone rather than signed out.
    if (identity === null) return { tokenExpiresAt: null, hasRefreshToken: true };

    return {
      tokenExpiresAt: identity.tokenExpiresAt,
      hasRefreshToken: identity.refreshTokenEnc !== null,
    };
  }

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

      /*
       * ★ OUR SESSION MUST NOT OUTLIVE DISCORD'S AUTHORISATION ★
       *
       * Checked HERE rather than on every request. Refresh is the natural
       * checkpoint: it happens every fifteen minutes for an active member, and
       * not at all for one who has gone away — so a revocation is honoured
       * promptly for the people it matters for, at no per-request cost.
       *
       * The case this closes: somebody removes our app in their Discord
       * settings and stays signed in here for the rest of their thirty-day
       * cookie. They have said stop; continuing would mean our idea of who they
       * are outliving theirs, and the only way they would find out is by
       * visiting a page they have no reason to visit.
       */
      const grant = await this.#grantFor(s.userId);
      const verdict = grantStillValid(grant, new Date());
      if (!verdict.ok) {
        throw new AppError(
          ErrorCode.REFRESH_TOKEN_INVALID,
          verdict.reason === 'revoked'
            ? 'Your Discord authorisation was removed. Sign in again to continue.'
            : 'Your session has expired. Sign in again to continue.',
        );
      }

      // Capped to whatever the grant has left, so the cookie expires cleanly
      // rather than failing confusingly part-way through something.
      const refreshMaxAge = sessionLifetimeSec(grant, REFRESH_TTL_SEC, new Date());

      jar(reply).setCookie(c.accessName, s.accessToken, { ...c.options, maxAge: 900 });
      jar(reply).setCookie(c.refreshName, s.refreshToken, { ...c.options, maxAge: refreshMaxAge });
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

  /**
   * What this member still has to do to be in good standing.
   *
   * Drives the banner and the onboarding flow. Deliberately reports the member's
   * OWN status only — it takes no id, so there is nothing here to point at
   * somebody else and no way to enumerate who does or does not hold privileged
   * permissions.
   *
   * Names the permissions that create the obligation, because "secure your
   * account" with no reason is an instruction, and people comply with
   * explanations rather than instructions.
   */
  @Get('me/account-status')
  async accountStatus(@Req() req: FastifyRequest): Promise<{
    privileged: boolean;
    twoFactorEnrolled: boolean;
    needsSecuring: boolean;
    because: string[];
  }> {
    const userId = req.user?.userId;
    if (userId === undefined || this.permissions === null || this.totp === null) {
      // Anonymous, or the services are not configured. Nothing to prompt about,
      // and CERTAINLY nothing to prompt about wrongly — a banner telling a
      // signed-out visitor to secure an account they do not have is noise.
      return { privileged: false, twoFactorEnrolled: false, needsSecuring: false, because: [] };
    }

    const mask = await this.permissions.effectiveMask(userId);
    const privileged = requiresTwoFactor(mask);
    const enrolled = await this.totp.isEnrolled(userId);

    return {
      privileged,
      twoFactorEnrolled: enrolled,
      needsSecuring: privileged && !enrolled,
      because: privileged ? describePermissions(mask & PRIVILEGED_PERMISSIONS) : [],
    };
  }
}
