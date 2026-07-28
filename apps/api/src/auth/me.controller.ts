import { Controller, Get, Patch, Body, Req, Inject, Optional } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { PrismaClient } from '@grims/db';
import { NO_PERMISSIONS, requiresTwoFactor } from '@grims/shared';
import { Public } from './auth.guard.js';
import { navFor, hasAdminArea, type NavItem } from './nav.js';
import { PermissionService } from '../authz/permission.service.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import { isValidTimezone, knownTimezones, DEFAULT_TIMEZONE } from '../common/timezone.js';
import { AppError, ErrorCode } from '@grims/shared';

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
    /**
     * IANA zone. Every time on the site outside the audit log renders in this,
     * on the SERVER, so there is nothing to correct after the page loads.
     */
    timezone: string;
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
      select: { handle: true, displayName: true, avatarStoredHash: true, timezone: true },
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

    const mustSecure = requiresTwoFactor(mask) && !(await this.#enrolled(userId));

    return {
      user: {
        userId,
        handle: user.handle,
        displayName: user.displayName,
        // Our own route. The hash decides whether there is anything to serve;
        // the URL does not carry it, so a changed picture is not a changed URL.
        avatarUrl: user.avatarStoredHash === null ? null : `/v1/media/avatars/${userId}`,
        rank: await this.#rankOf(userId),
        timezone: user.timezone,
      },
      /*
       * ★ AN UNSECURED PRIVILEGED ACCOUNT GETS NO LINKS AT ALL ★
       *
       * Emptied HERE rather than hidden in the browser, and that distinction is
       * the point: the navbar, the sidebar and the account dropdown all render
       * from this one list, so there is no second place for a link to survive
       * and no future component that can forget.
       *
       * They keep the public site, the onboarding page, and sign out. Nothing
       * else — because every one of those destinations would refuse them
       * anyway, and offering doors that are locked teaches people the interface
       * lies.
       */
      nav: mustSecure ? [] : navFor(mask),
      // Still reported truthfully. The UI needs to know they ARE an admin to
      // explain why they are being asked; it just must not link them anywhere.
      isAdmin: hasAdminArea(mask),
      mustSecureAccount: mustSecure,
    };
  }

  /**
   * Changes the member's timezone.
   *
   * Its own route rather than part of a general profile update: it is the only
   * field here a member can set, and a broad PATCH would need a per-field
   * allowlist to stop it becoming a way to write `handle` or `status`.
   */
  @Patch('me/timezone')
  async setTimezone(
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ timezone: string }> {
    const userId = req.user?.userId;
    if (userId === undefined) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');

    const cookies =
      (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
    verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);

    const timezone = (body as Record<string, unknown> | null)?.['timezone'];
    if (!isValidTimezone(timezone)) {
      /*
       * Rejected rather than quietly falling back to UTC. Storing something
       * other than what was asked for, and saying nothing, means every time on
       * the site is silently wrong for that member and nothing explains why.
       */
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'That is not a timezone we recognise. Pick one from the list.',
      );
    }

    await this.db.user.update({ where: { id: userId }, data: { timezone } });
    return { timezone };
  }

  /** The zones the picker offers. Read from the runtime, never a hand-kept list. */
  @Get('me/timezones')
  timezones(): { timezones: string[]; fallback: string } {
    return { timezones: knownTimezones(), fallback: DEFAULT_TIMEZONE };
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
