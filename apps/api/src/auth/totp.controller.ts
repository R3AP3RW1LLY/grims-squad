import { Controller, Get, Post, Body, Req, Res, Inject, Optional } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { User, type CurrentUser } from './current-user.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import { TotpService } from './totp.service.js';
import { STEP_UP_ABSOLUTE_MS } from './admin-gate.guard.js';

const IS_SECURE = process.env['NODE_ENV'] === 'production';
const STEP_UP_COOKIE = `${IS_SECURE ? '__Host-' : ''}gs_2fa`;

interface CookieJar {
  setCookie(name: string, value: string, options?: Record<string, unknown>): unknown;
  clearCookie(name: string, options?: Record<string, unknown>): unknown;
}

@Controller('v1/auth/totp')
export class TotpController {
  constructor(@Optional() @Inject(TotpService) private readonly totp: TotpService | null) {}

  #svc(): TotpService {
    if (this.totp === null) {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, 'Two-factor is not configured.');
    }
    return this.totp;
  }

  @Get('status')
  async status(@User() caller: CurrentUser | undefined): Promise<{ enrolled: boolean }> {
    return { enrolled: await this.#svc().isEnrolled(requireUser(caller)) };
  }

  /**
   * Starts enrolment.
   *
   * Returns the secret and an otpauth URI — this is the ONE response that
   * legitimately carries the secret, because the member has to type it into
   * their authenticator. It is never returned again afterwards.
   */
  @Post('enrol')
  async enrol(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
  ): Promise<{ secret: string; otpauthUri: string }> {
    const userId = requireUser(caller);
    csrf(req);
    return this.#svc().beginEnrolment(userId, userId);
  }

  /** Confirms enrolment and returns the recovery codes, shown exactly once. */
  @Post('confirm')
  async confirm(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ recoveryCodes: string[] }> {
    const userId = requireUser(caller);
    csrf(req);
    const result = await this.#svc().confirmEnrolment(userId, readCode(body));
    // Confirming proves possession right now, so it counts as the step-up too.
    // Asking for a second code immediately after entering one is friction with
    // no security value.
    this.#setStepUp(reply);
    return result;
  }

  /**
   * The step-up challenge: proves the person at the keyboard still holds the
   * authenticator, inside an already-authenticated session.
   */
  @Post('verify')
  async verify(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ verified: true }> {
    const userId = requireUser(caller);
    csrf(req);

    const raw = body as Record<string, unknown> | null;
    const recovery = raw?.['recoveryCode'];
    if (typeof recovery === 'string' && recovery.trim() !== '') {
      await this.#svc().verifyRecovery(userId, recovery);
    } else {
      await this.#svc().verify(userId, readCode(body));
    }

    this.#setStepUp(reply);
    return { verified: true };
  }

  #setStepUp(reply: FastifyReply): void {
    /*
     * `<issuedAt>.<lastSeenAt>`, both the same at the moment a code is entered. The first never
     * moves and bounds the session absolutely; the second slides with activity. See
     * admin-gate.guard.ts.
     */
    const now = Date.now();
    (reply as unknown as CookieJar).setCookie(STEP_UP_COOKIE, `${now}.${now}`, {
      httpOnly: true,
      secure: IS_SECURE,
      // Strict, unlike the session cookie. Nothing navigates cross-site into an
      // admin action, so there is no reason to send this one on a foreign
      // navigation — and this is the cookie that opens the console.
      sameSite: 'strict',
      path: '/',
      maxAge: Math.floor(STEP_UP_ABSOLUTE_MS / 1000),
    });
  }
}

function readCode(body: unknown): string {
  const v = (body as Record<string, unknown> | null)?.['code'];
  if (typeof v !== 'string') {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'A six-digit code is required.');
  }
  return v.trim();
}

function csrf(req: FastifyRequest): void {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);
}

function requireUser(caller: CurrentUser | undefined): string {
  if (caller === undefined) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
  return caller.userId;
}

export { STEP_UP_COOKIE };
