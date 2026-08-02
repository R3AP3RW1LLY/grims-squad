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

  /**
   * Removes the authenticator.
   *
   * ★ SQUADRON OWNER ★
   *
   * "we need a way for our users to either add the authenticator to their profile and manage the
   * authenticator, remove and re add etc, the officers / admin roles if they remove it must be
   * prompted to re add it, and until they do, can not be able to access the admin area at all!"
   *
   * ★ A CODE IS REQUIRED TO REMOVE ONE ★
   *
   * Removal is the single most useful thing an attacker can do with a hijacked session: it turns a
   * stolen browser tab into a permanent hold on the account, because everything afterwards needs
   * only Discord. So it costs a current code or a recovery code — the same proof enrolling costs.
   *
   * That is deliberately NOT the step-up cookie. A stepped-up session is a decision made up to
   * eight hours ago; this asks the person at the keyboard to prove possession NOW.
   *
   * ★ AND NOTHING HERE REVOKES ADMIN ACCESS, BECAUSE NOTHING NEEDS TO ★
   *
   * `AdminGateGuard` already refuses every admin route unless TOTP is enrolled, and
   * `mustSecureAccount` on /me is "privileged AND unenrolled". Removing the enrolment therefore
   * closes the admin area and raises the re-enrol prompt on its own, with no bookkeeping here.
   *
   * Writing a second revocation path would be the bug: two answers to "may this account open the
   * admin console", one of which is a column somebody has to remember to set.
   */
  @Post('remove')
  async remove(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ removed: true }> {
    const userId = requireUser(caller);
    csrf(req);

    const svc = this.#svc();
    if (!(await svc.isEnrolled(userId))) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'You do not have an authenticator set up.');
    }

    const raw = body as Record<string, unknown> | null;
    const recovery = raw?.['recoveryCode'];
    if (typeof recovery === 'string' && recovery.trim() !== '') {
      await svc.verifyRecovery(userId, recovery);
    } else {
      await svc.verify(userId, readCode(body));
    }

    await svc.remove(userId);

    /*
     * The step-up cookie goes with it. Leaving it set would let a privileged member keep browsing
     * the admin area until it expired, on the strength of a factor they had just deleted — and the
     * guard reads enrolment as well, so it would have refused anyway. Clearing it means the UI and
     * the guard agree immediately rather than after a page load.
     */
    this.#clearStepUp(reply);

    return { removed: true };
  }

  #clearStepUp(reply: FastifyReply): void {
    (reply as unknown as CookieJar).clearCookie(STEP_UP_COOKIE, { path: '/' });
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
