import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@grims/db';
import { AppError, ErrorCode, Permission } from '@grims/shared';
import type { AclDbService } from '../authz/acl-db.service.js';
import type { MarketStore, PlaceQuery } from './market.store.js';

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
 */
export interface DeliveryBucket {
  readonly at: Date;
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
  readonly stationName: string | null;
  readonly systemName: string | null;
  readonly price: number | null;
  readonly supply: number | null;
  readonly distance: number | null;
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

/** Orders candidate stations by what the member asked for. */
function rankPlaces<T extends { readonly distance: number | null; readonly price: number }>(
  places: readonly T[],
  sort: 'local' | 'cheapest' | 'closest',
): readonly T[] {
  const by = [...places];

  if (sort === 'cheapest') {
    return by.sort((a, b) => a.price - b.price || (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }
  if (sort === 'closest') {
    return by.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.price - b.price);
  }

  // 'local' — the default, and the one the owner asked for.
  return by.sort(
    (a, b) =>
      distanceBand(a.distance) - distanceBand(b.distance) ||
      a.price - b.price ||
      (a.distance ?? Infinity) - (b.distance ?? Infinity),
  );
}

export class ColonyService {
  constructor(
    private readonly db: PrismaClient,
    private readonly market: MarketStore,
    private readonly acl: AclDbService,
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
              COUNT(n.commodity)::int               AS need_count
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
        GROUP BY p.id, u.display_name
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
              COUNT(n.commodity)::int               AS need_count
         FROM colony_projects p
         LEFT JOIN colony_build_types bt ON bt.id = p.build_type_id
         JOIN users u ON u.id = p.posted_by_id
         LEFT JOIN colony_needs n ON n.project_id = p.id
        -- The visibility test as well as the token: revoking a share must actually revoke it, and a
        -- token that still worked after the member set the project back to private would be a link
        -- they believed they had taken back.
        WHERE p.share_token = $1 AND p.visibility = 'public'
        GROUP BY p.id, u.display_name`,
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
   */
  async deliveryChart(projectId: string): Promise<DeliveryCharts> {
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
    const rows = await this.db.$queryRawUnsafe<
      Array<{ at: Date; commodity: string; commander: string | null; amount: bigint }>
    >(
      `SELECT date_trunc($2, c.delivered_at) AS at,
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
    );

    /** Accumulates a stacked series onto a bucket keyed by time. */
    const stackByTime = (pick: (r: (typeof rows)[number]) => string): DeliveryBucket[] => {
      const map = new Map<number, { at: Date; bySeries: Record<string, number>; total: number }>();
      for (const r of rows) {
        const key = r.at.getTime();
        const slice = map.get(key) ?? { at: r.at, bySeries: {}, total: 0 };
        const amount = Number(r.amount);
        const series = pick(r);
        slice.bySeries[series] = (slice.bySeries[series] ?? 0) + amount;
        slice.total += amount;
        map.set(key, slice);
      }
      return [...map.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
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
  async shoppingList(
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
    },
  ): Promise<readonly ShoppingRow[]> {
    const needs = await this.needs(projectId);

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

    const out: ShoppingRow[] = [];

    for (const need of needs) {
      // Settled lines are dropped rather than shown at zero: a shopping list is what to go and buy.
      if (need.remaining <= 0) continue;

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

      const place = rankPlaces(candidates, opts.sort ?? 'local')[0];

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

      out.push({
        commodity: need.commodity,
        remaining: need.remaining,
        stationName: place?.stationName ?? null,
        systemName: place?.systemName ?? null,
        price: place?.price ?? null,
        supply: place?.quantity ?? null,
        distance: place?.distance ?? null,
        nearestOutOfRange:
          nearestOutOfRange === null
            ? null
            : {
                stationName: nearestOutOfRange.stationName,
                systemName: nearestOutOfRange.systemName,
                price: nearestOutOfRange.price,
                supply: nearestOutOfRange.quantity,
                distance: nearestOutOfRange.distance,
              },
        /*
         * The whole outstanding tonnage at that price, not what is on that station's shelf. It
         * answers "what will finishing this cost me", which is the question — and a member reading
         * it can see the supply column and work out how many trips.
         */
        cost: place === undefined ? null : place.price * need.remaining,
      });
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
        stationName: input.stationName?.trim() === '' ? null : input.stationName,
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

    const db = this.acl.forSystem('closing a colonisation project');
    await db.colonyProject.update({
      where: { id: projectId },
      // Priority cleared with it: a finished build must not keep pointing the squadron at itself.
      data: { completedAt: at, isPriority: false },
    });
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

  /** Marks a squadron project as the current effort, or stops doing so. Requires COLONY_MANAGE. */
  async setPriority(projectId: string, isPriority: boolean): Promise<void> {
    /*
     * forSystem, and it is narrow: the caller has already been checked for COLONY_MANAGE, and an
     * officer setting the squadron's effort must be able to reach a project regardless of whose it
     * is. Binding to the caller would silently refuse on somebody else's private project — which is
     * exactly the row an officer is most likely to be acting on.
     */
    const db = this.acl.forSystem('an officer setting the squadron colonisation effort');

    const project = await db.colonyProject.findFirst({
      where: { id: projectId },
      select: { owner: true },
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
  }
}
