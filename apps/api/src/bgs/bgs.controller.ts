import { Body, Controller, Delete, Get, Inject, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission, hasPermission } from '@grims/shared';
import { PermissionService } from '../authz/permission.service.js';
import { Public } from '../auth/auth.guard.js';
import { PAIRING_SERVICE } from '../telemetry/telemetry.tokens.js';
import type { PairingService } from '../telemetry/pairing.service.js';
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

/**
 * The same orders, for a paired companion.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "for the BGS system, create an overlay in the companion app with settings etc like the mining
 * overlay please!"
 *
 * ★ WHY THIS CANNOT REUSE THE ROUTE ABOVE ★
 *
 * The companion carries a device token, not a session cookie, so `req.user` is never set for it and
 * the permission check above would reject every call. The mining surface hit exactly this and
 * solved it the same way: a parallel controller whose bar is "this device is paired".
 *
 * ★ WHICH IS THE RIGHT BAR HERE TOO ★
 *
 * Standing orders are instructions to the whole squadron. An order only some members can read is
 * not an order — and the device belongs to a member who was let in and enrolled a companion, which
 * is a higher bar than BGS_VIEW represents anyway.
 */
@Controller('v1/companion/bgs')
export class BgsDeviceController {
  constructor(
    @Inject(BgsService) private readonly bgs: BgsService,
    @Inject(PAIRING_SERVICE) private readonly pairing: PairingService,
  ) {}

  async #paired(req: FastifyRequest): Promise<void> {
    const header = req.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    const device = token === '' ? null : await this.pairing.authenticate(token, new Date());
    if (device === null) {
      // The same opaque answer every device route gives: unknown, revoked and wrongly-scoped are
      // one reply, so a caller learns only that their token is not usable.
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'This device is not paired.');
    }
  }

  @Public()
  @Get('watchlist')
  async watchlist(@Req() req: FastifyRequest) {
    await this.#paired(req);
    return this.bgs.watchlist();
  }
}
