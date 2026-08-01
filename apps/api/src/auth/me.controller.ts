import { Controller, Get, Post, Patch, Body, Req, Inject, Optional } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { PrismaClient } from '@grims/db';
import { resolveMemberRank, LEADERSHIP_CEILING } from '@grims/shared';
import { NO_PERMISSIONS, requiresTwoFactor } from '@grims/shared';
import { Public } from './auth.guard.js';
import { navFor, hasAdminArea, type NavItem } from './nav.js';
import {
  nextOnboardingStep,
  shouldPromptForVerification,
  ONBOARDING_PATHS,
  type OnboardingStep,
} from './onboarding-gate.js';
import { createHash } from 'node:crypto';
import { PermissionService } from '../authz/permission.service.js';
import { ViewAsService } from '../authz/view-as.service.js';
import { STEP_UP_TTL_MS } from './admin-gate.guard.js';
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
   * The role being previewed, or null.
   *
   * ★ SQUADRON OWNER, 2026-08-01 ★
   *
   * "a way for the webmaster and officers to visually spoof a rank and physically see what they see
   * in the web app".
   *
   * Reported so the chrome can say so on every page. A preview with nothing on screen announcing it
   * is indistinguishable from having lost permissions — which is exactly the panic the feature
   * would otherwise cause, in the person who pressed the button.
   */
  viewingAs: { id: string; name: string } | null;
  /**
   * What they still owe, decided in ONE place (onboarding-gate.ts).
   *
   * The web layout redirects on `step`; it does not re-derive the rule. Two
   * copies of an ordering this fiddly drift, and the symptom is a member
   * bounced between two pages that each think the other should have run.
   */
  /**
   * When this SIGN-IN ends, and when the step-up does.
   *
   * Both are absolute instants rather than durations, so the browser can count
   * down without our clock and its clock having to agree on how long is left —
   * only on what time it is, which they already do.
   */
  session: {
    expiresAt: string | null;
    /** Null when they hold no step-up, or do not need one. */
    twoFactorExpiresAt: string | null;
  };
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
    /*
     * ★ THE RANK PREVIEW HAS TO REACH THE NAV ★
     *
     * Squadron owner, 2026-08-01: officers need to see the site as another rank sees it. If this
     * endpoint kept answering with the viewer's REAL mask, the sidebar would still show the admin
     * section while every page inside it refused — which looks like the permissions are broken
     * rather than like a preview.
     *
     * Optional, like the permission service beside it, so a unit test of this controller does not
     * need the whole authz module.
     */
    @Optional()
    @Inject(ViewAsService)
    private readonly viewAs: ViewAsService | null = null,
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
        // Signed out: no preview can be running, and saying null is more honest than omitting it.
        viewingAs: null,
        session: { expiresAt: null, twoFactorExpiresAt: null },
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
        companionPromptedAt: true,
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
        // Signed out: no preview can be running, and saying null is more honest than omitting it.
        viewingAs: null,
        session: { expiresAt: null, twoFactorExpiresAt: null },
        onboarding: { step: null, path: null, promptForVerification: false, verified: false },
      };
    }

    /*
     * `viewAs.maskFor` when it is available, which is `effectiveMask` unless a preview is running.
     * One source of truth for "what may this request do", shared with the permission guard.
     */
    const mask =
      this.viewAs !== null
        ? await this.viewAs.maskFor(userId, req)
        : this.permissions === null
          ? NO_PERMISSIONS
          : await this.permissions.effectiveMask(userId);

    const viewingAs = this.viewAs === null ? null : await this.viewAs.previewedRole(req);

    const privileged = requiresTwoFactor(mask);
    const enrolled = await this.#enrolled(userId);
    const mustSecure = privileged && !enrolled;

    const state = {
      privileged,
      twoFactorEnrolled: enrolled,
      commanderOnboarded: user.commanderOnboardedAt !== null,
      companionPrompted: user.companionPromptedAt !== null,
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
      /*
       * ★ REPORTED SO THE BANNER CAN EXIST ★
       *
       * A preview with nothing on screen saying so is indistinguishable from having lost
       * permissions — which is precisely the panic this feature would otherwise cause. Every page
       * already reads this endpoint for its chrome, so the banner comes free.
       */
      viewingAs,
      session: {
        expiresAt: (await this.#sessionEndsAt(req))?.toISOString() ?? null,
        twoFactorExpiresAt:
          req.twoFactorAt === undefined
            ? null
            : new Date(req.twoFactorAt.getTime() + STEP_UP_TTL_MS).toISOString(),
      },
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
  /**
   * Which Discord DMs this member has asked for (P2.10).
   *
   * ★ THREE SWITCHES, NOT ONE ★
   *
   * The reasons have very different volumes: being answered directly is rare and almost always
   * wanted, while a busy watched thread can produce twenty messages in an evening. A single switch
   * forces a choice between missing a reply and being flooded, and the choice people actually make
   * is to turn everything off.
   */
  @Get('me/notifications')
  async notificationPrefs(@Req() req: FastifyRequest): Promise<{
    notifyDmDirectReply: boolean;
    notifyDmMention: boolean;
    notifyDmWatched: boolean;
    discordLinked: boolean;
  }> {
    const userId = req.user?.userId;
    if (userId === undefined) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');

    const me = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        notifyDmDirectReply: true,
        notifyDmMention: true,
        notifyDmWatched: true,
        discordIdentity: { select: { discordId: true } },
      },
    });
    if (me === null) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');

    return {
      notifyDmDirectReply: me.notifyDmDirectReply,
      notifyDmMention: me.notifyDmMention,
      notifyDmWatched: me.notifyDmWatched,
      /*
       * Reported so the settings page can say "link Discord first" rather than offering switches
       * that would silently do nothing. A toggle that saves and then never delivers is worse than
       * one that explains why it is unavailable.
       */
      discordLinked: me.discordIdentity !== null,
    };
  }

  /** Changes them. Each is set independently; omitted keys are left alone. */
  @Patch('me/notifications')
  async setNotificationPrefs(
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ notifyDmDirectReply: boolean; notifyDmMention: boolean; notifyDmWatched: boolean }> {
    const userId = req.user?.userId;
    if (userId === undefined) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');

    const cookies =
      (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
    verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);

    const raw = body as Record<string, unknown> | null;
    /*
     * Only booleans are accepted, and only for keys actually present. A PATCH that treated a
     * missing key as `false` would turn off preferences the caller never mentioned — which is how
     * a settings page with one toggle silently clears the other two.
     */
    const data: Record<string, boolean> = {};
    for (const key of ['notifyDmDirectReply', 'notifyDmMention', 'notifyDmWatched'] as const) {
      const value = raw?.[key];
      if (typeof value === 'boolean') data[key] = value;
    }

    if (Object.keys(data).length === 0) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Nothing to change.');
    }

    const updated = await this.db.user.update({
      where: { id: userId },
      data,
      select: {
        notifyDmDirectReply: true,
        notifyDmMention: true,
        notifyDmWatched: true,
      },
    });

    return updated;
  }

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

  /**
   * Marks the companion step as seen.
   *
   * ★ SEEN, NOT INSTALLED — squadron owner, 2026-08-01: "onboarding download step" ★
   *
   * Called when the member moves on from the page, whether or not they connected anything. Gating
   * this on a paired device would wall out anybody whose machine cannot run the app, and the
   * squadron would rather have them in the forum than nowhere.
   *
   * Idempotent: the timestamp is only written the first time, so passing through again does not
   * make an old member look newly onboarded in the audit trail.
   */
  @Post('me/onboarding/companion')
  async companionSeen(@Req() req: FastifyRequest): Promise<{ done: true }> {
    const userId = req.user?.userId;
    if (userId === undefined) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');

    const cookies =
      (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
    verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);

    await this.db.user.updateMany({
      where: { id: userId, companionPromptedAt: null },
      data: { companionPromptedAt: new Date() },
    });
    return { done: true };
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
    /*
     * ★ READ FROM THE ROLES THEY WEAR, NOT FROM GRANTS ★
     *
     * This used to read `UserRole` and return the highest hierarchical grant.
     * Against real data that is null for almost everybody: grants only appear
     * after reconciliation, for an account that exists, and most of the
     * squadron has neither. A plain Cadet's dashboard said "Unranked".
     *
     * The third place this same mistake was made — after officer status and the
     * admin table — which is why the resolution now lives in ONE shared
     * function rather than being written out again here.
     */
    const identity = await this.db.discordIdentity.findUnique({
      where: { userId },
      select: { discordId: true },
    });
    if (identity === null) return null;

    const [member, roles, mappings] = await Promise.all([
      this.db.discordGuildMember.findUnique({
        where: { discordId: identity.discordId },
        select: { roles: true },
      }),
      // Names and categories, for the membership fallback.
      this.db.discordRole.findMany({ select: { discordRoleId: true, name: true, category: true } }),
      this.db.roleMapping.findMany({
        where: { role: { isHierarchical: true } },
        select: { discordRoleId: true, role: { select: { rankOrder: true, name: true } } },
      }),
    ]);

    if (member === null) return null;

    const byId = new Map(roles.map((r) => [r.discordRoleId, r]));
    const rankById = new Map(mappings.map((m) => [m.discordRoleId, m.role]));

    const held = member.roles.flatMap((id) => {
      const role = byId.get(id);
      if (role === undefined) return [];
      const mapped = rankById.get(id);
      return [
        {
          // The MAPPED role's name where there is one — "Cadet" rather than
          // whatever the Discord role happens to be called.
          name: mapped?.name ?? role.name,
          rankOrder: mapped?.rankOrder ?? null,
          category: role.category,
        },
      ];
    });

    return resolveMemberRank(held, LEADERSHIP_CEILING);
  }

  /**
   * When the current sign-in runs out.
   *
   * Read from the FAMILY, which carries the absolute deadline — not from the
   * refresh token, whose expiry moves on every rotation and would count down to
   * fifteen minutes over and over.
   */
  async #sessionEndsAt(req: FastifyRequest): Promise<Date | null> {
    const raw = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
    const refresh = raw['__Host-gs_rt'] ?? raw['gs_rt'];
    if (typeof refresh !== 'string' || refresh === '') return null;

    const row = await this.db.refreshToken.findUnique({
      where: { tokenHash: createHash('sha256').update(refresh).digest('hex') },
      select: { family: { select: { expiresAt: true, revokedAt: true } } },
    });

    if (row === null || row.family.revokedAt !== null) return null;
    return row.family.expiresAt;
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
