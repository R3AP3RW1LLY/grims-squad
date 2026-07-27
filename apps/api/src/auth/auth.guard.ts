import {
  Injectable,
  Inject,
  Optional,
  type CanActivate,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { SessionService } from './session.service.js';

/** Marks a route as reachable without a session. */
export const Public = () => SetMetadata('auth:public', true);

/**
 * Resolves the session cookie into `req.user`.
 *
 * FAILS CLOSED. A route is authenticated unless it explicitly opts out with
 * @Public — the opposite default would mean forgetting a decorator silently
 * exposes an endpoint, and forgetting is the common case.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  /*
   * Tokens are EXPLICIT rather than inferred from parameter types. Nest's
   * type-based injection relies on `emitDecoratorMetadata`, which TypeScript
   * emits and esbuild does not — so a guard that works when compiled with tsc
   * fails at runtime under tsx with "cannot read getAllAndOverride", because
   * only the first argument arrives. Naming the tokens removes the dependency
   * on which toolchain happens to be running.
   *
   * SessionService is @Optional because its factory returns null when the
   * server has no OAUTH_STATE_SECRET; the health endpoint must still answer.
   */
  constructor(
    @Optional() @Inject(SessionService) private readonly sessions: SessionService | null,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('auth:public', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
    const secure = process.env['NODE_ENV'] === 'production';
    const token =
      this.sessions === null ? undefined : cookies[this.sessions.cookieOptions({ secure }).accessName];

    if (this.sessions !== null && typeof token === 'string' && token !== '') {
      try {
        const claims = await this.sessions.verifyAccess(token);
        req.user = { userId: claims.sub };
      } catch {
        // An expired or forged token is treated as no token. The client's
        // refresh flow decides what happens next; a hard error here would make
        // every public page break the moment a session lapsed.
      }
    }

    /*
     * The step-up marker, read here rather than in AdminGateGuard so that the
     * guard which DECIDES has nothing to do with cookie parsing. The value is
     * a timestamp we set ourselves in an httpOnly cookie; freshness is judged
     * downstream, and a malformed value simply means "not stepped up".
     */
    const stepUpRaw = cookies[`${secure ? '__Host-' : ''}gs_2fa`];
    if (typeof stepUpRaw === 'string') {
      const ms = Number(stepUpRaw);
      if (Number.isFinite(ms) && ms > 0) req.twoFactorAt = new Date(ms);
    }

    if (isPublic === true) return true;
    if (req.user === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to continue.');
    }
    return true;
  }
}
