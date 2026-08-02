import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import {
  AppError,
  ErrorCode,
  Permission,
  ROLE_PRESETS,
} from '@grims/shared';
import { Public } from '../auth/auth.guard.js';
import { User, type CurrentUser } from '../auth/current-user.js';
import { PermissionService } from '../authz/permission.service.js';
import { MARKET_STORE } from './logistics.tokens.js';
import type { Coords, MarketStore, PlaceQuery } from './market.store.js';

/**
 * The commodities market.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "a realt time commodities market that operates similar to uexcorp.space/commodities that shows
 * all the comoditiy details, average pricing, price over time lots of data, as well as the best
 * places to buy both in general and based on the players current location and station they are at."
 *
 * ★ PUBLIC, BY PERMISSION ★
 *
 * Every route is `@Public()` in the sense that no session is required — but each is still gated on
 * TRADE_QUERY, which the GUEST mask now holds because the owner asked for these pages to be open:
 * "this will also be available to the public for use". The guard is not skipped, it is satisfied.
 * That distinction is what lets an officer take the market away from a rank later without touching
 * a line of this file.
 */
@Controller('v1/logistics')
export class MarketController {
  constructor(
    @Inject(MARKET_STORE) private readonly store: MarketStore,
    @Inject(PrismaClient) private readonly db: PrismaClient,
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {}

  /**
   * TRADE_QUERY or nothing, for a caller who may not be signed in.
   *
   * ★ HIDING THE NAV ENTRY IS HONESTY, NOT AUTHORISATION ★
   *
   * The URL is typeable and the endpoint is callable whatever the sidebar shows. The menu and the
   * guard have to read the same mask, and only one of them is a security boundary.
   *
   * A visitor with no session is checked against the GUEST mask, which now holds TRADE_QUERY —
   * so this is still a permission check, and one that guests pass. Deleting it would have been
   * fewer lines and would have made "public" the absence of a decision rather than a decision,
   * throwing away the owner's own requirement that these gates "work the same as all other
   * categories".
   */
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

  /** Every commodity at the newest recorded hour, with a day's movement. One indexed read. */
  @Public()
  @Get('commodities')
  async list(@User() caller: CurrentUser | undefined) {
    await this.#assertMarket(caller);
    return { commodities: await this.store.list() };
  }

  /**
   * One commodity: the current picture, the series, and where to trade it.
   *
   * ★ ONE REQUEST, BECAUSE THE PAGE IS ONE ANSWER ★
   *
   * Buys, sells, history and the headline could each be their own route. They are not, because a
   * member opening this page wants all four at once and four round trips would render the page in
   * four stages — each shifting the layout under whoever is reading it.
   */
  @Public()
  @Get('commodities/:name')
  async detail(
    @User() caller: CurrentUser | undefined,
    @Param('name') name: string,
    @Query('near') near?: string,
    @Query('withinLy') withinLy?: string,
    @Query('carriers') carriers?: string,
    @Query('largePad') largePad?: string,
    @Query('minQty') minQty?: string,
    @Query('freshDays') freshDays?: string,
    @Query('hours') hours?: string,
  ) {
    await this.#assertMarket(caller);

    const row = await this.store.one(name);
    if (row === null) return { commodity: null };

    /*
     * Where the member is, in order of how much it can be trusted:
     *
     *   1. `near=` — they typed a system, which is also the ONLY option a signed-out visitor has.
     *   2. their journal — the companion app knows, and the owner asked for exactly this: "based on
     *      the players current location and station they are at".
     *
     * The explicit parameter wins over the journal on purpose. A member planning tomorrow's run
     * from their sofa is not asking about the station they happen to be docked at.
     */
    const typed = near?.trim() ?? '';
    const origin: Origin | null =
      typed !== ''
        ? await this.#typedOrigin(typed)
        : await this.#whereTheyAre(caller?.userId ?? null);

    const opts: PlaceQuery = {
      limit: 25,
      // Carriers off unless asked for. See the note on CARRIER_TYPE — they hold both the cheapest
      // and the dearest prices in the galaxy and can be somewhere else tomorrow.
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
      /*
       * Echoed back so the page can say WHERE it is measuring from, and how it knew. A distance
       * column with no stated origin is a number nobody can check — and a member who never told us
       * where they are needs to know their journal did.
       */
      origin:
        origin === null
          ? null
          : { system: origin.system, station: origin.station, from: origin.from },
      /*
       * ★ SAID OUT LOUD, BECAUSE THE SILENT VERSION WAS DANGEROUS ★
       *
       * Somebody typed a system we cannot place. The radius filter therefore did not run, and these
       * results are galaxy-wide — which looks exactly like a correct answer and will send a member
       * to a station eight thousand light years away.
       *
       * Only ever set for a system somebody TYPED. A member with no paired device has given us
       * nothing to fail to resolve, and telling them their location is unknown would be telling
       * them off for a question they did not ask.
       */
      unknownSystem: typed !== '' && origin === null ? typed : null,
    };
  }

  /** A system somebody typed. Null when we hold no coordinates for it, so nothing can be measured. */
  async #typedOrigin(system: string): Promise<Origin | null> {
    const coords = await this.store.systemCoords(system);
    return coords === null ? null : { coords, system, station: null, from: 'typed' };
  }

