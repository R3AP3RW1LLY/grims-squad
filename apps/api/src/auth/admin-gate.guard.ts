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

    return true;
  }
}

/** How long a step-up lasts before the console asks again. */
export const STEP_UP_TTL_MS = 15 * 60_000;

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
export function twoFactorFreshInSession(req: FastifyRequest, now: Date = new Date()): boolean {
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
  return age >= 0 && age < STEP_UP_TTL_MS;
}
