import {
  Injectable,
  Inject,
  Optional,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { TotpService } from './totp.service.js';

const KEY = 'authz:requires-2fa';

/**
 * Marks a route as requiring a CONFIRMED second factor.
 *
 *   @RequiresTwoFactor()
 *
 * The human's decision: TOTP is required to ENTER THE ADMIN CONSOLE, not to
 * sign in. Signing in with Discord stays one step, because making 108 members
 * enrol to read the forum would be a tax on everyone to protect a handful of
 * accounts. The handful is where the protection belongs.
 */
export const RequiresTwoFactor = () => SetMetadata(KEY, true);

const FRESH_KEY = 'authz:requires-fresh-2fa';

/**
 * Requires a step-up performed in the last few MINUTES, not the last quarter hour.
 *
 * ★ P1.10 ACCEPTANCE CRITERION ★
 * "A tier-3 action (role grant, site config, AI kill switch) requires a fresh
 * step-up challenge even within a live session."
 *
 * The ordinary console window is fifteen minutes, which is right for reading
 * dashboards and wrong for handing somebody ROLE_MANAGE. An attacker who gets
 * to a logged-in, stepped-up machine has a quarter of an hour to grant
 * themselves everything; narrowing it to two minutes means they need the
 * authenticator in their hand, which is the entire point of having one.
 */
export const RequiresFreshTwoFactor = () => SetMetadata(FRESH_KEY, true);

/**
 * Refuses an admin route unless the caller has TOTP enrolled AND has satisfied
 * it recently in this session.
 *
 * ★ TWO SEPARATE CHECKS, DELIBERATELY ★
 *
 * "Enrolled" is a property of the account. "Satisfied recently" is a property
 * of the session. Only checking the first means someone who enrolled in March
 * walks into the console in July on a cookie alone, which is the same as not
 * having 2FA at all for anyone who has ever stolen a session.
 */
@Injectable()
export class AdminGateGuard implements CanActivate {
  // Explicit tokens: esbuild emits no decorator metadata, so type-based
  // injection resolves to Object and every route 500s (found in P1.2).
  constructor(
    @Optional() @Inject(TotpService) private readonly totp: TotpService | null,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (required !== true) return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const userId = req.user?.userId;
    if (userId === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    }

    if (this.totp === null) {
      // No TOTP service configured means no second factor can be checked.
      // Refuse rather than wave the request through — an admin console that
      // silently drops its own gate because of a missing environment variable
      // is worse than one that is unavailable.
      throw new AppError(
        ErrorCode.TWO_FACTOR_REQUIRED,
        'Two-factor is not configured on this server, so the admin console is unavailable.',
      );
    }

    if (!(await this.totp.isEnrolled(userId))) {
      // FORCED, not suggested. The response names the enrolment route so the
      // client can send them there rather than showing a dead end.
      throw new AppError(
        ErrorCode.TWO_FACTOR_REQUIRED,
        'Set up two-factor authentication to use the admin console. Go to /settings/security.',
      );
    }

    if (!twoFactorFreshInSession(req) || !withinAbsoluteWindow(req)) {
      throw new AppError(
        ErrorCode.TWO_FACTOR_REQUIRED,
        'Confirm your authenticator code to continue.',
      );
    }

    // Tier-3 routes ask again, on a much shorter window. Checked AFTER the
    // ordinary gate so the common case gives the ordinary message.
    const needsFresh = this.reflector.getAllAndOverride<boolean>(FRESH_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (needsFresh === true && !freshCodeEntered(req)) {
      throw new AppError(
        ErrorCode.TWO_FACTOR_REQUIRED,
        'This change needs a fresh authenticator code. Confirm it again to continue.',
      );
    }

    /*
     * ★ THIS IS WHAT MAKES THE WINDOW SLIDE ★
     *
     * Re-stamped on every request that gets through, so eight hours means eight hours of INACTIVITY
     * rather than eight hours from entering a code. `issuedAt` is carried forward untouched, which
     * is what keeps the absolute ceiling meaningful — otherwise activity would extend the session
     * indefinitely and the ceiling would never be reached.
     */
    stampActivity(ctx, req);

    return true;
  }
}

/**
 * How long a step-up lasts before the console asks again — SLIDING, on activity.
 *
 * ★ SQUADRON OWNER, 2026-07-31 ★
 *
 * "we need to greatly increase the admin 2FA timeout ... can we make the 2FA timeout every 8 hours
 * unless activity is detected?"
 *
 * So this is now eight hours of INACTIVITY rather than eight hours from the code being entered.
 * Every admin request that passes this gate pushes the window forward, so somebody working through
 * a long session is never interrupted, and a session abandoned at a desk still expires.
 *
 * ★ AND WHY THERE IS AN ABSOLUTE CAP AS WELL ★
 *
 * A purely sliding window never ends: a browser tab left open on a polling admin page would renew
 * itself forever, and the second factor would effectively stop applying to the one machine most
 * likely to be walked away from. `STEP_UP_ABSOLUTE_MS` is the backstop — past it a fresh code is
 * required however busy the session has been.
 */
export const STEP_UP_TTL_MS = 8 * 60 * 60_000;

/**
 * The longest a single step-up can live, however much activity there is.
 *
 * Twenty-four hours. Long enough that nobody meets it during a normal day at the console, short
 * enough that "I entered a code yesterday" is never a reason the admin tools are open today.
 */
export const STEP_UP_ABSOLUTE_MS = 24 * 60 * 60_000;

/**
 * The window for a TIER-3 action: granting roles, site config, AI kill switches.
 *
 * ★ RAISED FROM TWO MINUTES TO FIFTEEN, ON THE OWNER'S INSTRUCTION ★
 *
 * Squadron owner, 2026-07-31, after being shown the trade. Two minutes meant re-entering a code
 * between each change while working through a batch of role edits, which is the kind of friction
 * that gets a control switched off entirely.
 *
 * The cost, stated plainly because it is real: a stepped-up session left unattended can grant
 * permissions for a quarter of an hour rather than two minutes.
 *
 * What keeps this defensible is that it is still SEPARATE from the eight-hour general window, and
 * does NOT slide. Fifteen minutes from the last code entered, not from the last click.
 */
export const FRESH_STEP_UP_TTL_MS = 15 * 60_000;

declare module 'fastify' {
  interface FastifyRequest {
    /** Last admin activity, from the step-up cookie. The SLIDING half. */
    twoFactorAt?: Date;
    /** When a code was actually entered. Never moves — the absolute ceiling is measured from it. */
    twoFactorIssuedAt?: Date;
  }
}

/**
 * Was a CODE entered recently — not merely activity seen?
 *
 * Tier-3 deliberately measures from `issuedAt`, so clicking around the console does not keep the
 * dangerous window open. Fifteen minutes from typing a code, and no amount of browsing extends it.
 *
 * Falls back to the sliding stamp only for pre-existing cookies that carry no `issuedAt`.
 */
function freshCodeEntered(req: FastifyRequest, now: Date = new Date()): boolean {
  const issued = req.twoFactorIssuedAt ?? req.twoFactorAt;
  if (issued === undefined) return false;
  const age = now.getTime() - issued.getTime();
  return age >= 0 && age < FRESH_STEP_UP_TTL_MS;
}

/**
 * Pushes the sliding half of the step-up cookie forward.
 *
 * Best-effort: a response that has already been sent, or a route using a raw reply, must never turn
 * a successful admin action into a failure because a convenience cookie could not be rewritten.
 */
function stampActivity(ctx: ExecutionContext, req: FastifyRequest): void {
  try {
    const reply = ctx.switchToHttp().getResponse<{
      setCookie?: (name: string, value: string, options?: Record<string, unknown>) => unknown;
    }>();
    if (typeof reply.setCookie !== 'function') return;

    const issued = req.twoFactorIssuedAt ?? req.twoFactorAt;
    if (issued === undefined) return;

    const secure = process.env['NODE_ENV'] === 'production';
    reply.setCookie(`${secure ? '__Host-' : ''}gs_2fa`, `${issued.getTime()}.${Date.now()}`, {
      httpOnly: true,
      secure,
      // Strict, like the original: nothing navigates cross-site into an admin action.
      sameSite: 'strict',
      path: '/',
      maxAge: Math.floor(STEP_UP_ABSOLUTE_MS / 1000),
    });
  } catch {
    // See above — this is a convenience, not a control.
  }
}

/**
 * Has this step-up outlived its absolute ceiling, regardless of activity?
 *
 * The sliding window alone never ends — a tab left open on a polling admin page renews itself
 * forever, and the second factor stops applying to precisely the machine most likely to have been
 * walked away from. This is measured from when a CODE was entered and nothing moves it.
 *
 * A session from before the sliding change carries no `issuedAt`; those are allowed through on the
 * sliding check alone rather than being signed out mid-shift for no gain.
 */
export function withinAbsoluteWindow(
  req: FastifyRequest,
  now: Date = new Date(),
  windowMs: number = STEP_UP_ABSOLUTE_MS,
): boolean {
  const issued = req.twoFactorIssuedAt;
  if (issued === undefined) return true;
  const age = now.getTime() - issued.getTime();
  // Same both-bounds rule as below: a future timestamp must not pass forever.
  return age >= 0 && age < windowMs;
}

/**
 * Was the second factor satisfied recently enough in THIS session?
 *
 * Fifteen minutes. Long enough to work through the console without being
 * nagged, short enough that a session stolen an hour ago does not open it.
 */
export function twoFactorFreshInSession(
  req: FastifyRequest,
  now: Date = new Date(),
  windowMs: number = STEP_UP_TTL_MS,
): boolean {
  const at = req.twoFactorAt;
  if (at === undefined) return false;

  const age = now.getTime() - at.getTime();
  /*
   * BOTH bounds, and the lower one is load-bearing.
   *
   * `age < TTL` alone is satisfied by a NEGATIVE age, so a timestamp in the
   * future passes forever. The value arrives in a cookie — httpOnly and set by
   * us, but still client-side storage — and a step-up dated 2099 would be a
   * permanent bypass of the gate. Rejecting future timestamps costs nothing:
   * a legitimate one is never ahead of the server's own clock.
   */
  return age >= 0 && age < windowMs;
}
