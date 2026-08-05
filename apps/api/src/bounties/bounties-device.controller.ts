import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission } from '@grims/shared';
import { Public } from '../auth/auth.guard.js';
import { PermissionService } from '../authz/permission.service.js';
import { PAIRING_SERVICE } from '../telemetry/telemetry.tokens.js';
import type { PairingService } from '../telemetry/pairing.service.js';
import { BountiesService } from './bounties.service.js';

/**
 * Data Bounties, for the companion app.
 *
 * Same two reads the website makes, through the device-token door — the same split the
 * colonisation module established and for the same reasons (see ColonyDeviceController's header:
 * a device token is a weaker credential than a session, so what it can reach is a list somebody
 * has to add to on purpose).
 *
 * One difference from the website's routes is a feature, not a drift: a paired device always KNOWS
 * its member, so the board here always carries the member's own totals — the app never shows the
 * signed-out variant.
 */
@Controller('v1/companion/bounties')
export class BountiesDeviceController {
  constructor(
    @Inject(BountiesService) private readonly bounties: BountiesService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(PAIRING_SERVICE) private readonly pairing: PairingService,
  ) {}

  /** The member behind a bearer token, having checked they may read the market. */
  async #caller(req: FastifyRequest): Promise<{ userId: string }> {
    const header = req.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    const device = token === '' ? null : await this.pairing.authenticate(token, new Date());
    if (device === null) {
      // Unknown, revoked and wrongly-scoped are one reply, matching the telemetry routes.
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'This device is not paired.');
    }

    const mask = await this.permissions.effectiveMask(device.userId);
    if ((mask & Permission.TRADE_QUERY) !== Permission.TRADE_QUERY) {
      throw new AppError(
        ErrorCode.PERMISSION_DENIED,
        'You do not have access to Logistics & Trade.',
      );
    }
    return { userId: device.userId };
  }

  @Public()
  @Get()
  async board(@Req() req: FastifyRequest) {
    const caller = await this.#caller(req);
    const board = await this.bounties.board();
    const me = await this.bounties.totals(caller.userId);
    return { ...board, me };
  }

  @Public()
  @Get('leaderboard')
  async leaderboard(@Req() req: FastifyRequest, @Query('month') month?: string) {
    await this.#caller(req);
    const key = month ?? new Date().toISOString().slice(0, 7);
    const result = await this.bounties.leaderboard(key);
    if (result === null) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'month must look like 2026-08.');
    }
    return result;
  }
}
