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

    if (!twoFactorFreshInSession(req)) {
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
    if (needsFresh === true && !twoFactorFreshInSession(req, new Date(), FRESH_STEP_UP_TTL_MS)) {
      throw new AppError(
        ErrorCode.TWO_FACTOR_REQUIRED,
        'This change needs a fresh authenticator code. Confirm it again to continue.',
      );
    }

    return true;
  }
}

/**
 * How long a step-up lasts before the console asks again.
 *
 * ★ TWO HOURS IS A CEILING, NOT A TARGET ★
 *
 * Raised from fifteen minutes on the squadron owner's instruction. Worth being
 * clear about the trade rather than burying it: a longer window means a
 * stepped-up session left open on an unattended machine stays privileged for
 * longer, and that is the cost being accepted.
 *
 * What makes it defensible is the tier below. The actions that can do lasting
 * damage — granting roles, changing site config, resetting somebody's second
 * factor — do NOT run on this window; they require a challenge from the last
 * two minutes. So two hours buys convenience for reading and routine work, and
 * buys nothing at all for the operations that matter most.
 */
export const STEP_UP_TTL_MS = 2 * 60 * 60_000;

/**
 * The window for a TIER-3 action: granting roles, site config, AI kill switches.
 *
 * Two minutes, and deliberately NOT raised alongside the general window above.
 * Long enough to preview a permission change and then save it, short enough
 * that a stepped-up session left unattended is not a standing authorisation to
 * grant anybody anything.
 *
 * This is what makes a two-hour general window survivable: the longer window
 * covers reading and routine work, and the actions that can do lasting damage
 * still ask again.
 */
export const FRESH_STEP_UP_TTL_MS = 2 * 60_000;

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the session layer from the step-up cookie. */
    twoFactorAt?: Date;
  }
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
