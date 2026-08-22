import type { PrismaClient } from '@grims/db';
import {
  AppError,
  ErrorCode,
  Permission,
  predictMarket,
  resolveEconomies,
  simulatePlan,
  suggestBuildOrder,
  type EconBuildType,
  type EconomyResult,
  type OrderSuggestion,
  type PredictedMarket,
  type SimBuildType,
  type SimResult,
  orphanFlags,
  profileSystem,
  renderBuildBook,
  scoreRoles,
  type BookAdvice,
} from '@grims/shared';
import { fetchSystemBodies, type EdsmSystemBodies } from '@grims/ed-clients';
import {
  selfSufficiency,
  systemTrade,
  type SelfSufficiency,
  type SystemTrade,
} from '@grims/shared';

/**
 * Planning a whole system before any of it is built.
 *
 * ★ SQUADRON OWNER, 2026-08-03 ★
 *
 * "ideally what we would like is the same interface that raven gives us, a layout of the system,
 * with spots on each planet that we can settle etc ... add a new page to colonization called
 * Planning."
 *
 * ★ A PLAN IS NOT A PROJECT ★
 *
 * A project tracks one construction site that already exists in the game and is fed by the journal.
 * A plan is the shape of a system somebody INTENDS to build — thirty sites across a dozen bodies,
 * ordered, costed, and argued over on Discord long before the first beacon drops. Nothing in the
 * journal knows about it, because none of it exists yet.
 *
 * ★ PERMISSIONS REUSE THE PROJECT RULES DELIBERATELY ★
 *
 * Read is COLONY_VIEW, creating is COLONY_POST, and directing the squadron's is COLONY_MANAGE — the
 * same three bits, with the same "whose build is it" rule. A fourth permission for planning would
 * be a new bit, a migration to grant it, and a fresh thing for an officer to get wrong, to express
 * a distinction nobody has asked for.
 */

export interface PlanBody {
  readonly bodyId: number;
  readonly name: string;
  readonly kind: string;
  readonly subType: string | null;
  readonly isLandable: boolean;
  readonly gravity: number | null;
  readonly temperature: number | null;
  readonly distanceLs: number | null;
  readonly hasRings: boolean;
  readonly terraformable: boolean;
  readonly hasVolcanism: boolean;
  readonly hasAtmosphere: boolean;
  readonly parentBodyId: number | null;
  /** Read off the in-game architect view. Null until somebody has looked. */
  readonly orbitalSlots: number | null;
  readonly surfaceSlots: number | null;
  readonly slotsBy: string | null;
}

export interface PlanSite {
  readonly id: string;
  readonly bodyId: number | null;
  readonly location: 'orbital' | 'surface';
  readonly buildTypeId: string | null;
  readonly buildTypeName: string | null;
  readonly tier: number | null;
  readonly totalTonnes: number | null;
  readonly economyInfluence: string | null;
  readonly position: number;
  readonly isPrimary: boolean;
  readonly projectId: string | null;
  /**
   * What this row asked for before the plan was corrected, and when.
   *
   * ★ SQUADRON OWNER: AUTO-CORRECT, AND SAY SO ★
   *
   * A site linked to a project that names a different structure is a plan that was wrong: the
   * project's build type came from the game, the plan's was an intention. The worker corrects it
   * automatically — but an automatic edit to somebody's plan that leaves no trace is
   * indistinguishable from the plan having been wrong all along. They would find a structure they
   * never chose and no way to tell whether the platform decided that or they misremembered.
   *
   * Both null for the ordinary row, which is most of them.
   */
  readonly correctedFrom: string | null;
  readonly correctedFromName: string | null;
  readonly correctedAt: string | null;
  /**
   * What the project this site became actually reports.
   *
   * ★ THE PLAN'S FIGURE IS AN ESTIMATE; THIS ONE IS MEASURED ★
   *
   * `totalTonnes` above is what the catalogue says a build of this kind costs. This is what the
   * site itself asked for, read off a commander's journal when they docked there. Null until the
   * site has been placed and posted, which is the normal state of most of a plan.
   *
   * `required` can be zero on a posted project nobody has docked at yet — a different thing from a
   * site that wants nothing, and the reason `siteProgress` falls back to the catalogue there.
   */
  readonly project: {
    readonly required: number;
    readonly remaining: number;
    readonly completedAt: Date | null;
  } | null;
}

export interface PlanDetail {
  readonly id: string;
  readonly owner: 'squadron' | 'personal';
  readonly title: string;
  readonly systemName: string;
  readonly systemId64: string | null;
  readonly notes: string | null;
  readonly version: number;
  readonly postedBy: string | null;
  readonly postedById: string;
  readonly updatedAt: Date;
  readonly bodies: readonly PlanBody[];
  /** When EDSM was last asked. A body list nobody can date is one nobody can trust. */
  readonly bodiesFetchedAt: Date | null;
  readonly sites: readonly PlanSite[];

  /**
   * Whether the plan can actually be built, in this order.
   *
   * ★ COMPUTED HERE, NOT IN EITHER APP ★
   *
   * The website and the companion both draw this, and two implementations of a rule this fiddly
   * would drift — the half that drifted would be the one deciding whether a fortnight of hauling is
   * legal. The shared module runs once, on the server, and both ends render the same answer.
   */
  readonly simulation: SimResult;

  /**
   * A better build order, when there is one — and the tonnage it saves.
   *
   * ★ SQUADRON OWNER, 2026-08-10 ★
   *
   * "The build-order optimiser is still worth doing — you have an editable order, but nothing
   * suggests the feeder→hub pairing that would get your economy producing after ~50k t instead of
   * ~257k t. That's a real gap inside a feature that exists."
   *
   * Computed on the server for the same reason the simulation is: the website and the companion both
   * draw it, and two implementations of a rule this fiddly would drift. It is a SUGGESTION — it never
   * applies itself, because a member's own order can encode a body they want finished first or a
   * carrier already parked somewhere, and a planner that silently rearranged a fortnight of work is
   * one nobody trusts twice.
   *
   * `worthIt` is false when the order is already good, so the panel stays quiet rather than always
   * having advice.
   */
  readonly suggestion: OrderSuggestion;

  /**
   * What economy each planned station would end up with.
   *
   * ★ THE QUESTION UNDERNEATH "WHERE SHOULD THE PORT GO" ★
   *
   * A station's economy decides what its market carries. The same Coriolis around a gas giant and
   * around an earth-like world are two different shops, and the answer depends on the arrangement
   * of the whole system rather than on the port alone — which is precisely what a planner is for.
   */
  readonly economies: EconomyResult;

  /**
   * What each planned station's market would actually buy and sell.
   *
   * ★ THE STEP PAST THE ADJECTIVE ★
   *
   * `economies` answers "what kind of shop" — which is where Raven Colonial stops. Nobody hauls
   * tonnes for an adjective; this is the commodity list the mix implies, computed by the shared
   * predictMarket ON THE SERVER for the same reason the simulation is: two surfaces rendering one
   * answer, never two computations that drift. Empty on the board, where bodies are not loaded.
   */
  readonly markets: ReadonlyArray<{ readonly siteId: string; readonly market: PredictedMarket }>;

