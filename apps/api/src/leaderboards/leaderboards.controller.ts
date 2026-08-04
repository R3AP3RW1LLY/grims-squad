import { Controller, Get, Inject, Query } from '@nestjs/common';
import { AppError, ErrorCode, Permission, ROLE_PRESETS } from '@grims/shared';
import { Public } from '../auth/auth.guard.js';
import { User, type CurrentUser } from '../auth/current-user.js';
import { PermissionService } from '../authz/permission.service.js';
import { LeaderboardsService, type BadgeView, type StandingsView } from './leaderboards.service.js';

/**
 * The gamified leaderboards, and the caller's own badges.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "make a new category called leaderboards ... gamify the colonization leaderboard, make badges
 * ect the same way were doing it for databounties ... then we also need to make a leaderboard and
 * gamify it for Trade routes make this work like the other ones too"
 *
 * ★ SAME DOOR AS THE BOUNTY BOARD ★
 *
 * `@Public()` plus a TRADE_QUERY check, exactly like the Data Runner board these grew out of: the
 * standings are squadron activity metadata, and the guard being satisfied rather than skipped is
 * what lets an officer close the door later without touching this file. Nothing here awards a
 * point or a badge — the worker's scorers and the telemetry upload path do that.
 */
@Controller('v1/leaderboards')
export class LeaderboardsController {
  constructor(
    @Inject(LeaderboardsService) private readonly leaderboards: LeaderboardsService,
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

  /**
   * All three boards. `month` defaults to the current UTC month — the running season — because
   * that is the table a member opening the page is competing on today. `me` is the caller's own
   * standing per board, null for a guest.
   */
  @Public()
  @Get()
  async standings(
    @User() caller: CurrentUser | undefined,
    @Query('month') month?: string,
  ): Promise<StandingsView> {
    await this.#assertMarket(caller);

    const key = month ?? new Date().toISOString().slice(0, 7);
    const result = await this.leaderboards.standings(key, caller?.userId ?? null);
    if (result === null) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'month must look like 2026-08.');
    }
    return result;
  }

  /**
   * Every badge the caller has earned, across the forum and all three boards.
   *
   * Not `@Public()`: the route is scoped to the SESSION user — there is no id parameter and there
   * must never be one — so the global guard demanding a session is the correct door, and the
   * check below is the belt to its braces.
   */
  @Get('badges/me')
  async myBadges(@User() caller: CurrentUser | undefined): Promise<{ badges: BadgeView[] }> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to see your badges.');
    }
    return { badges: await this.leaderboards.badgesOf(caller.userId) };
  }
}
