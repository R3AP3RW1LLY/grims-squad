import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  Inject,
  Optional,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission } from '@grims/shared';
import { User, type CurrentUser } from '../auth/current-user.js';
import { RequiresPermission, CloakAsNotFound } from '../authz/requires-permission.guard.js';
import { AdminGateGuard, RequiresTwoFactor } from '../auth/admin-gate.guard.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import { CMDR_SERVICE, NONCE_SERVICE, INARA_LINK } from './cmdr.tokens.js';
import { LIVE_SERVICE } from '../live/live.tokens.js';
import type { CmdrService, ClaimRecord, QueueEntry } from './cmdr.service.js';
import type { NonceService } from '@grims/shared';
import type { LiveService } from '../live/live.service.js';
import type { InaraLinkService, LinkStatus } from './inara-link.service.js';

function readString(body: unknown, key: string): string {
  const v = (body as Record<string, unknown> | null)?.[key];
  if (typeof v !== 'string') {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `${key} is required.`);
  }
  return v;
}

/*
 * ★ RED-TEAM FINDING, 2026-07-27 ★
 *
 * The officer routes below approve who a member CLAIMS TO BE — a privileged
 * action that affects other people — and they were guarded by MEMBER_MANAGE
 * alone. The admin console requires a confirmed second factor for exactly this
 * class of action; these did not, so a stolen session cookie could approve
 * verifications while /app refused the same officer.
 *
 * AdminGateGuard is registered here and applied per-route, because the MEMBER
 * routes on this same controller (linking your own Inara key, declaring your
 * own commander) must stay reachable with one factor. Putting the guard at
 * class level would lock ordinary members out of their own account.
 */
@UseGuards(AdminGateGuard)
@Controller('v1')
export class CmdrController {
  constructor(
    @Inject(CMDR_SERVICE) private readonly cmdr: CmdrService,
    @Inject(NONCE_SERVICE) private readonly nonce: NonceService,
    @Inject(INARA_LINK) private readonly inara: InaraLinkService,
    /*
     * ★ @Optional, AND THAT IS A DELIBERATE RISK ACCEPTED HERE ★
     *
     * `LiveModule` is @Global, so in the running application this is always
     * present. Optional because the controller's own tests construct it
     * directly with three collaborators, and a required fourth would make every
     * one of them a wiring test for a notification.
     *
     * The failure mode is bounded and honest: with no live service, pages stop
     * updating by themselves and still show the truth on the next navigation.
     * Nothing is written, granted or lost.
     */
    @Optional() @Inject(LIVE_SERVICE) private readonly live?: LiveService,
  ) {}

  /**
   * Tells this member's other tabs that their verification moved.
   *
   * ★ FIRE AND FORGET, ON PURPOSE ★
   *
   * Publishing is an in-memory loop over sockets, but a browser that vanished
   * mid-write must never turn a successful verification into a 500 — the member
   * really is verified by the time this runs, and the write is already
   * committed. `LiveService.publish` swallows dead sockets for the same reason;
   * this is the belt to that pair of braces.
   *
   * Scoped to the ONE member. A verification is not squadron news, and
   * broadcasting it would tell a hundred browsers that a particular person just
   * proved their commander name.
   */
  private publishVerification(userId: string): void {
    try {
      // Their own tabs: the settings page, which shows the full state.
      this.live?.publish({ type: 'verification', userId });

      /*
       * ★ AND EVERYBODY ELSE'S ROSTER ★
       *
       * A verification is not only news to the person it happened to. The
       * roster shows an "Inara verified" badge for every member, the admin
       * console has a CMDR verified column, and a member profile shows the
       * commander name — none of which is that member's own tab.
       *
       * The member-scoped event above reaches only them, so without this the
       * squadron owner would verify somebody and watch the roster go on showing
       * them unverified until it was reloaded by hand. Squadron owner,
       * 2026-07-29: verifications must show instantly ACROSS the app.
       *
       * `roster` rather than a squadron-wide `verification`, and that
       * distinction is deliberate: this event carries NO userId, so it says
       * "the roster changed" and not "this particular person just proved their
       * commander name". Every page re-reads through the normal endpoints with
       * the normal permission checks, so nothing is disclosed that the viewer
       * could not already have fetched.
       */
      this.live?.publish({ type: 'roster', userId: null });
    } catch {
      /* Never fails the request that caused it. */
    }
  }

