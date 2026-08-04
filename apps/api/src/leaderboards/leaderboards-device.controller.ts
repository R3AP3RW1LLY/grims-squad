import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission } from '@grims/shared';
import { Public } from '../auth/auth.guard.js';
import { PermissionService } from '../authz/permission.service.js';
import { PAIRING_SERVICE } from '../telemetry/telemetry.tokens.js';
import type { PairingService } from '../telemetry/pairing.service.js';
import { LeaderboardsService } from './leaderboards.service.js';

/**
 * The leaderboards, for the companion app.
 *
 * The same standings the website serves, through the device-token door — the split every mirror
 * surface uses, for the reasons ColonyDeviceController's header lays out. The one difference is
 * an advantage: a paired device always knows its member, so `me` is always the member's own
 * standing, never the signed-out null.
 */
@Controller('v1/companion/leaderboards')
export class LeaderboardsDeviceController {
  constructor(
    @Inject(LeaderboardsService) private readonly leaderboards: LeaderboardsService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(PAIRING_SERVICE) private readonly pairing: PairingService,
  ) {}

  async #caller(req: FastifyRequest): Promise<{ userId: string }> {
    const header = req.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    const device = token === '' ? null : await this.pairing.authenticate(token, new Date());
    if (device === null) {
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
  async standings(@Req() req: FastifyRequest, @Query('month') month?: string) {
    const caller = await this.#caller(req);
    const key = month ?? new Date().toISOString().slice(0, 7);
    const result = await this.leaderboards.standings(key, caller.userId);
    if (result === null) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'month must look like 2026-08.');
    }
    return result;
  }

  /** The member's own badge case, for the app's dashboard surfaces. */
  @Public()
  @Get('badges')
  async badges(@Req() req: FastifyRequest) {
    const caller = await this.#caller(req);
    return { badges: await this.leaderboards.badgesOf(caller.userId) };
  }
}
