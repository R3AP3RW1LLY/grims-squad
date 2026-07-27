import {
  Injectable,
  Inject,
  type CanActivate,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, type PermissionMask } from '@grims/shared';
import { PermissionService } from './permission.service.js';

const KEY = 'authz:required';
const CLOAK_KEY = 'authz:cloak-404';

/**
 * Requires EVERY bit in `mask`.
 *
 *   @RequiresPermission(Permission.MEMBER_MANAGE)
 *
 * This is the CONTROLLER-level check. It is not the only one, and it is not the
 * important one — INV-002 requires enforcement in the DATA layer, because a
 * controller guard protects one route and a repository protects every caller
 * that will ever exist. This exists to return a clean 403 early, not to be the
 * boundary.
 */
export const RequiresPermission = (mask: PermissionMask) => SetMetadata(KEY, mask.toString());

/**
 * Answer 404 rather than 403 when permission is missing.
 *
 * A 403 CONFIRMS the route exists. On the admin surface that hands an outsider
 * a map: which endpoints are there, and therefore what the console can do. A
 * 404 tells them the same thing as a mistyped URL.
 *
 * Not the default everywhere, because for a route a member legitimately knows
 * about — one they simply lack a permission for — a 404 is a lie that sends
 * them looking for a bug instead of asking an officer for access.
 */
export const CloakAsNotFound = () => SetMetadata(CLOAK_KEY, true);

@Injectable()
export class RequiresPermissionGuard implements CanActivate {
  // Explicit tokens: see the note in AuthGuard. Type-based injection needs
  // emitDecoratorMetadata, which esbuild does not produce.
  constructor(
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const raw = this.reflector.getAllAndOverride<string>(KEY, [ctx.getHandler(), ctx.getClass()]);
    if (raw === undefined) return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const userId = req.user?.userId;
    if (userId === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to continue.');
    }

    if (!(await this.permissions.has(userId, BigInt(raw)))) {
      // Deliberately does NOT say which permission was missing. Telling an
      // attacker exactly which bit to acquire is a map of the way in.
      const cloak = this.reflector.getAllAndOverride<boolean>(CLOAK_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]);
      throw cloak === true
        ? new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Not found.')
        : new AppError(ErrorCode.PERMISSION_DENIED, 'You do not have access to this.');
    }
    return true;
  }
}
