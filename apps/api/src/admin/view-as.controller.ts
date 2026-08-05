import { Controller, Post, Delete, Body, Req, Res, Inject, UseGuards } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@grims/db';
import {
  AppError,
  ErrorCode,
  Permission,
  VIEW_AS_COOKIE,
  VIEW_AS_MAX_AGE_SEC,
  readPreviewRoleId,
} from '@grims/shared';
import { RequiresPermission } from '../authz/requires-permission.guard.js';
import { AdminGateGuard, RequiresTwoFactor } from '../auth/admin-gate.guard.js';
import { User, type CurrentUser } from '../auth/current-user.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';

/**
 * Entering and leaving a rank preview.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "on the roles page, we need to add a way for the webmaster and officers to visually spoof a rank
 * and physically see what they see in the web app so we can verify that everything is working on
 * that front"
 *
 * ★ WHY THIS IS ITS OWN CONTROLLER ★
 *
 * The admin controller carries `@RequiresPermission(MEMBER_MANAGE)` at class level. Leaving a
 * preview MUST NOT require any permission — that is the whole trap this feature has — so the exit
 * cannot live on a class that gates everything. Two routes, two different rules, and the difference
 * is the point rather than an accident of layout.
 */
const IS_SECURE = (process.env['PUBLIC_WEB_URL'] ?? '').startsWith('https://');

interface CookieJar {
  setCookie(name: string, value: string, options?: Record<string, unknown>): unknown;
  clearCookie(name: string, options?: Record<string, unknown>): unknown;
}

const jar = (reply: FastifyReply): CookieJar => reply as unknown as CookieJar;

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_SECURE,
  /*
   * `lax`, not `strict`. The preview has to survive arriving at a page from a link, which is the
   * whole activity — an officer clicking through the site to see what a rank sees. Under `strict`
   * the cookie would be withheld on the first navigation and the preview would appear to end by
   * itself, at random.
   */
  sameSite: 'lax' as const,
  path: '/',
  signed: false,
};

@Controller('v1/admin/view-as')
export class ViewAsController {
  constructor(@Inject(PrismaClient) private readonly db: PrismaClient) {}

  /**
   * Start previewing a role.
   *
   * ★ ROLE_MANAGE, BECAUSE IT LIVES ON THE ROLES PAGE ★
   *
   * Not for safety — a preview can only ever REMOVE permissions, so somebody with no permission at
   * all could set this cookie and gain precisely nothing. It is gated because it belongs to the
   * screen that edits masks, and an officer who cannot edit a role has no reason to be handed a
   * control that previews one.
   */
  @Post()
  @UseGuards(AdminGateGuard)
  @RequiresTwoFactor()
  @RequiresPermission(Permission.ROLE_MANAGE)
  async begin(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ viewingAs: string; roleName: string }> {
    if (caller === undefined) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to continue.');
    csrf(req);

    const roleId = readPreviewRoleId((body as { roleId?: string } | null)?.roleId);
    if (roleId === null) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Choose a role to preview.');
    }

    /*
     * The role is resolved BEFORE the cookie is set, so a typo is an error message rather than a
     * preview of nothing. A preview with an empty mask looks identical to a catastrophic
     * permissions failure, and the person seeing it would have no way to tell which.
     */
    const role = await this.db.role.findFirst({
      where: { OR: [{ id: roleId }, { key: roleId }] },
      select: { id: true, name: true },
    });
    if (role === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No such role.');
    }

    jar(reply).setCookie(VIEW_AS_COOKIE, role.id, {
      ...COOKIE_OPTIONS,
      maxAge: VIEW_AS_MAX_AGE_SEC,
    });

    /*
     * ★ NOT AUDITED, ON PURPOSE ★
     *
     * A preview cannot change anything: every write is refused while it is active, and the mask is
     * an intersection so it grants nothing. An audit row per page view would fill the log an
     * officer uses to find real changes with an officer looking at pages.
     */
    return { viewingAs: role.id, roleName: role.name };
  }

  /**
   * Stop previewing.
   *
   * ★ NO PERMISSION, NO TWO-FACTOR GATE, AND EXEMPT FROM THE WRITE BLOCK ★
   *
   * This is the trap the whole feature turns on, so it is worth stating plainly.
   *
   * Preview as Cadet and you no longer hold ROLE_MANAGE — the preview took it. If leaving required
   * ROLE_MANAGE, the button to escape would refuse you. If the global write block applied, this
   * DELETE would be refused too. Either way an officer would be locked out of the admin console for
   * an hour for pressing a preview button, with the exit visible and inert.
   *
   * So: signed in is the only requirement, and `VIEW_AS_EXEMPT_PATHS` keeps the guard off it.
   */
  @Delete()
  end(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): { viewingAs: null } {
    if (caller === undefined) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to continue.');
    csrf(req);

    jar(reply).clearCookie(VIEW_AS_COOKIE, COOKIE_OPTIONS);
    return { viewingAs: null };
  }
}

/** Same shape as the admin controller's: the method decides, the cookie and header must agree. */
function csrf(req: FastifyRequest): void {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);
}