  /**
   * What the SYSTEM trades, rolled up from its stations, and how much of its own bill it covers.
   *
   * ★ SQUADRON OWNER, 2026-08-11 ★
   *
   * "a section on what our system will produce ... an indepth view on everything about it"
   *
   * Every line here was already computed by `predictMarket` and only ever rendered as chips under
   * individual sites. Nothing asked what the system as a whole would trade, and nothing had ever
   * put the economy model and the build's own shopping list in the same sentence.
   */
  readonly trade: SystemTrade;
  /** What the finished system would supply against what its own builds still want. */
  readonly selfSufficiency: SelfSufficiency;
  /**
   * What the galaxy pays for each traded commodity today.
   *
   * ★ A REFERENCE, NOT A PREDICTION — THE OWNER'S OWN CHOICE ★
   *
   * We do not model Elite's pricing: it moves with supply, demand and economy strength, none of
   * which this simulates. So these are observed figures from `commodity_snapshots` — what the
   * galaxy actually trades at — and the page labels them as such. A guessed price sends somebody on
   * a worthless run, and they do not come back to check whether the tool was right.
   */
  readonly prices: ReadonlyArray<{
    readonly commodity: string;
    readonly avgSell: number | null;
    readonly avgBuy: number | null;
    readonly sellMarkets: number;
    readonly observedAt: Date | null;
  }>;
}

/** Injected so the service is testable without a network. */
export type Fetcher = Parameters<typeof fetchSystemBodies>[1];

/**
 * How long a cached body list is treated as current.
 *
 * ★ BODIES BARELY CHANGE, SO THIS IS LONG ON PURPOSE ★
 *
 * A system's planets do not move. What changes is how much of it somebody has SCANNED — a partially
 * explored system fills in as people fly through it. A week is long enough that a squadron planning
 * one system never touches EDSM twice, and short enough that a system explored since we last looked
 * corrects itself without anybody asking.
 */
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;

export class ColonyPlanService {
  /*
   * ★ NO AclDbService HERE, AND THAT IS A DECISION ★
   *
   * Every other colonisation service takes one, because `ColonyProject` carries a `visibility`
   * column and is registered in ACL_MODELS — so INV-002 requires its reads to go through a bound
   * client.
   *
   * `ColonyPlan` has no visibility column. A plan is squadron-wide or it is its author's, with no
   * third state, and that rule is expressed directly in the WHERE clause of every read here. Taking
   * an ACL client we did not use would suggest a protection that is not there.
   */
  constructor(
    private readonly db: PrismaClient,
    private readonly fetcher: Fetcher,
  ) {}

