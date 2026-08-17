import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission } from '@grims/shared';
import { Public } from '../auth/auth.guard.js';
import { PermissionService } from '../authz/permission.service.js';
import { PAIRING_SERVICE } from '../telemetry/telemetry.tokens.js';
import type { PairingService } from '../telemetry/pairing.service.js';
import { ColonyService, type ColonyOwner } from './colony.service.js';
import { ColonyRosterService } from './colony-roster.service.js';
import { ColonyCatalogueService } from './colony-catalogue.service.js';
import { ColonyPlanService } from './colony-plan.service.js';
import { ColonyCarrierService, carrierCover, carrierHoldLines } from './colony-carrier.service.js';
import { ColonyPurchasesService } from './colony-purchases.service.js';
import { ColonyPlanReviewService } from './colony-plan-review.service.js';
import { MARKET_STORE } from './logistics.tokens.js';
import type { MarketStore } from './market.store.js';

/**
 * Colonisation, for the companion app.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "we want the entire colonization module to be visible in the companion app! people should be able
 * to have full interaction with colonization either from the website or from the app."
 *
 * ★ THE SAME SERVICE, THE SAME PERMISSIONS — A DIFFERENT DOOR ★
 *
 * Every route here delegates to the identical `ColonyService` the website uses, and checks the
 * identical permission bits. The ONLY difference is how the caller is identified: the site has a
 * session cookie, the app has a paired device token.
 *
 * That is deliberate and it is the whole point. A second implementation for the app would drift —
 * and the half that drifted would be the one enforcing "only a personal project can be published",
 * because it is the rule nobody re-reads. One service, two front doors, no second copy of any rule.
 *
 * ★ WHY NOT JUST ACCEPT THE DEVICE TOKEN ON THE EXISTING ROUTES ★
 *
 * Because a device token is a LONGER-LIVED and WEAKER credential than a session. It lives in a
 * config file on a member's PC, it does not expire on sign-out, and it exists so a background
 * process can upload journals. Quietly making it equivalent to being signed in would widen what
 * every existing route accepts, including ones added later by somebody who never thought about the
 * companion.
 *
 * Keeping it to its own controller means the surface the app can reach is a list somebody has to
 * add to on purpose — the same reasoning as the preload bridge in the app itself.
 */
@Controller('v1/companion/colony')
export class ColonyDeviceController {
  constructor(
    @Inject(ColonyService) private readonly colony: ColonyService,
    @Inject(ColonyRosterService) private readonly rosters: ColonyRosterService,
    @Inject(ColonyCatalogueService) private readonly catalogue: ColonyCatalogueService,
    // Trailing underscore for the same reason the website's controller has one: `plans` is already
    // a route method on this class, and a field of that name would shadow it.
    @Inject(ColonyPlanService) private readonly plans_: ColonyPlanService,
    @Inject(ColonyCarrierService) private readonly carriers: ColonyCarrierService,
    // The shopping route. The same instance the website's controller uses, so "where do I fly for
    // this" has one answer rather than one per surface.
    @Inject(ColonyPurchasesService) private readonly purchases: ColonyPurchasesService,
    // The plan review. Same service as the website's, so one plan cannot get two verdicts.
    @Inject(ColonyPlanReviewService) private readonly review: ColonyPlanReviewService,
    @Inject(MARKET_STORE) private readonly market: MarketStore,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(PAIRING_SERVICE) private readonly pairing: PairingService,
  ) {}

