import { Body, Controller, Delete, Get, Inject, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission, hasPermission } from '@grims/shared';
import { PermissionService } from '../authz/permission.service.js';
import { BgsService } from './bgs.service.js';

/**
 * The BGS watchlist and its orders.
 *
 * Reading is BGS_VIEW — members need to know tonight's instructions, and an order nobody can read
 * is not an order. Writing is BGS_SET_ORDERS, which is privileged: it steers where the whole
 * squadron spends an evening.
 */
@Controller('v1/bgs')
export class BgsController {
  constructor(
    @Inject(BgsService) private readonly bgs: BgsService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {}

  async #caller(req: FastifyRequest, need: bigint): Promise<string> {
    const userId = (req as FastifyRequest & { user?: { id?: string } }).user?.id;
    if (typeof userId !== 'string') {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in.');
    }

    const mask = await this.permissions.effectiveMask(userId);
    // Cloaked, like every other gated read (INV-002): absent rather than forbidden.
    if (!hasPermission(mask, need)) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Not found.');
    }
    return userId;
  }

  @Get('watchlist')
  async watchlist(@Req() req: FastifyRequest) {
    await this.#caller(req, Permission.BGS_VIEW);
    return { factions: await this.bgs.watchlist() };
  }

  @Post('watchlist')
  async watch(@Req() req: FastifyRequest, @Body() body: { name?: unknown; isOurs?: unknown }) {
    await this.#caller(req, Permission.BGS_SET_ORDERS);
    await this.bgs.watch(typeof body.name === 'string' ? body.name : '', body.isOurs === true);
    return { ok: true };
  }

  @Delete('watchlist/:id')
  async unwatch(@Req() req: FastifyRequest, @Param('id') id: string) {
    await this.#caller(req, Permission.BGS_SET_ORDERS);
    await this.bgs.unwatch(id);
    return { ok: true };
  }

  @Post('orders')
  async order(
    @Req() req: FastifyRequest,
    @Body()
    body: {
      factionId?: unknown;
      stance?: unknown;
      systemName?: unknown;
      priority?: unknown;
      guidance?: unknown;
    },
  ) {
    const userId = await this.#caller(req, Permission.BGS_SET_ORDERS);

    if (typeof body.factionId !== 'string' || typeof body.stance !== 'string') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Say which faction and what to do about it.');
    }

    await this.bgs.order({
      factionId: body.factionId,
      stance: body.stance,
      systemName: typeof body.systemName === 'string' ? body.systemName : null,
      priority: typeof body.priority === 'number' ? body.priority : 3,
      guidance: typeof body.guidance === 'string' ? body.guidance : null,
      setById: userId,
    });
    return { ok: true };
  }

  @Delete('orders/:id')
  async countermand(@Req() req: FastifyRequest, @Param('id') id: string) {
    await this.#caller(req, Permission.BGS_SET_ORDERS);
    await this.bgs.countermand(id);
    return { ok: true };
  }
}
