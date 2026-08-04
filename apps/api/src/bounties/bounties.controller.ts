import { Controller, Get, Inject, Query } from '@nestjs/common';
import { AppError, ErrorCode, Permission, ROLE_PRESETS } from '@grims/shared';
import { Public } from '../auth/auth.guard.js';
import { User, type CurrentUser } from '../auth/current-user.js';
import { PermissionService } from '../authz/permission.service.js';
import { BountiesService } from './bounties.service.js';

/**
 * Data Bounties and the Data Runner leaderboard.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "create a new page under squadrons called Data bounty's and create a list of all stations and
 * systems we need to dock at to shore up market data ... turn this into our first offical Data
 * Runner Leaderboard please!"
 *
 * ★ SAME DOOR AS THE MARKET PAGES ★
 *
 * `@Public()` plus a TRADE_QUERY check, exactly like the commodities routes: the board IS market
 * metadata, and the guard being satisfied rather than skipped is what lets an officer close the
 * door later without touching this file. The claiming side never comes through here at all —
 * credit is paid inside the telemetry upload path, which authenticates a paired device.
 */
@Controller('v1/bounties')
export class BountiesController {
  constructor(
    @Inject(BountiesService) private readonly bounties: BountiesService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {}

  async #assertMarket(caller: CurrentUser | undefined): Promise<void> {
    const mask =
      caller === undefined
        ? ROLE_PRESETS.guest
        : await this.permissions.effectiveMask(caller.userId);

    if ((mask & Permission.TRADE_QUERY) !== Permission.TRADE_QUERY) {
      throw new AppError(
        ErrorCode.PERMISSION_DENIED,
        'You do not have access to Logistics & Trade.',
      );
    }
  }

  /** The board, plus the caller's own running totals when they are signed in. */
  @Public()
  @Get()
  async board(@User() caller: CurrentUser | undefined) {
    await this.#assertMarket(caller);

    const board = await this.bounties.board();
    const me = caller === undefined ? null : await this.bounties.totals(caller.userId);
    return { ...board, me };
  }

  /**
   * Standings. `month` defaults to the current UTC month — the running season — because that is
   * the table a member opening the page is competing on today.
   */
  @Public()
  @Get('leaderboard')
  async leaderboard(@User() caller: CurrentUser | undefined, @Query('month') month?: string) {
    await this.#assertMarket(caller);

    const key = month ?? new Date().toISOString().slice(0, 7);
    const result = await this.bounties.leaderboard(key);
    if (result === null) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'month must look like 2026-08.');
    }
    return result;
  }
}
