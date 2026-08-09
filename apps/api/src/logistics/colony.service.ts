import { randomBytes } from 'node:crypto';
import {
  announceColonyProject,
  completeColonyProject,
  notifySquadron,
  type LiveNudge,
  type PrismaClient,
} from '@grims/db';
import { AppError, cleanStationName, ErrorCode, Permission } from '@grims/shared';
import { DEFAULT_TIMEZONE, isValidTimezone } from '../common/timezone.js';
import type { AclDbService } from '../authz/acl-db.service.js';
import type { MarketStore, PlaceQuery } from './market.store.js';
import { SingleFlight } from '../common/single-flight.js';
import { Bulkhead } from '../common/bulkhead.js';

/**
 * How long a computed shopping list stays fresh.
 *
 * Sixty seconds is chosen against the two failures on either side of it. Too short and a retrying
 * companion still stampedes, which is the outage this exists to prevent. Too long and the list
 * quotes a station that sold out — a different bug report, and one that erodes trust in the whole
 * feature rather than merely making it slow.
 *
 * A minute is far longer than a burst of retries and far shorter than the interval at which market
 * data actually changes: EDDN refreshes a given station every few minutes at best.
 */
const SHOPPING_LIST_TTL_MS = 60_000;

/**
 * Where the site lives, for a link in a Discord message.
 *
 * ★ PUBLIC_URL, WITH THE SAME FALLBACK THE TELEMETRY CONTROLLER USES ★
 *
 * `WEB_BASE_URL` is the explicit answer where somebody has set one; `PUBLIC_URL` is what the
 * deploy preflight already requires, so it is the reliable one. A trailing slash is stripped by
 * the template, and an unset pair produces a relative link rather than a broken absolute one —
 * ugly in Discord, but it cannot point at the wrong hub.
 */
function siteUrl(): string {
  const explicit = (process.env['WEB_BASE_URL'] ?? '').trim();
  const fallback = (process.env['PUBLIC_URL'] ?? '').trim();
  return explicit === '' ? fallback : explicit;
}

/**
 * Colonisation projects — the squadron's own record.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "officers will be able to add Squadron specific and personal project and ladder ranked members
 * will be able to list personal projects", "Squadron projects members-only, personal projects
 * publishable by choice", and — of what a squadron project does that a personal one does not —
 * "Squadron projects also get a shopping list from the Freight Office".
 */

export type ColonyOwner = 'squadron' | 'personal';
export type ColonyVisibility = 'private' | 'squadron' | 'public';

export interface ProjectRow {
  readonly id: string;
  readonly owner: ColonyOwner;
  readonly title: string;
  readonly systemName: string;
  readonly stationName: string | null;
  /**
   * The construction site this points at, as a STRING.
   *
   * A market id exceeds 2^53, so it is carried as text end to end rather than as a JSON number —
   * the same reasoning as the tonnage totals on the market rows.
   */
  readonly marketId: string;
  /** Whatever the member typed when they posted it. Free text, and often blank. */
  readonly buildType: string | null;
  /**
   * What the site actually is, worked out from what it asks for.
   *
   * ★ NOT THE SAME FIELD AS `buildType` ABOVE ★
   *
   * That one is a string somebody typed. This one is the catalogue row its requirement fingerprints
   * to — twenty-odd commodities at exact tonnages, which no two build types share. Null until
   * somebody has docked there, and null for a build type we have not recorded yet, which is
   * information rather than an error.
   */
  readonly identified: {
    readonly id: string;
    readonly displayName: string;
    readonly tier: number;
    readonly padSize: string;
    readonly location: string;
    readonly totalTonnes: number;
  } | null;
  readonly notes: string | null;
  readonly visibility: ColonyVisibility;
  readonly shareToken: string | null;
  readonly isPriority: boolean;
  readonly completedAt: Date | null;
  readonly postedBy: string | null;
  readonly postedById: string;
  readonly updatedAt: Date;
  /** Tonnes still wanted across every commodity, and tonnes the build asks for in total. */
  readonly remaining: number;
  readonly required: number;
  readonly needCount: number;
  /**
   * Deliveries recorded against this build.
   *
   * The one number that decides whether it can still be deleted: the server refuses once this is
   * above zero, because removing the project would erase somebody's hauling record.
   */
  readonly deliveryCount: number;
}

export interface NeedDetail {
  readonly commodity: string;
  readonly remaining: number;
  readonly required: number | null;
  /**
   * When the game last told us this.
   *
   * ★ IT WAS STORED AND NEVER SHOWN, WHICH IS THE WORST OF BOTH ★
   *
   * `colony_needs.observedAt` has been written on every sync since the table existed and read by no
   * route, so no screen could say how old the figures were. A needs list is a snapshot of a depot
   * reading — it is current if somebody docked there ten minutes ago and a fortnight stale if
   * nobody has been since. Those look identical without this, and only one of them is worth
   * planning an evening around.
   */
  readonly observedAt: Date | null;
}

/**
 * A depot reading sent with a new project, so it lands with its progress already known.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "if we can see the historical data on all materials that have been delivered, can we please
 * include that when we create the new project, so we have full data visibilty."
 *
 * We can: the game's own depot event carries `ProvidedAmount` for every commodity, which is the
 * site's ENTIRE delivery history — everybody's, not just the poster's. A site half built by
 * strangers arrives on the board reading half built.
 */
export interface OpeningSnapshot {
  readonly resources: ReadonlyArray<{
    readonly commodity: string;
    readonly required: number;
    readonly provided: number;
  }>;
}

/** One delivery, as the append-only ledger recorded it. */
export interface DeliveryRow {
  readonly at: Date;
  readonly commander: string;
  readonly commodity: string;
  readonly amount: number;
}

/**
 * One bar of the delivery chart: a slice of time, and what went in during it.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "a stacked bar chart that shows commoditied selivered per hour per day like raven colonial", and
 * then "we want the who has hauled to be a stacked bar chart" too.
 *
 * `bySeries` is what makes the bar STACKED rather than a single total. It is deliberately NOT
 * called `byCommodity` any more: the same bar is stacked by commodity in one view and by commander
 * in the other, and a field named for one of them while holding the other is the kind of lie that
 * costs somebody an hour.
 *
 * ★ `at` IS A NAIVE LOCAL KEY AND `label` IS THE ONLY THING A CLIENT MAY DRAW — 2026-08-04 ★
 *
 * The buckets used to travel as instants, and both clients reparsed them with `new Date()` and
 * labelled them in whatever zone the DEVICE happened to be in. West of UTC that put a whole
 * evening's hauling on the previous day's bar — a member watched today's deliveries stack onto
 * yesterday. So the bucket is cut in the viewer's own zone (see `deliveryChart`), the key is the
 * zone-local wall time `YYYY-MM-DDTHH:MM` with no offset for a client to misapply, and the axis
 * text is authored HERE. A client that never parses a bucket cannot re-shift one.
 */
export interface DeliveryBucket {
  /** The bucket's wall time in the chart's own zone. An opaque, sortable key — never parsed. */
  readonly at: string;
  /** Rendered on the axis verbatim: `23:00` for an hour bucket, `4 Aug` for a day bucket. */
  readonly label: string;
  readonly bySeries: Readonly<Record<string, number>>;
  readonly total: number;
}

/**
 * One commander's column: everything they have hauled, split by commodity.
 *
 * ★ THE QUESTION THE TIME CHART CANNOT ANSWER ★
 *
 * "Who has hauled" as a plain tally says one person brought 40,000 tonnes. It does not say whether
 * that was forty thousand tonnes of steel or a share of everything — which is the difference
 * between somebody who covered a commodity and somebody who did a bit of each run.
 */
export interface HaulerStack {
  readonly commander: string;
  readonly byCommodity: Readonly<Record<string, number>>;
  readonly total: number;
}

/** Everything the two charts on a project page need, in one read. */
export interface DeliveryCharts {
  readonly bucket: 'hour' | 'day';
  /**
   * The IANA zone the buckets were actually cut in, so both clients can caption the axis with it.
   * Usually the viewer's stored zone; UTC when the viewer has none or their zone was refused.
   */
  readonly tz: string;
  /** Time on the x-axis, stacked by commodity. */
  readonly byCommodity: readonly DeliveryBucket[];
  /** The same time buckets, stacked by commander. */
  readonly byCommander: readonly DeliveryBucket[];
  /** One column per commander, stacked by commodity. Biggest hauler first. */
  readonly haulers: readonly HaulerStack[];
}

