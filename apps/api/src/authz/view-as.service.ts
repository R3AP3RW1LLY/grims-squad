import type { FastifyRequest } from 'fastify';
import {
  type PermissionMask,
  VIEW_AS_COOKIE,
  PREVIEW_UNKNOWN_ROLE_MASK,
  previewMask,
  readPreviewRoleId,
} from '@grims/shared';
import { PermissionService } from './permission.service.js';

/**
 * The permission mask to use for THIS request, accounting for a rank preview.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "a way for the webmaster and officers to visually spoof a rank and physically see what they see
 * in the web app so we can verify that everything is working on that front"
 *
 * ★ ONE PLACE, OR IT IS NOT A PREVIEW ★
 *
 * The nav, the permission guard and every page that asks "may I" have to agree, or the preview
 * shows a sidebar for one rank and pages for another — which is worse than not having it, because
 * it would look like the permissions themselves were broken.
 *
 * So everything that needs a mask for a request asks this, and `effectiveMask` is called directly
 * only where there is no request at all.
 */

export interface IRoleMaskLookup {
  /**
   * The role's mask AND its name, or null when no such role exists.
   *
   * The name comes back with the mask because the banner has to say which rank is being previewed.
   * "You are viewing as another rank" is not enough — an officer clicking through six pages needs
   * to know WHICH, and a second lookup on every page for a string we already had would be silly.
   */
  find(roleId: string): Promise<{ readonly name: string; readonly mask: PermissionMask } | null>;
}

export class ViewAsService {
  constructor(
    private readonly permissions: PermissionService,
    private readonly roles: IRoleMaskLookup,
  ) {}

  /** The role being previewed on this request, or null. */
  previewedRoleId(req: FastifyRequest): string | null {
    const jar = (req.cookies ?? {}) as Record<string, string | undefined>;
    return readPreviewRoleId(jar[VIEW_AS_COOKIE]);
  }

  /**
   * The mask this request should be authorised and rendered with.
   *
   * ★ INTERSECTION, NEVER SUBSTITUTION ★
   *
   * `previewMask` is `real & role`. It cannot produce a bit the caller did not already hold, which
   * is why the cookie needs no signature: tampering with it can only take permissions away from the
   * person doing the tampering.
   */
  async maskFor(userId: string, req: FastifyRequest): Promise<PermissionMask> {
    const real = await this.permissions.effectiveMask(userId);

    const roleId = this.previewedRoleId(req);
    if (roleId === null) return real;

    /*
     * A role that has since been deleted previews as NOTHING rather than as the caller's real mask.
     *
     * Falling back to the real mask would mean a preview silently stopped previewing — the banner
     * would still be on screen saying "viewing as Cadet" while the site showed the webmaster's own
     * view. A preview that lies about what it is showing is the one outcome worth avoiding here,
     * and an empty one is obvious enough to be reported.
     */
    const role = await this.roles.find(roleId);
    return previewMask(real, role?.mask ?? PREVIEW_UNKNOWN_ROLE_MASK);
  }

  /** The role being previewed, with its name, for the banner. Null when not previewing. */
  async previewedRole(req: FastifyRequest): Promise<{ id: string; name: string } | null> {
    const roleId = this.previewedRoleId(req);
    if (roleId === null) return null;

    const role = await this.roles.find(roleId);
    /*
     * A role that has since been deleted still reports as a preview, named plainly. The mask is
     * already empty (see `maskFor`), and a banner that vanished while the site stayed empty would
     * leave somebody staring at a stripped-down page with nothing explaining it.
     */
    return { id: roleId, name: role?.name ?? 'a role that no longer exists' };
  }

  /** True when every bit in `required` survives the preview. */
  async allows(userId: string, req: FastifyRequest, required: PermissionMask): Promise<boolean> {
    // An empty requirement answers false, exactly as `PermissionService.has` does: `has(user, 0n)`
    // is almost always a constant that failed to resolve, and "yes, you hold nothing" opens a door.
    if (required === 0n) return false;
    return ((await this.maskFor(userId, req)) & required) === required;
  }
}