  /**
   * A system's bodies, from cache or from EDSM.
   *
   * ★ FETCHED WHEN SOMEBODY PLANS, NOT IN BULK ★
   *
   * The alternative was importing Spansh's galaxy dump or subscribing to EDDN's `Scan` stream —
   * 34.7% of the whole firehose, hundreds of thousands of rows a day, for systems nobody here will
   * ever colonise. A squadron plans a handful, so a handful is what we hold.
   */
  async bodies(systemName: string): Promise<{ system: EdsmSystemBodies | null; fetchedAt: Date | null }> {
    const name = systemName.trim();
    if (name === '') return { system: null, fetchedAt: null };

    const [cached] = await this.db.$queryRawUnsafe<
      Array<{ id64: bigint; name: string; body_count: number | null; fetched_at: Date }>
    >(`SELECT id64, name, body_count, fetched_at FROM colony_systems WHERE lower(name) = lower($1)`, name);

    if (cached !== undefined && Date.now() - cached.fetched_at.getTime() < CACHE_MS) {
      return { system: await this.#fromCache(cached.id64), fetchedAt: cached.fetched_at };
    }

    const fresh = await fetchSystemBodies(name, this.fetcher).catch(() => null);
    if (fresh === null) {
      /*
       * EDSM answers HTTP 200 with an empty object for a system it has never heard of, so a miss is
       * indistinguishable from a network failure at the transport layer. Falling back to whatever we
       * already hold is the right answer for both: a stale body list beats an empty diagram, and the
       * page shows how old it is either way.
       */
      if (cached === undefined) return { system: null, fetchedAt: null };
      return { system: await this.#fromCache(cached.id64), fetchedAt: cached.fetched_at };
    }

    await this.#cache(fresh);
    return { system: await this.#fromCache(BigInt(fresh.id64)), fetchedAt: new Date() };
  }

  async #fromCache(id64: bigint): Promise<EdsmSystemBodies | null> {
    const [head] = await this.db.$queryRawUnsafe<Array<{ id64: bigint; name: string; body_count: number | null }>>(
      `SELECT id64, name, body_count FROM colony_systems WHERE id64 = $1::bigint`,
      id64.toString(),
    );
    if (head === undefined) return null;

    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT body_id, name, kind, sub_type, is_landable, gravity, temperature, distance_ls,
              radius_km, has_rings, terraformable, has_atmosphere, has_volcanism, parent_body_id
         FROM colony_bodies WHERE system_id64 = $1::bigint ORDER BY distance_ls NULLS FIRST`,
      id64.toString(),
    );

    return {
      id64: Number(head.id64),
      name: head.name,
      bodyCount: head.body_count,
      bodies: rows.map((r) => ({
        bodyId: Number(r['body_id']),
        name: String(r['name']),
        kind: String(r['kind']),
        subType: r['sub_type'] === null ? null : String(r['sub_type']),
        isLandable: r['is_landable'] === true,
        gravity: r['gravity'] === null ? null : Number(r['gravity']),
        temperature: r['temperature'] === null ? null : Number(r['temperature']),
        distanceLs: r['distance_ls'] === null ? null : Number(r['distance_ls']),
        radiusKm: r['radius_km'] === null ? null : Number(r['radius_km']),
        hasRings: r['has_rings'] === true,
        terraformable: r['terraformable'] === true,
        hasAtmosphere: r['has_atmosphere'] === true,
        hasVolcanism: r['has_volcanism'] === true,
        parentBodyId: r['parent_body_id'] === null ? null : Number(r['parent_body_id']),
      })),
    };
  }

  /**
   * Writes a fetched system to the cache.
   *
   * ★ SLOT COUNTS SURVIVE A REFETCH ★
   *
   * Somebody read those off their own screen. Overwriting them with nulls because EDSM was asked
   * again a week later would throw away the one thing on this page that cannot be obtained any
   * other way — so the upsert leaves them alone and only refreshes what EDSM actually knows.
   */
  async #cache(system: EdsmSystemBodies): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO colony_systems (id64, name, body_count, fetched_at)
         VALUES ($1::bigint, $2, $3, now())
         ON CONFLICT (id64) DO UPDATE SET name = EXCLUDED.name,
                                          body_count = EXCLUDED.body_count,
                                          fetched_at = now()`,
        String(system.id64),
        system.name,
        system.bodyCount,
      );

      for (const b of system.bodies) {
        await tx.$executeRawUnsafe(
          `INSERT INTO colony_bodies
             (system_id64, body_id, name, kind, sub_type, is_landable, gravity, temperature,
              distance_ls, radius_km, has_rings, terraformable, has_atmosphere, has_volcanism,
              parent_body_id)
           VALUES ($1::bigint, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (system_id64, body_id) DO UPDATE SET
             name = EXCLUDED.name, kind = EXCLUDED.kind, sub_type = EXCLUDED.sub_type,
             is_landable = EXCLUDED.is_landable, gravity = EXCLUDED.gravity,
             temperature = EXCLUDED.temperature, distance_ls = EXCLUDED.distance_ls,
             radius_km = EXCLUDED.radius_km, has_rings = EXCLUDED.has_rings,
             terraformable = EXCLUDED.terraformable, has_atmosphere = EXCLUDED.has_atmosphere,
             has_volcanism = EXCLUDED.has_volcanism, parent_body_id = EXCLUDED.parent_body_id`,
          String(system.id64),
          b.bodyId,
          b.name,
          b.kind,
          b.subType,
          b.isLandable,
          b.gravity,
          b.temperature,
          b.distanceLs,
          b.radiusKm,
          b.hasRings,
          b.terraformable,
          b.hasAtmosphere,
          b.hasVolcanism,
          b.parentBodyId,
        );
      }
    });
  }

  /**
   * Records how many slots a body has, as read off the in-game architect view.
   *
   * Needs only COLONY_VIEW. It is an observation about the galaxy rather than a decision about the
   * squadron — the same reasoning that lets any member claim a commodity — and gating it behind rank
   * would mean the one member who actually flew there could not write down what they saw.
   */
  async setSlots(input: {
    systemId64: bigint;
    bodyId: number;
    orbital: number | null;
    surface: number | null;
    callerId: string;
  }): Promise<void> {
    const clamp = (v: number | null): number | null =>
      v === null || !Number.isFinite(v) ? null : Math.max(0, Math.min(32, Math.trunc(v)));

    const changed = await this.db.$executeRawUnsafe(
      `UPDATE colony_bodies
          SET orbital_slots = $3, surface_slots = $4, slots_by_id = $5::uuid, slots_at = now()
        WHERE system_id64 = $1::bigint AND body_id = $2`,
      input.systemId64.toString(),
      input.bodyId,
      clamp(input.orbital),
      clamp(input.surface),
      input.callerId,
    );

    if (changed === 0) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'We hold no such body.');
    }
  }

  /** Every plan the caller may see. */
  async list(owner: 'squadron' | 'personal' | 'all', callerId: string): Promise<readonly PlanDetail[]> {
    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT p.id, p.owner::text AS owner, p.title, p.system_name, p.system_id64::text AS system_id64,
              p.notes, p.version, p.posted_by_id, p.updated_at, u.display_name AS posted_by,
              s.fetched_at,
              /*
               * ★ THE THREE FACTS AN ORPHAN FLAG NEEDS — SQUADRON OWNER, 2026-08-22 ★
               *
               * Counted in the list query rather than fetched per plan: the planning page shows
               * every plan at once, and a per-plan round trip would be one query per row to decide
               * whether to draw a badge.
               *
               * dangling_sites is the only one that is a fault -- sites pointing at a project that
               * no longer exists, so the plan measures progress against something gone.
               */
              (SELECT count(*) FROM colony_plan_sites ps
                WHERE ps.plan_id = p.id AND ps.project_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM colony_projects cp WHERE cp.id = ps.project_id)
              )::int AS dangling_sites,
              (SELECT count(*) FROM colony_plan_sites ps WHERE ps.plan_id = p.id)::int AS site_count,
              (SELECT count(*) FROM colony_projects cp
                WHERE cp.system_name = p.system_name
                  AND cp.completed_at IS NULL AND cp.abandoned_at IS NULL)::int AS live_projects,
              EXISTS (SELECT 1 FROM colony_projects cp WHERE cp.system_name = p.system_name)
                AS ever_built
         FROM colony_plans p
         JOIN users u ON u.id = p.posted_by_id
         LEFT JOIN colony_systems s ON s.id64 = p.system_id64
        WHERE ($1 = 'all' OR p.owner::text = $1)
          -- A personal plan is its author's alone until they choose otherwise; a squadron plan is
          -- everybody's. There is no third state, so there is no visibility column to read.
          AND (p.owner = 'squadron' OR p.posted_by_id = $2::uuid)
        ORDER BY p.updated_at DESC`,
      owner,
      callerId,
    );

    /*
     * ★ THE BOARD WAS READING AN EMPTY LIST ★
     *
     * `#head` builds a plan with no sites, and this returned that straight out — so every plan on
     * the board said "nothing planned yet" no matter what was in it, and the tonnage that is meant
     * to be the headline was always zero. Found by looking at the page rather than at the types,
     * which all agreed with each other.
     *
     * One query for every plan's sites, not one per plan. A board with twenty plans on it should
     * not be twenty round trips.
     */
    const plans = rows.map((r) => this.#head(r));
    if (plans.length === 0) return plans;

    const sites = await this.#sitesOfMany(plans.map((p) => p.id));
    const catalogue = await this.#catalogueFor([...sites.values()].flat().map((s) => s.buildTypeId));

    const now = new Date();
    const byId = new Map(rows.map((r) => [String(r['id']), r]));

    return plans.map((plan) => {
      const mine = sites.get(plan.id) ?? [];
      const r = byId.get(plan.id);

      /*
       * ★ FLAGGED, NEVER CORRECTED — SQUADRON OWNER, 2026-08-22 ★
       *
       * "orphan" meant three things and the answer was all three, ranked. `orphanFlags` decides
       * which one to say; every condition it reports is recoverable, so nothing here changes a plan.
       * A forgotten plan may be next month's project.
       */
      const flags =
        r === undefined
          ? []
          : orphanFlags(
              {
                planId: plan.id,
                title: plan.title,
                systemName: plan.systemName,
                touchedAt: (r['updated_at'] as Date | null) ?? null,
                siteCount: Number(r['site_count'] ?? 0),
                danglingSites: Number(r['dangling_sites'] ?? 0),
                liveProjects: Number(r['live_projects'] ?? 0),
                everBuilt: r['ever_built'] === true,
              },
              now,
            );

      return {
        ...plan,
        sites: mine,
        orphanFlags: flags,
        simulation: simulatePlan(
          mine.map((s) => ({ id: s.id, buildTypeId: s.buildTypeId })),
          catalogue,
        ),
      };
    });
  }

  /** One plan, with its system laid out and its sites in build order. */
  /**
   * The plan as a printable build book.
   *
   * ★ SQUADRON OWNER, 2026-08-16 ★
   *
   * "the build guide generator is also not anywhere i can find it?"
   *
   * ★ IT READS THROUGH THE SAME VISIBILITY AS THE PLAN ITSELF ★
   *
   * `byId` is what decides whether this member may see this plan at all. Reading the sites directly
   * here would be a second answer to that question, and the second answer is the one that gets
   * forgotten — so the book is built from what `byId` already returned, and a plan the caller cannot
   * open produces no book.
   *
   * A site with no build type chosen is a slot somebody has reserved and not filled. It is left OUT
   * rather than printed blank: a row with no structure and no tonnage is a line a member has to
   * puzzle over on paper, where nothing can explain it.
   */
  async book(planId: string, userId: string, now = new Date()): Promise<string | null> {
    const plan = await this.byId(planId, userId);
    if (plan === null) return null;

    const sites = (plan.sites ?? [])
      .filter((s) => s.buildTypeId !== null && s.buildTypeId !== undefined)
      .map((s, i) => ({
        order: i + 1,
        buildId: String(s.buildTypeId),
        displayName: String(s.buildTypeName ?? s.buildTypeId),
        // The body as the game spells it. Null while somebody is still deciding where it goes.
        body: s.location === null || s.location === undefined ? 'not placed' : String(s.location),
        tier: Number(s.tier ?? 1),
        totalTonnes: Number(s.totalTonnes ?? 0),
        // Linked to a real project is how a plan knows a site actually exists.
        built: s.projectId !== null && s.projectId !== undefined,
      }));

    /*
     * ★ THE REASONING GOES IN THE BOOK, NOT JUST ON THE PAGE ★
     *
     * Squadron owner, 2026-08-18. A printed sheet is read away from the screen with nobody to ask,
     * so it is the one place the "why" matters most — and the place it was missing.
     *
     * Optional and failing soft: a book for an unsurveyed system still prints its build order, and
     * the advisor may reach for an assistant that lives on a machine in the owner's house.
     */
    const advice = await this.#bookAdvice(plan.systemName).catch(() => undefined);

    return renderBuildBook({
      systemName: plan.systemName,
      architect: plan.postedBy ?? 'the squadron',
      generatedAt: now,
      sites,
      ...(advice === undefined ? {} : { advice }),
    });
  }