export interface HaulerTally {
  readonly name: string;
  readonly tonnes: number;
}

/** Where to buy what a project still needs. The thing a squadron project gets and a personal one does not. */
export interface ShoppingRow {
  readonly commodity: string;
  readonly remaining: number;
  /** The site's total ask, when the journal has given it. What the three-segment bar divides by. */
  readonly required: number | null;
  /**
   * Effective tonnes of this already aboard the build's attached carriers, capped at `remaining`.
   *
   * ★ THE NUMBER THAT STOPS A WASTED SHOPPING TRIP ★
   *
   * The list used to quote the full outstanding tonnage and print a caveat telling members to go
   * and check the Carriers tab themselves. Twenty thousand tonnes parked at the site is not
   * something a footnote should be in charge of — so the quantity every quote uses is `toBuy`,
   * and this is what was subtracted to get it.
   */
  readonly onCarriers: number;
  /** What actually needs buying: max(0, remaining − onCarriers). Zero means the carriers cover it. */
  readonly toBuy: number;
  readonly stationName: string | null;
  readonly systemName: string | null;
  readonly price: number | null;
  readonly supply: number | null;
  readonly distance: number | null;
  /**
   * When somebody last saw this price, so the page can say how much to trust it.
   *
   * Shown rather than used as a filter. Half our mirror is older than three months, and a page that
   * hid everything stale would tell a member "nobody sells this" about commodities that are on a
   * shelf right now — which is worse than an old number they can weigh for themselves.
   */
  readonly seenAt: Date | null;
  /**
   * The nearest place that sells this AT ALL, when nothing inside the radius does.
   *
   * ★ SQUADRON OWNER, 2026-08-03 ★
   *
   * "if on the where to buy a commodty is listed as 'nobody in range sells this' can we display the
   * actual nearest location that does sell it, with an estimated light years in distance please.
   * this will help people locate the commodity."
   *
   * "Nobody in range sells this" is true and useless: it tells a member the search failed and
   * nothing about what to do next. CMM Composite on the squadron's own build is exactly this — not
   * sold within a hundred light years, and somebody still has to go and get forty thousand tonnes
   * of it from somewhere.
   *
   * Null only when nobody anywhere in our mirror sells it, which is a different and much rarer
   * statement.
   */
  readonly nearestOutOfRange: {
    readonly stationName: string;
    readonly systemName: string;
    readonly price: number;
    readonly supply: number;
    readonly distance: number | null;
    readonly seenAt: Date | null;
  } | null;
  /** Credits to buy the outstanding tonnage at that price. Null when nowhere sells it. */
  readonly cost: number | null;
}

/**
 * ★ COLONY PROJECTS ARE ACL-BEARING, SO EVERY READ IS BOUND (INV-002) ★
 *
 * `visibility` made ColonyProject an ACL model, and `acl-usage.spec.ts` failed the build the moment
 * it did — along with `acl-find-unique.spec.ts`, because the extension merges its predicate into
 * `where` as an AND array, which is a legal filter and an ILLEGAL unique input. `findUnique` on one
 * of these does not filter wrongly; it throws on every call.
 *
 * Both guards were right, and both caught this before it shipped. So nothing here touches
 * `prisma.colonyProject` directly: reads go through a client bound to whoever is asking, and the
 * predicate in `acl-extension.ts` — public to everyone, squadron to anyone signed in, private to
 * its poster — is applied inside the query rather than after it.
 *
 * `colonyNeed` and `colonyContribution` carry no ACL column and are reached only after a project
 * has been resolved through a bound client, so they are read on the plain one.
 */
/**
 * How far a station is, in bands rather than light years.
 *
 * ★ LOCAL FIRST, THEN CHEAPEST WITHIN THE SAME TRIP ★
 *
 * "always prioritize local markets before sending out of system" is not the same instruction as
 * "sort by distance". Sorting purely by distance picks a station eleven light years away over one
 * twelve light years away that is half the price, which is a distinction nobody flying cares about.
 * What a member actually means is: the same system beats leaving it, a short hop beats a long haul,
 * and *within a comparable trip* they want the better price.
 *
 * So distance is bucketed and price decides inside a bucket. Band 0 is the build's own system,
 * which is the case the owner reported and the one that matters most.
 */
function distanceBand(ly: number | null): number {
  if (ly === null) return 99;
  if (ly < 1) return 0; // the same system
  if (ly <= 15) return 1; // one jump in almost anything
  if (ly <= 50) return 2;
  if (ly <= 150) return 3;
  return 4;
}

/** Past this, a supply figure is not evidence about what is on the shelf today. */
export const BELIEVABLE_DAYS = 90;

/**
 * Whether a price is recent enough to be believed at all. 0 = yes, 1 = no.
 *
 * ★ MEASURED, NOT ASSUMED — 2026-08-03 ★
 *
 * Of the 18.6 million rows in our market mirror, 6.4% were seen within a week, 27% within a month,
 * and 46.6% are older than three months. The oldest is from June 2020. Nothing in the shopping list
 * knew that, so a station whose shelf was last looked at eleven months ago outranked one somebody
 * flew through yesterday whenever it was a few credits cheaper.
 *
 * A price is a claim about STOCK, and stock is the thing a member is flying forty light years to
 * collect. An old reading is not slightly worse information — it is a different kind of statement,
 * and the trip it sends somebody on can be entirely wasted.
 *
 * ★ TWO BANDS, NOT FOUR — AND THE TRADE THAT FORCED IT, 2026-08-04 ★
 *
 * This was 7 / 30 / 90 day bands, ranked above price. Measuring what that actually did to real
 * shopping lines — 2,051 sourced (origin, commodity) pairs — showed it changing the named station
 * on about 37% of them, and the price it paid for that was not defensible:
 *
 *     median +15%, p90 +104%, and 121 of 318 flips cost more than a quarter extra.
 *     The worst: Steel at Tiethay, 410 cr on an EIGHT-day-old reading, replaced by
 *     3,625 cr on a FOUR-day-old one. An 8.8x price rise to buy four days.
 *
 * Both readings were recent. Both were believable. The old bands made a one-day step across an
 * arbitrary line outrank ANY price difference, however large, and nobody would sanction that trade
 * if it were put to them in words.
 *
 * The thing worth protecting against was never four days versus eight — it was ELEVEN MONTHS. So
 * this is now a single question with a yes-or-no answer: can this reading be believed? Inside
 * ninety days, price decides and the age is merely printed. Outside it, the row sits below every
 * believable option however cheap it looks, because a year-old supply figure is not a bargain, it
 * is fiction.
 *
 * Still shown, never filtered: 46.6% of the mirror is older than this, and hiding it would tell a
 * member "nobody sells this" about commodities sitting on a shelf right now.
 */
export function freshnessBand(seenAt: Date | null, now: number): number {
  // Unknown is treated as too old rather than as fresh. Sorting an undated row to the front would
  // promote exactly the rows we know least about to the top of somebody's shopping list.
  if (seenAt === null) return 1;
  const days = (now - seenAt.getTime()) / 86_400_000;
  return days <= BELIEVABLE_DAYS ? 0 : 1;
}

/**
 * Orders candidate stations by what the member asked for.
 *
 * ★ EXPORTED SO IT CAN BE MEASURED AGAINST ITSELF ★
 *
 * It was module-private, and every attempt to measure what the ranking actually does to real
 * shopping lines had to TRANSCRIBE it — three separate re-implementations, each of which would have
 * gone on printing a plausible number against a comparator that no longer existed. A measurement
 * that cannot fail when the code changes is not measuring the code.
 */
export function rankPlaces<
  T extends {
    readonly distance: number | null;
    readonly price: number;
    readonly seenAt: Date | null;
    readonly stationName: string;
  },
