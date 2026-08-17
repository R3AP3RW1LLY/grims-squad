import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
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
  /**
   * "I flew there and there is no market."
   *
   * ★ SQUADRON OWNER, 2026-08-16 ★
   *
   * Paid the same as a market report; trusted on one report from a verified commander.
   *
   * The member did the work the bounty asked for — they flew out and found out. That the answer was
   * "nothing here" is the fault of the board that sent them, and a report costing a trip and paying
   * nothing is a report nobody files, which leaves the bounty there for the next member to waste
   * the same evening on.
   *
   * No permission gate beyond a session: the bounty board is public to members and this is the only
   * way to correct it from the cockpit. The verification check that actually matters lives in the
   * service, because it is a rule about who may make the CLAIM rather than who may call the route.
   */
  @Post('no-market')
  async reportNoMarket(
    @User() caller: CurrentUser | undefined,
    @Body() body: { stationKey?: string },
  ) {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to report a station.');
    }
    const stationKey = (body.stationKey ?? '').trim();
    if (stationKey === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Name the station you flew to.');
    }

    return this.bounties.reportNoMarket({ stationKey, userId: caller.userId });
  }
}
