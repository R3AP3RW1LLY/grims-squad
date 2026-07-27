import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** Resolved from the session cookie by AuthGuard. */
export interface CurrentUser {
  readonly userId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: CurrentUser;
  }
}

/**
 * Injects the signed-in user, or undefined.
 *
 * Deliberately returns undefined rather than throwing on an anonymous request:
 * whether anonymous access is allowed is a decision for the guard on that
 * route, not for the decorator that reads the value.
 */
export const User = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUser | undefined =>
    ctx.switchToHttp().getRequest<{ user?: CurrentUser }>().user,
);
