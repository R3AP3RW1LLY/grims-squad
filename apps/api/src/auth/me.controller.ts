import { Controller, Get, Req, Inject, Optional } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { PrismaClient } from '@grims/db';
import { NO_PERMISSIONS, requiresTwoFactor } from '@grims/shared';
import { Public } from './auth.guard.js';
import { navFor, hasAdminArea, type NavItem } from './nav.js';
import { PermissionService } from '../authz/permission.service.js';

/**
 * Everything the signed-in chrome needs, in ONE request.
 *
 * ★ WHY ONE CALL AND NOT FOUR ★
 *
 * The navbar wants a name, a picture, a menu and whether there is an admin area.
 * Four endpoints would mean four round trips on every page render — and worse,
 * four moments where the answers can disagree, so a member briefly sees an admin
 * link that the next response takes away.
 *
 * ★ RETURNS null RATHER THAN 401 ★
 *
 * The same layout renders for signed-out visitors. A 401 here would make every
 * public page log an auth failure, and would force the chrome to treat "not
 * signed in" — the normal state for most visitors — as an error condition.
 */
export interface MeResponse {
  user: {
    userId: string;
    handle: string;
    displayName: string;
    /** Our own URL, never Discord's. Null when they have no picture. */
    avatarUrl: string | null;
    rank: string | null;
  } | null;
  nav: NavItem[];
  isAdmin: boolean;
  /** Privileged AND unenrolled — the chrome uses this to keep admin links honest. */
  mustSecureAccount: boolean;
}

@Controller('v1')
export class MeController {
  constructor(
    // @Inject is REQUIRED, not decoration: esbuild emits no decorator metadata
    // (P1.2), so Nest has no way to infer the type from the parameter and
    // resolves it as undefined. The failure is a startup DI error, which is
    // exactly the sort of thing that gets noticed late.
    @Inject(PrismaClient) private readonly db: PrismaClient,
    @Optional()
    @Inject(PermissionService)
    private readonly permissions: PermissionService | null = null,
  ) {}

  @Public()
  @Get('me')
  async me(@Req() req: FastifyRequest): Promise<MeResponse> {
    const userId = req.user?.userId;
    if (userId === undefined) {
      return { user: null, nav: [], isAdmin: false, mustSecureAccount: false };
    }

    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { handle: true, displayName: true, avatarStoredHash: true },
    });
    if (user === null) {
      /*
       * A valid session for a user row that no longer exists. Rare, and it
       * happens after a deletion or a wipe — answered as signed-OUT rather than
       * as an error, so the chrome offers a sign-in button instead of a broken
       * page the member cannot get out of.
       */
      return { user: null, nav: [], isAdmin: false, mustSecureAccount: false };
    }

    const mask =
      this.permissions === null ? NO_PERMISSIONS : await this.permissions.effectiveMask(userId);

    return {
      user: {
        userId,
        handle: user.handle,
        displayName: user.displayName,
        // Our own route. The hash decides whether there is anything to serve;
        // the URL does not carry it, so a changed picture is not a changed URL.
        avatarUrl: user.avatarStoredHash === null ? null : `/v1/media/avatars/${userId}`,
        rank: await this.#rankOf(userId),
      },
      nav: navFor(mask),
      isAdmin: hasAdminArea(mask),
      mustSecureAccount: requiresTwoFactor(mask) && !(await this.#enrolled(userId)),
    };
  }

  /**
   * The member's rank, read from their GRANTS.
   *
   * INV-047: there is no denormalised rank column, because one would be a copy
   * of the truth that drifts the first time a grant changes without it.
   */
  async #rankOf(userId: string): Promise<string | null> {
    const grants = await this.db.userRole.findMany({
      where: { userId },
      select: { role: { select: { key: true, name: true, isHierarchical: true, rankOrder: true } } },
    });

    /*
     * Highest rankOrder wins. A member can hold several hierarchical roles
     * during a promotion, and showing the lower one would tell somebody they
     * had been demoted.
     */
    const ranks = grants
      .map((g) => g.role)
      .filter((r) => r.isHierarchical)
      .sort((a, b) => b.rankOrder - a.rankOrder);

    return ranks[0]?.name ?? ranks[0]?.key ?? null;
  }

  async #enrolled(userId: string): Promise<boolean> {
    const count = await this.db.twoFactorCredential.count({ where: { userId } });
    return count > 0;
  }
}