>(places: readonly T[], sort: 'local' | 'cheapest' | 'closest', now: number): readonly T[] {
  const by = [...places];

  /*
   * ★ FRESHNESS DOES NOT OVERRIDE THE SORT SOMEBODY ASKED FOR ★
   *
   * A member who chose "cheapest" gets the cheapest. Quietly demoting it because the reading is old
   * would be answering a different question than the one on the control they just used — the page
   * shows the age instead, and lets them decide.
   */
  if (sort === 'cheapest') {
    return by.sort((a, b) => a.price - b.price || (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }
  if (sort === 'closest') {
    return by.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.price - b.price);
  }

  /*
   * 'local' — the default, and the one the owner asked for.
   *
   * Distance first: "always prioritize local markets before sending out of system" was an
   * instruction, not a preference. Then whether the reading can be believed AT ALL — see
   * `freshnessBand`, and the Tiethay trade that cut it down to one question. Then price.
   *
   * Within a trip, two believable readings are separated by price alone, so the four-days-versus-
   * eight comparison that used to octuple a bill cannot happen. A reading older than three months
   * sits below every believable one however cheap, because it is not evidence.
   */
  return by.sort(
    (a, b) =>
      distanceBand(a.distance) - distanceBand(b.distance) ||
      freshnessBand(a.seenAt, now) - freshnessBand(b.seenAt, now) ||
      a.price - b.price ||
      (a.distance ?? Infinity) - (b.distance ?? Infinity) ||
      /*
       * ★ A TOTAL ORDER, BECAUSE THE PAGE MUST NOT MOVE UNDER SOMEBODY ★
       *
       * Without this the comparator leaves genuine ties unresolved, and the underlying query does
       * not determine row order either — so the shopping list could name a different station on two
       * consecutive loads with nothing in the data having changed. Found while measuring: one pair
       * flipped between two runs seconds apart on a price-and-distance tie.
       *
       * The station name is arbitrary as a preference and perfect as a tiebreak: it is stable,
       * always present, and never equal for two different stations.
       */
      a.stationName.localeCompare(b.stationName),
  );
}

export class ColonyService {
  /**
   * Shared across every instance, deliberately.
   *
   * Nest constructs this service per module, and a coalescer scoped to one instance would let the
   * same project be computed once per instance — which is the stampede again, just with a smaller
   * number. There is one database and one answer, so there is one flight.
   */
  private static readonly shoppingFlight = new SingleFlight({ maxEntries: 200 });

  /**
   * ★ THE CEILING THIS ROUTE MAY NOT EXCEED ★
   *
   * On 2026-08-06 this one computation held all twenty-five database connections, so sign-in, the
   * roster and the health check the deploy gates on were queued behind a page of market lookups.
   *
   * Six of twenty-five, and a short queue. That is generous for a computation that is now
   * coalesced — six DISTINCT shopping lists at once is far beyond anything a 107-member squadron
   * produces — while leaving nineteen connections that this route can never touch, whatever
   * happens to it next.
   *
   * Static for the same reason the coalescer is: per-instance limits would multiply by the number
   * of instances, which is not a limit.
   */
  private static readonly shoppingBulkhead = new Bulkhead({
    limit: 6,
    queue: 12,
    name: 'colonisation shopping list',
  });

  constructor(
    private readonly db: PrismaClient,
    private readonly market: MarketStore,
    private readonly acl: AclDbService,
    /**
     * How the notification producers below nudge live bell badges. Optional so every existing
     * test constructs the service exactly as before; rows still land without it (notify.ts).
     */
    private readonly nudge?: LiveNudge,
  ) {}

  /**
   * The boards.
   *
   * ★ THE ACL IS NOT DOING THE FILTERING HERE, AND THAT IS DELIBERATE ★
   *
   * `ColonyProject` is registered in ACL_MODELS, so a read through `AclDbService` already refuses
   * rows a caller may not see. This method is reached ONLY after a COLONY_VIEW check, and it filters
   * by `owner` — a different axis entirely. The two are not alternatives: the permission decides
   * whether the boards exist for you, and the ACL decides which rows are yours to read.
   */
  async board(
    owner: ColonyOwner | 'all',
    caller: { userId: string } | null,
  ): Promise<readonly ProjectRow[]> {
    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT p.id, p.owner::text AS owner, p.title, p.system_name, p.station_name, p.build_type,
              p.market_id::text AS market_id,
              -- What the site's own requirement fingerprinted to. Null until somebody has docked
              -- there, and null for a build type we have not recorded — which is information.
              p.build_type_id, bt.display_name AS build_type_name, bt.tier AS build_tier,
              bt.pad_size AS build_pad, bt.location AS build_location,
              bt.total_tonnes AS build_total,
              p.notes, p.visibility::text AS visibility, p.share_token, p.is_priority,
              p.completed_at, p.posted_by_id, p.updated_at,
              u.display_name AS posted_by,
              COALESCE(SUM(n.remaining), 0)::bigint AS remaining,
              COALESCE(SUM(n.required), 0)::bigint  AS required,
              COUNT(n.commodity)::int               AS need_count,
              /*
               * ★ WHAT DELETE ACTUALLY TURNS ON ★
               *
               * remove() refuses once anybody has hauled here, because deleting the project would
               * erase their deliveries. The page was hiding its Delete button on required = 0
               * instead -- "has this site reported what it needs", which is a different question
               * and a stricter one. A member who mistyped a market id, let it report its needs and
               * hauled nothing had no way to remove it, though the server would have allowed it.
               *
               * A correlated subquery rather than another LEFT JOIN: joining the ledger into a
               * statement that already groups over colony_needs would multiply the need rows by
               * the delivery rows and quietly inflate every total on the page.
               */
              (SELECT count(*) FROM colony_contributions c WHERE c.project_id = p.id)::int
                                                    AS delivery_count
         FROM colony_projects p
         LEFT JOIN colony_build_types bt ON bt.id = p.build_type_id
         JOIN users u ON u.id = p.posted_by_id
         LEFT JOIN colony_needs n ON n.project_id = p.id
        WHERE ($1 = 'all' OR p.owner::text = $1)
          /*
           * Visibility, applied here as well as in the ACL layer. A signed-out reader may see only
           * a published project; a member sees squadron-visible ones and anything of their own.
           */
          AND (
            p.visibility = 'public'
            OR ($2::uuid IS NOT NULL AND p.visibility = 'squadron')
            OR ($2::uuid IS NOT NULL AND p.posted_by_id = $2::uuid)
          )
        GROUP BY p.id, u.display_name, bt.id
        -- Priority first, then live before finished, then most recently touched.
        ORDER BY p.is_priority DESC, (p.completed_at IS NOT NULL), p.updated_at DESC`,
      owner,
      caller?.userId ?? null,
    );

    return rows.map((r) => this.#row(r));
  }

  async byId(id: string, caller: { userId: string } | null): Promise<ProjectRow | null> {
    const rows = await this.board('all', caller);
    return rows.find((r) => r.id === id) ?? null;
  }

  /**
   * The live project for a construction site, by its market id.
   *
   * ★ WHAT THE COMPANION'S BUILD-TRACKER ASKS ★
   *
   * The app knows the member has docked and knows the market id from the journal; it does not know
   * which project that is. Resolved through `board` so the visibility rules are applied ONCE, in
   * the place that already applies them — a direct query here would be a second copy of the
   * "public, or squadron and signed in, or your own" predicate, and the copy is what drifts.
   *
   * Finished projects are excluded: an overlay showing a completed build's needs while the member
   * is docked somewhere else entirely is worse than showing nothing.
   */
  async byMarketId(
    marketId: bigint,
    caller: { userId: string } | null,
  ): Promise<ProjectRow | null> {
    /*
     * ★ FILTERED FROM THE BOARD, NOT QUERIED DIRECTLY ★
     *
     * The first version read `colonyProject` on the plain client for just the id, on the reasoning
     * that an id leaks nothing. `acl-usage.spec.ts` failed it, and the guard is right: INV-002 is
     * about the CLIENT, not about how much of the row is selected, because the next person to touch
     * that query will add a column to it.
     *
     * A squadron has a handful of live projects. Filtering them in memory costs nothing and means
     * the visibility rules are applied exactly once, in `board`.
     */
    const wanted = marketId.toString();
    return (
      (await this.board('all', caller)).find(
        (p) => p.marketId === wanted && p.completedAt === null,
      ) ?? null
    );
  }

  /** One published project, by its token. The token IS the capability. */
  async byToken(token: string): Promise<ProjectRow | null> {
    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT p.id, p.owner::text AS owner, p.title, p.system_name, p.station_name, p.build_type,
              p.market_id::text AS market_id,
              -- What the site's own requirement fingerprinted to. Null until somebody has docked
              -- there, and null for a build type we have not recorded — which is information.
              p.build_type_id, bt.display_name AS build_type_name, bt.tier AS build_tier,
              bt.pad_size AS build_pad, bt.location AS build_location,
              bt.total_tonnes AS build_total,
              p.notes, p.visibility::text AS visibility, p.share_token, p.is_priority,
              p.completed_at, p.posted_by_id, p.updated_at,
              u.display_name AS posted_by,
              COALESCE(SUM(n.remaining), 0)::bigint AS remaining,
              COALESCE(SUM(n.required), 0)::bigint  AS required,
              COUNT(n.commodity)::int               AS need_count,
              /*
               * ★ WHAT DELETE ACTUALLY TURNS ON ★
               *
               * remove() refuses once anybody has hauled here, because deleting the project would
               * erase their deliveries. The page was hiding its Delete button on required = 0
               * instead -- "has this site reported what it needs", which is a different question
               * and a stricter one. A member who mistyped a market id, let it report its needs and
               * hauled nothing had no way to remove it, though the server would have allowed it.
               *
               * A correlated subquery rather than another LEFT JOIN: joining the ledger into a
               * statement that already groups over colony_needs would multiply the need rows by
               * the delivery rows and quietly inflate every total on the page.
               */
              (SELECT count(*) FROM colony_contributions c WHERE c.project_id = p.id)::int
                                                    AS delivery_count
         FROM colony_projects p
         LEFT JOIN colony_build_types bt ON bt.id = p.build_type_id
         JOIN users u ON u.id = p.posted_by_id
         LEFT JOIN colony_needs n ON n.project_id = p.id
        -- The visibility test as well as the token: revoking a share must actually revoke it, and a
        -- token that still worked after the member set the project back to private would be a link
        -- they believed they had taken back.
        WHERE p.share_token = $1 AND p.visibility = 'public'
        GROUP BY p.id, u.display_name, bt.id`,
      token,
    );

    const r = rows[0];
    return r === undefined ? null : this.#row(r);
  }

  #row(r: Record<string, unknown>): ProjectRow {
    return {
      id: String(r['id']),
      owner: String(r['owner']) as ColonyOwner,
      title: String(r['title']),
      systemName: String(r['system_name']),
      stationName: r['station_name'] === null ? null : String(r['station_name']),
      marketId: String(r['market_id'] ?? ''),
      buildType: r['build_type'] === null ? null : String(r['build_type']),
      identified:
        r['build_type_id'] === null || r['build_type_id'] === undefined
          ? null
          : {
              id: String(r['build_type_id']),
              displayName: String(r['build_type_name'] ?? ''),
              tier: Number(r['build_tier'] ?? 0),
              padSize: String(r['build_pad'] ?? 'none'),
              location: String(r['build_location'] ?? 'orbital'),
              totalTonnes: Number(r['build_total'] ?? 0),
            },
      notes: r['notes'] === null ? null : String(r['notes']),
      visibility: String(r['visibility']) as ColonyVisibility,
      shareToken: r['share_token'] === null ? null : String(r['share_token']),
      isPriority: r['is_priority'] === true,
      completedAt: (r['completed_at'] as Date | null) ?? null,
      postedBy: r['posted_by'] === null ? null : String(r['posted_by']),
      postedById: String(r['posted_by_id']),
      updatedAt: r['updated_at'] as Date,
      remaining: Number(r['remaining'] ?? 0),
      required: Number(r['required'] ?? 0),
      needCount: Number(r['need_count'] ?? 0),
      deliveryCount: Number(r['delivery_count'] ?? 0),
    };
  }

  /** What a project still needs, biggest shortfall first. */
  async needs(projectId: string): Promise<readonly NeedDetail[]> {
    const rows = await this.db.colonyNeed.findMany({
      where: { projectId },
      orderBy: { remaining: 'desc' },
      select: { commodity: true, remaining: true, required: true, observedAt: true },
    });
    return rows;
  }

  /**
   * Who hauled what, most first.
   *
   * ★ NAMES, NOT IDS, AND ONLY EVER TOTALS ★
   *
   * A leaderboard needs a name and a number. It does not need to say WHEN somebody hauled, which
   * would turn a contribution board into an activity log of who was online at what hour — a
   * different thing entirely, and not what anybody agreed to by delivering cargo.
   */
  async haulers(projectId: string): Promise<readonly HaulerTally[]> {
    const rows = await this.db.$queryRawUnsafe<Array<{ name: string | null; tonnes: bigint }>>(
      `SELECT u.display_name AS name, SUM(c.amount)::bigint AS tonnes
         FROM colony_contributions c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.project_id = $1::uuid
        GROUP BY u.display_name
        ORDER BY SUM(c.amount) DESC`,
      projectId,
    );

    return rows.map((r) => ({ name: r.name ?? 'A former member', tonnes: Number(r.tonnes) }));
  }

  /**
   * Every delivery, newest first.
   *
   * ★ SQUADRON OWNER, 2026-08-02 ★
   *
   * "whos delivered what and when."
   *
   * The ledger is append-only, so this is the literal record rather than a derived tally — which is
   * what makes it worth showing at all: a member can see their own run land on it.
   *
   * Capped, because a finished build can hold thousands of rows and nobody scrolls that far. The
   * chart below summarises the whole history; this is the recent detail.
   */
  async deliveries(projectId: string, limit = 200): Promise<readonly DeliveryRow[]> {
    const rows = await this.db.$queryRawUnsafe<
      Array<{ at: Date; commander: string | null; commodity: string; amount: number }>
    >(
      `SELECT c.delivered_at AS at, u.display_name AS commander, c.commodity, c.amount
         FROM colony_contributions c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.project_id = $1::uuid
        ORDER BY c.delivered_at DESC
        LIMIT $2`,
      projectId,
      limit,
    );

    return rows.map((r) => ({
      at: r.at,
      // A member who has left still hauled the cargo. Their rows survive with a null user (the
      // ledger uses SET NULL), and erasing them from the history would understate the build.
      commander: r.commander ?? 'A former member',
      commodity: r.commodity,
      amount: r.amount,
    }));
  }

  /**
   * Deliveries bucketed over time, for a stacked bar chart.
   *
   * ★ SQUADRON OWNER, 2026-08-02 ★
   *
   * "a stacked bar chart that shows commoditied selivered per hour per day like raven colonial."
   *
   * ★ BUCKETED IN POSTGRES, AND THE WIDTH IS CHOSEN FROM THE SPAN ★
   *
   * A build that started this morning wants hours; one running for three weeks wants days, or the
   * chart is five hundred bars a pixel wide. The caller does not have to know which — the span of
   * the data decides, and the answer says which it chose so the axis can be labelled honestly.
   *
   * `date_trunc` rather than arithmetic in Node: bucketing in SQL means one row per bar rather than
   * every contribution crossing the wire to be counted here.
   *
   * ★ BUCKETED IN THE VIEWER'S OWN ZONE — REPORTED 2026-08-04 ★
   *
   * `date_trunc` on a timestamptz truncates in the SESSION's zone, which is UTC — so a "day" bar
   * was midnight-to-midnight UTC, and every client then labelled that bar in the DEVICE's zone.
   * For anybody west of Greenwich the two disagreed all evening: a delivery at 21:00 their time
   * sat in UTC's next day, drawn under a label naming the previous one. `AT TIME ZONE $3` shifts
   * each delivery to the viewer's wall clock BEFORE truncating, so a member's day bar means the
   * day they actually flew.
   */
  async deliveryChart(projectId: string, tz: string = DEFAULT_TIMEZONE): Promise<DeliveryCharts> {
    /*
     * Refused zones become UTC rather than errors, in two layers. This check catches anything the
     * runtime does not recognise before it can reach SQL; the retry below catches the rarer case
     * of a zone Node knows and this Postgres's older tzdata does not. Either way the member gets
     * a chart — in UTC, honestly captioned as UTC — rather than a 500 for a preference string.
     */
    let zone = isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;

    const span = await this.db.$queryRawUnsafe<Array<{ hours: number | null }>>(
      `SELECT EXTRACT(EPOCH FROM (max(delivered_at) - min(delivered_at))) / 3600 AS hours
         FROM colony_contributions WHERE project_id = $1::uuid`,
      projectId,
    );

    /*
     * Forty-eight hours is the switch. Below it, hourly bars show the shape of a single evening's
     * hauling — which is the thing a member most wants to see. Above it, hourly would be hundreds
     * of bars and the daily rhythm is what matters instead.
     */
    const hours = Number(span[0]?.hours ?? 0);
    const bucket: 'hour' | 'day' = Number.isFinite(hours) && hours > 48 ? 'day' : 'hour';

    /*
     * ★ ONE QUERY, PIVOTED THREE WAYS ★
     *
     * Grouped by time AND commodity AND commander together, because all three views are cuts of
     * the same fact — who put what in, and when. Three separate GROUP BYs would read the ledger
     * three times to produce answers that must agree, and the day they disagree is the day nobody
     * can tell which one is wrong.
     *
     * The row count is bounded by the number of (bucket, commodity, commander) combinations that
     * ACTUALLY occurred, not by their product: a build with twenty commodities and ten haulers
     * over a fortnight is a few hundred rows, because most commanders never touch most commodities
     * on most days.
     */
    /*
     * ★ THE BUCKET LEAVES POSTGRES AS TEXT, ON PURPOSE ★
     *
     * `date_trunc(..., ts AT TIME ZONE zone)` yields a zone-local NAIVE timestamp, and a naive
     * timestamp handed to a Date-typed driver gets reinterpreted as UTC — the exact reparse this
     * fix removes from the clients, reintroduced one layer down. `to_char` freezes the wall time
     * into a string the moment it is correct, and nothing downstream ever parses it again.
     */
    const read = (): Promise<
      Array<{ at: string; commodity: string; commander: string | null; amount: bigint }>
    > =>
      this.db.$queryRawUnsafe(
        `SELECT to_char(date_trunc($2, c.delivered_at AT TIME ZONE $3), 'YYYY-MM-DD"T"HH24:MI') AS at,
                c.commodity,
                u.display_name AS commander,
                SUM(c.amount)::bigint AS amount
           FROM colony_contributions c
           LEFT JOIN users u ON u.id = c.user_id
          WHERE c.project_id = $1::uuid
          GROUP BY 1, 2, 3
          ORDER BY 1`,
        projectId,
        bucket,
        zone,
      );

    let rows: Awaited<ReturnType<typeof read>>;
    try {
      rows = await read();
    } catch (error) {
      // The second layer of the fallback above: Node accepted the zone and Postgres did not.
      if (zone === DEFAULT_TIMEZONE) throw error;
      zone = DEFAULT_TIMEZONE;
      rows = await read();
    }

    /*
     * The axis text, authored where the zone is known. Day buckets go through Intl pinned to UTC —
     * the key is already the viewer's wall time, so UTC here means "format the parts as written",
     * and `en-GB` keeps the label identical to every other date the site renders. Hour buckets are
     * a substring: the key IS the wall clock.
     */
    const dayLabel = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
    });
    const labelOf = (at: string): string =>
      bucket === 'hour' ? `${at.slice(11, 13)}:00` : dayLabel.format(new Date(`${at}:00Z`));

    /** Accumulates a stacked series onto a bucket keyed by time. */
    const stackByTime = (pick: (r: (typeof rows)[number]) => string): DeliveryBucket[] => {
      const map = new Map<
        string,
        { at: string; label: string; bySeries: Record<string, number>; total: number }
      >();
      for (const r of rows) {
        const slice = map.get(r.at) ?? { at: r.at, label: labelOf(r.at), bySeries: {}, total: 0 };
        const amount = Number(r.amount);
        const series = pick(r);
        slice.bySeries[series] = (slice.bySeries[series] ?? 0) + amount;
        slice.total += amount;
        map.set(r.at, slice);
      }
      // `YYYY-MM-DDTHH:MM` sorts lexicographically in time order, which is why the key keeps
      // that shape rather than anything friendlier.
      return [...map.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    };

    /*
     * A member who has left still hauled the cargo. The ledger uses SET NULL, so their rows
     * survive with no user — named rather than dropped, because erasing them would understate the
     * build and leave the chart disagreeing with the total at the top of the page.
     */
    const commanderOf = (r: (typeof rows)[number]): string => r.commander ?? 'A former member';

    const haulers = new Map<string, { byCommodity: Record<string, number>; total: number }>();
    for (const r of rows) {
      const name = commanderOf(r);
      const stack = haulers.get(name) ?? { byCommodity: {}, total: 0 };
      const amount = Number(r.amount);
      stack.byCommodity[r.commodity] = (stack.byCommodity[r.commodity] ?? 0) + amount;
      stack.total += amount;
      haulers.set(name, stack);
    }

    return {
      bucket,
      // The zone the buckets were REALLY cut in — after both fallbacks — so the caption a client
      // prints can never claim a zone the SQL did not use.
      tz: zone,
      byCommodity: stackByTime((r) => r.commodity),
      byCommander: stackByTime(commanderOf),
      // Biggest first. A ranked axis is read top-down and answers "who is carrying this build"
      // before anybody has to compare column heights.
      haulers: [...haulers.entries()]
        .map(([commander, stack]) => ({ commander, ...stack }))
        .sort((a, b) => b.total - a.total),
    };
  }

  /**
   * The zone a member reads times in, for the chart above.
   *
   * ★ ONE INDEXED READ, RESOLVED WHERE THE SESSION IS ★
   *
   * The platform stores every member's timezone precisely so a server can answer "whose evening is
   * this" without trusting a device clock (see common/timezone.ts). Both colony controllers call
   * this rather than each reading `users` themselves — one rule about what an absent or unusable
   * zone means, in the same file as the query that depends on the answer. Guests read UTC, which
   * is also what the column defaults to.
   */
  async viewerTimezone(userId: string | null): Promise<string> {
    if (userId === null) return DEFAULT_TIMEZONE;

    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });

    const tz = user?.timezone ?? DEFAULT_TIMEZONE;
    return isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  }

  /**
   * Where to buy what a project still needs.
   *
   * ★ SQUADRON OWNER, 2026-08-02 ★
   *
   * "Squadron projects also get a shopping list from the Freight Office." This is that: the
   * project's outstanding needs, each answered with the best place to actually buy it.
   *
   * ★ ONE INDEXED LOOKUP PER COMMODITY, NOT A JOIN ★
   *
   * The tempting version joins `colony_needs` against `market_entries` in one statement. It is the
   * same shape as the four-way join that exhausted the disk on 2026-07-31 — `market_entries` has no
   * plain index on `commodity`, so the join degrades to a scan of 18.78 million rows per need.
   *
   * A construction site wants around thirty commodities, and each lookup rides the partial buy
   * index at roughly 8ms. Thirty small queries beat one enormous one, decisively.
   */
  /**
   * ★ COALESCED — THE FIX FOR THE OUTAGE OF 2026-08-06 ★
   *
   * The API log showed NINE requests for the same project inside three hundred milliseconds,
   * sustained, each running the whole list below: sixty to ninety market queries apiece. The
   * companion app retried because the endpoint was slow, and the retries were what kept it slow.
   * Response times went 667ms → 14,646ms and the entire connection pool went to this one route.
   *
   * A plain cache would not have stopped it — nine simultaneous misses are nine computations, and
   * in a stampede everybody arrives during the first one. Coalescing is the property that matters:
   * the first caller computes and the other eight wait on the same promise.
   *
   * The key names everything that changes the answer. Sharing a key between two different
   * questions would return one project's shopping list for another, which is far worse than being
   * slow — see the test that pins it.
   */
  async shoppingList(
    projectId: string,
    opts: {
      near: { x: number; y: number; z: number } | null;
      withinLy: number;
      largePadOnly: boolean;
      sort?: 'local' | 'cheapest' | 'closest';
      carrierCover?: Readonly<Record<string, number>>;
    },
  ): Promise<readonly ShoppingRow[]> {
    const key = JSON.stringify([
      projectId,
      opts.near === null ? null : [opts.near.x, opts.near.y, opts.near.z],
      opts.withinLy,
      opts.largePadOnly,
      opts.sort ?? 'local',
      // Sorted, so two equal covers that were built in a different order share one entry rather
      // than computing the same answer twice under two spellings of the same key.
      Object.entries(opts.carrierCover ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ]);

    /*
     * Coalescer OUTSIDE the bulkhead, deliberately.
     *
     * The nine callers of one stampede should join a single flight and then occupy ONE permit
     * between them — not nine. Reversed, the bulkhead would refuse eight callers who were about to
     * share an answer that was already being computed, which is a refusal that buys nothing.
     */
    return ColonyService.shoppingFlight.run(key, SHOPPING_LIST_TTL_MS, () =>
      ColonyService.shoppingBulkhead.run(() => this.#computeShoppingList(projectId, opts)),
    );
  }

  async #computeShoppingList(
    projectId: string,
    opts: {
      near: { x: number; y: number; z: number } | null;
      withinLy: number;
      largePadOnly: boolean;
      /**
       * ★ SQUADRON OWNER, 2026-08-02 ★
       *
       * "the where to buy it, is wrong! there is a station in system that offers most of this, this
       * must offer a toggle for the Where to buy it that gives locations that are closest, and an
       * option with locations that are cheapest."
       *
       * They are genuinely different answers and neither is always right. A station in the build's
       * own system at a poor price beats one forty jumps away at a good one, right up until the
       * tonnage is large enough that the price difference outweighs the trips. Only the member
       * knows which they are doing, so it is a toggle rather than a cleverer default.
       */
      sort?: 'local' | 'cheapest' | 'closest';
      /**
       * Effective tonnes per commodity already aboard the build's attached carriers — the merge of
       * manual, journal and mirror the carrier service computes. Passed in rather than fetched
       * here, because the controller already holds the carriers for the same page.
       */
      carrierCover?: Readonly<Record<string, number>>;
    },
  ): Promise<readonly ShoppingRow[]> {
    const needs = await this.needs(projectId);
    const now = Date.now();
    const cover = opts.carrierCover ?? {};

    const query: Omit<PlaceQuery, 'near'> = {
      limit: 1,
      // Carriers off. A shopping list is a plan for a trip, and a carrier that has jumped away by
      // the time somebody flies there is the worst possible entry on one.
      excludeCarriers: true,
      largePadOnly: opts.largePadOnly,
      seenSince: null,
      withinLy: opts.withinLy,
      minQuantity: 1,
    };

    /*
     * ★ SEVERAL COMMODITIES AT ONCE, BUT NOT ALL OF THEM — MEASURED 2026-08-06 ★
     *
     * This loop used to await each commodity's pair of queries before starting the next. Thirty
     * lookups at a real origin measured 5.8 SECONDS of database time on production, almost all of
     * it spent waiting out network hops in single file. A 25-commodity build is fifty round trips
     * one after another.
     *
     * The obvious fix — Promise.all over every need — would have been the next outage. The
     * connection pool is twenty-five and `shoppingBulkhead` already permits SIX concurrent shopping
     * lists, so unbounded fan-out is six lists times fifty queries against a pool of twenty-five.
     * The list that caused the incident would have caused the next one.
     *
     * Four at a time, each still issuing its own pair, so at most eight queries are in flight per
     * list and six lists stay under the pool with room for everything else the API is doing.
     *
     * Nothing else changes: not one query, not the ranking, not the fallbacks. The shopping list
     * has correctness history — "always prioritize local markets before sending out of system" was
     * a real bug — and only the waiting is being removed.
     */
    const SHOPPING_CONCURRENCY = 4;

    const priceOne = async (need: (typeof needs)[number]): Promise<ShoppingRow | null> => {
      // Settled lines are dropped rather than shown at zero: a shopping list is what to go and buy.
      if (need.remaining <= 0) return null;

      /*
       * ★ WHAT THE CARRIERS ALREADY HOLD IS NOT SOMETHING TO BUY ★
       *
       * The old list quoted the full outstanding tonnage with a footnote saying carriers exist. So
       * the quantity every quote below uses is what is left AFTER the attached holds: capped at the
       * remaining need (a carrier holding more than the build wants covers it, not more than it),
       * and a fully covered line skips the market entirely — quoting a station for cargo the
       * squadron already owns is exactly the trip this exists to prevent.
       */
      const onCarriers = Math.min(
        need.remaining,
        Math.max(0, Math.trunc(Number(cover[need.commodity] ?? 0))),
      );
      const toBuy = need.remaining - onCarriers;

      if (toBuy <= 0) {
        /*
         * Returned BEFORE any market call, exactly as before. Concurrency makes it tempting to
         * hoist the lookups above this check for tidiness; that would quote stations for cargo the
         * squadron already owns, which is the trip the carrier cover exists to prevent.
         */
        return {
          commodity: need.commodity,
          remaining: need.remaining,
          required: need.required,
          onCarriers,
          toBuy: 0,
          stationName: null,
          systemName: null,
          price: null,
          supply: null,
          distance: null,
          seenAt: null,
          nearestOutOfRange: null,
          // Zero, not null: null means "nowhere sells it", and this line needs nothing bought.
          cost: 0,
        };
      }

      /*
       * ★ TWO CANDIDATE SETS, AND THE REASON IS A REAL BUG — SQUADRON OWNER, 2026-08-02 ★
       *
       * "the Where to buy page is sending to to really odd places, we know we can get everything
       * except CMM Composite from a station pretty close to the construction site, this is telling
       * us to leave the system! ... always prioritize local markets before sending out of system!"
       *
       * They were right, and the data was never the problem: the station in their own system had
       * 374,554 steel, 355,793 titanium, 221,834 aluminium and 207,220 litres of oxygen on the
       * shelf. The problem was that this fetched the twelve CHEAPEST rows and then re-sorted them.
       * A re-sort can only reorder answers it was already given, and an in-system starport charging
       * 3,456 for steel is never among the twelve cheapest when distant ones charge less. The local
       * option was invisible to the ranking that was supposed to prefer it.
       *
       * So both are asked for: the cheapest few AND the nearest few, merged. Two indexed queries
       * per commodity instead of one — the partial index answers the first, the cube GiST answers
       * the second — and the local station is now always a candidate.
       */
      const [cheapest, nearest] = await Promise.all([
        this.market
          .bestBuys(need.commodity, { ...query, limit: 8, near: opts.near, order: 'price' })
          .catch(() => []),
        opts.near === null
          ? Promise.resolve([])
          : this.market
              .bestBuys(need.commodity, { ...query, limit: 8, near: opts.near, order: 'distance' })
              .catch(() => []),
      ]);

      const seen = new Set<string>();
      const candidates = [...cheapest, ...nearest].filter((p) => {
        const key = `${p.systemName}\u0000${p.stationName}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // One clock for the whole list. Reading it per row would let two commodities land in
      // different bands mid-loop, which is a reordering nobody could reproduce.
      const place = rankPlaces(candidates, opts.sort ?? 'local', now)[0];

      /*
       * ★ WHEN NOTHING IS IN RANGE, SAY WHERE IT IS ANYWAY ★
       *
       * Only reached when the radius search found nothing, so it costs one extra query on the lines
       * that would otherwise have been a dead end — and none at all on a shopping list that is
       * fully sourced.
       *
       * `withinLy` is deliberately enormous rather than absent: the query needs a radius to use the
       * cube index at all, and 20,000 light years reaches the far side of anything a squadron will
       * ever colonise while still being a bounded search.
       */
      const nearestOutOfRange =
        place !== undefined || opts.near === null
          ? null
          : ((
              await this.market
                .bestBuys(need.commodity, {
                  ...query,
                  limit: 1,
                  near: opts.near,
                  withinLy: 20_000,
                  order: 'distance',
                })
                .catch(() => [])
            )[0] ?? null);

      return {
        commodity: need.commodity,
        remaining: need.remaining,
        required: need.required,
        onCarriers,
        toBuy,
        stationName: place?.stationName ?? null,
        systemName: place?.systemName ?? null,
        price: place?.price ?? null,
        supply: place?.quantity ?? null,
        distance: place?.distance ?? null,
        seenAt: place?.seenAt ?? null,
        nearestOutOfRange:
          nearestOutOfRange === null
            ? null
            : {
                stationName: nearestOutOfRange.stationName,
                systemName: nearestOutOfRange.systemName,
                price: nearestOutOfRange.price,
                supply: nearestOutOfRange.quantity,
                distance: nearestOutOfRange.distance,
                seenAt: nearestOutOfRange.seenAt,
              },
        /*
         * The tonnage that still needs BUYING at that price — after the carriers — not what is on
         * that station's shelf. It answers "what will finishing this cost me", and a member can
         * see the supply column and work out how many trips.
         */
        cost: place === undefined ? null : place.price * toBuy,
      };
    };

    /*
     * Windowed rather than Promise.all, and the ORDER of the output is preserved because each
     * window writes into the array it was sliced from. A shopping list whose rows do not line up
     * with its needs would quote the wrong station for the wrong commodity, and nothing on the page
     * would look wrong.
     */
    const out: ShoppingRow[] = [];
    for (let i = 0; i < needs.length; i += SHOPPING_CONCURRENCY) {
      const window = await Promise.all(needs.slice(i, i + SHOPPING_CONCURRENCY).map(priceOne));
      for (const row of window) if (row !== null) out.push(row);
    }

    return out;
  }

  /** Posts a project. `owner` is checked by the controller against COLONY_POST / COLONY_MANAGE. */
  async create(input: {
    userId: string;
    owner: ColonyOwner;
    marketId: bigint;
    systemName: string;
    stationName: string | null;
    title: string;
    notes: string | null;
    /**
     * What the poster could already see, from the depot they are standing on.
     *
     * ★ SQUADRON OWNER, 2026-08-02 ★
     *
     * "if we can see the historical data on all materials that have been delivered, can we please
     * include that when we create the new project, so we have full data visibilty."
     *
     * Optional, and never trusted as authority: the very next sync REPLACES these rows wholesale
     * from the newest journal reading. It exists so a project does not sit on the board saying
     * "waiting for somebody to dock there" while the person who posted it is standing on the pad.
     */
    snapshot?: OpeningSnapshot | null;
  }): Promise<{ id: string }> {
    const title = input.title.trim();
    if (title === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Give the project a name.');
    }

    /*
     * ★ THE GAME'S WORD FOR THE PLACE, NOT THE PLAYER'S — 2026-08-09 ★
     *
     * A member's project showed its location as `$EXT_PANEL_ColonisationShip; Mitra Horizons`. That
     * prefix is Elite's localisation key for "System Colonisation Ship": the client looks it up in
     * its language files, and anything reading the journal directly gets the key instead.
     *
     * Cleaned here rather than in the page, because BOTH doors into a project come through this
     * method — the website's and the companion's — and every surface downstream (the planner, the
     * shopping list, the assistant, the app) reads what this writes.
     */
    const stationName = cleanStationName(input.stationName);
    if (input.systemName.trim() === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Name the system the site is in.');
    }

    /*
     * ★ A SECOND POST OF THE SAME SITE IS THE SAME BUILD ★
     *
     * The unique index on `market_id` would raise, and the raw error is opaque. Answered plainly
     * instead, because the member has not done anything wrong: somebody else got there first, and
     * what they want is the existing project.
     */
    const existing = await this.acl
      .forSystem('checking whether a construction site is already posted, before creating it')
      .colonyProject.findFirst({
        where: { marketId: input.marketId },
        select: { id: true, title: true },
      });
    if (existing !== null) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `That construction site is already posted as “${existing.title}”.`,
      );
    }

    // `forCaller` resolves the caller's visible-id sets, so it is async. `forSystem` is not.
    const asMe = await this.acl.forCaller(input.userId);

    const created = await asMe.colonyProject.create({
      data: {
        owner: input.owner,
        postedById: input.userId,
        marketId: input.marketId,
        systemName: input.systemName.trim(),
        stationName: stationName?.trim() === '' ? null : stationName,
        title,
        notes: input.notes?.trim() === '' ? null : input.notes,
      },
      select: { id: true },
    });

    /*
     * Written after the project, and deliberately not inside a transaction with it.
     *
     * A snapshot that fails to write costs a member the wait until the next sync — fifteen minutes,
     * and self-correcting. Rolling back a project they successfully posted because an optional
     * convenience failed would cost them the project, and they would post it again and be told it
     * already exists.
     */
    if (input.snapshot != null) {
      await this.#writeSnapshot(created.id, input.snapshot).catch(() => undefined);
    }

    /*
     * ★ THE SQUADRON HEARS ABOUT A NEW BUILD, ONCE, FROM THE CREATE ★
     *
     * A project is created `squadron`-visible (the schema default), so the feed entry shows the
     * feed's readers something they could already open. `notifySquadron` swallows its own
     * failures — the project exists by now, and a bell must not un-post it.
     */
    await notifySquadron(
      this.db,
      {
        kind: 'colony.project-started',
        title: `${title} — new colonisation project`,
        body:
          stationName === null || stationName.trim() === ''
            ? input.systemName.trim()
            : `${stationName.trim()}, ${input.systemName.trim()}`,
        link: `/colonisation/${created.id}`,
        actorUserId: input.userId,
      },
      this.nudge,
    );

    /*
     * ★ SQUADRON PROJECTS ANNOUNCE TO DISCORD — SQUADRON OWNER, 2026-08-05 ★
     *
     * "when a new squadron colonization project is created, can we send a notification to this
     * discord channel please ... with a link to the project on the website ... include the name of
     * the commander who started the squadron project"
     *
     * ★ AND MEMBERS' OWN BUILDS TOO — SQUADRON OWNER, 2026-08-05 ★
     *
     * "can we also announce player owned colonization projects in the same channel the same way we
     * do the squadron owned colonization projects?"
     *
     * This was squadron-only, on the reasoning that a personal build is one member's and putting it
     * in a squadron channel would read as a call to arms nobody issued. The owner's answer is that
     * a member posting a build is exactly when they would like some help with it — the channel is
     * where haulers look, and a project nobody hears about gets hauled by nobody.
     *
     * The wording distinguishes them, so the reader still knows whose it is and the squadron's own
     * efforts are not diluted into a list of everybody's side projects.
     *
     * PRIVATE builds stay silent. A member who set their project to private has said who may see
     * it, and a channel post would hand it to everybody — announcing something the visibility
     * setting exists to prevent.
     *
     * Fire-and-forget, like the squadron notice above it: the project is created by the time this
     * runs, and no announcement is worth failing a creation over.
     */
    void announceColonyProject(this.db, created.id, siteUrl()).catch(() => undefined);

    return created;
  }

  async #writeSnapshot(projectId: string, snapshot: OpeningSnapshot): Promise<void> {
    const observedAt = new Date();

    const needs = snapshot.resources
      .filter((r) => typeof r.commodity === 'string' && r.commodity.trim() !== '')
      .map((r) => ({
        projectId,
        commodity: r.commodity.trim(),
        // Floored at zero, like the sync's own rule: an over-delivered site reports a negative
        // remainder, and "-40 tonnes still needed" on a progress bar is worse than saying nothing.
        remaining: Math.max(0, Math.trunc(r.required) - Math.trunc(r.provided)),
        required: Math.trunc(r.required),
        observedAt,
      }))
      .filter((n) => Number.isFinite(n.required) && n.required >= 0);

    if (needs.length === 0) return;

    // `skipDuplicates`, because the sync job may already have run between the project being created
    // and this landing. Whichever wrote first is equally correct — both are the same depot reading.
    await this.db.colonyNeed.createMany({ data: needs, skipDuplicates: true });
  }

  /**
   * Changes who may see a project.
   *
   * ★ ONLY A PERSONAL PROJECT MAY BE PUBLISHED — SQUADRON OWNER, 2026-08-02 ★
   *
   * "Squadron projects members-only, personal projects publishable by choice." Enforced HERE rather
   * than in the ACL, which is the correct division: the ACL's job is to honour whatever value is in
   * the column, and having it quietly disagree with a stored value would hide this bug rather than
   * prevent it.
   */
  async setVisibility(input: {
    projectId: string;
    userId: string;
    visibility: ColonyVisibility;
    mayPublish: boolean;
  }): Promise<{ shareToken: string | null }> {
    const db = await this.acl.forCaller(input.userId);

    const project = await db.colonyProject.findFirst({
      where: { id: input.projectId },
      select: { owner: true, postedById: true, shareToken: true },
    });

    if (project === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That project is not available.');
    }
    if (project.postedById !== input.userId) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'That is not your project.');
    }
    if (input.visibility === 'public') {
      if (project.owner === 'squadron') {
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          'Squadron projects stay inside the squadron. Only a personal project can be published.',
        );
      }
      if (!input.mayPublish) {
        throw new AppError(
          ErrorCode.PERMISSION_DENIED,
          'You do not have permission to publish a project publicly.',
        );
      }
    }

    /*
     * The token is minted once and KEPT when a project goes private and public again. Rotating it
     * would break every link already shared with somebody who was legitimately given it — and
     * "unpublish" already revokes access, because `byToken` requires `visibility = 'public'`.
     */
    const shareToken =
      input.visibility === 'public'
        ? (project.shareToken ?? randomBytes(16).toString('base64url'))
        : project.shareToken;

    await db.colonyProject.update({
      where: { id: input.projectId },
      data: { visibility: input.visibility, shareToken },
    });

    return { shareToken: input.visibility === 'public' ? shareToken : null };
  }

  /**
   * Whose build this is, for anything that changes it.
   *
   * ★ THE SAME RULE THE ROSTER USES, AND IT HAS TO STAY THE SAME ★
   *
   * A squadron project is the squadron's effort, so directing it is an officer's call. A personal
   * project belongs to whoever posted it, and nobody else decides its fate — not even an officer,
   * because it is not the squadron's build.
   */
  async #mayDirect(projectId: string, callerId: string, mask: bigint): Promise<void> {
    const db = this.acl.forSystem('checking who may change a colonisation project');
    const project = await db.colonyProject.findFirst({
      where: { id: projectId },
      select: { owner: true, postedById: true },
    });

    if (project === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That project is not available.');
    }

    const may =
      project.owner === 'squadron'
        ? (mask & Permission.COLONY_MANAGE) === Permission.COLONY_MANAGE
        : project.postedById === callerId;

    if (!may) {
      throw new AppError(
        ErrorCode.PERMISSION_DENIED,
        project.owner === 'squadron'
          ? 'Only officers can change a squadron project.'
          : 'Only the member who posted this project can change it.',
      );
    }
  }

  /**
   * Closes a build by hand.
   *
   * ★ SOMETHING HAS TO BE ABLE TO END A PROJECT THAT NOBODY VISITS AGAIN ★
   *
   * Until now only the journal could: a `ConstructionComplete` or `ConstructionFailed` on a depot
   * reading. That covers a build somebody finished and nothing else. An abandoned site, a project
   * posted against the wrong market id, a system the squadron walked away from — all of them read
   * "Live" for ever and sit at the top of a board offering work nobody is doing.
   *
   * The ledger is untouched. Closing says the effort is over; it says nothing about the cargo that
   * was genuinely hauled, and erasing that would understate what people did.
   */
  async close(projectId: string, callerId: string, mask: bigint, at = new Date()): Promise<void> {
    await this.#mayDirect(projectId, callerId, mask);

    /*
     * The SAME transition the sync's depot-flag and 100% paths use, so all four ways a build can
     * end announce it from one place — and announce it once, because the guarded update inside
     * only moves a row whose completedAt is still null. Closing an already-closed project stays
     * a quiet no-op, exactly as the plain update before it was.
     */
    await completeColonyProject(this.db, projectId, at, this.nudge);
  }

  /** Puts a closed project back on the board — for one closed by mistake. */
  async reopen(projectId: string, callerId: string, mask: bigint): Promise<void> {
    await this.#mayDirect(projectId, callerId, mask);

    const db = this.acl.forSystem('reopening a colonisation project');
    await db.colonyProject.update({ where: { id: projectId }, data: { completedAt: null } });
  }

  /**
   * Deletes a project outright.
   *
   * ★ REFUSED ONCE ANYBODY HAS HAULED TO IT, AND THAT IS DELIBERATE ★
   *
   * The point of delete is the project posted against a mistyped market id — one that will never
   * receive a depot reading and can only be fixed in SQL today. That project has no ledger.
   *
   * A project WITH a ledger is different in kind: the rows are a record of what real people
   * actually carried, and `onDelete: Cascade` would take them with it. Somebody tidying a board
   * would silently erase a fortnight of other members' contributions. So it refuses and names the
   * alternative, rather than asking for a confirmation nobody reads.
   */
  async remove(projectId: string, callerId: string, mask: bigint): Promise<void> {
    await this.#mayDirect(projectId, callerId, mask);

    const [ledger] = await this.db.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM colony_contributions WHERE project_id = $1::uuid`,
      projectId,
    );

    if (Number(ledger?.n ?? 0) > 0) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'People have already hauled to this build, and deleting it would erase their deliveries. Close it instead.',
      );
    }

    const db = this.acl.forSystem('deleting a colonisation project');
    await db.colonyProject.delete({ where: { id: projectId } });
  }

  /**
   * Handing a personal project to the squadron, or handing it back.
   *
   * ★ SQUADRON OWNER, 2026-08-05 ★
   *
   * "give admins the option after the fact to turn a project into a squadron project"
   *
   * `owner` was decided once, at creation, by whoever posted it — and nothing anywhere could
   * change it afterwards. A member who started a build that the squadron then rallied behind had
   * no way to make that official, and an officer had no way to adopt it: the project could never
   * be marked as the current effort, because priority is squadron-only.
   *
   * ★ OFFICERS ONLY, IN BOTH DIRECTIONS ★
   *
   * Adopting a build commits the squadron's playing time, which is not the poster's to commit.
   * Releasing one back is the same decision reversed and belongs to the same people — and a member
   * who could hand their own project to the squadron could also point the whole roster at it,
   * which is precisely what `setPriority` refuses to let them do.
   *
   * ★ WHAT MOVES WITH IT, AND WHAT DOES NOT ★
   *
   * `postedById` is left exactly as it is. It records who FOUND the site and it is shown on the
   * page; rewriting history so the squadron appears to have posted it would erase a member's
   * credit for the one thing they definitely did.
   *
   * Going back to personal clears `isPriority`, because a personal project cannot be the
   * squadron's current effort — leaving the flag set would put a badge on the board that
   * `setPriority` itself would refuse to have put there.
   */
  async setOwner(
    projectId: string,
    owner: ColonyOwner,
    actorId: string,
  ): Promise<{ owner: ColonyOwner }> {
    /*
     * forSystem, and narrow: the caller has already been checked for COLONY_MANAGE, and an officer
     * adopting a build must be able to reach it whoever posted it. Binding to the caller would
     * silently refuse on somebody else's private project — exactly the row this exists to act on.
     */
    const db = this.acl.forSystem('an officer changing who owns a colonisation project');

    const project = await db.colonyProject.findFirst({
      where: { id: projectId },
      select: { owner: true, title: true, systemName: true, stationName: true },
    });
    if (project === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That project is not available.');
    }

    // Already there. A no-op rather than an error: two officers pressing the same button is not a
    // mistake either of them made.
    if (project.owner === owner) return { owner };

    await db.colonyProject.update({
      where: { id: projectId },
      data: {
        owner,
        ...(owner === 'personal' ? { isPriority: false } : {}),
      },
    });

    /*
     * An adoption is a new squadron project as far as the colonisation channel is concerned — the
     * owner approved announcing both, because otherwise the channel misses every build that became
     * the squadron's effort rather than starting as one. Handing one BACK is not announced: that is
     * an officer tidying up, not a call to haul.
     */
    if (owner === 'squadron') {
      void announceColonyProject(this.db, projectId, siteUrl(), actorId).catch(() => undefined);
    }

    await db.auditLog.create({
      data: {
        actorType: 'user',
        actorId,
        action: 'colony.project.owner',
        targetType: 'colony_project',
        targetId: projectId,
        before: { owner: project.owner },
        after: {
          owner,
          title: project.title,
          systemName: project.systemName,
          stationName: project.stationName,
        },
      },
    }).catch(() => undefined);

    return { owner };
  }

  /** Marks a squadron project as the current effort, or stops doing so. Requires COLONY_MANAGE. */
  async setPriority(projectId: string, isPriority: boolean, actorId?: string): Promise<void> {
    /*
     * forSystem, and it is narrow: the caller has already been checked for COLONY_MANAGE, and an
     * officer setting the squadron's effort must be able to reach a project regardless of whose it
     * is. Binding to the caller would silently refuse on somebody else's private project — which is
     * exactly the row an officer is most likely to be acting on.
     */
    const db = this.acl.forSystem('an officer setting the squadron colonisation effort');

    const project = await db.colonyProject.findFirst({
      where: { id: projectId },
      select: { owner: true, isPriority: true, title: true, systemName: true, stationName: true },
    });
    if (project === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That project is not available.');
    }
    /*
     * Priority is a claim on the whole squadron's playing time, so it only means anything on a
     * squadron project. Allowing it on a personal one would let an officer point everybody at one
     * member's own build without that ever having been a decision anybody made.
     */
    if (project.owner !== 'squadron') {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Only a squadron project can be the squadron’s current effort.',
      );
    }

    await db.colonyProject.update({ where: { id: projectId }, data: { isPriority } });

    /*
     * ★ ANNOUNCED ONLY ON THE OFF→ON TRANSITION ★
     *
     * Turning priority ON is the squadron being pointed at a build, which is news. Re-pressing
     * the switch on an already-priority project changes nothing anybody needs to hear about, and
     * turning it OFF is bookkeeping — the feed says where to haul, not where to stop.
     */
    if (isPriority && !project.isPriority) {
      await notifySquadron(
        this.db,
        {
          kind: 'colony.priority',
          title: `${project.title} is the squadron’s current effort`,
          body:
            project.stationName === null || project.stationName === ''
              ? `Deliveries to ${project.systemName} count double on the colonisation board.`
              : `Deliveries to ${project.stationName}, ${project.systemName} count double on the colonisation board.`,
          link: `/colonisation/${projectId}`,
          ...(actorId === undefined ? {} : { actorUserId: actorId }),
        },
        this.nudge,
      );
    }
  }
}
