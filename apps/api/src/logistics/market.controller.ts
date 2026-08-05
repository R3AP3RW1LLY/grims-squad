import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import {
  AppError,
  ErrorCode,
  Permission,
  ROLE_PRESETS,
  MAX_CARGO_TONNES,
} from '@grims/shared';
import { Public } from '../auth/auth.guard.js';
import { User, type CurrentUser } from '../auth/current-user.js';
import { PermissionService } from '../authz/permission.service.js';
import { MARKET_STORE } from './logistics.tokens.js';
import type { Coords, MarketStore, PlaceQuery } from './market.store.js';
import { planRoutes, TIME_MODEL, type RouteSort } from './routes.service.js';
import { CommanderPositionService, positionAge } from './commander-position.service.js';

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

/**
 * The feed's pulse, in the words a page prints.
 *
 * ★ EVERY SURFACE THAT SHOWS A PRICE SHOWS THIS ★
 *
 * When the collector stops, every row ages together — so nothing on a page looks unusual and the
 * whole list is quietly, uniformly wrong. The per-row age cannot catch it; only the pulse can.
 */
function feedBanner(health: { newestAt: Date | null; hoursBehind: number; stale: boolean }) {
  if (health.newestAt === null) {
    return { stale: true, text: 'We hold no market prices at all yet.', newestAt: null };
  }

  const h = health.hoursBehind;
  const text =
    h < 1
      ? 'Prices are live.'
      : h < 24
        ? `Newest price is ${Math.floor(h)} hour${Math.floor(h) === 1 ? '' : 's'} old.`
        : `Newest price is ${Math.floor(h / 24)} day${Math.floor(h / 24) === 1 ? '' : 's'} old — the market feed has stopped.`;

  return { stale: health.stale, text, newestAt: health.newestAt };
}