  /**
   * The member behind a bearer token, having checked they may do this.
   *
   * The permission is resolved from the USER, not from the device: a device is a machine somebody
   * paired, and what it may do is exactly what the person holding it may do. An officer's laptop is
   * an officer; the same laptop after they are demoted is not.
   */
  async #caller(req: FastifyRequest, need: bigint, refusal: string): Promise<{ userId: string }> {
    const header = req.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    const device = token === '' ? null : await this.pairing.authenticate(token, new Date());
    if (device === null) {
      // The same opaque answer the telemetry routes give: unknown, revoked and wrongly-scoped are
      // one reply, so a caller learns only that their token is not usable.
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'This device is not paired.');
    }

    const mask = await this.permissions.effectiveMask(device.userId);
    if ((mask & need) !== need) throw new AppError(ErrorCode.PERMISSION_DENIED, refusal);

    return { userId: device.userId };
  }

  /**
   * The build catalogue, for the companion app.
   *
   * ★ SQUADRON OWNER, 2026-08-03 ★
   *
   * "ensure the Companion app matches and has all the same pages in colonization that the website
   * has please! must be a mirror!"
   *
   * The website had this and the app did not, which is exactly the split the owner has objected to
   * twice now — a member reading the board in one place could answer "what does a Coriolis cost"
   * and the same member in the other could not.
   *
   * Same service as the website's, so the two cannot give different numbers for the same build.
   */
  @Public()
  @Get('build-types')
  async buildTypes(@Req() req: FastifyRequest) {
    await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    return { buildTypes: await this.catalogue.list() };
  }

  @Public()
  @Get('build-types/:id')
  async buildType(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Query('near') near?: string,
  ) {
    await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    /*
     * No origin means no prices. A cheapest-anywhere figure is a number nobody can act on and looks
     * like a real quote — the app asks where you are buying from rather than inventing one.
     */
    /*
     * Resolved straight off the market store, the same way the shopping list does it a few methods
     * down. A system we cannot place comes back null, and the caller is told which name failed
     * rather than being shown unpriced rows with no explanation.
     */
    const wanted = near?.trim() ?? '';
    const coords = wanted === '' ? null : await this.market.systemCoords(wanted);
    const detail = await this.catalogue.byId(id, coords);
    if (detail === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No such build type.');
    }

    return {
      buildType: detail,
      origin: coords === null ? null : { system: wanted },
      unknownSystem: wanted !== '' && coords === null ? wanted : null,
    };
  }

  /**
   * Both boards, exactly as the website's sidebar shows them.
   *
   * ★ THE ONE ROUTE HERE THAT LOST ITS `@Public()`, AND WHAT IT COST ★
   *
   * Reported 2026-08-04: "I still get 'This device is no longer paired'", and "the one member
   * colonisation project that appears on the website no longer appears in the companion app".
   *
   * Both were this. `@Public()` and this method's doc comment were adjacent; the build catalogue
   * routes were later inserted BETWEEN them, so the decorator attached itself to `build-types`
   * (which then carried two) and this route was left with none. A route without it is judged by the
   * session guard, which wants a cookie the app has never had — so the board answered 401, the app
   * translated that to "no longer paired", and the project vanished from a device that was in fact
   * connected and uploading the whole time.
   *
   * Nothing failed loudly. Typecheck cannot see a missing decorator, and the route still worked
   * perfectly from a browser. `device-routes-public.spec.ts` now fails the build for it.
   */
  @Public()
  @Get('projects')
  async projects(@Req() req: FastifyRequest, @Query('owner') owner?: string) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    const scope: ColonyOwner | 'all' = owner === 'squadron' || owner === 'personal' ? owner : 'all';
    const mask = await this.permissions.effectiveMask(me.userId);

    return {
      projects: await this.colony.board(scope, me),
      // The same rendering hints the website gets, so the app can offer the same controls without
      // a second round trip and without guessing.
      can: {
        post: has(mask, Permission.COLONY_POST),
        manage: has(mask, Permission.COLONY_MANAGE),
        publish: has(mask, Permission.COLONY_SHARE_PUBLIC),
      },
    };
  }

  /**
   * One project in full: needs, haulers, and where to buy the rest.
   *
   * ★ THIS IS ALSO WHAT FEEDS THE BUILD-TRACKER OVERLAY ★
   *
   * The overlay draws the needs of the site the member is docked at. Rather than a second endpoint
   * shaped for the overlay, it reads this one — so what the panel shows and what the app's own
   * screen shows cannot disagree, which is the failure a member would report as "the overlay is
   * wrong" and nobody could reproduce on the website.
   */
  @Public()
  @Get('projects/:id')
  async project(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Query('near') near?: string,
    @Query('withinLy') withinLy?: string,
    @Query('sort') sort?: string,
    // Matches the website's own filter, so the two surfaces cannot disagree about the same build.
    @Query('largePad') largePad?: string,
  ) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    const project = await this.colony.byId(id, me);
    if (project === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That project is not available.');
    }

    /*
     * ★ THE BUILD'S OWN SYSTEM IS THE DEFAULT — REPORTED 2026-08-02 ★
     *
     * "the where to buy it, is wrong! there is a station in system that offers most of this."
     *
     * It was, and this was why: with no origin the shopping list ranked by price across the ENTIRE
     * galaxy, so a station in the build's own system was never going to win against the cheapest
     * seller in the bubble. Nothing was measuring distance because nothing had said where from.
     *
     * The obvious place to haul from is the site itself, so that is where it measures from unless
     * the member names somewhere else.
     */
    const typed = near?.trim() ?? '';
    const origin = typed === '' ? project.systemName : typed;
    const coords = origin === '' ? null : await this.market.systemCoords(origin);

    /*
     * The chart is bucketed in the MEMBER's stored zone, exactly as the website's controller does
     * it — the device's own clock is never consulted, because a laptop set to another country is
     * how the day bars ended up wrong in the first place (see deliveryChart).
     */
    const tz = await this.colony.viewerTimezone(me.userId);

    // Carriers before the shopping list, exactly as the website's controller orders it: the buy
    // maths subtracts what the attached holds cover, so the cover must exist before pricing.
    const carriers = await this.carriers.forProject(id);
    const cover = carrierCover(carriers);

    /*
     * ★ THE PROMPT THE APP RENDERS AND THE HUB NEVER SENT — 2026-08-17 ★
     *
     * The attach prompt shipped on both surfaces. The companion renders it, defends against an
     * older hub with `data.canAttach ?? []`, and has a spec asserting both of those things. Every
     * one of those statements was true, and the prompt never appeared in the app for anybody,
     * because THIS route — the only one the companion reads a project through — never put the
     * field in the payload.
     *
     * Two correct halves with the data missing in between, which is the failure this module keeps
     * producing: the website's route computed it, the app's did not, and nothing errored because
     * an absent field is indistinguishable from an empty list.
     *
     * The parity spec asserted the app RENDERS the prompt. It could not have caught this: what was
     * missing was on the other side of the wire.
     */
    const canAttach = await this.carriers
      .unattachedHoldingFor(id, me.userId)
      .catch(() => []);

    const [needs, haulers, shopping, deliveries, chart, isCrew] = await Promise.all([
      this.colony.needs(id),
      this.colony.haulers(id),
      this.colony.shoppingList(id, {
        near: coords,
        withinLy: clamp(numberOr(withinLy, 100), 1, 500),
        /*
         * ★ THE SAME ANSWER AS THE WEBSITE — it was hardcoded off here ★
         *
         * The website exposes a large-pad filter and this path pinned it to false, so the two
         * surfaces gave DIFFERENT shopping answers for the same build. Read from the query like
         * every other filter.
         */
        largePadOnly: largePad === '1',
        sort: sort === 'closest' ? 'closest' : sort === 'cheapest' ? 'cheapest' : 'local',
        carrierCover: cover,
      }),
      // "whos delivered what and when", and the stacked chart over it. Fetched with everything else
      // rather than on their own routes: the page shows them together, and three round trips would
      // render it in three stages, each shifting the layout under whoever is reading.
      this.colony.deliveries(id),
      this.colony.deliveryChart(id, tz),
      // Whether the reader is on the crew roster — the carrier-cargo pen is crew work, and the app
      // should not draw a control the service will refuse.
      this.rosters.isCrew(id, me.userId),
    ]);

    return {
      project,
      needs,
      haulers,
      shopping,
      deliveries,
      chart,
      carriers,
      /** This member's own carriers holding what the build wants, unattached. Owner-only. */
      canAttach,
      // The effective per-commodity cover, computed once and sent down — same field, same maths,
      // same numbers as the website's door.
      carrierCover: cover,
      /*
       * ★ THE RIGHTS, WHICH THE APP NEVER RECEIVED ★
       *
       * Without them the app drew every control to everybody: "Take off" on a carrier somebody else
       * attached, "Add as squadron" to a member with no rank, and — once the actions row exists —
       * Close and Delete on builds that are not theirs. The website has sent this since the day it
       * could not draw a close button for want of knowing who was reading.
       *
       * A rendering hint only; every write re-checks in the service.
       */
      can: {
        manage: (await this.permissions.effectiveMask(me.userId) & Permission.COLONY_MANAGE) ===
          Permission.COLONY_MANAGE,
        isPoster: project.postedById === me.userId,
        isCrew,
      },
      // Echoed so the page can say where it is measuring from — a distance column with no stated
      // origin is a number nobody can check.
      shoppingFrom: coords === null ? null : origin,
      shoppingSort: sort === 'closest' ? 'closest' : sort === 'cheapest' ? 'cheapest' : 'local',
    };
  }

  /**
   * The project for a market id, if we hold one.
   *
   * ★ THE ROUTE THE OVERLAY LIVES ON ★
   *
   * The app knows the member has docked, and it knows the market id from the journal. It does NOT
   * know which project that is. Everything else would need the member to have picked one from a
   * list, which defeats the purpose of a panel that appears when you arrive somewhere.
   *
   * Returns null rather than 404 for a site nobody has posted: that is the ordinary case — most
   * construction sites in the galaxy are not this squadron's — and an error for the ordinary case
   * is an error log nobody reads.
   */
  @Public()
  @Get('at/:marketId')
  async atMarket(@Req() req: FastifyRequest, @Param('marketId') marketId: string) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    // Not a market id at all. Answered as "no project here" rather than as an error: the app sends
    // whatever the journal gave it, and a malformed value is our problem to absorb, not the
    // member's to see.
    if (!/^\d+$/.test(marketId)) return { project: null, needs: [] };

    const project = await this.colony.byMarketId(BigInt(marketId), me);
    if (project === null) return { project: null, needs: [] };

    return { project, needs: await this.colony.needs(project.id) };
  }

  /** Posts a project from the app. Identical rules to the website's form. */
  @Public()
  @Post('projects')
  async create(
    @Req() req: FastifyRequest,
    @Body()
    body: {
      owner?: string;
      marketId?: string;
      systemName?: string;
      stationName?: string;
      title?: string;
      notes?: string;
      snapshot?: {
        resources?: Array<{ commodity?: unknown; required?: unknown; provided?: unknown }>;
      };
    },
  ) {
    const owner: ColonyOwner = body.owner === 'squadron' ? 'squadron' : 'personal';

    const me = await this.#caller(
      req,
      owner === 'squadron' ? Permission.COLONY_MANAGE : Permission.COLONY_POST,
      owner === 'squadron'
        ? 'Only officers can post a squadron project.'
        : 'You do not have permission to post a colonisation project.',
    );

    const raw = (body.marketId ?? '').trim();
    if (!/^\d+$/.test(raw)) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'That is not a market id. Dock at the construction site first.',
      );
    }

    return this.colony.create({
      userId: me.userId,
      owner,
      marketId: BigInt(raw),
      systemName: body.systemName ?? '',
      stationName: body.stationName ?? null,
      title: body.title ?? '',
      notes: body.notes ?? null,
      /*
       * The depot reading the app could already see. Sanitised here rather than trusted: it arrives
       * from a client we do not control, and a non-numeric amount would become NaN in a column the
       * progress bar divides by.
       */
      snapshot: readSnapshot(body.snapshot),
    });
  }

  /**
   * The shopping route — where to fly for what this build still needs.
   *
   * ★ SQUADRON OWNER, 2026-08-10 ★
   *
   * "in the companion app under the new Where the squadron has bought it we get this error: Cannot
   * GET /v1/companion/colony/projects/.../purchases"
   *
   * ★ THE ROUTE SHIPPED TO ONE CONTROLLER AND THE APP TALKS TO THE OTHER ★
   *
   * The website's endpoint went on `ColonyController` (`/v1/logistics/colony`). This is a separate
   * class serving `/v1/companion/colony`, and it had no such route — so the client function, the IPC
   * channel and the renderer were all correct and all pointed at nothing. Every test on both ends
   * passed, because each end WAS right; the gap was between them. `companion-route-parity.spec.ts`
   * now reads both files and fails on exactly this.
   *
   * Same service as the website's, so the two cannot disagree about where to send somebody — which
   * is the whole point of the owner's "must be a mirror".
   */
  @Public()
  @Get('projects/:id/purchases')
  async purchaseRoute(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Query('order') order?: string,
  ) {
    await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    const scope = await this.purchases.visibleFor(id);
    // Not an error. A build outside the gate has no catalogue, and the tab omits the panel — the
    // same answer the website gives, so neither surface has to special-case the other's shape.
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
   * Recording a station somebody actually bought at, from the app.
   *
   * The one thing no journal can say is "there is thirty thousand tonnes sitting here RIGHT NOW" —
   * a purchase is proof somebody took some away, a declaration is a claim about what is still there.
   * The service refuses a fleet carrier by name and says why; that sentence is passed through rather
   * than replaced, because it tells the member what to do instead.
   */
  @Public()
  @Post('projects/:id/purchases')
  async declarePurchase(
    @Req() req: FastifyRequest,
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
    const me = await this.#caller(
      req,
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

  /**
   * Everybody on the build, what they have taken on, and what they have delivered.
   *
   * ★ SQUADRON OWNER, 2026-08-02 ★
   *
   * "a way for people to join the project ahead of time, and a way that we can assign people who do
   * join what materials we want them to haul."
   */
  @Public()
  @Get('projects/:id/roster')
  async roster(@Req() req: FastifyRequest, @Param('id') id: string) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    return { roster: await this.rosters.roster(id, me.userId) };
  }

  /** Puts the caller on the roster. Needs only COLONY_VIEW: volunteering is not a privilege. */
  @Public()
  @Post('projects/:id/join')
  async join(@Req() req: FastifyRequest, @Param('id') id: string) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    await this.rosters.join(id, me.userId);
    return { ok: true };
  }

  @Public()
  @Post('projects/:id/leave')
  async leave(@Req() req: FastifyRequest, @Param('id') id: string) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    await this.rosters.leave(id, me.userId);
    return { ok: true };
  }

  /**
   * Declares this build the caller's current one, from the app. Same service and same bar as the
   * website's route — COLONY_VIEW, because saying which build you are hauling to is not a
   * privilege — so the two doors cannot disagree about what "current" means.
   */
  @Public()
  @Post('projects/:id/current')
  async setCurrent(@Req() req: FastifyRequest, @Param('id') id: string) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    await this.rosters.setCurrent(id, me.userId);
    return { ok: true };
  }

  @Public()
  @Delete('projects/:id/current')
  async clearCurrent(@Req() req: FastifyRequest, @Param('id') id: string) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    await this.rosters.clearCurrent(id, me.userId);
    return { ok: true };
  }

  /**
   * The build the member has pinned, with everything the overlay needs to draw it.
   *
   * ★ ONE READ, SHAPED FOR A 30-SECOND POLL ★
   *
   * The app asks this on a timer while the member plays, so it deliberately reuses the project,
   * needs and haulers reads the detail route already runs and SKIPS the expensive extras — the
   * shopping list, the delivery charts, the carrier holds. A poll that priced the galaxy twice a
   * minute would be most of the API's work for a panel that only says what is still wanted.
   *
   * `{ current: null }` covers all three empty cases as ONE answer — nothing pinned, the pinned
   * build deleted, the pinned build no longer visible to this member. The app draws no overlay;
   * which of the three it was is not the overlay's business, and the third must not leak a title
   * through a side door that the project routes would refuse.
   */
  @Public()
  @Get('current')
  async current(@Req() req: FastifyRequest) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    const held = await this.rosters.currentFor(me.userId);
    if (held === null) return { current: null };

    // Re-read through the caller's own visibility, exactly like the detail route.
    const project = await this.colony.byId(held.projectId, me);
    if (project === null) return { current: null };

    const [needs, haulers, carriers] = await Promise.all([
      this.colony.needs(project.id),
      this.colony.haulers(project.id),
      /*
       * ★ FOR THE OVERLAY'S GRID — SQUADRON OWNER, 2026-08-15 ★
       *
       * "show What is actually remaining vs what is in player cargo holds vs what it actually in
       * assigned fleet carrier holds."
       *
       * The member's own hold the overlay already has — it reads Cargo.json on their machine. The
       * carriers it cannot know, so they ride down here. Failing soft: an overlay that loses its
       * carrier column is worth far less than one that stops drawing because a join was slow.
       */
      this.carriers.forProject(project.id).catch(() => []),
    ]);

    return {
      current: {
        projectId: project.id,
        title: project.title,
        systemName: project.systemName,
        stationName: project.stationName,
        // A string end to end — a market id exceeds 2^53, same reasoning as the project rows.
        marketId: project.marketId,
        isPriority: project.isPriority,
        // Delivered is DERIVED from the same two figures the progress bar divides, so the
        // overlay and the project page cannot disagree about how far along the build is.
        progress: { delivered: project.required - project.remaining, required: project.required },
        needs,
        haulers,
        /*
         * Flattened to commodity and tonnes, and named by callsign. The overlay is a few hundred
         * pixels over a cockpit: it needs "who has it and how much", not a carrier's full record.
         */
        /*
         * ★ THIS READ `c.holds` AND NOTHING ELSE — 2026-08-17 ★
         *
         * `holds` is only the market MIRROR: a carrier's public sell orders. Cargo staged for a build
         * is exactly the cargo that is NOT on sale, which is the reason the journal, cAPI and manual
         * sources exist at all — so the panel a member reads in the seconds before opening a
         * commodity market was blind to all three.
         *
         * This controller already imports `carrierCover` and applies the merge on the project-detail
         * route two hundred lines above. Same data, same file, two different answers, and the overlay
         * showed the smaller one.
         *
         * `carrierHoldLines` applies the same rule per (carrier, commodity) and keeps the callsign,
         * because which carrier to dock at is the whole point of naming one.
         */
        carrierHolds: carrierHoldLines(carriers),
      },
    };
  }

  /**
   * Claim a commodity, or put one on somebody else.
   *
   * Gated on COLONY_VIEW here rather than something stronger, because the interesting check is not
   * about the caller's rank in general — it is about whose build this is, and the service makes it.
   * A member claiming for themselves needs no permission at all beyond seeing the board.
   */
  @Public()
  @Post('projects/:id/assign')
  async assign(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: { userId?: string; commodity?: string; tonnes?: number },
  ) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    const mask = await this.permissions.effectiveMask(me.userId);

    await this.rosters.assign({
      projectId: id,
      callerId: me.userId,
      callerMask: mask,
      // Absent means "me". The common case is a member claiming something, and making the app send
      // its own id back to identify itself would be a value it could get wrong.
      targetUserId: typeof body.userId === 'string' && body.userId !== '' ? body.userId : me.userId,
      commodity: body.commodity ?? '',
      tonnes: typeof body.tonnes === 'number' ? body.tonnes : null,
    });

    return { ok: true };
  }

  @Public()
  @Post('projects/:id/unassign')
  async unassign(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: { userId?: string; commodity?: string },
  ) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    const mask = await this.permissions.effectiveMask(me.userId);

    await this.rosters.unassign({
      projectId: id,
      callerId: me.userId,
      callerMask: mask,
      targetUserId: typeof body.userId === 'string' && body.userId !== '' ? body.userId : me.userId,
      commodity: body.commodity ?? '',
    });

    return { ok: true };
  }

  @Public()
  @Patch('projects/:id/priority')
  async priority(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: { isPriority?: boolean },
  ) {
    const officer = await this.#caller(
      req,
      Permission.COLONY_MANAGE,
      'Only officers can set the squadron’s current effort.',
    );

    // The actor travels for the squadron feed, exactly as the website's door passes it — the
    // notice must read the same whichever surface the officer used.
    await this.colony.setPriority(id, body.isPriority === true, officer.userId);
    return { ok: true };
  }

  /**
   * Closing, reopening and deleting — the three the app could not do.
   *
   * ★ SQUADRON OWNER, 2026-08-04: "full parridy" ★
   *
   * The website has had these since the day the actions row shipped; the app had only `priority`,
   * so a member who posted a build from the app had to open a browser to close it. That is the exact
   * split the owner has objected to repeatedly.
   *
   * COLONY_VIEW here, on purpose, exactly as on the website: the interesting check is not the
   * caller's rank in general but whose build this is, and the SERVICE makes it — a member closing
   * their own needs nothing beyond seeing the board, an officer closing the squadron's needs
   * COLONY_MANAGE. One rule, in one place, reached through two doors.
   */
  @Public()
  @Patch('projects/:id/close')
  async close(@Req() req: FastifyRequest, @Param('id') id: string) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    const mask = await this.permissions.effectiveMask(me.userId);
    await this.colony.close(id, me.userId, mask);
    return { ok: true };
  }

  /**
   * "I flew out and it is already built." The app's door onto the same report.
   *
   * This one matters MORE here than on the website: the member making the discovery is in their
   * ship, at the pad, with the app open — not at a browser. Same service, same COLONY_VIEW check,
   * same announcement.
   */
  @Public()
  @Patch('projects/:id/report-built')
  async reportBuilt(@Req() req: FastifyRequest, @Param('id') id: string) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    await this.colony.reportBuilt(id, me.userId);
    return { ok: true };
  }

  @Public()
  @Patch('projects/:id/reopen')
  async reopen(@Req() req: FastifyRequest, @Param('id') id: string) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    const mask = await this.permissions.effectiveMask(me.userId);
    await this.colony.reopen(id, me.userId, mask);
    return { ok: true };
  }

  /**
   * Giving up on a build from the app, or taking that back.
   *
   * ★ THE APP GETS EVERY WRITE THE WEBSITE HAS — SQUADRON OWNER, 2026-08-15 ★
   *
   * "we also need to allow admins to mark builds as abandoned" was asked for on BOTH surfaces, and
   * `companion-route-parity.spec.ts` exists precisely because a hub call with no device route here
   * is a button in the app that fails at runtime with nothing catching it beforehand.
   *
   * COLONY_MANAGE is enforced in the service, not here — this guard says only that the caller may
   * use the colonisation boards at all, matching every other write on this controller.
   */
  @Public()
  @Patch('projects/:id/abandoned')
  async setAbandoned(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: { abandoned?: unknown; note?: unknown },
  ) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    const mask = await this.permissions.effectiveMask(me.userId);

    await this.colony.setAbandoned({
      projectId: id,
      callerId: me.userId,
      mask,
      // Explicit, like `colonyPriority`'s own coercion: a malformed body must not read as "abandon it".
      abandoned: body.abandoned === true,
      ...(typeof body.note === 'string' ? { note: body.note } : {}),
    });
    return { ok: true };
  }

  @Public()
  @Delete('projects/:id')
  async remove(@Req() req: FastifyRequest, @Param('id') id: string) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    const mask = await this.permissions.effectiveMask(me.userId);
    await this.colony.remove(id, me.userId, mask);
    return { ok: true };
  }

  /**
   * One carrier's whole run, for the app.
   *
   * ★ SQUADRON OWNER, 2026-08-09 ★
   *
   * "an aggregated total of all materials needed to get all the builds completed if i am buying and
   * storing on a fleet carrier"
   *
   * ★ THE APP IS WHERE THIS GETS USED ★
   *
   * The website is where somebody plans the run; the app is what is open while they fly it, next to
   * the commodity market they are standing in. A combined list that existed only on the website
   * would be the one surface it is least useful on.
   *
   * Same service and the same arithmetic as the website's route — the netting that subtracts a
   * shared hold once rather than once per build lives in `manifest`, so the two cannot disagree
   * about how much is left to buy.
   */
  @Public()
  @Get('carriers/:marketId/manifest')
  async carrierManifest(
    @Req() req: FastifyRequest,
    @Param('marketId') marketId: string,
    @Query('near') near?: string,
    @Query('withinLy') withinLy?: string,
    @Query('largePad') largePad?: string,
    @Query('sort') sort?: string,
  ) {
    await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    // Rejected rather than coerced: `BigInt('')` is 0n, which is a market id somebody might hold.
    if (!/^\d{1,19}$/.test(marketId)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'That is not a market id.');
    }

    const manifest = await this.carriers.manifest(BigInt(marketId));
    if (manifest.carrier === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Not found.');
    }

    /*
     * Coordinates the same way the project route above resolves them — by name, through the market
     * store. No origin means no prices, which is the rule that route already states: a
     * cheapest-anywhere figure is a number nobody can act on.
     */
    const typed = (near ?? '').trim();
    const coords = typed === '' ? null : await this.market.systemCoords(typed);

    /*
     * The manifest has already netted what is aboard, so the sourcing gets what is left to BUY and
     * no cover. Passing cover again here would subtract the same cargo twice.
     */
    const shopping = await this.colony.shoppingListForNeeds(
      JSON.stringify([
        'carrier',
        marketId,
        coords === null ? null : [coords.x, coords.y, coords.z],
        withinLy ?? '',
        largePad ?? '',
        sort ?? '',
        manifest.lines.map((l) => `${l.commodity}:${l.toBuy}`).join(','),
      ]),
      manifest.lines.map((l) => ({
        commodity: l.commodity,
        remaining: l.toBuy,
        required: l.needed,
        observedAt: new Date(),
      })),
      {
        near: coords,
        withinLy: clamp(numberOr(withinLy, 100), 1, 500),
        largePadOnly: largePad === '1',
        sort: sort === 'closest' ? 'closest' : sort === 'cheapest' ? 'cheapest' : 'local',
      },
    );

    return { ...manifest, shopping };
  }

  /**
   * Fleet carriers, for the app. Same service, same rules — see the note on the planner routes.
   */
  @Public()
  @Get('projects/:id/carriers')
  async carrierSearch(@Req() req: FastifyRequest, @Param('id') id: string, @Query('q') q?: string) {
    await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    return { carriers: await this.carriers.search(id, q ?? '') };
  }

  @Public()
  @Post('projects/:id/carriers')
  async attachCarrier(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: { marketId?: string; isSquadron?: boolean },
  ) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    const mask = await this.permissions.effectiveMask(me.userId);

    return this.carriers.attach({
      projectId: id,
      marketId: (body.marketId ?? '').trim(),
      isSquadron: body.isSquadron === true,
      callerId: me.userId,
      callerMask: mask,
    });
  }

  @Public()
  @Delete('projects/:id/carriers/:marketId')
  async detachCarrier(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Param('marketId') marketId: string,
  ) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    const mask = await this.permissions.effectiveMask(me.userId);

    await this.carriers.detach({ projectId: id, marketId, callerId: me.userId, callerMask: mask });
    return { ok: true };
  }

  /**
   * Declares, corrects or clears a MANUAL tonnage on an attached carrier — the app's door for the
   * same write the website has. Crew membership is checked in the service, where the refusal is.
   */
  @Public()
  @Patch('projects/:id/carriers/:marketId/cargo')
  async setCarrierCargo(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Param('marketId') marketId: string,
    @Body() body: { commodity?: string; tonnes?: number | null },
  ) {
    const me = await this.#caller(
      req,
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

  /**
   * The companion app's reading of its member's OWN carrier hold.
   *
   * ★ NOT UNDER `projects/`, ON PURPOSE ★
   *
   * The app does not know which builds the carrier is attached to, and should not have to: it
   * watched cargo move on ITS member's carrier and says so. The service stores the reading only
   * when that carrier is attached to at least one build, and answers `stored: false` otherwise —
   * not an error, because "your carrier is not helping any build right now" is the ordinary case.
   *
   * COLONY_VIEW like every other door here: the write lands in colonisation tables, and a member
   * whose rank cannot see the boards has no business filling them.
   */
  /**
   * The member's own ship hold.
   *
   * ★ SQUADRON OWNER, 2026-08-16 ★
   *
   * "materials being added to fleet carriers and in player holds are not registering properly"
   *
   * The overlay was always right — it reads `Cargo.json` on the member's machine. The hub had never
   * received a hold at all: zero `Cargo` rows against 8,706 depot readings, because nothing ever
   * sent one. This is the door that was missing.
   *
   * ★ THE WHOLE HOLD IS SENT; ALMOST NONE OF IT IS KEPT ★
   *
   * `scopeHold` discards every commodity no live build the member is on still wants, so a mining
   * run, a trade loop and mission cargo never reach storage. That boundary is enforced HERE rather
   * than in the app, because a rule that lives on a member's machine is a rule that can be edited.
   */
  @Public()
  @Post('ship-hold')
  async shipHold(
    @Req() req: FastifyRequest,
    @Body() body: { commodities?: unknown },
  ) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    const lines = Array.isArray(body.commodities) ? body.commodities : [];
    const held = lines
      .map((l) => {
        const row = l as { commodity?: unknown; tonnes?: unknown };
        return {
          commodity: typeof row.commodity === 'string' ? row.commodity : '',
          tonnes: Number(row.tonnes),
        };
      })
      .filter((l) => l.commodity !== '' && Number.isFinite(l.tonnes));

    const stored = await this.colony.recordHold(me.userId, held);
    return { ok: true, stored };
  }

  @Public()
  @Post('carrier-cargo')
  async carrierCargo(
    @Req() req: FastifyRequest,
    @Body()
    body: {
      marketId?: string;
      commodities?: Array<{ commodity?: unknown; tonnes?: unknown }>;
      totalTonnes?: unknown;
      totalAt?: unknown;
    },
  ) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    return this.carriers.journalSnapshot({
      marketId: (body.marketId ?? '').trim(),
      // Whose carrier this is. Without it the hub holds the cargo and cannot tell anybody it has it.
      pushedBy: me.userId,
      commodities: Array.isArray(body.commodities) ? body.commodities : [],
      /*
       * The game's own total, kept apart from the witnessed rows. Validated in the service, like
       * everything else here — this controller's job is to name the door, not to decide what a
       * tonnage is.
       */
      totalTonnes: typeof body.totalTonnes === 'number' ? body.totalTonnes : null,
      totalAt: typeof body.totalAt === 'string' ? body.totalAt : null,
    });
  }

  /**
   * ★ THE PLANNER, FOR THE APP — SQUADRON OWNER, 2026-08-03 ★
   *
   * "ensure the Companion app matches and has all the same pages in colonization that the website
   * has please! must be a mirror!"
   *
   * Every route below is the website's route with the door changed. Same `ColonyPlanService`, same
   * `COLONY_VIEW` to read, same rule in the service deciding who may change what — a squadron plan
   * is the squadron's so an officer directs it, a personal one belongs to whoever started it.
   *
   * Nothing here re-implements a rule. The one that would drift if it did is the check on who may
   * edit a squadron plan, because it is the rule nobody re-reads.
   */
  @Public()
  @Get('plans')
  async plans(@Req() req: FastifyRequest, @Query('owner') owner?: string) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    const scope = owner === 'squadron' || owner === 'personal' ? owner : 'all';
    return { plans: await this.plans_.list(scope, me.userId) };
  }

  @Public()
  @Get('plans/:id')
  async plan(@Req() req: FastifyRequest, @Param('id') id: string) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );

    const plan = await this.plans_.byId(id, me.userId);
    if (plan === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That plan is not available.');
    }

    // The same rights the website gets. The app drew every editing control unconditionally, so a
    // member with no rank was offered a full editor whose every click was refused.
    const mask = await this.permissions.effectiveMask(me.userId);
    return { plan, can: { edit: await this.plans_.mayEdit(id, me.userId, mask) } };
  }

  @Public()
  @Post('plans')
  async createPlan(
    @Req() req: FastifyRequest,
    @Body() body: { owner?: string; title?: string; systemName?: string },
  ) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    const mask = await this.permissions.effectiveMask(me.userId);

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
   * COLONY_VIEW only, and that matters MORE here than on the website: the member most likely to be
   * looking at the architect panel is the one flying, with the app open on a second screen. Gating
   * this behind rank would mean the one person who can see the number cannot write it down.
   */
  @Public()
  @Patch('plans/bodies/:systemId64/:bodyId')
  async setSlots(
    @Req() req: FastifyRequest,
    @Param('systemId64') systemId64: string,
    @Param('bodyId') bodyId: string,
    @Body() body: { orbital?: number | null; surface?: number | null },
  ) {
    const me = await this.#caller(
      req,
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

  @Public()
  @Post('plans/:id/sites')
  async addPlanSite(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body()
    body: {
      version?: number;
      bodyId?: number | null;
      location?: string;
      buildTypeId?: string | null;
    },
  ) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    const mask = await this.permissions.effectiveMask(me.userId);

    return this.plans_.addSite({
      planId: id,
      callerId: me.userId,
      callerMask: mask,
      version: typeof body.version === 'number' ? body.version : 0,
      bodyId: typeof body.bodyId === 'number' ? body.bodyId : null,
      location: body.location === 'surface' ? 'surface' : 'orbital',
      buildTypeId:
        typeof body.buildTypeId === 'string' && body.buildTypeId !== '' ? body.buildTypeId : null,
    });
  }

  @Public()
  @Delete('plans/:id/sites/:siteId')
  async removePlanSite(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Param('siteId') siteId: string,
    @Query('version') version?: string,
  ) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    const mask = await this.permissions.effectiveMask(me.userId);

    return this.plans_.removeSite({
      planId: id,
      siteId,
      callerId: me.userId,
      callerMask: mask,
      version: numberOr(version, 0),
    });
  }

  /** The whole build order at once, which is what the up and down buttons send. */
  /**
   * "Read my plan and tell me what is wrong with it."
   *
   * ★ CAUGHT BY THE PARITY GUARD, 2026-08-10 ★
   *
   * This route was written on the WEBSITE controller and not here, exactly as the purchases route
   * was this morning — and `companion-route-parity.spec.ts`, written that same morning for that
   * same mistake, named it before anybody opened the app. The guard earned itself inside a day.
   *
   * POST rather than GET: it costs a model call, so it happens when somebody asks.
   */
  @Public()
  @Post('plans/:id/review')
  async planReview(@Req() req: FastifyRequest, @Param('id') id: string) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation planner.',
    );

    const out = await this.review.review(id, me.userId);
    if (out === null) throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No such plan.');
    return out;
  }

  @Public()
  @Patch('plans/:id/order')
  async reorderPlan(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: { version?: number; siteIds?: string[] },
  ) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    const mask = await this.permissions.effectiveMask(me.userId);

    return this.plans_.reorder({
      planId: id,
      siteIds: Array.isArray(body.siteIds) ? body.siteIds : [],
      callerId: me.userId,
      callerMask: mask,
      version: typeof body.version === 'number' ? body.version : 0,
    });
  }

  @Public()
  @Delete('plans/:id')
  async removePlan(@Req() req: FastifyRequest, @Param('id') id: string) {
    const me = await this.#caller(
      req,
      Permission.COLONY_VIEW,
      'You do not have access to the colonisation boards.',
    );
    const mask = await this.permissions.effectiveMask(me.userId);

    await this.plans_.remove(id, me.userId, mask);
    return { ok: true };
  }
}

/**
 * The opening depot reading, cleaned.
 *
 * Every entry that is not a name and two finite numbers is DROPPED rather than repaired. A
 * half-understood row on a needs list is a line a member cannot act on, and the next sync will
 * replace the whole set from the journal anyway.
 */
function readSnapshot(
  raw: { resources?: Array<{ commodity?: unknown; required?: unknown; provided?: unknown }> } | undefined,
): { resources: Array<{ commodity: string; required: number; provided: number }> } | null {
  if (raw === undefined || !Array.isArray(raw.resources)) return null;

  const resources: Array<{ commodity: string; required: number; provided: number }> = [];
  for (const entry of raw.resources) {
    const commodity = typeof entry?.commodity === 'string' ? entry.commodity.trim() : '';
    const required = Number(entry?.required);
    const provided = Number(entry?.provided);
    if (commodity === '' || !Number.isFinite(required) || !Number.isFinite(provided)) continue;
    if (required < 0 || provided < 0) continue;
    resources.push({ commodity, required, provided });
  }

  return resources.length === 0 ? null : { resources };
}

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