  /** Type-ahead for the origin box. Signed-out visitors need this; it is how they say where they are. */
  @Public()
  @Get('systems')
  async systems(@User() caller: CurrentUser | undefined, @Query('q') q?: string) {
    await this.#assertMarket(caller);

    const fragment = q?.trim() ?? '';
    // Two characters minimum: one letter matches a large fraction of a galaxy of systems, and the
    // prefix index cannot narrow it enough to be worth the round trip.
    if (fragment.length < 2) return { systems: [] };
    return { systems: await this.store.systemsLike(fragment, 10) };
  }

  /**
   * Where a member's ship last was, from their own journal.
   *
   * ★ ONLY EVER THE CALLER'S OWN ★
   *
   * Keyed on the session's user id and nothing else, so there is no shape of this request that
   * returns somebody else's position. A commander's location is the most sensitive thing the
   * companion app carries — it is where they are, right now — and this endpoint's whole job is to
   * make a page more convenient. Convenience never justifies widening it.
   *
   * Null for anybody who has not paired a device, which is most people today. The page falls back
   * to the origin box, which works identically for everyone.
   */
  async #whereTheyAre(userId: string | null): Promise<Origin | null> {
    if (userId === null) return null;

    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      /*
       * `Location` (where you logged in), `FSDJump` (where you arrived) and `Docked` (what you
       * docked at) all carry StarSystem. Newest of the three wins, which is the ship's actual
       * position — riding the (user_id, occurred_at) index.
       */
      `SELECT payload->>'StarSystem' AS system, payload->>'StationName' AS station
         FROM telemetry_events
        WHERE user_id = $1::uuid
          AND event_type IN ('Location', 'FSDJump', 'Docked')
          AND payload->>'StarSystem' IS NOT NULL
        ORDER BY occurred_at DESC
        LIMIT 1`,
      userId,
    );

    const r = rows[0];
    if (r === undefined) return null;

    const system = String(r['system']);
    const coords = await this.store.systemCoords(system);
    // We know the name but hold no coordinates for it — deep space, or a system our galaxy data has
    // not reached. Nothing can be measured from it, so it is not an origin.
    if (coords === null) return null;

    return {
      coords,
      system,
      station: r['station'] === null ? null : String(r['station']),
      from: 'journal',
    };
  }
}

/**
 * Where distances are measured from, and how we came to know it.
 *
 * `from` is carried all the way to the page rather than inferred there: "50 ly from Deciat, which
 * you typed" and "50 ly from Deciat, where your ship is" are different claims, and a member who
 * never told us where they are needs to see that their journal did.
 */
interface Origin {
  readonly coords: Coords;
  readonly system: string;
  readonly station: string | null;
  readonly from: 'typed' | 'journal';
}

function numberOr(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** A cutoff date, or null for "no limit". Guards the 0 case so `freshDays=0` means unfiltered. */
function daysAgo(days: number): Date | null {
  if (days <= 0) return null;
  return new Date(Date.now() - days * 86_400_000);
}