@Controller('v1/logistics')
export class MarketController {
  constructor(
    @Inject(MARKET_STORE) private readonly store: MarketStore,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(CommanderPositionService) private readonly position: CommanderPositionService,
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

  /**
   * Where this member was last seen, so a page can measure from it.
   *
   * ★ SQUADRON OWNER, 2026-08-04 ★
   *
   * "based on the users current or last know position."
   *
   * ★ NULL IS A PERFECTLY GOOD ANSWER ★
   *
   * A guest, a member who has never paired a device, and a member whose app has not uploaded yet
   * all get `null` — and every one of those is a normal state, not a failure. The pages fall back
   * to asking, exactly as they do today. Returning an error instead would make "I have not started
   * the companion" look like something broke.
   *
   * The AGE rides with it and is never optional. A position from six hours ago is useful; one from
   * three weeks ago looks identical and will send somebody shopping four hundred light years from
   * where they are.
   */
  @Public()
  @Get('position')
  async wherever(@User() caller: CurrentUser | undefined) {
    await this.#assertMarket(caller);
    if (caller === undefined) return { position: null };

    const found = await this.position.lastKnown(caller.userId);
    if (found === null) return { position: null };

    const age = positionAge(found.at, Date.now());
    return {
      position: {
        systemName: found.systemName,
        stationName: found.stationName,
        at: found.at,
        source: found.source,
        hasCoords: found.coords !== null,
        age: age.text,
        stale: age.stale,
      },
    };
  }

  /** How far "near you" reaches on the index page. One honest number, printed on the page. */
  static readonly NEAR_LY = 50;

  /*
   * ★ SQUADRON OWNER, 2026-08-04: the market pages measure from the member ★
   *
   * "based on the users current or last know position" — resolved exactly the way the Freight
   * Office does it: a typed system wins, else the journal's last word with its age printed, else
   * nothing and the page simply shows the galaxy-wide numbers it always showed — one indexed
   * read, as before. The near columns are enrichment, never a gate.
   */
  @Public()
  @Get('commodities')
  async list(@User() caller: CurrentUser | undefined, @Query('near') near?: string) {
    await this.#assertMarket(caller);
    const commodities = await this.store.list();

    const typed = near?.trim() ?? '';
    const origin: Origin | null =
      typed !== ''
        ? await this.#typedOrigin(typed)
        : await this.#whereTheyAre(caller?.userId ?? null);

    if (origin === null) {
      return {
        commodities,
        origin: null,
        unknownSystem: typed === '' ? null : typed,
        nearWithinLy: null,
      };
    }

    const nearRows = await this.store.listNear(origin.coords, MarketController.NEAR_LY);
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
      nearWithinLy: MarketController.NEAR_LY,
    };
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

  /**
   * The Freight Office: plan a run from here.
   *
   * ★ SQUADRON OWNER, 2026-08-02 ★
   *
   * "a trade route planner that is very granular and will allow one to selct any buyable and
   * sellable commodity ... this will also be available to the public for use."
   *
   * Same origin rules as the market: a typed system first, the caller's own journal otherwise. With
   * neither, there is nothing to plan FROM — a route needs a starting point in a way a price table
   * does not — so it answers with an empty plan and says why rather than guessing at Sol.
   */
  @Public()
  @Get('routes')
  async routes(
    @User() caller: CurrentUser | undefined,
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
    await this.#assertMarket(caller);

    const typed = near?.trim() ?? '';
    const origin: Origin | null =
      typed !== ''
        ? await this.#typedOrigin(typed)
        : await this.#whereTheyAre(caller?.userId ?? null);

    if (origin === null) {
      return {
        routes: [],
        considered: [],
        origin: null,
        unknownSystem: typed === '' ? null : typed,
      };
    }

    const plan = await planRoutes(this.store, {
      origin: origin.coords,
      originName: origin.system,
      /*
       * Clamped, not trusted — but at the CARRIER's capacity now, not a ship's.
       *
       * This was 794 — described in this comment as "the biggest hold a ship can carry", which the
       * squadron owner corrected on 2026-08-05: "this statement is not true at all". It is not. A
       * Panther Clipper Mk II carries well past it, and members routinely haul more. So the old
       * number was not merely too small for carriers, it was too small for SHIPS, and a member
       * planning either was quietly planned for 794 tonnes and quoted the profit of a run nobody
       * was doing.
       *
       * The bound survives because it was never about ships. Route profit is a per-tonne figure
       * multiplied by this, so 99999999 is quoted a total that is pure fiction — and it is the one
       * number on this page nobody double-checks. A ceiling no real hold can reach costs nothing.
       */
      cargo: clamp(numberOr(cargo, 64), 1, MAX_CARGO_TONNES),
      buyWithinLy: clamp(numberOr(buyWithinLy, 50), 1, 500),
      sellWithinLy: clamp(numberOr(sellWithinLy, 100), 1, 500),
      budget: budget === undefined || budget.trim() === '' ? null : Math.max(0, numberOr(budget, 0)),
      largePadOnly: largePad === '1',
      includeCarriers: carriers === '1',
      /*
       * ★ SEVEN DAYS, NOT "ANY AGE" — MEASURED 2026-08-04 ★
       *
       * The default was 0, meaning no limit, and it produced exactly the run you would expect: the
       * planner's top pick paired an 86-DAY-OLD buy price with a 13-day-old sell and called it
       * 17,919 cr/t. Neither leg was a claim about today, and the sell station had no large pad.
       *
       * A route is a commitment to fly somewhere specific, which is a stronger claim than "where
       * could I buy this" — so it gets a stronger default than the shopping list's.
       *
       * Seven days is measured, not chosen: 258 of the 369 tradeable commodities still have BOTH a
       * fresh buy and a fresh sell inside a week, against 337 inside a month and 0 inside a day.
       * A week keeps 70% of the market and throws away the fiction. Any age is still one click
       * away for somebody who knows what they are looking at.
       */
      seenSince: daysAgo(numberOr(freshDays, 7)),
      only: commodity?.trim() ?? null,
      // Anything unrecognised falls back to the default rather than erroring: a sort key is a
      // preference, and a mistyped preference should never cost somebody their answer.
      sort: sort === 'tonne' || sort === 'hour' ? (sort as RouteSort) : 'trip',
    });

    return {
      ...plan,
      feed: feedBanner(await this.store.feedHealth()),
      origin: {
        system: origin.system,
        station: origin.station,
        from: origin.from,
        // Undefined for a typed origin. The page prints the age only when there is one to print.
        ...(origin.age === undefined ? {} : { age: origin.age, stale: origin.stale === true }),
      },
      unknownSystem: null,
      // The page prints these beside every per-hour figure — an estimate with named assumptions.
      timeModel: TIME_MODEL,
    };
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
   *
   * ★ ONE IMPLEMENTATION, AFTER BRIEFLY HAVING TWO ★
   *
   * This was a private query here. A second copy was written as a service for the commodities
   * pages before anybody noticed this one — which is exactly the drift that produces two answers to
   * "where am I". It now delegates, and the service is the only place that knows.
   *
   * The move gained three things this query did not have: `CarrierJump`, which it never looked at;
   * `StarPos` off an `FSDJump`, which is exact and needs no lookup — so a member in a system our
   * galaxy dump has never heard of now HAS an origin where before they had none; and the timestamp,
   * without which no page could say "where you docked three weeks ago".
   */
  async #whereTheyAre(userId: string | null): Promise<Origin | null> {
    if (userId === null) return null;

    const found = await this.position.lastKnown(userId);
    // We know the name but hold no coordinates for it — deep space, or a system our galaxy data has
    // not reached. Nothing can be measured from it, so it is not an origin.
    if (found === null || found.coords === null) return null;

    const age = positionAge(found.at, Date.now());

    return {
      coords: found.coords,
      system: found.systemName,
      station: found.stationName,
      from: 'journal',
      at: found.at,
      age: age.text,
      stale: age.stale,
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
  /**
   * When the journal said so, and whether that is old enough to distrust.
   *
   * ★ THE OWNER ASKED FOR "CURRENT OR LAST KNOWN", AND THOSE ARE NOT THE SAME THING ★
   *
   * A position from six hours ago is useful. One from three weeks ago looks identical on a page and
   * will plan a member's whole trading run around a place they left — every distance measured from
   * it wrong, and nothing on screen saying why. Absent for a typed origin, which is current by
   * definition because they just typed it.
   */
  readonly at?: Date;
  readonly age?: string;
  readonly stale?: boolean;
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
