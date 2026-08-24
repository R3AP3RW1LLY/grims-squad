import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { PrismaClient } from '@grims/db';
import { AppError, ErrorCode, Permission, readClaimOwnership, ROLE_PRESETS } from '@grims/shared';
import { mergeNeeds } from '@grims/shared/colony-all-needs';
import { Public } from '../auth/auth.guard.js';
import { User, type CurrentUser } from '../auth/current-user.js';
import { PermissionService } from '../authz/permission.service.js';
import { ColonyService, type ColonyOwner, type ColonyVisibility } from './colony.service.js';
import { ColonyRosterService } from './colony-roster.service.js';
import { ColonyCatalogueService } from './colony-catalogue.service.js';
import { ColonyCarrierService, carrierCover } from './colony-carrier.service.js';
import { ColonyPurchasesService } from './colony-purchases.service.js';
import { CommanderPositionService } from './commander-position.service.js';
import { ColonyPlanReviewService } from './colony-plan-review.service.js';
import { SystemAdvisorService } from './system-advisor.service.js';
import { ColonyPlanService } from './colony-plan.service.js';
import { MARKET_STORE } from './logistics.tokens.js';
import type { MarketStore } from './market.store.js';

/**
 * Colonisation.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "officers will be able to add Squadron specific and personal project and ladder ranked members
 * will be able to list personal projects", and "Squadron projects members-only, personal projects
 * publishable by choice".
 *
 * ★ MEMBERS ONLY, WITH ONE DELIBERATE HOLE ★
 *
 * Every route here needs COLONY_VIEW, which the GUEST mask does NOT hold — unlike the market and
 * the Freight Office, which the owner made public. A project board says who is building what and
 * where, which is operational.
 *
 * The exception is `shared/:token`, and it is not a hole in the gate: the token IS the capability,
 * minted only when a member with COLONY_SHARE_PUBLIC publishes a project of their own. A squadron
 * project can never reach it, because the service refuses to publish one.
 */
@Controller('v1/logistics/colony')
export class ColonyController {
  constructor(
    @Inject(ColonyService) private readonly colony: ColonyService,
    @Inject(MARKET_STORE) private readonly market: MarketStore,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    // The same roster service the companion controller uses: one rule about who may direct a build,
    // in one place, so the two surfaces cannot disagree.
    @Inject(ColonyRosterService) private readonly rosters: ColonyRosterService,
    @Inject(ColonyCatalogueService) private readonly catalogue: ColonyCatalogueService,
    @Inject(ColonyCarrierService) private readonly carriers: ColonyCarrierService,
    @Inject(ColonyPurchasesService) private readonly purchases: ColonyPurchasesService,
    // `plans_` because `plans` is the route method below it, and a field cannot share its name.
    @Inject(ColonyPlanService) private readonly plans_: ColonyPlanService,
    /*
     * Where the caller was last seen, so the boards can rank builds by how far they are.
     *
     * The SAME service the shopping list resolves an origin with — a member's position worked out
     * two different ways is two different answers to one question, and the one that disagreed would
     * be the one deciding where somebody flies tonight.
     */
    @Inject(CommanderPositionService) private readonly position: CommanderPositionService,
    // The plan review: the simulation's own findings, read back in the member's language.
    @Inject(ColonyPlanReviewService) private readonly review: ColonyPlanReviewService,
    // What a system should be built as, from its survey and its bloc. Advice, never a write.
    @Inject(SystemAdvisorService) private readonly advisor: SystemAdvisorService,
    /*
     * The bloc tables are addressed with raw SQL for the same reason every other colonisation table
     * on this controller is: they are read and written by one feature, nothing joins to them through
     * the ACL extension, and a generated client here would be a second shape to keep in step.
     */
    @Inject(PrismaClient) private readonly db: PrismaClient,
  ) {}