/**
   * The reasoning that goes at the front of a printed book.
   *
   * ★ COMPUTED HERE RATHER THAN ASKED OF THE ADVISOR, AND THAT IS DELIBERATE ★
   *
   * `SystemAdvisorService` depends on THIS service for its survey, so calling it from here would
   * close a cycle — the same shape as the AiModule cycle that crash-looped the API in August and
   * was invisible to every test in the repository because nothing loads the real module graph.
   *
   * It also happens to be the better book. These are the COMPUTED facts — counts, distances, role
   * scores — which are the half a member can check against the system map. A printed sheet is read
   * with nobody to ask, so the verifiable half is the half worth printing, and it needs no
   * assistant to be reachable at the moment somebody hits print.
   */
  async #bookAdvice(systemName: string): Promise<BookAdvice | undefined> {
    const { system } = await this.bodies(systemName);
    if (system === null || system.bodies.length === 0) return undefined;

    const profile = profileSystem(
      system.bodies.map((b) => ({
        name: b.name,
        kind: b.subType ?? b.kind,
        isLandable: b.isLandable,
        hasRings: b.hasRings,
        isTerraformCandidate: b.terraformable,
        distanceLs: b.distanceLs,
        gravity: b.gravity,
        temperatureK: b.temperature,
      })),
    );

    const fits = scoreRoles(profile);
    const best = fits[0];
    if (best === undefined) return undefined;

    /*
     * The objections from EVERY role that scored, not only the best one — a member reading the book
     * may build the second choice, and the reason not to is the same either way.
     */
    const warnings = [...new Set(fits.flatMap((f) => f.against))];

    return {
      headline: `Best suited to ${best.role}`,
      reasons: best.reasons,
      warnings,
      // No assistant on this path: see the note above. The prose lives on the planning page.
      prose: '',
    };
  }

  async byId(id: string, callerId: string): Promise<PlanDetail | null> {
    const [row] = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT p.id, p.owner::text AS owner, p.title, p.system_name, p.system_id64::text AS system_id64,
              p.notes, p.version, p.posted_by_id, p.updated_at, u.display_name AS posted_by,
              s.fetched_at
         FROM colony_plans p
         JOIN users u ON u.id = p.posted_by_id
         LEFT JOIN colony_systems s ON s.id64 = p.system_id64
        WHERE p.id = $1::uuid AND (p.owner = 'squadron' OR p.posted_by_id = $2::uuid)`,
      id,
      callerId,
    );

    if (row === undefined) return null;

    const head = this.#head(row);
    const [bodies, sites] = await Promise.all([this.#bodiesOf(head.systemId64), this.#sitesOf(id)]);

    const [order, economies] = await Promise.all([
      this.#simulate(sites),
      this.#economies(sites, bodies),
    ]);

    // Markets follow from the economies, so they cannot join the parallel block above.
    const markets = await this.#markets(sites, economies);

    /*
     * ★ THE SYSTEM'S OWN TRADE, AND WHETHER IT PAYS FOR ITSELF ★
     *
     * The rollup is pure and shared. The two reads it needs are the build's outstanding materials
     * — every colonisation project in THIS system, not only ones linked to the plan, because a
     * member hauling to an unlinked site is still hauling it — and what the galaxy pays for
     * whatever the system will trade.
     */
    const trade = systemTrade(markets.map((m) => ({ siteId: m.siteId, market: m.market })));

    const [needs, prices] = await Promise.all([
      this.#outstandingIn(head.systemName),
      this.#pricesFor([...trade.sells, ...trade.buys].map((l) => l.commodity)),
    ]);

    return {
      ...head,
      bodies,
      sites,
      simulation: order.simulation,
      suggestion: order.suggestion,
      economies,
      markets,
      trade,
      selfSufficiency: selfSufficiency(trade.sells, needs),
      prices,
    };
  }

  /**
   * What each chosen site's market would trade, from its resolved economy mix.
   *
   * One small query for the station shapes — location, pad and tier decide market breadth — over
   * only the builds this plan references, then the shared predictMarket per site. Installations
   * get their honest "no market of its own" answer from the model itself, so every CHOSEN site
   * appears here and the pages decide what is worth drawing.
   */
  /**
   * Every commodity the colonisation projects in this system still want.
   *
   * By SYSTEM rather than by linked project, deliberately: a member hauling to a construction site
   * nobody has linked to this plan is still hauling it, and ignoring their work would understate
   * what the system has to import.
   */
  async #outstandingIn(
    systemName: string,
  ): Promise<ReadonlyArray<{ commodity: string; remaining: number }>> {
    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT n.commodity, SUM(n.remaining)::bigint AS remaining
         FROM colony_needs n
         JOIN colony_projects p ON p.id = n.project_id
        WHERE p.system_name = $1 AND n.remaining > 0
        GROUP BY n.commodity`,
      systemName,
    );
    return rows.map((r) => ({
      commodity: String(r['commodity']),
      remaining: Number(r['remaining'] ?? 0),
    }));
  }

  /**
   * What the galaxy pays for these commodities today.
   *
   * ★ OBSERVED, NEVER PREDICTED — THE OWNER'S OWN CHOICE ★
   *
   * `commodity_snapshots` records what markets across the galaxy actually trade at. It says nothing
   * about what THIS system's stations will charge: that moves with supply, demand and economy
   * strength, none of which we model. The page labels these as galaxy figures for exactly that
   * reason — a guessed price sends somebody on a worthless run, and they do not come back to check
   * whether the tool was right.
   *
   * DISTINCT ON the newest row per commodity: the table keeps a history, and averaging six months
   * of readings would produce a number describing no particular day.
   */
  async #pricesFor(
    commodities: readonly string[],
  ): Promise<
    ReadonlyArray<{
      commodity: string;
      avgSell: number | null;
      avgBuy: number | null;
      sellMarkets: number;
      observedAt: Date | null;
    }>
  > {
    const wanted = [...new Set(commodities)];
    if (wanted.length === 0) return [];

    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT DISTINCT ON (c.commodity)
              c.commodity, c.avg_sell, c.avg_buy, c.sell_markets, c.observed_at
         FROM commodity_snapshots c
        WHERE c.commodity = ANY($1::text[])
        ORDER BY c.commodity, c.observed_at DESC`,
      wanted,
    );

    return rows.map((r) => ({
      commodity: String(r['commodity']),
      avgSell: r['avg_sell'] === null ? null : Number(r['avg_sell']),
      avgBuy: r['avg_buy'] === null ? null : Number(r['avg_buy']),
      sellMarkets: Number(r['sell_markets'] ?? 0),
      observedAt: (r['observed_at'] as Date | null) ?? null,
    }));
  }

  async #markets(
    sites: readonly PlanSite[],
    economies: EconomyResult,
  ): Promise<Array<{ siteId: string; market: PredictedMarket }>> {
    const ids = [...new Set(sites.map((s) => s.buildTypeId).filter((v): v is string => v !== null))];
    if (ids.length === 0) return [];

    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, location, pad_size, tier FROM colony_build_types WHERE id = ANY($1::text[])`,
      ids,
    );

    const shapes = new Map(
      rows.map((r) => [
        String(r['id']),
        {
          location: r['location'] === 'surface' ? ('surface' as const) : ('orbital' as const),
          padSize: String(r['pad_size']),
          tier: Number(r['tier']),
        },
      ]),
    );

    const out: Array<{ siteId: string; market: PredictedMarket }> = [];
    for (const site of sites) {
      if (site.buildTypeId === null) continue;
      const shape = shapes.get(site.buildTypeId);
      const economy = economies.sites.find((e) => e.siteId === site.id);
      if (shape === undefined || economy === undefined) continue;
      out.push({ siteId: site.id, market: predictMarket(economy, shape) });
    }
    return out;
  }

  /**
   * Runs the construction-point rules over one plan's build order, and looks for a better one.
   *
   * Both from the SAME catalogue read. They answer two halves of one question — can this be built,
   * and is this the order to build it in — and loading the build types twice to ask them separately
   * would be a second query for no new information.
   *
   * ★ TONNAGE COMES FROM THE SITES, NOT THE CATALOGUE ★
   *
   * `SimBuildType` carries what the simulation needs — points, tiers, prerequisites — and not what a
   * structure weighs. The sites already know: `totalTonnes` is on each one. So the lookup is built
   * here rather than by widening a type the whole planner shares.
   */
  async #simulate(sites: readonly PlanSite[]): Promise<{
    simulation: SimResult;
    suggestion: OrderSuggestion;
  }> {
    const catalogue = await this.#catalogueFor(sites.map((s) => s.buildTypeId));
    const order = sites.map((s) => ({ id: s.id, buildTypeId: s.buildTypeId }));

    const tonnes = new Map<string, number>();
    for (const site of sites) {
      if (site.buildTypeId !== null && site.totalTonnes !== null) {
        tonnes.set(site.buildTypeId, site.totalTonnes);
      }
    }

    return {
      simulation: simulatePlan(order, catalogue),
      suggestion: suggestBuildOrder(order, catalogue, (id) => tonnes.get(id) ?? 0),
    };
  }

  /**
   * Works out what each planned station's economy would resolve to.
   *
   * Reads only the builds this plan uses, for the same reason the point simulation does: fifty-five
   * rows to answer a question about four is a query nobody asked for.
   */
  async #economies(
    sites: readonly PlanSite[],
    bodies: readonly PlanBody[],
  ): Promise<EconomyResult> {
    const ids = [...new Set(sites.map((s) => s.buildTypeId).filter((v): v is string => v !== null))];

    const rows =
      ids.length === 0
        ? []
        : await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `SELECT id, display_name, tier, build_class, economy_influence, economy_fixed
               FROM colony_build_types
              WHERE id = ANY($1::text[])`,
            ids,
          );

    const catalogue = new Map<string, EconBuildType>(
      rows.map((r) => [
        String(r['id']),
        {
          id: String(r['id']),
          displayName: String(r['display_name']),
          tier: Number(r['tier']),
          buildClass: String(r['build_class']),
          economyInfluence: String(r['economy_influence']),
          economyFixed: r['economy_fixed'] === null ? null : String(r['economy_fixed']),
        },
      ]),
    );

    return resolveEconomies(
      sites.map((s) => ({
        id: s.id,
        bodyId: s.bodyId,
        location: s.location,
        buildTypeId: s.buildTypeId,
      })),
      bodies.map((b) => ({
        bodyId: b.bodyId,
        kind: b.kind,
        subType: b.subType,
        hasRings: b.hasRings,
        terraformable: b.terraformable,
        hasVolcanism: b.hasVolcanism,
        isLandable: b.isLandable,
      })),
      catalogue,
    );
  }

  /** Every plan's sites, grouped, in one query. */
  async #sitesOfMany(planIds: readonly string[]): Promise<Map<string, PlanSite[]>> {
    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT s.plan_id::text AS plan_id,
              s.id, s.body_id, s.location, s.build_type_id, s.position, s.is_primary,
              s.project_id::text AS project_id,
              s.corrected_from_build_type_id AS corrected_from,
              s.corrected_at,
              -- The old build type's display name, so the notice can say "an Extraction Settlement
              -- — Medium" rather than a catalogue id nobody recognises.
              c.display_name AS corrected_from_name,
              t.display_name AS build_type_name, t.tier, t.total_tonnes,
              t.economy_influence
         FROM colony_plan_sites s
         LEFT JOIN colony_build_types t ON t.id = s.build_type_id
         LEFT JOIN colony_build_types c ON c.id = s.corrected_from_build_type_id
        WHERE s.plan_id = ANY($1::uuid[])
        ORDER BY s.position`,
      planIds,
    );

    const out = new Map<string, PlanSite[]>();
    for (const r of rows) {
      const key = String(r['plan_id']);
      const list = out.get(key) ?? [];
      list.push(this.#site(r));
      out.set(key, list);
    }
    return out;
  }

  /**
   * The construction-point rules for a set of builds.
   *
   * ★ ONLY THE BUILDS ACTUALLY USED ★
   *
   * Fetching the whole catalogue would be fifty-five rows to answer a question about four. The
   * simulation takes a lookup rather than a list precisely so the caller can decide that.
   */
  async #catalogueFor(referenced: ReadonlyArray<string | null>): Promise<Map<string, SimBuildType>> {
    const ids = [...new Set(referenced.filter((v): v is string => v !== null))];
    if (ids.length === 0) return new Map();

    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, display_name, tier, build_class, needs_tier, needs_points,
              gives_tier, gives_points, requires, satisfies,
              eff_population, eff_max_population, eff_security, eff_technology,
              eff_wealth, eff_standard_of_living, eff_development,
              economy_influence, economy_fixed
         FROM colony_build_types
        WHERE id = ANY($1::text[])`,
      ids,
    );

    return new Map<string, SimBuildType>(
      rows.map((r) => [
        String(r['id']),
        {
          id: String(r['id']),
          displayName: String(r['display_name']),
          tier: Number(r['tier']),
          buildClass: String(r['build_class']),
          needsTier: Number(r['needs_tier']),
          needsPoints: Number(r['needs_points']),
          givesTier: Number(r['gives_tier']),
          givesPoints: Number(r['gives_points']),
          requires: r['requires'] === null ? null : String(r['requires']),
          satisfies: Array.isArray(r['satisfies']) ? (r['satisfies'] as string[]) : [],
          effects: {
            population: Number(r['eff_population']),
            maxPopulation: Number(r['eff_max_population']),
            security: Number(r['eff_security']),
            technology: Number(r['eff_technology']),
            wealth: Number(r['eff_wealth']),
            standardOfLiving: Number(r['eff_standard_of_living']),
            development: Number(r['eff_development']),
          },
          // What the system BECOMES. Selected here because the simulation cannot vote without it,
          // and an absent column reads as "no economy at all" rather than as a missing join.
          influence: r['economy_influence'] === null ? null : String(r['economy_influence']),
          fixed: r['economy_fixed'] === null ? null : String(r['economy_fixed']),
        },
      ]),
    );
  }

  async #bodiesOf(systemId64: string | null): Promise<readonly PlanBody[]> {
    if (systemId64 === null) return [];

    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT b.body_id, b.name, b.kind, b.sub_type, b.is_landable, b.gravity, b.temperature,
              b.distance_ls, b.has_rings, b.terraformable, b.has_volcanism, b.has_atmosphere,
              b.parent_body_id,
              b.orbital_slots, b.surface_slots, u.display_name AS slots_by
         FROM colony_bodies b
         LEFT JOIN users u ON u.id = b.slots_by_id
        WHERE b.system_id64 = $1::bigint
        -- Nearest first: the order a system map is read in, and the order somebody flies them.
        ORDER BY b.distance_ls NULLS FIRST, b.body_id`,
      systemId64,
    );

    return rows.map((r) => ({
      bodyId: Number(r['body_id']),
      name: String(r['name']),
      kind: String(r['kind']),
      subType: r['sub_type'] === null ? null : String(r['sub_type']),
      isLandable: r['is_landable'] === true,
      gravity: r['gravity'] === null ? null : Number(r['gravity']),
      temperature: r['temperature'] === null ? null : Number(r['temperature']),
      distanceLs: r['distance_ls'] === null ? null : Number(r['distance_ls']),
      hasRings: r['has_rings'] === true,
      terraformable: r['terraformable'] === true,
      // Fetched from EDSM and stored since the planner shipped, but never read back out. The
      // economy model needs both: volcanism feeds extraction, and an atmosphere is what makes a
      // body worth more surface slots.
      hasVolcanism: r['has_volcanism'] === true,
      hasAtmosphere: r['has_atmosphere'] === true,
      parentBodyId: r['parent_body_id'] === null ? null : Number(r['parent_body_id']),
      orbitalSlots: r['orbital_slots'] === null ? null : Number(r['orbital_slots']),
      surfaceSlots: r['surface_slots'] === null ? null : Number(r['surface_slots']),
      slotsBy: r['slots_by'] === null ? null : String(r['slots_by']),
    }));
  }

  async #sitesOf(planId: string): Promise<readonly PlanSite[]> {
    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      /*
       * ★ WHAT HAS ACTUALLY BEEN BUILT — SQUADRON OWNER, 2026-08-11 ★
       *
       * "on the build order page, can we track what has been built please?"
       *
       * Answerable only since a planned site can point at the project it became. The plan knows
       * what a build WOULD cost from the catalogue; the project knows what it actually still wants,
       * because a docked commander's journal reports it. Joining them is the difference between a
       * plan and a progress report.
       *
       * LEFT JOINs throughout: most sites have no project, which is not a gap but the normal state
       * of a plan — somebody has to fly out and place them first.
       */
      `SELECT s.id, s.body_id, s.location, s.build_type_id, s.position, s.is_primary,
              s.project_id::text AS project_id,
              t.display_name AS build_type_name, t.tier, t.total_tonnes,
              t.economy_influence,
              pr.completed_at AS project_completed_at,
              need.required AS project_required,
              need.remaining AS project_remaining
         FROM colony_plan_sites s
         LEFT JOIN colony_build_types t ON t.id = s.build_type_id
         LEFT JOIN colony_projects pr ON pr.id = s.project_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(n.required), 0)::bigint  AS required,
                  COALESCE(SUM(n.remaining), 0)::bigint AS remaining
             FROM colony_needs n
            WHERE n.project_id = s.project_id
         ) need ON s.project_id IS NOT NULL
        WHERE s.plan_id = $1::uuid
        ORDER BY s.position`,
      planId,
    );

    return rows.map((r) => this.#site(r));
  }

  /** One site row, read the same way whichever query produced it. */
  #site(r: Record<string, unknown>): PlanSite {
    return {
      id: String(r['id']),
      bodyId: r['body_id'] === null ? null : Number(r['body_id']),
      location: r['location'] === 'surface' ? 'surface' : 'orbital',
      buildTypeId: r['build_type_id'] === null ? null : String(r['build_type_id']),
      buildTypeName: r['build_type_name'] === null ? null : String(r['build_type_name']),
      tier: r['tier'] === null ? null : Number(r['tier']),
      totalTonnes: r['total_tonnes'] === null ? null : Number(r['total_tonnes']),
      // What this build feeds into whatever port receives it. `none` for the many that feed
      // nothing, null only while no build has been chosen.
      economyInfluence: r['economy_influence'] === null ? null : String(r['economy_influence']),
      position: Number(r['position']),
      isPrimary: r['is_primary'] === true,
      projectId: r['project_id'] === null ? null : String(r['project_id']),
      correctedFrom: r['corrected_from'] == null ? null : String(r['corrected_from']),
      correctedFromName: r['corrected_from_name'] == null ? null : String(r['corrected_from_name']),
      correctedAt:
        r['corrected_at'] == null ? null : new Date(r['corrected_at'] as string).toISOString(),
      project:
        r['project_id'] === null || r['project_id'] === undefined
          ? null
          : {
              required: Number(r['project_required'] ?? 0),
              remaining: Number(r['project_remaining'] ?? 0),
              completedAt: (r['project_completed_at'] as Date | null) ?? null,
            },
    };
  }

  #head(r: Record<string, unknown>): PlanDetail {
    return {
      id: String(r['id']),
      owner: r['owner'] === 'squadron' ? 'squadron' : 'personal',
      title: String(r['title']),
      systemName: String(r['system_name']),
      systemId64: r['system_id64'] === null ? null : String(r['system_id64']),
      notes: r['notes'] === null ? null : String(r['notes']),
      version: Number(r['version']),
      postedBy: r['posted_by'] === null ? null : String(r['posted_by']),
      postedById: String(r['posted_by_id']),
      updatedAt: r['updated_at'] as Date,
      bodies: [],
      bodiesFetchedAt: (r['fetched_at'] as Date | null) ?? null,
      sites: [],
      // The head row alone knows nothing about the build order. Both callers fill this in — `byId`
      // from the plan's own sites, `list` from one query across every plan.
      simulation: simulatePlan([], new Map()),
      /*
       * No advice on the board. A suggestion is worth reading beside the order it would replace, and
       * a card that says "there is a better order" with no way to see it is a nag rather than a tool.
       */
      suggestion: suggestBuildOrder([], new Map()),
      /*
       * Left empty on the board deliberately. An economy depends on the BODIES the sites stand on,
       * and the board loads none of them — computing it there would produce a number that looks
       * authoritative and is arrived at from half the inputs.
       */
      economies: resolveEconomies([], [], new Map()),
      // Markets follow the economies, so the board leaves them empty for the same reason.
      markets: [],
      // And the trade rollup follows the markets. A board card has no system economy to show.
      trade: { sells: [], buys: [], internal: [] },
      selfSufficiency: {
        covered: [],
        notCovered: [],
        coveredTonnes: 0,
        outstandingTonnes: 0,
        pctCovered: null,
      },
      prices: [],
    };
  }

  /**
   * Starts a plan, fetching the system's bodies as it goes.
   *
   * The fetch is not allowed to fail the creation: a plan for a system EDSM has never heard of is
   * still a plan, and the page says the body list is empty rather than refusing to save anything.
   */
  async create(input: {
    owner: 'squadron' | 'personal';
    title: string;
    systemName: string;
    callerId: string;
    callerMask: bigint;
  }): Promise<{ id: string }> {
    if ((input.callerMask & Permission.COLONY_POST) !== Permission.COLONY_POST) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'Your rank cannot start a plan.');
    }
    if (
      input.owner === 'squadron' &&
      (input.callerMask & Permission.COLONY_MANAGE) !== Permission.COLONY_MANAGE
    ) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'Only officers can plan on the squadron’s behalf.');
    }

    const title = input.title.trim();
    const systemName = input.systemName.trim();
    if (title === '' || systemName === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'A plan needs a name and a system.');
    }

    const found = await this.bodies(systemName).catch(() => ({ system: null, fetchedAt: null }));

    const [created] = await this.db.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO colony_plans (owner, title, system_name, system_id64, posted_by_id)
       VALUES ($1::"ColonyOwner", $2, $3, $4::bigint, $5::uuid)
       RETURNING id`,
      input.owner,
      title,
      found.system?.name ?? systemName,
      found.system === null ? null : String(found.system.id64),
      input.callerId,
    );

    return { id: String(created?.id ?? '') };
  }

  /**
   * Whose plan this is, for anything that changes it.
   *
   * The same rule projects use: a squadron plan is the squadron's, so an officer directs it; a
   * personal one belongs to whoever started it, and rank does not change that.
   */
  /**
   * Whether this caller may change this plan — the same question `#mayEdit` throws over.
   *
   * ★ THE PAGE WAS GUESSING, AND ITS GUESS WAS ALWAYS YES ★
   *
   * The website computed `canEdit = plan.owner === 'personal' || plan.postedBy !== null`. That
   * looked like the projects rule and was not one: `postedBy` is a display name from an INNER join
   * on `posted_by_id`, a NOT NULL column — so it is never null, so the expression is always true.
   * Every member was shown the full editing UI for every squadron plan, and every click came back
   * "Only officers can change a squadron plan."
   *
   * Nothing was ever at risk — the service refuses on every write — but being offered a control
   * that cannot work is worse than not being offered it, because it reads as a broken app rather
   * than as a rank you do not hold.
   *
   * So the answer is computed HERE, from the same predicate the refusal uses, and sent to both
   * surfaces. A rendering hint that disagrees with the rule it is hinting at is not a hint.
   */
  async mayEdit(planId: string, callerId: string, mask: bigint): Promise<boolean> {
    const [plan] = await this.db.$queryRawUnsafe<Array<{ owner: string; posted_by_id: string }>>(
      `SELECT owner::text AS owner, posted_by_id FROM colony_plans WHERE id = $1::uuid`,
      planId,
    );
    if (plan === undefined) return false;

    return plan.owner === 'squadron'
      ? (mask & Permission.COLONY_MANAGE) === Permission.COLONY_MANAGE
      : plan.posted_by_id === callerId;
  }

  async #mayEdit(planId: string, callerId: string, mask: bigint): Promise<{ version: number }> {
    const [plan] = await this.db.$queryRawUnsafe<
      Array<{ owner: string; posted_by_id: string; version: number }>
    >(`SELECT owner::text AS owner, posted_by_id, version FROM colony_plans WHERE id = $1::uuid`, planId);

    if (plan === undefined) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That plan is not available.');
    }

    const may =
      plan.owner === 'squadron'
        ? (mask & Permission.COLONY_MANAGE) === Permission.COLONY_MANAGE
        : plan.posted_by_id === callerId;

    if (!may) {
      throw new AppError(
        ErrorCode.PERMISSION_DENIED,
        plan.owner === 'squadron'
          ? 'Only officers can change a squadron plan.'
          : 'Only the member who started this plan can change it.',
      );
    }

    return { version: plan.version };
  }

  /**
   * Bumps the version, refusing if somebody else moved first.
   *
   * ★ OPTIMISTIC CONCURRENCY, AND IT IS NOT DECORATION ★
   *
   * The highest-value moment for a planner is two officers on Discord looking at the same system.
   * Last-write-wins on a drag-ordered list silently destroys work in exactly that scenario — one of
   * them reorders ten sites, the other saves a note, and the reorder is gone with no error anywhere.
   *
   * A mismatch is reported with both versions so the page can say what happened rather than just
   * refusing.
   */
  async #bump(planId: string, expected: number): Promise<number> {
    const [row] = await this.db.$queryRawUnsafe<Array<{ version: number }>>(
      `UPDATE colony_plans SET version = version + 1, updated_at = now()
        WHERE id = $1::uuid AND version = $2
        RETURNING version`,
      planId,
      expected,
    );

    if (row === undefined) {
      const [now] = await this.db.$queryRawUnsafe<Array<{ version: number }>>(
        `SELECT version FROM colony_plans WHERE id = $1::uuid`,
        planId,
      );
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `Somebody else saved this plan while you were editing it — it is now at revision ${now?.version ?? '?'}, and you started from ${expected}. Reload and make your change again.`,
      );
    }

    return row.version;
  }

  /** Adds an intended build. */
  async addSite(input: {
    planId: string;
    callerId: string;
    callerMask: bigint;
    version: number;
    bodyId: number | null;
    location: 'orbital' | 'surface';
    buildTypeId: string | null;
  }): Promise<{ version: number }> {
    await this.#mayEdit(input.planId, input.callerId, input.callerMask);

    const [plan] = await this.db.$queryRawUnsafe<Array<{ system_id64: bigint | null }>>(
      `SELECT system_id64 FROM colony_plans WHERE id = $1::uuid`,
      input.planId,
    );

    const [last] = await this.db.$queryRawUnsafe<Array<{ next: number }>>(
      `SELECT COALESCE(max(position), -1) + 1 AS next FROM colony_plan_sites WHERE plan_id = $1::uuid`,
      input.planId,
    );

    /*
     * The FIRST site in a plan is the primary port, which the game treats specially and charges no
     * construction points for. Marked automatically rather than asked about: it is a fact about
     * being first, not a choice, and a checkbox for it would be a checkbox somebody gets wrong.
     */
    const isPrimary = (last?.next ?? 0) === 0;

    await this.db.$executeRawUnsafe(
      `INSERT INTO colony_plan_sites
         (plan_id, system_id64, body_id, location, build_type_id, position, is_primary)
       VALUES ($1::uuid, $2::bigint, $3, $4, $5, $6, $7)`,
      input.planId,
      input.bodyId === null ? null : (plan?.system_id64?.toString() ?? null),
      input.bodyId,
      input.location,
      input.buildTypeId,
      last?.next ?? 0,
      isPrimary,
    );

    return { version: await this.#bump(input.planId, input.version) };
  }

  /** Removes one, and closes the gap it leaves in the build order. */
  async removeSite(input: {
    planId: string;
    siteId: string;
    callerId: string;
    callerMask: bigint;
    version: number;
  }): Promise<{ version: number }> {
    await this.#mayEdit(input.planId, input.callerId, input.callerMask);

    await this.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM colony_plan_sites WHERE id = $1::uuid AND plan_id = $2::uuid`,
        input.siteId,
        input.planId,
      );
      /*
       * Renumbered rather than left with a hole. Positions are what the build ORDER means, and tier
       * points are earned and spent in that sequence — a gap is harmless until somebody inserts into
       * it and two sites claim the same place.
       */
      await tx.$executeRawUnsafe(
        `WITH ordered AS (
           SELECT id, row_number() OVER (ORDER BY position) - 1 AS pos
             FROM colony_plan_sites WHERE plan_id = $1::uuid
         )
         UPDATE colony_plan_sites s SET position = o.pos, is_primary = (o.pos = 0)
           FROM ordered o WHERE o.id = s.id`,
        input.planId,
      );
    });

    return { version: await this.#bump(input.planId, input.version) };
  }

  /** Sets the whole build order at once, which is what a drag produces. */
  async reorder(input: {
    planId: string;
    siteIds: readonly string[];
    callerId: string;
    callerMask: bigint;
    version: number;
  }): Promise<{ version: number }> {
    await this.#mayEdit(input.planId, input.callerId, input.callerMask);

    await this.db.$transaction(async (tx) => {
      for (const [index, siteId] of input.siteIds.entries()) {
        await tx.$executeRawUnsafe(
          `UPDATE colony_plan_sites SET position = $3, is_primary = ($3 = 0)
            WHERE id = $1::uuid AND plan_id = $2::uuid`,
          siteId,
          input.planId,
          index,
        );
      }
    });

    return { version: await this.#bump(input.planId, input.version) };
  }

  /**
   * Points a planned site at the project that got built there.
   *
   * ★ THE COLUMN WAS ALREADY THERE, AND NOTHING EVER WROTE IT — FOUND 2026-08-10 ★
   *
   * `colony_plan_sites.project_id` has been read out by this service since the planner shipped and
   * set by nothing at all: a link the schema plainly anticipated and no code ever made.
   *
   * ★ WHY A PLAN CANNOT SIMPLY GENERATE ITS PROJECTS ★
   *
   * The obvious feature — "turn this plan into projects" — is impossible, and the reason is a NOT
   * NULL: `colony_projects.market_id` is how a ColonisationConstructionDepot event finds the project
   * a member posted, and a construction site has no market id until somebody actually places it in
   * the game. A plan is an intention; a project is a thing that exists.
   *
   * So the direction is reversed. The member places the site, posts it as a project with the market
   * id only they can read off the game, and THIS closes the loop — after the fact, which is the only
   * time the fact exists.
   *
   * Idempotent, and it refuses to steal: a site already pointing at a different project is left
   * alone rather than repointed, because two builds in one system are exactly the case this would
   * otherwise scramble.
   */
  async linkProject(input: {
    planId: string;
    siteId: string;
    projectId: string;
    callerId: string;
    callerMask: bigint;
  }): Promise<{ linked: boolean }> {
    await this.#mayEdit(input.planId, input.callerId, input.callerMask);

    const done = await this.db.$executeRawUnsafe(
      `UPDATE colony_plan_sites
          SET project_id = $3::uuid
        WHERE id = $1::uuid AND plan_id = $2::uuid
          AND (project_id IS NULL OR project_id = $3::uuid)`,
      input.siteId,
      input.planId,
      input.projectId,
    );

    return { linked: done > 0 };
  }

  /** Deletes a plan outright. Nothing was built, so nothing is lost but the intention. */
  async remove(planId: string, callerId: string, mask: bigint): Promise<void> {
    await this.#mayEdit(planId, callerId, mask);
    await this.db.$executeRawUnsafe(`DELETE FROM colony_plans WHERE id = $1::uuid`, planId);
  }
}
