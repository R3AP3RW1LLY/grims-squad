import { Injectable, Inject, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, previewAllows, VIEW_AS_REFUSAL } from '@grims/shared';
import { ViewAsService } from './view-as.service.js';

/**
 * Refuses anything that changes state while a rank preview is active.
 *
 * ★ WHY A PREVIEW MUST NOT BE ABLE TO ACT ★
 *
 * Two reasons, and the second is the one that bites.
 *
 * The audit log would record the wrong thing: a webmaster editing a role while they believed they
 * were a Cadet looking at a page. Somebody reading that log later has no way to know a preview was
 * involved.
 *
 * And a reduced mask makes SOME writes succeed that the viewer expects to be refused, and others
 * fail that they expect to work — so a preview that could act would produce exactly the confusion
 * the feature exists to remove. "Can a Cadet do this?" is a question about permission masks, which
 * the roles page answers directly. "What does a Cadet SEE?" is the question this is for.
 *
 * ★ GLOBAL, AND AFTER THE AUTH GUARD ★
 *
 * Registered alongside the permission guard rather than applied per controller. A preview that
 * refused writes on the admin console but not on the forum would let somebody post as themselves
 * while believing they were previewing — the same wrong-name-in-the-log problem, on the surface
 * where it is most visible to other members.
 */
@Injectable()
export class ViewAsGuard implements CanActivate {
  constructor(@Inject(ViewAsService) private readonly viewAs: ViewAsService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();

    // No preview, no opinion. This is the overwhelmingly common path and it does no work beyond
    // reading one cookie.
    if (this.viewAs.previewedRoleId(req) === null) return true;

    /*
     * `previewAllows` holds the exemptions, and the important one is leaving the preview.
     *
     * Preview as Cadet and you no longer hold ROLE_MANAGE — so if the exit were refused here for
     * being a DELETE, you would be stuck inside the preview until the cookie expired, with the
     * button to escape refusing you.
     */
    if (previewAllows(req.method, req.url.split('?')[0] ?? req.url)) return true;

    throw new AppError(ErrorCode.PERMISSION_DENIED, VIEW_AS_REFUSAL);
  }
}
