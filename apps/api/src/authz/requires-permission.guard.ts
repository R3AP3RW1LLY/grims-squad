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
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'You do not have access to this.');
    }
    return true;
  }
}
