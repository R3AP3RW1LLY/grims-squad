import { Controller, Get, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission, hasPermission } from '@grims/shared';
import { PermissionService } from '../authz/permission.service.js';
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
}
