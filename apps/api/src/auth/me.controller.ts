import { Controller, Get, Post, Patch, Body, Req, Inject, Optional } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { PrismaClient } from '@grims/db';
import { NO_PERMISSIONS, requiresTwoFactor } from '@grims/shared';
import { Public } from './auth.guard.js';
import { navFor, hasAdminArea, type NavItem } from './nav.js';
import {
  nextOnboardingStep,
  shouldPromptForVerification,
  ONBOARDING_PATHS,
  type OnboardingStep,
} from './onboarding-gate.js';
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
  /**
   * What they still owe, decided in ONE place (onboarding-gate.ts).
   *
   * The web layout redirects on `step`; it does not re-derive the rule. Two
   * copies of an ordering this fiddly drift, and the symptom is a member
   * bounced between two pages that each think the other should have run.
   */
  onboarding: {
    step: OnboardingStep;
    path: string | null;
    /** Nag without blocking — true only for the admins the wall lets past. */
    promptForVerification: boolean;
    verified: boolean;
  };
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
      return {
        user: null,
        nav: [],
        isAdmin: false,
        mustSecureAccount: false,
        onboarding: { step: null, path: null, promptForVerification: false, verified: false },
      };
    }

    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        handle: true,
        displayName: true,
        avatarStoredHash: true,
        timezone: true,
        commanderOnboardedAt: true,
      },
    });
    if (user === null) {
      /*
       * A valid session for a user row that no longer exists. Rare, and it
       * happens after a deletion or a wipe — answered as signed-OUT rather than
       * as an error, so the chrome offers a sign-in button instead of a broken
       * page the member cannot get out of.
       */
      return {
        user: null,
        nav: [],
        isAdmin: false,
        mustSecureAccount: false,
        onboarding: { step: null, path: null, promptForVerification: false, verified: false },
      };
    }

    const mask =
      this.permissions === null ? NO_PERMISSIONS : await this.permissions.effectiveMask(userId);

    const privileged = requiresTwoFactor(mask);
    const enrolled = await this.#enrolled(userId);
    const mustSecure = privileged && !enrolled;

    const state = {
      privileged,
      twoFactorEnrolled: enrolled,
      commanderOnboarded: user.commanderOnboardedAt !== null,
      verified: await this.#verified(userId),
    };
    const step = nextOnboardingStep(state);

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
      onboarding: {
        step,
        path: step === null ? null : ONBOARDING_PATHS[step],
        promptForVerification: shouldPromptForVerification(state),
        verified: state.verified,
      },
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

  /**
   * Finishes the commander onboarding step.
   *
   * Sets the timezone AND stamps the completion together, because they are one
   * decision. Two calls would leave a member who closed the tab between them
   * with a timezone saved and the step still owed — asked again next sign-in,
   * with the answer already filled in and no explanation.
   */
  @Post('me/onboarding/commander')
  async completeCommanderOnboarding(
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ timezone: string; done: true }> {
    const userId = req.user?.userId;
    if (userId === undefined) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');

    const cookies =
      (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
    verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);

    const timezone = (body as Record<string, unknown> | null)?.['timezone'];
    if (!isValidTimezone(timezone)) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'That is not a timezone we recognise. Pick one from the list.',
      );
    }

    await this.db.user.update({
      where: { id: userId },
      data: { timezone, commanderOnboardedAt: new Date() },
    });
    return { timezone, done: true };
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

  /**
   * Has anybody confirmed which commander this is?
   *
   * `isVerified` AND not revoked. A pending claim is not a verification — the
   * whole point of the queue is that declaring a name proves nothing (INV-005).
   */
  async #verified(userId: string): Promise<boolean> {
    const count = await this.db.cmdrVerification.count({
      where: { userId, isVerified: true, revokedAt: null },
    });
    return count > 0;
  }

  async #enrolled(userId: string): Promise<boolean> {
    const count = await this.db.twoFactorCredential.count({ where: { userId } });
    return count > 0;
  }
}
