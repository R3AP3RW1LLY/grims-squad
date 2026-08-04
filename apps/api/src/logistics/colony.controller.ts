import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { AppError, ErrorCode, Permission, ROLE_PRESETS } from '@grims/shared';
import { Public } from '../auth/auth.guard.js';
import { User, type CurrentUser } from '../auth/current-user.js';
import { PermissionService } from '../authz/permission.service.js';
import { ColonyService, type ColonyOwner, type ColonyVisibility } from './colony.service.js';
import { ColonyRosterService } from './colony-roster.service.js';
import { ColonyCatalogueService } from './colony-catalogue.service.js';
import { ColonyCarrierService } from './colony-carrier.service.js';
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
    // `plans_` because `plans` is the route method below it, and a field cannot share its name.
    @Inject(ColonyPlanService) private readonly plans_: ColonyPlanService,
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

    return {
      projects: await this.colony.board(scope, caller === undefined ? null : { userId: caller.userId }),
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

    const [needs, haulers, shopping, deliveries, chart, carriers] = await Promise.all([
      this.colony.needs(id),
      this.colony.haulers(id),
      this.colony.shoppingList(id, {
        near: origin?.coords ?? null,
        withinLy: clamp(numberOr(withinLy, 100), 1, 500),
        largePadOnly: largePad === '1',
        sort: sort === 'closest' ? 'closest' : sort === 'cheapest' ? 'cheapest' : 'local',
      }),
      // The same two the app gets. One service, one shape — the website and the companion showing
      // different histories of the same build is the failure this whole controller exists to avoid.
      this.colony.deliveries(id),
      this.colony.deliveryChart(id),
      // What is already sitting in a hold. It changes what "remaining" means for a member deciding
      // whether to launch — twenty thousand tonnes on a carrier parked at the site is not the same
      // build as twenty thousand tonnes nobody has bought yet.
      this.carriers.forProject(id),
    ]);

    return {
      project,
      needs,
      haulers,
      shopping,
      deliveries,
      chart,
      carriers,
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

    return this.colony.create({
      userId: me.userId,
      owner,
      marketId,
      systemName: body.systemName ?? '',
      stationName: body.stationName ?? null,
      title: body.title ?? '',
      notes: body.notes ?? null,
    });
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
