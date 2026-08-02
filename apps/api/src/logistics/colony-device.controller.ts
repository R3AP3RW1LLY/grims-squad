import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission } from '@grims/shared';
import { Public } from '../auth/auth.guard.js';
import { PermissionService } from '../authz/permission.service.js';
import { PAIRING_SERVICE } from '../telemetry/telemetry.tokens.js';
import type { PairingService } from '../telemetry/pairing.service.js';
import { ColonyService, type ColonyOwner } from './colony.service.js';
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

  /** Both boards, exactly as the website's sidebar shows them. */
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

    const [needs, haulers, shopping, deliveries, chart] = await Promise.all([
      this.colony.needs(id),
      this.colony.haulers(id),
      this.colony.shoppingList(id, {
        near: coords,
        withinLy: clamp(numberOr(withinLy, 100), 1, 500),
        largePadOnly: false,
        sort: sort === 'closest' ? 'closest' : 'cheapest',
      }),
      // "whos delivered what and when", and the stacked chart over it. Fetched with everything else
      // rather than on their own routes: the page shows them together, and three round trips would
      // render it in three stages, each shifting the layout under whoever is reading.
      this.colony.deliveries(id),
      this.colony.deliveryChart(id),
    ]);

    return {
      project,
      needs,
      haulers,
      shopping,
      deliveries,
      chart,
      // Echoed so the page can say where it is measuring from — a distance column with no stated
      // origin is a number nobody can check.
      shoppingFrom: coords === null ? null : origin,
      shoppingSort: sort === 'closest' ? 'closest' : 'cheapest',
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

  @Public()
  @Patch('projects/:id/priority')
  async priority(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: { isPriority?: boolean },
  ) {
    await this.#caller(
      req,
      Permission.COLONY_MANAGE,
      'Only officers can set the squadron’s current effort.',
    );

    await this.colony.setPriority(id, body.isPriority === true);
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
