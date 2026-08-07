import { Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission, hasPermission } from '@grims/shared';
import { PermissionService } from '../authz/permission.service.js';
import { Public } from '../auth/auth.guard.js';
import { PAIRING_SERVICE } from '../telemetry/telemetry.tokens.js';
import type { PairingService } from '../telemetry/pairing.service.js';
import { RecruitService } from './recruit.service.js';

/**
 * The member's own recruiting: their link, and who came through it.
 *
 * ★ THE GATE IS NOT HERE ★
 *
 * Only RECRUIT_VIEW is checked at the door. The three-part rule — permission, Inara verification,
 * Cadet — lives in the service and is re-read at the moment of minting, because all three can
 * change between a page load and a click, and a member whose recruiting was switched off must not
 * get a link from a button their browser still had on screen.
 */
@Controller('v1/recruit')
export class RecruitController {
  constructor(
    @Inject(RecruitService) private readonly recruit: RecruitService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {}

  async #caller(req: FastifyRequest): Promise<{ userId: string; mask: bigint }> {
    const userId = (req as FastifyRequest & { user?: { id?: string } }).user?.id;
    if (typeof userId !== 'string') {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to see your recruiting.');
    }

    const mask = await this.permissions.effectiveMask(userId);
    if (!hasPermission(mask, Permission.RECRUIT_VIEW)) {
      // Cloaked like every other gated read (INV-002): a member without the bit is told the page
      // is not there rather than that it exists and is closed to them.
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Not found.');
    }

    return { userId, mask };
  }

  @Get()
  async status(@Req() req: FastifyRequest) {
    const { userId, mask } = await this.#caller(req);
    return { ...(await this.recruit.status(userId, mask)), ladder: this.recruit.ladder() };
  }

  @Post('link')
  async mint(@Req() req: FastifyRequest) {
    const { userId, mask } = await this.#caller(req);
    return this.recruit.mint(userId, mask);
  }

  /**
   * The officer's view and its three actions.
   *
   * Gated on RECRUIT_MANAGE, which is privileged: assigning and voiding rewrite who appears on a
   * public board, so they demand a second factor the same way setting BGS orders does.
   */
  async #officer(req: FastifyRequest): Promise<string> {
    const userId = (req as FastifyRequest & { user?: { id?: string } }).user?.id;
    if (typeof userId !== 'string') {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in.');
    }

    const mask = await this.permissions.effectiveMask(userId);
    if (!hasPermission(mask, Permission.RECRUIT_MANAGE)) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Not found.');
    }
    return userId;
  }

  @Get('manage')
  async manage(@Req() req: FastifyRequest) {
    await this.#officer(req);
    return this.recruit.manage();
  }

  @Post('manage/assign')
  async assign(@Req() req: FastifyRequest, @Body() body: { discordId?: unknown; recruiterId?: unknown }) {
    await this.#officer(req);

    const discordId = typeof body.discordId === 'string' ? body.discordId : '';
    const recruiterId = typeof body.recruiterId === 'string' ? body.recruiterId : '';
    if (discordId === '' || recruiterId === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Say which join and which member.');
    }

    await this.recruit.assign(discordId, recruiterId);
    return { ok: true };
  }

  @Post('manage/void')
  async void(@Req() req: FastifyRequest, @Body() body: { discordId?: unknown; reason?: unknown }) {
    const officerId = await this.#officer(req);

    const discordId = typeof body.discordId === 'string' ? body.discordId : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    /*
     * A reason is REQUIRED, not defaulted. An unexplained void is the thing that gets argued about
     * in Discord six weeks later, when nobody remembers why somebody's recruit stopped counting.
     */
    if (discordId === '' || reason === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Voiding a claim needs a reason.');
    }

    await this.recruit.void(discordId, officerId, reason);
    return { ok: true };
  }

  @Post('manage/revoke')
  async revoke(@Req() req: FastifyRequest, @Body() body: { code?: unknown; reason?: unknown }) {
    const officerId = await this.#officer(req);

    const code = typeof body.code === 'string' ? body.code : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (code === '' || reason === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Revoking a link needs a reason.');
    }

    await this.recruit.revoke(code, officerId, reason);
    return { ok: true };
  }
}

/**
 * The same recruiting, for a paired companion.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "one last feature i want to add is a unique discord invite link for all members that are inara
 * veriefied in our platform ... build me a cool recruit tracking system"
 *
 * ★ THE APP IS WHERE THE LINK IS ACTUALLY WANTED ★
 *
 * A member decides to invite somebody while they are playing — mid-conversation in a Discord voice
 * channel, with the game running. Making them alt-tab to a website to fetch their own link is the
 * friction that stops the whole feature being used.
 *
 * ★ THE GATE IS STILL NOT HERE ★
 *
 * Being paired opens the door; the three-part rule — permission, Inara verification, Cadet — is
 * re-read inside `mint` at the moment of the click, because all three can change while a page sits
 * on screen. That is the same reasoning as the session controller above, and it is why this can
 * safely be a thinner door rather than a second copy of the rule.
 */
@Controller('v1/companion/recruit')
export class RecruitDeviceController {
  constructor(
    @Inject(RecruitService) private readonly recruit: RecruitService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(PAIRING_SERVICE) private readonly pairing: PairingService,
  ) {}

  async #caller(req: FastifyRequest): Promise<{ userId: string; mask: bigint }> {
    const header = req.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    const device = token === '' ? null : await this.pairing.authenticate(token, new Date());
    if (device === null) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'This device is not paired.');
    }

    return { userId: device.userId, mask: await this.permissions.effectiveMask(device.userId) };
  }

  @Public()
  @Get()
  async status(@Req() req: FastifyRequest) {
    const { userId, mask } = await this.#caller(req);
    return { ...(await this.recruit.status(userId, mask)), ladder: this.recruit.ladder() };
  }

  @Public()
  @Post('link')
  async mint(@Req() req: FastifyRequest) {
    const { userId, mask } = await this.#caller(req);
    return this.recruit.mint(userId, mask);
  }
}
