import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission } from '@grims/shared';
import { Public } from '../auth/auth.guard.js';
import { PermissionService } from '../authz/permission.service.js';
import { PAIRING_SERVICE } from '../telemetry/telemetry.tokens.js';
import type { PairingService } from '../telemetry/pairing.service.js';
import { MARKET_STORE } from './logistics.tokens.js';
import type { MarketStore, PlaceQuery } from './market.store.js';
import { planRoutes, TIME_MODEL, type RouteSort } from './routes.service.js';
import { CommanderPositionService, positionAge } from './commander-position.service.js';

/**
 * The Freight Office, for the companion app.
 *
 * ★ SQUADRON OWNER, 2026-08-03 ★
 *
 * "then add this to the companion app too please so we have full feature parridy." The app's Trade
 * runs tab has been a signpost to the website since it shipped; this is the planner behind it.
 *
 * Same device-token door as colonisation and bounties, same reasons (see ColonyDeviceController's
 * header). One genuine advantage over the website's route: a paired device always knows its
 * member, so the plan starts from where their ship actually is unless they name somewhere else —
 * the app never has to ask "where are you" of somebody whose journal answers it.
 */
@Controller('v1/companion/trade')
export class TradeDeviceController {
  constructor(
    @Inject(MARKET_STORE) private readonly store: MarketStore,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(PAIRING_SERVICE) private readonly pairing: PairingService,
    @Inject(CommanderPositionService) private readonly position: CommanderPositionService,
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

  /**
   * The commodities index, with near-you enrichment. Mirrors the website's list exactly — same
   * store calls, same 50 ly radius — except the origin falls back to the DEVICE's member, who
   * always exists here.
   */
  @Public()
  @Get('commodities')
  async commodities(@Req() req: FastifyRequest, @Query('near') near?: string) {
    const caller = await this.#caller(req);
    const commodities = await this.store.list();

    const typed = near?.trim() ?? '';
    let origin: {
      coords: { x: number; y: number; z: number };
      system: string;
      station: string | null;
      from: 'typed' | 'journal';
      age?: string;
      stale?: boolean;
    } | null = null;

    if (typed !== '') {
      const coords = await this.store.systemCoords(typed);
      if (coords !== null) origin = { coords, system: typed, station: null, from: 'typed' };
    } else {
      const known = await this.position.lastKnown(caller.userId);
      if (known !== null && known.coords !== null) {
        const age = positionAge(known.at, Date.now());
        origin = {
          coords: known.coords,
          system: known.systemName,
          station: known.stationName,
          from: 'journal',
          age: age.text,
          stale: age.stale,
        };
      }
    }

    if (origin === null) {
      return {
        commodities,
        origin: null,
        unknownSystem: typed === '' ? null : typed,
        nearWithinLy: null,
      };
    }

    const nearRows = await this.store.listNear(origin.coords, NEAR_LY);
    return {
      commodities: commodities.map((c) => ({
        ...c,
        ...(nearRows.get(c.commodity) ?? { nearBuy: null, nearSell: null, nearMarkets: 0 }),
      })),
      origin: {
        system: origin.system,
        station: origin.station,
        from: origin.from,
        ...(origin.age === undefined ? {} : { age: origin.age, stale: origin.stale === true }),
      },
      unknownSystem: null,
      nearWithinLy: NEAR_LY,
    };
  }

  /**
   * One commodity in full: headline row, price history, and where to trade it — the website's
   * detail page through the device door, with the same parameters and the same defaults, except
   * that the origin falls back to the device's member instead of nothing.
   */
  @Public()
  @Get('commodities/:name')
  async commodity(
    @Req() req: FastifyRequest,
    @Param('name') name: string,
    @Query('near') near?: string,
    @Query('withinLy') withinLy?: string,
    @Query('carriers') carriers?: string,
    @Query('largePad') largePad?: string,
    @Query('minQty') minQty?: string,
    @Query('freshDays') freshDays?: string,
    @Query('hours') hours?: string,
  ) {
    const caller = await this.#caller(req);

    const row = await this.store.one(name);
    if (row === null) return { commodity: null };

    const typed = near?.trim() ?? '';
    let origin: {
      coords: { x: number; y: number; z: number };
      system: string;
      station: string | null;
      from: 'typed' | 'journal';
      age?: string;
      stale?: boolean;
    } | null = null;

    if (typed !== '') {
      const coords = await this.store.systemCoords(typed);
      if (coords !== null) origin = { coords, system: typed, station: null, from: 'typed' };
    } else {
      const known = await this.position.lastKnown(caller.userId);
      if (known !== null && known.coords !== null) {
        const age = positionAge(known.at, Date.now());
        origin = {
          coords: known.coords,
          system: known.systemName,
          station: known.stationName,
          from: 'journal',
          age: age.text,
          stale: age.stale,
        };
      }
    }

    const opts: PlaceQuery = {
      limit: 25,
      excludeCarriers: carriers !== '1',
      largePadOnly: largePad === '1',
      minQuantity: numberOr(minQty, 0),
      seenSince: daysAgo(numberOr(freshDays, 0)),
      near: origin?.coords ?? null,
      withinLy: clamp(numberOr(withinLy, 50), 1, 1000),
    };

    const [buys, sells, history] = await Promise.all([
      this.store.bestBuys(name, opts),
      this.store.bestSells(name, opts),
      this.store.history(name, clamp(numberOr(hours, 168), 1, 24 * 90)),
    ]);

    return {
      commodity: row,
      buys,
      sells,
      history,
      origin:
        origin === null
          ? null
          : {
              system: origin.system,
              station: origin.station,
              from: origin.from,
              ...(origin.age === undefined ? {} : { age: origin.age, stale: origin.stale === true }),
            },
      unknownSystem: typed !== '' && origin === null ? typed : null,
    };
  }

  /**
   * Plan a run. Parameters, clamps and defaults MATCH the website's route in MarketController —
   * the app is a mirror, and two doors quoting different answers for the same inputs is the drift
   * the mirror rule exists to prevent.
   */
  @Public()
  @Get('routes')
  async routes(
    @Req() req: FastifyRequest,
    @Query('near') near?: string,
    @Query('cargo') cargo?: string,
    @Query('buyWithinLy') buyWithinLy?: string,
    @Query('sellWithinLy') sellWithinLy?: string,
    @Query('budget') budget?: string,
    @Query('largePad') largePad?: string,
    @Query('carriers') carriers?: string,
    @Query('freshDays') freshDays?: string,
    @Query('commodity') commodity?: string,
    @Query('sort') sort?: string,
  ) {
    const caller = await this.#caller(req);

    const typed = near?.trim() ?? '';
    let origin: {
      coords: { x: number; y: number; z: number };
      system: string;
      station: string | null;
      from: 'typed' | 'journal';
      age?: string;
      stale?: boolean;
    } | null = null;

    if (typed !== '') {
      const coords = await this.store.systemCoords(typed);
      if (coords !== null) {
        origin = { coords, system: typed, station: null, from: 'typed' };
      }
    } else {
      const known = await this.position.lastKnown(caller.userId);
      if (known !== null && known.coords !== null) {
        const age = positionAge(known.at, Date.now());
        origin = {
          coords: known.coords,
          system: known.systemName,
          station: known.stationName,
          from: 'journal',
          age: age.text,
          stale: age.stale,
        };
      }
    }

    if (origin === null) {
      return {
        routes: [],
        considered: [],
        origin: null,
        unknownSystem: typed === '' ? null : typed,
        timeModel: TIME_MODEL,
      };
    }

    const plan = await planRoutes(this.store, {
      origin: origin.coords,
      originName: origin.system,
      cargo: clamp(numberOr(cargo, 64), 1, 794),
      buyWithinLy: clamp(numberOr(buyWithinLy, 50), 1, 500),
      sellWithinLy: clamp(numberOr(sellWithinLy, 100), 1, 500),
      budget: budget === undefined || budget.trim() === '' ? null : Math.max(0, numberOr(budget, 0)),
      largePadOnly: largePad === '1',
      includeCarriers: carriers === '1',
      seenSince: daysAgo(numberOr(freshDays, 7)),
      only: commodity?.trim() === '' ? null : (commodity?.trim() ?? null),
      sort: sort === 'tonne' || sort === 'hour' ? (sort as RouteSort) : 'trip',
    });

    return {
      ...plan,
      origin: {
        system: origin.system,
        station: origin.station,
        from: origin.from,
        ...(origin.age === undefined ? {} : { age: origin.age, stale: origin.stale === true }),
      },
      unknownSystem: null,
      timeModel: TIME_MODEL,
    };
  }
}

/** The same radius the website's index measures. One number, two doors. */
const NEAR_LY = 50;

// Mirrors of MarketController's local helpers, kept private to each door on purpose: they are
// three lines each, and a shared "controller-utils" file is how unrelated routes grow entangled.
function numberOr(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function daysAgo(days: number): Date | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(Date.now() - days * 86_400_000);
}
