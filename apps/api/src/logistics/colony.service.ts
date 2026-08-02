import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@grims/db';
import { AppError, ErrorCode } from '@grims/shared';
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
  readonly buildType: string | null;
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
              p.notes, p.visibility::text AS visibility, p.share_token, p.is_priority,
              p.completed_at, p.posted_by_id, p.updated_at,
              u.display_name AS posted_by,
              COALESCE(SUM(n.remaining), 0)::bigint AS remaining,
              COALESCE(SUM(n.required), 0)::bigint  AS required,
              COUNT(n.commodity)::int               AS need_count
         FROM colony_projects p
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
              p.notes, p.visibility::text AS visibility, p.share_token, p.is_priority,
              p.completed_at, p.posted_by_id, p.updated_at,
              u.display_name AS posted_by,
              COALESCE(SUM(n.remaining), 0)::bigint AS remaining,
              COALESCE(SUM(n.required), 0)::bigint  AS required,
              COUNT(n.commodity)::int               AS need_count
         FROM colony_projects p
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
      select: { commodity: true, remaining: true, required: true },
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
    opts: { near: { x: number; y: number; z: number } | null; withinLy: number; largePadOnly: boolean },
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

      const best = await this.market
        .bestBuys(need.commodity, { ...query, near: opts.near })
        .catch(() => []);

      const place = best[0];

      out.push({
        commodity: need.commodity,
        remaining: need.remaining,
        stationName: place?.stationName ?? null,
        systemName: place?.systemName ?? null,
        price: place?.price ?? null,
        supply: place?.quantity ?? null,
        distance: place?.distance ?? null,
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

    return created;
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