  // --------------------------------------------------------- Inara API key
  /**
   * Links the member's own Inara API key (trust tier 2).
   *
   * There is NO commander-name field. The name comes back from Inara, which is
   * what makes this verification rather than self-declaration — see
   * InaraLinkService. Adding one here would defeat the whole design.
   *
   * `source` distinguishes the website from the companion app, because a key
   * added in the app shows up here with no action from the member.
   */
  @Post('me/inara')
  async linkInara(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<LinkStatus & { verified: boolean }> {
    const userId = requireUser(caller);
    csrf(req);
    const b = body as Record<string, unknown> | null;
    const source = b?.['source'] === 'app' ? 'app' : 'web';
    const r = await this.inara.link(userId, readString(b, 'apiKey'), source);

    /*
     * ★ THE WHOLE STATUS, NOT JUST THE NAME ★
     *
     * This returned `{ cmdrName, verified }`. The website's status panel needs
     * `squadronStatus` to decide between "Not verified", "Partially verified"
     * and "Verified" — so after a member pasted their key, the panel had
     * nothing to move to and went on announcing "Not verified" over a commander
     * name it had just been given. The only way out was a manual reload.
     *
     * A SUPERSET of the old shape: `verified` is still here, because the
     * companion app reads it and an app in the wild is not redeployed by
     * merging this. Nothing is removed, so no existing caller notices.
     *
     * Deliberately NOT spreading the link result: no key, ever, in any
     * response. `status()` reads from storage and cannot return one.
     */
    const status = await this.inara.status(userId);
    this.publishVerification(userId);
    return { ...status, verified: r.verified };
  }

  /**
   * "I have applied to join the squadron on Inara."
   *
   * ★ A CLAIM, WHICH IS NOT PROOF ★
   *
   * Ticking this grants nothing. It records that the member says they applied,
   * and re-asks Inara immediately — Inara is what confirms membership, and this
   * only decides whether it is worth spending a request from a budget of two a
   * minute asking about them at all.
   *
   * The immediate re-check matters because the common case is somebody who
   * joined a moment before ticking the box, and telling them to come back in
   * twenty minutes for something we can answer now would be needless.
   */
  @Post('me/inara/squadron-claim')
  async claimSquadron(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
  ): Promise<LinkStatus> {
    const userId = requireUser(caller);
    csrf(req);
    await this.inara.claimSquadron(userId);
    this.publishVerification(userId);
    // The STATUS, not the raw result: one shape for the page to render, whether
    // the check confirmed them, found a different squadron, or could not run.
    return this.inara.status(userId);
  }

  /** Whether a key is on file, and the verified name. Never the key itself. */
  @Get('me/inara')
  async inaraStatus(@User() caller: CurrentUser | undefined): Promise<LinkStatus> {
    return this.inara.status(requireUser(caller));
  }

  /** Re-checks the stored key against Inara, and reconciles the nickname. */
  @Post('me/inara/refresh')
  async refreshInara(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
  ): Promise<LinkStatus & { verified: boolean; error: string | null }> {
    const userId = requireUser(caller);
    csrf(req);
    const r = await this.inara.refresh(userId);
    // Same reasoning as `linkInara`: a re-check can move somebody from partial
    // to verified, and the panel needs the fields that say so. Superset again,
    // so the companion app's `verified` and `error` still arrive.
    const status = await this.inara.status(userId);
    this.publishVerification(userId);
    return { ...status, verified: r.verified, error: r.error };
  }

  /**
   * Removes the stored key.
   *
   * Does NOT un-verify the commander name — the member proved it, and removing
   * the credential is a privacy choice rather than a retraction.
   */
  @Delete('me/inara')
  async unlinkInara(
    @User() caller: CurrentUser | undefined,
    @Req() req: FastifyRequest,
  ): Promise<{ unlinked: true }> {
    const userId = requireUser(caller);
    csrf(req);
    await this.inara.unlink(userId);
    this.publishVerification(userId);
    return { unlinked: true };
  }

  /**
   * Starts Inara verification (trust tier 2).
   *
   * Returns a code the member pastes into their Inara profile. The WORKER then
   * polls Inara and completes it — this route never calls Inara itself, because
   * the global limiter allows two calls a minute and a member must never be
   * waiting on that queue inside an HTTP request (INV-031, INV-033).
   */
  @Post('me/cmdr/inara')
  async startInara(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ nonce: string; expiresAt: string; instructions: string }> {
    const userId = requireUser(caller);
    csrf(req);

    const claim = await this.nonce.issue(userId, readString(body, 'cmdrName'));
    return {
      nonce: claim.claimNonce,
      expiresAt: claim.nonceExpiresAt.toISOString(),
      instructions:
        'Add this code anywhere in your Inara profile bio, then leave it there. We check every few minutes and it can take up to an hour. You can remove it once you are verified.',
    };
  }

  /** Where the member's own verification stands. */
  @Get('me/cmdr')
  async myClaim(
    @User() caller: CurrentUser | undefined,
  ): Promise<{ pending: { cmdrName: string; nonce: string; expiresAt: string } | null }> {
    const userId = requireUser(caller);
    const claim = await this.nonce.pendingFor(userId);
    return {
      pending:
        claim === null
          ? null
          : {
              cmdrName: claim.cmdrName,
              nonce: claim.claimNonce,
              expiresAt: claim.nonceExpiresAt.toISOString(),
            },
    };
  }

  /** The member declares their own commander name. Creates a pending claim. */
  @Post('me/cmdr')
  async declare(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<ClaimRecord> {
    const userId = requireUser(caller);
    csrf(req);
    // The user id comes from the SESSION. A member can only ever declare for
    // themselves, so there is no id in the body to tamper with.
    return this.cmdr.declare(userId, readString(body, 'cmdrName'));
  }

  /**
   * The officer queue.
   *
   * MEMBER_MANAGE, not a bespoke permission: approving who a member claims to
   * be is member management, and inventing a permission for every action makes
   * the mask harder to reason about without making it more precise.
   */
  @RequiresPermission(Permission.MEMBER_MANAGE)
  @RequiresTwoFactor()
  @CloakAsNotFound()
  @Get('admin/cmdr-claims')
  async queue(): Promise<{ claims: QueueEntry[] }> {
    return { claims: await this.cmdr.pendingQueue() };
  }

  @RequiresPermission(Permission.MEMBER_MANAGE)
  @RequiresTwoFactor()
  @CloakAsNotFound()
  @Post('admin/cmdr-claims/:id/approve')
  async approve(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<{ approved: true }> {
    const officerId = requireUser(caller);
    csrf(req);
    // The service refuses self-approval. Enforced there rather than here so it
    // holds for any future caller — a bot command, an admin script — and not
    // only for this route.
    const approved = await this.cmdr.approve(id, officerId);
    /*
     * ★ THE MEMBER, NOT THE OFFICER ★
     *
     * An officer approving from the console changes somebody ELSE'S page. The
     * event names the member whose verification moved, or the one person who
     * has been waiting for it is the only one who does not hear.
     */
    this.publishVerification(approved.userId);
    return { approved: true };
  }

  @RequiresPermission(Permission.MEMBER_MANAGE)
  @RequiresTwoFactor()
  @CloakAsNotFound()
  @Post('admin/cmdr-claims/:id/reject')
  async reject(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ rejected: true }> {
    const officerId = requireUser(caller);
    csrf(req);
    const rejected = await this.cmdr.reject(id, officerId, readString(body, 'reason'));
    // Same as approval: it is the member's page that changed, not the officer's.
    this.publishVerification(rejected.userId);
    return { rejected: true };
  }
}

function csrf(req: FastifyRequest): void {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);
}

function requireUser(caller: CurrentUser | undefined): string {
  if (caller === undefined) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
  }
  return caller.userId;
}