  async #mask(caller: CurrentUser | undefined): Promise<bigint> {
    return caller === undefined
      ? ROLE_PRESETS.guest
      : this.permissions.effectiveMask(caller.userId);
  }

  async #assert(caller: CurrentUser | undefined, need: bigint, what: string): Promise<bigint> {
    const mask = await this.#mask(caller);
    if ((mask & need) !== need) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, what);
    }
    return mask;
  }

  /** Somebody has to be signed in for everything except a published link. */
  #requireSession(caller: CurrentUser | undefined): CurrentUser {
    if (caller === undefined) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'Sign in to use colonisation.');
    }
    return caller;
  }

  @Get('projects')
  async projects(@User() caller: CurrentUser | undefined, @Query('owner') owner?: string) {
    const mask = await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    const scope: ColonyOwner | 'all' =
      owner === 'squadron' || owner === 'personal' ? owner : 'all';

    /*
     * ★ RANKED BY THE CLIENTS, FROM FACTS SENT BY THE SERVER ★
     *
     * The board carries `lastDeliveryAt` and each build's coordinates; `you` carries where the
     * caller was last seen. Both surfaces then call the SAME `rankOpportunities` out of
     * @grims/shared, so the website and the app cannot put a different build at the top of the same
     * member's list — and re-sorting is instant rather than a round trip.
     */
    const you =
      caller === undefined ? null : await this.position.lastKnown(caller.userId).catch(() => null);

    return {
      projects: await this.colony.board(
        scope,
        caller === undefined
          ? null
          : // The officer flag rides with the caller because the board is raw SQL and cannot
            // consult the ACL extension — see the abandonment clause in `board`.
            { userId: caller.userId, canManage: has(mask, Permission.COLONY_MANAGE) },
      ),
      you:
        you === null
          ? null
          : { systemName: you.systemName, coords: you.coords, at: you.at, source: you.source },
      /*
       * ★ WHAT THE CALLER MAY DO, SENT WITH WHAT THEY MAY SEE ★
       *
       * The page needs this to decide whether to offer the "post as a squadron project" box and the
       * publish control. Returned alongside the board rather than fetched separately, because a
       * second round trip to ask "what am I allowed to do" is a second chance for the two answers
       * to disagree — and the one that disagreed would be the one drawing the button.
       *
       * It is a HINT for rendering and never a gate. Every one of these is re-checked on the write.
       */
      can: {
        post: has(mask, Permission.COLONY_POST),
        manage: has(mask, Permission.COLONY_MANAGE),
        publish: has(mask, Permission.COLONY_SHARE_PUBLIC),
      },
    };
  }

  /** One project: what it needs, who has hauled to it, and where to buy the rest. */
  @Get('projects/:id')
  async project(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Query('near') near?: string,
    @Query('withinLy') withinLy?: string,
    @Query('largePad') largePad?: string,
    @Query('sort') sort?: string,
  ) {
    const mask = await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    const project = await this.colony.byId(
      id,
      caller === undefined ? null : { userId: caller.userId },
    );
    /*
     * The same answer for "no such project" and "not yours to see". Distinguishing them would
     * confirm which ids are real to anybody enumerating them — the same reasoning as the shared
     * build reader.
     */
    if (project === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That project is not available.');
    }

    /*
     * Defaults to the build's own system, for the reason recorded in the device controller: with no
     * origin the list ranked by price across the whole galaxy, so a seller in the build's own system
     * could never win. The site is where somebody is hauling to.
     */
    const origin =
      (await this.#origin(near)) ?? (await this.#origin(project.systemName));

    /*
     * The delivery chart is bucketed in the VIEWER's zone (see deliveryChart), so their stored
     * timezone is read first — one indexed lookup, UTC for a guest. Resolved before the parallel
     * block rather than inside it because the chart read cannot start without it.
     */
    const tz = await this.colony.viewerTimezone(caller?.userId ?? null);

    /*
     * ★ CARRIERS BEFORE THE SHOPPING LIST, ON PURPOSE ★
     *
     * The buy maths subtracts what the attached holds effectively cover, so the cover has to exist
     * before the market is priced. One small indexed read ahead of the parallel block — the same
     * shape as the timezone above it, and for the same reason: the next read cannot start without
     * it.
     */
    const carriers = await this.carriers.forProject(id);
    const cover = carrierCover(carriers);

    /*
     * ★ THE ATTACH PROMPT — SQUADRON OWNER, 2026-08-16 ★
     *
     * "your carrier is holding 800 t this build needs — attach it?", shown to the carrier's OWNER
     * and to nobody else. A carrier that is not attached is deliberately on no squadron board, and
     * telling officers what is inside one before its owner has offered it would publish a private
     * hold to make a prompt slightly more effective.
     *
     * Fails soft: a prompt is worth less than the page it sits on.
     */
    const canAttach =
      caller === undefined
        ? []
        : await this.carriers.unattachedHoldingFor(id, caller.userId).catch(() => []);

    const [needs, haulers, shopping, deliveries, chart, isCrew] = await Promise.all([
      this.colony.needs(id),
      this.colony.haulers(id),
      this.colony.shoppingList(id, {
        near: origin?.coords ?? null,
        withinLy: clamp(numberOr(withinLy, 100), 1, 500),
        largePadOnly: largePad === '1',
        sort: sort === 'closest' ? 'closest' : sort === 'cheapest' ? 'cheapest' : 'local',
        carrierCover: cover,
      }),
      // The same two the app gets. One service, one shape — the website and the companion showing
      // different histories of the same build is the failure this whole controller exists to avoid.
      this.colony.deliveries(id),
      this.colony.deliveryChart(id, tz),
      // Whether the reader is on the crew roster, because declaring a carrier's cargo is crew work
      // and the page should not offer a pen the service will refuse.
      caller === undefined ? Promise.resolve(false) : this.rosters.isCrew(id, caller.userId),
    ]);

    return {
      project,
      needs,
      haulers,
      shopping,
      deliveries,
      chart,
      carriers,
      /** Your own carriers holding what this build wants, unattached. Owner-only — see above. */
      canAttach,
      /*
       * The effective per-commodity cover — manual beats journal beats mirror, summed across the
       * attached carriers. Computed ONCE here and sent down, so the needs bars, the shopping list
       * and the carriers tab all stage the same yellow tonnage rather than three re-derivations.
       */
      carrierCover: cover,
      /*
       * ★ WHAT THIS READER MAY DO, DECIDED HERE ★
       *
       * The page could not draw a close button because it had no way to know whether the reader was
       * allowed to press one: the detail payload carried no rights and no identity. Sending the
       * caller's own id down for the page to compare would be one more value the browser could get
       * wrong about who it belongs to, so the comparison is made where the session is.
       *
       * A hint for rendering only — every write re-checks.
       */
      can: {
        manage: (mask & Permission.COLONY_MANAGE) === Permission.COLONY_MANAGE,
        isPoster: caller !== undefined && project.postedById === caller.userId,
        isCrew,
      },
      origin: origin === null ? null : { system: origin.system },
      unknownSystem: (near?.trim() ?? '') !== '' && origin === null ? near?.trim() : null,
    };
  }

  /**
   * A published project, by its token.
   *
   * No session and no permission: the token is the capability, and it exists only because a member
   * chose to publish a project of their own. Public on the same terms as a shared ship build.
   */
  @Public()
  @Get('shared/:token')
  async shared(@Param('token') token: string) {
    const project = await this.colony.byToken(token);
    if (project === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That project is not available.');
    }
    return { project, needs: await this.colony.needs(project.id) };
  }

  @Post('projects')
  async create(
    @User() caller: CurrentUser | undefined,
    @Body()
    body: {
      owner?: string;
      marketId?: string;
      systemName?: string;
      stationName?: string;
      title?: string;
      notes?: string;
      /**
       * The planned site this project realises, when it was posted from a plan.
       *
       * Optional and non-fatal: a project posted from a plan is a project first. If the link cannot
       * be made — the plan changed, the rank does not reach it — the project still exists, because
       * failing the post over its own bookkeeping would lose the thing the member actually wanted.
       */
      planId?: string;
      planSiteId?: string;
    },
  ) {
    const me = this.#requireSession(caller);
    const owner: ColonyOwner = body.owner === 'squadron' ? 'squadron' : 'personal';

    /*
     * A squadron project is the thing the whole squadron hauls for, so posting one is an officer's
     * call. A personal project needs only COLONY_POST, which every member holds.
     */
    await this.#assert(
      caller,
      owner === 'squadron' ? Permission.COLONY_MANAGE : Permission.COLONY_POST,
      owner === 'squadron'
        ? 'Only officers can post a squadron project.'
        : 'You do not have permission to post a colonisation project.',
    );

    /*
     * The market id is the join to reality — it is how the journal finds this project again. Parsed
     * strictly: a project with a bogus id would sit on the board for ever showing nothing, and look
     * like the sync being broken rather than a typo.
     */
    const marketId = parseMarketId(body.marketId);

    const made = await this.colony.create({
      userId: me.userId,
      owner,
      marketId,
      systemName: body.systemName ?? '',
      stationName: body.stationName ?? null,
      title: body.title ?? '',
      notes: body.notes ?? null,
    });

    /*
     * ★ CLOSING THE LOOP A PLAN CANNOT CLOSE BY ITSELF ★
     *
     * `colony_plan_sites.project_id` was read by the planner and written by nothing. A plan cannot
     * generate its projects — a project needs the construction site's market id, which does not
     * exist until somebody places the site in game — so the link can only be made in this
     * direction, at the one moment the market id is known.
     *
     * Non-fatal by construction. The project is created and returned whatever happens here; a
     * failed link is a plan that still shows the site as unbuilt, which is untidy rather than wrong.
     */
    if (body.planId !== undefined && body.planSiteId !== undefined) {
      await this.plans_
        .linkProject({
          planId: body.planId,
          siteId: body.planSiteId,
          projectId: made.id,
          callerId: me.userId,
          callerMask: await this.#mask(caller),
        })
        .catch(() => undefined);
    }

    return made;
  }

  @Patch('projects/:id/visibility')
  async visibility(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Body() body: { visibility?: string },
  ) {
    const me = this.#requireSession(caller);
    const mask = await this.#assert(
      caller,
      Permission.COLONY_POST,
      'You do not have permission to change a colonisation project.',
    );

    const visibility: ColonyVisibility =
      body.visibility === 'public' || body.visibility === 'private' ? body.visibility : 'squadron';

    return this.colony.setVisibility({
      projectId: id,
      userId: me.userId,
      visibility,
      // Checked here and re-checked in the service. The service is the one that matters; this makes
      // the failure a clear message rather than a generic refusal.
      mayPublish: (mask & Permission.COLONY_SHARE_PUBLIC) === Permission.COLONY_SHARE_PUBLIC,
    });
  }

  /**
   * The roster, on the website.
   *
   * ★ THE WHOLE FEATURE WAS COMPANION-ONLY ★
   *
   * Join, leave, claim and assign were built, tested and reachable only from the desktop app —
   * this controller had no roster routes at all. So a member reading the board on the website could
   * see what a build needed and had no way to say they would bring any of it, and an officer could
   * not hand work out without alt-tabbing into a different application.
   *
   * The same service the companion uses, so the two surfaces cannot disagree about who is on a
   * build or who may direct it.
   */
  /**
   * The build catalogue.
   *
   * ★ WHY THIS IS NOT UNDER `projects` ★
   *
   * It is not about any project. It is what a KIND of build costs, which is the question somebody
   * has before they have posted anything — and the whole reason the catalogue exists.
   *
   * COLONY_VIEW, like the boards: it is squadron planning material, not public reference.
   */
  /**
   * ★ THE PLANNER — SQUADRON OWNER, 2026-08-03 ★
   *
   * "a layout of the system, with spots on each planet that we can settle etc ... add a new page to
   * colonization called Planning."
   *
   * A plan is not a project: a project tracks a construction site that exists, and a plan is the
   * shape of a system somebody intends to build. Read is COLONY_VIEW; who may CHANGE one is decided
   * by whose plan it is, in the service, exactly as it is for projects.
   */
  /**
   * ★ FLEET CARRIERS ON A BUILD — SQUADRON OWNER, 2026-08-02 ★
   *
   * "we also need a way to add fleet carriers to the project like raven colonial does", and
   * "squadron carriers too".
   *
   * COLONY_VIEW to look and to attach: a member offering their own carrier to somebody else's build
   * is the case this exists for, and gating it behind rank would mean the person with the cargo
   * cannot say so. Marking one as the SQUADRON'S needs COLONY_MANAGE — that is a claim about whose
   * it is, checked in the service.
   */
  /**
   * One carrier's whole run: every build it serves, added up, and where to buy the difference.
   *
   * ★ SQUADRON OWNER, 2026-08-09 ★
   *
   * "it can be active on many projects and it will give me an aggregated total of all materials
   * needed to get all the builds completed if i am buying and storing on a fleet carrier"
   *
   * ★ KEYED ON THE CARRIER, WHICH IS THE WHOLE POINT ★
   *
   * Not "projects I picked". A carrier holds one hold, and the arithmetic only works when the thing
   * doing the holding is the thing being asked — see `manifest`, which subtracts its cargo once
   * rather than once per build the way three project pages read together would.
   *
   * The sourcing runs on the aggregate for the same reason. Priced per project and added up, a
   * commodity two builds both want would name two stations for two part-loads; priced once, it names
   * the station that can actually fill the run.
   */
  @Get('carriers/:marketId/manifest')
  async carrierManifest(
    @User() caller: CurrentUser | undefined,
    @Param('marketId') marketId: string,
    @Query('near') near?: string,
    @Query('withinLy') withinLy?: string,
    @Query('largePad') largePad?: string,
    @Query('sort') sort?: string,
  ) {
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    // Rejected rather than coerced: `BigInt('')` is 0n, which is a market id somebody might hold.
    if (!/^\d{1,19}$/.test(marketId)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'That is not a market id.');
    }

    const manifest = await this.carriers.manifest(BigInt(marketId));
    if (manifest.carrier === null) {
      // Cloak, like every other colonisation read: a carrier nobody has attached is not ours to
      // confirm the existence of.
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Not found.');
    }

    const origin = await this.#origin(near);

    /*
     * The manifest already did the netting, so the sourcing is handed what is left to BUY and no
     * cover at all. Passing the cover again here would subtract the same cargo a second time.
     */
    const shopping = await this.colony.shoppingListForNeeds(
      // The flight key is the carrier's, not a project's — see `shoppingListForNeeds`.
      JSON.stringify([
        'carrier',
        marketId,
        origin === null ? null : [origin.coords.x, origin.coords.y, origin.coords.z],
        withinLy ?? '',
        largePad ?? '',
        sort ?? '',
        // The needs themselves, so a delivery landing mid-cache does not serve a stale run.
        manifest.lines.map((l) => `${l.commodity}:${l.toBuy}`).join(','),
      ]),
      manifest.lines.map((l) => ({
        commodity: l.commodity,
        remaining: l.toBuy,
        required: l.needed,
        observedAt: new Date(),
      })),
      {
        near: origin?.coords ?? null,
        withinLy: clamp(numberOr(withinLy, 100), 1, 500),
        largePadOnly: largePad === '1',
        sort: sort === 'closest' ? 'closest' : sort === 'cheapest' ? 'cheapest' : 'local',
      },
    );

    return { ...manifest, shopping };
  }

  /**
   * Where the squadron has actually bought this build's materials, grouped by station.
   *
   * ★ SQUADRON OWNER, 2026-08-10 ★
   *
   * "group all materials bought at each station by the station name and system name please! so its
   * easy for us to identify where to go!"
   *
   * The shopping list answers one commodity at a time, which is right for planning and wrong for
   * flying. A hauler wants one destination that fills the hold, so this is keyed on the station.
   *
   * ★ THE GATE IS THE OWNER'S, AND IT NEEDS NO NEW FIELD ★
   *
   * "only for projects in systems that are being colonized by the commander that started the
   * colonization project". Every system with projects has exactly one distinct poster, measured on
   * production — so the coloniser IS the poster, and a system with several posters returns nothing
   * and the page renders exactly as it does today.
   */
  @Get('projects/:id/purchases')
  async purchaseCatalogue(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Query('order') order?: string,
  ) {
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    const scope = await this.purchases.visibleFor(id);
    // Not an error: a project outside the gate simply has no catalogue, and the page hides the panel.
    if (scope === null) return { systemName: null, stations: [], uncovered: [] };

    /*
     * The member's sort choice, carried through rather than decided here.
     *
     * ★ A TOGGLE, NOT A DEFAULT — SQUADRON OWNER, 2026-08-17 ★
     *
     * Asked whether a squadron station far away should outrank a neutral one nearby, the answer was
     * to show both orderings and let the member choose. Anything other than `closest` means "ours
     * first", so a missing or mistyped value lands on the ordering the criteria describe.
     */
    return this.purchases.forProject(id, order === 'closest' ? 'closest' : 'ours');
  }

  /**
   * The officers' list of stations the squadron holds.
   *
   * ★ THE TABLE WAS READ BY THE RANKING AND WRITTEN BY NOTHING ★
   *
   * `station_ownership_claims` shipped with the buy-location ordering and is consulted on every
   * where-to-buy query. It had no route, no service method and no screen, so the officer override
   * the schema describes at length -- "it does not cover a station we hold but never built here" --
   * could not be exercised by anybody. These three routes are that override.
   *
   * COLONY_MANAGE, not COLONY_VIEW: a claim changes where the whole squadron is sent to shop.
   * Reading the list is gated the same way, because it names which officer said what and that is
   * an officers' conversation.
   */
  /**
   * What this system should be built as, and why.
   *
   * ★ SQUADRON OWNER, 2026-08-18 ★
   *
   * "add to the planning service in the companion app and website so we can do this exactly as
   * you've done ... this will help the squadron immensely!"
   *
   * COLONY_VIEW, not COLONY_MANAGE: this is advice, it changes nothing, and the member deciding
   * whether a system is worth hauling to is usually not an officer. The bloc routes below, which
   * DO change what the advice says for everybody, are officers-only.
   */
  /**
   * A first layout for a system, proposed by the assistant and ruled on by the plan checker.
   *
   * ★ POST, AND COLONY_POST ★
   *
   * A GET invites a browser to make an assistant call on every prefetch, and this one costs a model
   * round trip. It is also gated harder than the advice beside it: reading what a system is good for
   * is for everybody, and generating a layout is for somebody who could actually post one.
   *
   * The checker's verdict comes back with the draft — see `draft()` for why it is never repaired.
   */
  /**
   * Lays out a system, working around whatever is already there.
   *
   * ★ SQUADRON OWNER, 2026-08-22 ★
   *
   * "if a system already has a partial build ask the user if they want to override it, or if they
   * want to keep it and we work around it etc."
   *
   * `planId` names the plan to work around; without it this drafts a fresh system exactly as before.
   * `mode` is the member's answer, and its absence is not a default — a plan with intentions in it
   * comes back with a question and no steps, so nobody spends a model call on a layout they are
   * about to reject.
   *
   * The caller's id travels so the service can resolve THEIR visibility of that plan; a draft must
   * not become a side door onto one they could not otherwise open.
   */
  @Post('systems/:name/draft')
  async draftLayout(
    @User() caller: CurrentUser | undefined,
    @Param('name') name: string,
    @Body() body: { planId?: string; mode?: string } = {},
  ) {
    const me = this.#requireSession(caller);
    await this.#assert(caller, Permission.COLONY_POST, 'You cannot post colonisation plans.');

    // Narrowed here rather than trusted: anything that is not one of the two answers is no answer,
    // which makes the service ask rather than silently picking one.
    const mode = body.mode === 'keep' || body.mode === 'override' ? body.mode : undefined;

    return this.advisor.draft(decodeURIComponent(name), {
      ...(typeof body.planId === 'string' && body.planId !== '' ? { planId: body.planId } : {}),
      callerId: me.userId,
      ...(mode === undefined ? {} : { mode }),
    });
  }

  @Get('systems/:name/advice')
  async systemAdvice(@User() caller: CurrentUser | undefined, @Param('name') name: string) {
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    return this.advisor.advise(decodeURIComponent(name));
  }

  /**
   * The squadron's named groups of systems.
   *
   * A bloc is what lets the advice see a MISSING LINK — that the squadron refines ore in one system
   * and builds high tech in another and has nothing in between — which no single-system view can
   * produce. Officers decide the grouping because it changes the recommendation everybody reads.
   */
  @Get('blocs')
  async blocs(@User() caller: CurrentUser | undefined) {
    await this.#assert(caller, Permission.COLONY_VIEW, 'You do not have access to the colonisation boards.');

    const rows = await this.db.$queryRawUnsafe<
      Array<{ id: string; name: string; note: string | null; system_name: string | null; role: string | null }>
    >(
      `SELECT b.id::text, b.name, b.note, s.system_name, s.role
         FROM colony_blocs b
         LEFT JOIN colony_bloc_systems s ON s.bloc_id = b.id
        ORDER BY b.name, s.system_name`,
    );

    const byId = new Map<string, { id: string; name: string; note: string | null; systems: Array<{ systemName: string; role: string | null }> }>();
    for (const r of rows) {
      let bloc = byId.get(r.id);
      if (bloc === undefined) {
        bloc = { id: r.id, name: r.name, note: r.note, systems: [] };
        byId.set(r.id, bloc);
      }
      if (r.system_name !== null) bloc.systems.push({ systemName: r.system_name, role: r.role });
    }
    return { blocs: [...byId.values()] };
  }

  @Post('blocs')
  async createBloc(@User() caller: CurrentUser | undefined, @Body() body: unknown) {
    const me = this.#requireSession(caller);
    await this.#assert(caller, Permission.COLONY_MANAGE, 'Only officers manage system blocs.');

    const raw = (body ?? {}) as Record<string, unknown>;
    const name = typeof raw['name'] === 'string' ? raw['name'].trim().slice(0, 80) : '';
    if (name === '') throw new AppError(ErrorCode.VALIDATION_FAILED, 'Name the bloc.');

    const note = typeof raw['note'] === 'string' && raw['note'].trim() !== '' ? raw['note'].trim().slice(0, 400) : null;

    const [row] = await this.db.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO colony_blocs (name, note, created_by_id) VALUES ($1, $2, $3::uuid)
       ON CONFLICT (name) DO UPDATE SET note = EXCLUDED.note
       RETURNING id::text`,
      name,
      note,
      me.userId,
    );
    return { id: row?.id ?? '', name };
  }

  /**
   * Put a system in a bloc, and say what it is for.
   *
   * The role is what the squadron DECIDED, not what the bodies suggest — and that distinction is the
   * whole point. A system with perfect extraction bodies that officers chose to make military IS
   * military, and a gap analysis counting potential rather than decisions would report a supply
   * chain the squadron does not have.
   */
  @Post('blocs/:id/systems')
  async addBlocSystem(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const me = this.#requireSession(caller);
    await this.#assert(caller, Permission.COLONY_MANAGE, 'Only officers manage system blocs.');

    const raw = (body ?? {}) as Record<string, unknown>;
    const systemName = typeof raw['systemName'] === 'string' ? raw['systemName'].trim().slice(0, 80) : '';
    if (systemName === '') throw new AppError(ErrorCode.VALIDATION_FAILED, 'Name the system.');

    // Narrowed to what the ranking understands. Anything else is stored as "no role decided" rather
    // than as a value the gap analysis would silently ignore.
    const known = ['extraction', 'refinery', 'industrial', 'hightech', 'agriculture', 'tourism', 'military', 'colony'];
    const role = typeof raw['role'] === 'string' && known.includes(raw['role']) ? raw['role'] : null;

    await this.db.$executeRawUnsafe(
      `INSERT INTO colony_bloc_systems (bloc_id, system_name, role, added_by_id)
       VALUES ($1::uuid, $2, $3, $4::uuid)
       ON CONFLICT (bloc_id, system_name) DO UPDATE SET role = EXCLUDED.role`,
      id,
      systemName,
      role,
      me.userId,
    );
    return { ok: true };
  }

  @Delete('blocs/:id/systems/:name')
  async removeBlocSystem(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Param('name') name: string,
  ) {
    this.#requireSession(caller);
    await this.#assert(caller, Permission.COLONY_MANAGE, 'Only officers manage system blocs.');

    await this.db.$executeRawUnsafe(
      `DELETE FROM colony_bloc_systems WHERE bloc_id = $1::uuid AND lower(system_name) = lower($2)`,
      id,
      decodeURIComponent(name),
    );
    return { ok: true };
  }

  @Get('station-claims')
  async stationClaims(@User() caller: CurrentUser | undefined) {
    await this.#assert(caller, Permission.COLONY_MANAGE, 'Only officers manage station ownership.');
    return { claims: await this.purchases.listStationClaims() };
  }

  @Post('station-claims')
  async claimStation(@User() caller: CurrentUser | undefined, @Body() body: unknown) {
    const me = this.#requireSession(caller);
    await this.#assert(caller, Permission.COLONY_MANAGE, 'Only officers manage station ownership.');

    const raw = (body ?? {}) as Record<string, unknown>;
    /*
     * Narrowed here rather than defaulted. The schema says an unrecognised value "should degrade to
     * 'not ours' rather than break the sort" -- right for a row already in the table, wrong for
     * somebody pressing a button, because storing a claim that ranks as unowned looks like it
     * worked and changes nothing.
     */
    const ownership = readClaimOwnership(raw['ownership']);
    if (ownership === null) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Say whose it is: the squadron or a member.');
    }

    return this.purchases.claimStation({
      stationName: typeof raw['stationName'] === 'string' ? raw['stationName'] : '',
      systemName: typeof raw['systemName'] === 'string' ? raw['systemName'] : '',
      ownership,
      note: typeof raw['note'] === 'string' && raw['note'].trim() !== '' ? raw['note'] : null,
      callerId: me.userId,
    });
  }

  @Delete('station-claims/:key')
  async withdrawStationClaim(
    @User() caller: CurrentUser | undefined,
    @Param('key') key: string,
  ) {
    this.#requireSession(caller);
    await this.#assert(caller, Permission.COLONY_MANAGE, 'Only officers manage station ownership.');
    return this.purchases.withdrawStationClaim(decodeURIComponent(key));
  }

  @Post('projects/:id/purchases')
  async declarePurchase(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Body()
    body: {
      commodity?: string;
      stationName?: string;
      stationSystem?: string;
      tonnes?: number;
      price?: number;
      note?: string;
    },
  ) {
    const me = this.#requireSession(caller);
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    const scope = await this.purchases.visibleFor(id);
    if (scope === null) {
      // Refused rather than silently stored: a row written into a catalogue nobody can see is a
      // member's effort thrown away without telling them.
      throw new AppError(
        ErrorCode.RESOURCE_NOT_VISIBLE,
        'This build does not keep a purchase catalogue.',
      );
    }

    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null;

    return this.purchases.declare({
      systemName: scope.systemName,
      stationName: body.stationName ?? '',
      stationSystem: body.stationSystem ?? '',
      commodity: body.commodity ?? '',
      tonnes: num(body.tonnes),
      price: num(body.price),
      note: typeof body.note === 'string' && body.note.trim() !== '' ? body.note : null,
      userId: me.userId,
    });
  }

  @Post('projects/:id/purchases/withdraw')
  async withdrawPurchase(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Body() body: { commodity?: string; stationName?: string },
  ) {
    const me = this.#requireSession(caller);
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    const scope = await this.purchases.visibleFor(id);
    if (scope === null) throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Not found.');

    return this.purchases.withdraw({
      systemName: scope.systemName,
      stationName: (body.stationName ?? '').trim(),
      commodity: (body.commodity ?? '').trim(),
      userId: me.userId,
    });
  }

  @Get('projects/:id/carriers')
  async carrierSearch(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Query('q') q?: string,
  ) {
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    return { carriers: await this.carriers.search(id, q ?? '') };
  }

  @Post('projects/:id/carriers')
  async attachCarrier(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Body() body: { marketId?: string; isSquadron?: boolean },
  ) {
    const me = this.#requireSession(caller);
    const mask = await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    return this.carriers.attach({
      projectId: id,
      marketId: (body.marketId ?? '').trim(),
      isSquadron: body.isSquadron === true,
      callerId: me.userId,
      callerMask: mask,
    });
  }

  @Delete('projects/:id/carriers/:marketId')
  async detachCarrier(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Param('marketId') marketId: string,
  ) {
    const me = this.#requireSession(caller);
    const mask = await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    await this.carriers.detach({
      projectId: id,
      marketId,
      callerId: me.userId,
      callerMask: mask,
    });
    return { ok: true };
  }

  /**
   * Declares, corrects or clears a MANUAL tonnage on an attached carrier.
   *
   * COLONY_VIEW here; the interesting check — crew membership — is the service's, because
   * "who may say what is aboard" is a fact about the build's roster, not about rank.
   */
  @Patch('projects/:id/carriers/:marketId/cargo')
  async setCarrierCargo(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Param('marketId') marketId: string,
    @Body() body: { commodity?: string; tonnes?: number | null },
  ) {
    const me = this.#requireSession(caller);
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    await this.carriers.setManual({
      projectId: id,
      marketId,
      commodity: body.commodity ?? '',
      tonnes: typeof body.tonnes === 'number' ? body.tonnes : null,
      callerId: me.userId,
    });
    return { ok: true };
  }

  @Get('plans')
  async plans(@User() caller: CurrentUser | undefined, @Query('owner') owner?: string) {
    const me = this.#requireSession(caller);
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    const scope = owner === 'squadron' || owner === 'personal' ? owner : 'all';
    return { plans: await this.plans_.list(scope, me.userId) };
  }

  /**
   * Systems the caller has claimed in game and not planned yet.
   *
   * Read straight from their own journal uploads. Scoped to the caller and never widened — a claim
   * is a statement about somebody's intentions, and the consent catalogue promises exactly that.
   */
  @Get('plans/claimed')
  async claimed(@User() caller: CurrentUser | undefined) {
    const me = this.#requireSession(caller);
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    return { claimed: await this.plans_.claimedWithoutPlan(me.userId) };
  }

  /**
   * The plan as a build book — one printable HTML file.
   *
   * Squadron owner: "the build guide generator is also not anywhere i can find it?"
   *
   * Served as a DOWNLOAD rather than a page. It is read beside the game, on a second monitor or on
   * paper, and a browser tab is the one place it cannot be while somebody is flying.
   */
  @Get('plans/:id/book')
  async planBook(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const me = this.#requireSession(caller);
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    const html = await this.plans_.book(id, me.userId);
    if (html === null) {
      /*
       * RESOURCE_NOT_VISIBLE, not NOT_FOUND: the two are the same answer on purpose. "It exists but
       * is not yours" tells somebody a plan is there, which is a fact about another member's work
       * they had no way to learn.
       */
      throw new AppError(
        ErrorCode.RESOURCE_NOT_VISIBLE,
        'That plan does not exist, or is not yours to read.',
      );
    }

    void reply.header('content-type', 'text/html; charset=utf-8');
    // A filename, so it lands in Downloads as something recognisable rather than "book".
    void reply.header('content-disposition', `attachment; filename="build-book-${id}.html"`);
    return html;
  }

  @Get('plans/:id')
  async plan(@User() caller: CurrentUser | undefined, @Param('id') id: string) {
    const me = this.#requireSession(caller);
    const mask = await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    const plan = await this.plans_.byId(id, me.userId);
    if (plan === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That plan is not available.');
    }
    // The real rule, not the page's guess at it. See `mayEdit`.
    return { plan, can: { edit: await this.plans_.mayEdit(id, me.userId, mask) } };
  }

  @Post('plans')
  async createPlan(
    @User() caller: CurrentUser | undefined,
    @Body() body: { owner?: string; title?: string; systemName?: string },
  ) {
    const me = this.#requireSession(caller);
    const mask = await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    return this.plans_.create({
      owner: body.owner === 'squadron' ? 'squadron' : 'personal',
      title: body.title ?? '',
      systemName: body.systemName ?? '',
      callerId: me.userId,
      callerMask: mask,
    });
  }

  /**
   * How many slots a body has, as read off the in-game architect view.
   *
   * COLONY_VIEW only. It is an observation about the galaxy rather than a decision about the
   * squadron, and gating it behind rank would mean the one member who actually flew there could not
   * write down what they saw.
   */
  @Patch('plans/bodies/:systemId64/:bodyId')
  async setSlots(
    @User() caller: CurrentUser | undefined,
    @Param('systemId64') systemId64: string,
    @Param('bodyId') bodyId: string,
    @Body() body: { orbital?: number | null; surface?: number | null },
  ) {
    const me = this.#requireSession(caller);
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    await this.plans_.setSlots({
      systemId64: BigInt(systemId64),
      bodyId: Number(bodyId),
      orbital: typeof body.orbital === 'number' ? body.orbital : null,
      surface: typeof body.surface === 'number' ? body.surface : null,
      callerId: me.userId,
    });
    return { ok: true };
  }

  /**
   * What importing a Raven Colonial export would change. Writes nothing.
   *
   * ★ SQUADRON OWNER, 2026-08-24: "Import wins, and say so." ★
   *
   * Two routes rather than one, because the saying-so has to happen before the winning. The worst
   * outcome here is silently replacing a plan somebody spent an evening on, so the member sees the
   * consequences — including what they would lose — and then decides.
   *
   * COLONY_VIEW to preview: reading what a file WOULD do to a plan you can already open discloses
   * nothing you could not see by opening it. Applying needs the edit right, checked in the service
   * against whose plan it is.
   */
  @Post('plans/:id/import/preview')
  async previewImport(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Body() body: { file?: unknown } = {},
  ) {
    const me = this.#requireSession(caller);
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    const read = await this.plans_.previewImport(id, me.userId, body.file);
    if (read === null) {
      /*
       * One answer for "no such plan", "not yours to see" and "that file could not be read". The
       * first two must not be distinguishable — the same reasoning the project routes follow — and
       * the third is reported in the preview's own words when the file parses at all.
       */
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'That file could not be read as a Raven Colonial export.',
      );
    }

    return { preview: read.preview, system: read.file.systemName };
  }

  /** Applies the import. Slot counts only — see the service for why structures are not written. */
  @Post('plans/:id/import')
  async applyImport(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Body() body: { file?: unknown } = {},
  ) {
    const me = this.#requireSession(caller);
    const mask = await this.#assert(
      caller,
      Permission.COLONY_POST,
      'You cannot edit colonisation plans.',
    );

    const done = await this.plans_.applyImport(id, me.userId, mask, body.file);
    if (done === null) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'That file could not be read as a Raven Colonial export.',
      );
    }

    return done;
  }

  @Post('plans/:id/sites')
  async addPlanSite(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Body()
    body: { version?: number; bodyId?: number | null; location?: string; buildTypeId?: string | null },
  ) {
    const me = this.#requireSession(caller);
    const mask = await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    return this.plans_.addSite({
      planId: id,
      callerId: me.userId,
      callerMask: mask,
      version: typeof body.version === 'number' ? body.version : 0,
      bodyId: typeof body.bodyId === 'number' ? body.bodyId : null,
      location: body.location === 'surface' ? 'surface' : 'orbital',
      buildTypeId: typeof body.buildTypeId === 'string' && body.buildTypeId !== '' ? body.buildTypeId : null,
    });
  }

  @Delete('plans/:id/sites/:siteId')
  async removePlanSite(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Param('siteId') siteId: string,
    @Query('version') version?: string,
  ) {
    const me = this.#requireSession(caller);
    const mask = await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    return this.plans_.removeSite({
      planId: id,
      siteId,
      callerId: me.userId,
      callerMask: mask,
      version: Number(version ?? 0),
    });
  }

  /** The whole build order at once, which is what a drag produces. */
  /**
   * "Read my plan and tell me what is wrong with it."
   *
   * ★ SQUADRON OWNER, 2026-08-10 ★
   *
   * Chosen from the colonisation suggestions. The planner already says whether a plan is payable
   * and what it becomes; nothing read those findings back in a member's own language, or decided
   * which of eleven problems is the one that will cost them a fortnight.
   *
   * POST rather than GET: it costs a model call, so it happens when somebody asks for it rather
   * than every time a page renders.
   */
  @Post('plans/:id/review')
  async reviewPlan(@User() caller: CurrentUser | undefined, @Param('id') id: string) {
    const me = this.#requireSession(caller);
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation planner.',
    );

    const out = await this.review.review(id, me.userId);
    // Cloaked as not-visible rather than not-found, per INV-002: a plan somebody may not read must
    // not be distinguishable from one that does not exist.
    if (out === null) throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No such plan.');
    return out;
  }

  @Patch('plans/:id/order')
  async reorderPlan(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Body() body: { version?: number; siteIds?: string[] },
  ) {
    const me = this.#requireSession(caller);
    const mask = await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    return this.plans_.reorder({
      planId: id,
      siteIds: Array.isArray(body.siteIds) ? body.siteIds : [],
      callerId: me.userId,
      callerMask: mask,
      version: typeof body.version === 'number' ? body.version : 0,
    });
  }

  @Delete('plans/:id')
  async removePlan(@User() caller: CurrentUser | undefined, @Param('id') id: string) {
    const me = this.#requireSession(caller);
    const mask = await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    await this.plans_.remove(id, me.userId, mask);
    return { ok: true };
  }

  @Get('build-types')
  async buildTypes(@User() caller: CurrentUser | undefined) {
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    return { buildTypes: await this.catalogue.list() };
  }

  @Get('build-types/:id')
  async buildType(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Query('near') near?: string,
  ) {
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    /*
     * No origin means no prices, deliberately. A cheapest-anywhere figure is a number nobody can
     * act on, and worse, it looks like a real quote — so the page asks where you are buying from
     * rather than inventing an answer.
     */
    const origin = await this.#origin(near);
    const detail = await this.catalogue.byId(id, origin?.coords ?? null);
    if (detail === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No such build type.');
    }

    return {
      buildType: detail,
      origin: origin === null ? null : { system: origin.system },
      unknownSystem: (near?.trim() ?? '') !== '' && origin === null ? near?.trim() : null,
    };
  }

  @Get('projects/:id/roster')
  async roster(@User() caller: CurrentUser | undefined, @Param('id') id: string) {
    const me = this.#requireSession(caller);
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    return { roster: await this.rosters.roster(id, me.userId) };
  }

  /** Volunteering is not a privilege — COLONY_VIEW is the whole bar. */
  @Post('projects/:id/join')
  async join(@User() caller: CurrentUser | undefined, @Param('id') id: string) {
    const me = this.#requireSession(caller);
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    await this.rosters.join(id, me.userId);
    return { ok: true };
  }

  @Post('projects/:id/leave')
  async leave(@User() caller: CurrentUser | undefined, @Param('id') id: string) {
    const me = this.#requireSession(caller);
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    await this.rosters.leave(id, me.userId);
    return { ok: true };
  }

  /**
   * Everything the caller owes, across every build they are on.
   *
   * ★ THE SAME ANSWER THE APP GETS — SQUADRON OWNER'S STANDING RULE ★
   *
   * "we need all of this in full parity on the website and the companion app." One service call and
   * one `mergeNeeds`, shared with the device route, so a member planning a buying run on the site
   * and flying it with the app cannot be handed two different lists.
   */
  @Get('owed')
  async owed(@User() caller: CurrentUser | undefined) {
    const me = this.#requireSession(caller);
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    return mergeNeeds(await this.colony.everythingOwed(me.userId));
  }

  /**
   * Declares this build the caller's current one — the one the companion's overlay pins.
   *
   * COLONY_VIEW is the whole bar, like join: saying which build you are hauling to is not a
   * privilege. The service enforces "at most one per member" through the table's key, so setting
   * a second build moves the pin rather than growing a list.
   */
  @Post('projects/:id/current')
  async setCurrent(@User() caller: CurrentUser | undefined, @Param('id') id: string) {
    const me = this.#requireSession(caller);
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    await this.rosters.setCurrent(id, me.userId);
    return { ok: true };
  }

  @Delete('projects/:id/current')
  async clearCurrent(@User() caller: CurrentUser | undefined, @Param('id') id: string) {
    const me = this.#requireSession(caller);
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    await this.rosters.clearCurrent(id, me.userId);
    return { ok: true };
  }

  /**
   * Claim a commodity, or put one on somebody else.
   *
   * Gated on COLONY_VIEW here rather than something stronger, because the interesting check is not
   * the caller's rank in general — it is whose build this is, and the service makes it. A member
   * claiming for themselves needs no permission beyond seeing the board.
   */
  @Post('projects/:id/assign')
  async assign(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Body() body: { userId?: string; commodity?: string; tonnes?: number },
  ) {
    const me = this.#requireSession(caller);
    const mask = await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    await this.rosters.assign({
      projectId: id,
      callerId: me.userId,
      callerMask: mask,
      // Absent means "me". The common case is a member claiming something, and making the page send
      // its own id back to identify itself would be a value it could get wrong.
      targetUserId: typeof body.userId === 'string' && body.userId !== '' ? body.userId : me.userId,
      commodity: body.commodity ?? '',
      tonnes: typeof body.tonnes === 'number' ? body.tonnes : null,
    });

    return { ok: true };
  }

  @Post('projects/:id/unassign')
  async unassign(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Body() body: { userId?: string; commodity?: string },
  ) {
    const me = this.#requireSession(caller);
    const mask = await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    await this.rosters.unassign({
      projectId: id,
      callerId: me.userId,
      callerMask: mask,
      targetUserId: typeof body.userId === 'string' && body.userId !== '' ? body.userId : me.userId,
      commodity: body.commodity ?? '',
    });

    return { ok: true };
  }

  /**
   * Closing, reopening and deleting.
   *
   * ★ GATED ON COLONY_VIEW HERE, ON PURPOSE ★
   *
   * The interesting check is not the caller's rank in general — it is whose build this is, and the
   * service makes it. A member closing their own project needs no permission beyond seeing the
   * board; an officer closing the squadron's needs COLONY_MANAGE. One rule, in one place, shared
   * with the roster.
   */
  @Patch('projects/:id/close')
  async close(@User() caller: CurrentUser | undefined, @Param('id') id: string) {
    const me = this.#requireSession(caller);
    const mask = await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    await this.colony.close(id, me.userId, mask);
    return { ok: true };
  }

  /**
   * "I flew out and it is already built."
   *
   * ★ COLONY_VIEW, NOT COLONY_MANAGE — SQUADRON OWNER, 2026-08-12 ★
   *
   * Every other write on this controller asks whose build it is. This one deliberately does not.
   * The member who discovers a build is finished is almost never an officer — it is whoever arrived
   * with a full hold and found nothing to deliver to — and until now they had no way to tell
   * anybody, so the next member repeated the trip.
   *
   * It closes rather than flags because it is reversible, audited against the reporter by name, and
   * announced the moment it happens. Flagging would leave the wasted trips running until an officer
   * noticed, which is the behaviour being fixed.
   */
  @Patch('projects/:id/report-built')
  async reportBuilt(@User() caller: CurrentUser | undefined, @Param('id') id: string) {
    const me = this.#requireSession(caller);
    await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    await this.colony.reportBuilt(id, me.userId);
    return { ok: true };
  }

  @Patch('projects/:id/reopen')
  async reopen(@User() caller: CurrentUser | undefined, @Param('id') id: string) {
    const me = this.#requireSession(caller);
    const mask = await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    await this.colony.reopen(id, me.userId, mask);
    return { ok: true };
  }

  /**
   * Gives up on a build, or takes that back.
   *
   * Squadron owner, 2026-08-15: "we also need to allow admins to mark builds as abandoned and not
   * always just as complete."
   *
   * The permission check is COLONY_VIEW here and COLONY_MANAGE inside the service, matching every
   * other write on this controller: the guard says "you may use the colonisation boards at all",
   * and whose build it is — and whether this particular member may direct it — is the service's
   * question, because it needs the row to answer.
   */
  @Patch('projects/:id/abandoned')
  async setAbandoned(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Body() body: { abandoned?: unknown; note?: unknown },
  ) {
    const me = this.#requireSession(caller);
    const mask = await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    await this.colony.setAbandoned({
      projectId: id,
      callerId: me.userId,
      mask,
      // Explicit, not truthy. `{}` posted by a broken client must not read as "abandon it".
      abandoned: body.abandoned === true,
      ...(typeof body.note === 'string' ? { note: body.note } : {}),
    });
    return { ok: true };
  }

  @Delete('projects/:id')
  async remove(@User() caller: CurrentUser | undefined, @Param('id') id: string) {
    const me = this.#requireSession(caller);
    const mask = await this.#assert(
      caller,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    await this.colony.remove(id, me.userId, mask);
    return { ok: true };
  }

  /**
   * Handing a personal project to the squadron, or handing it back.
   *
   * Squadron owner, 2026-08-05: "give admins the option after the fact to turn a project into a
   * squadron project". COLONY_MANAGE, not the poster: adopting a build commits the squadron's
   * playing time, and that was never the poster's to commit — the same reasoning that stops a
   * member marking their own build as the squadron's current effort.
   */
  @Patch('projects/:id/owner')
  async setOwner(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Body() body: { owner?: string },
  ) {
    const me = this.#requireSession(caller);
    await this.#assert(
      caller,
      Permission.COLONY_MANAGE,
      'Only officers can change who owns a colonisation project.',
    );

    if (body.owner !== 'squadron' && body.owner !== 'personal') {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Say whether it belongs to the squadron or to the member who posted it.',
      );
    }

    return this.colony.setOwner(id, body.owner, me.userId);
  }

  @Patch('projects/:id/priority')
  async priority(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Body() body: { isPriority?: boolean },
  ) {
    const me = this.#requireSession(caller);
    await this.#assert(
      caller,
      Permission.COLONY_MANAGE,
      'Only officers can set the squadron’s current effort.',
    );

    // The actor travels so the squadron feed can put a face on "the current effort changed".
    await this.colony.setPriority(id, body.isPriority === true, me.userId);
    return { ok: true };
  }

  /** A typed system, for the shopping list's distances. Null when we cannot place it. */
  async #origin(
    near: string | undefined,
  ): Promise<{ coords: { x: number; y: number; z: number }; system: string } | null> {
    const typed = near?.trim() ?? '';
    if (typed === '') return null;

    const coords = await this.market.systemCoords(typed);
    return coords === null ? null : { coords, system: typed };
  }
}

/**
 * The construction site's market id.
 *
 * Thrown on rather than defaulted. Zero is what `Number('')` and a stray letter both produce, and a
 * project filed under market id 0 would never match a journal event — a board entry that silently
 * never updates, which reads as the sync being broken.
 */
function parseMarketId(raw: string | undefined): bigint {
  const text = (raw ?? '').trim();
  if (!/^\d+$/.test(text)) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      'That is not a market id. Dock at the construction site and copy the id the companion app shows.',
    );
  }
  return BigInt(text);
}

/** Every bit, not any of them — the same AND semantics every other check here uses. */
function has(mask: bigint, need: bigint): boolean {
  return (mask & need) === need;
}

function numberOr(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
