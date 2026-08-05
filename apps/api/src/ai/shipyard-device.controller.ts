import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  AppError,
  ErrorCode,
  Permission,
  isBuildVisibility,
  type ShipBuild,
} from '@grims/shared';
import type { FitRole } from '@grims/ed-clients';
import { Public } from '../auth/auth.guard.js';
import { PermissionService } from '../authz/permission.service.js';
import { PAIRING_SERVICE } from '../telemetry/telemetry.tokens.js';
import type { PairingService } from '../telemetry/pairing.service.js';
import { ShipBuildService, ShipyardService } from './ship-build.service.js';

/**
 * The Shipyard, for the companion app.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "we need to add the Shipyard and Logistics and Trade categories to the companion app, and they
 * must work in full mirror with the website please!"
 *
 * Same door pattern as colonisation, trade and bounties: the identical services the website's
 * routes call, behind device-token authentication, so the app can never quote a different jump
 * range or offer a different module list than the site. The catalogue reads assert SHIPYARD_VIEW
 * against the MEMBER (a device is the person holding it); saving asserts the same save/share bits
 * the website asserts, with the same refusal sentences.
 */
@Controller('v1/companion/shipyard')
export class ShipyardDeviceController {
  constructor(
    @Inject(ShipyardService) private readonly shipyard: ShipyardService,
    @Inject(ShipBuildService) private readonly builds: ShipBuildService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(PAIRING_SERVICE) private readonly pairing: PairingService,
  ) {}

  async #caller(req: FastifyRequest, need: bigint, refusal: string): Promise<{ userId: string }> {
    const header = req.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    const device = token === '' ? null : await this.pairing.authenticate(token, new Date());
    if (device === null) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'This device is not paired.');
    }

    const mask = await this.permissions.effectiveMask(device.userId);
    if ((mask & need) !== need) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, refusal);
    }
    return { userId: device.userId };
  }

  @Public()
  @Get('ships')
  async ships(@Req() req: FastifyRequest) {
    await this.#caller(req, Permission.SHIPYARD_VIEW, 'You do not have access to the Shipyard.');
    return { ships: await this.shipyard.ships() };
  }

  @Public()
  @Get('outfit/:shipId')
  async outfit(@Req() req: FastifyRequest, @Param('shipId') shipId: string) {
    await this.#caller(req, Permission.SHIPYARD_VIEW, 'You do not have access to the Shipyard.');
    const outfit = await this.shipyard.outfit(shipId);
    if (outfit === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'We do not have that ship in our data.');
    }
    return outfit;
  }

  /** The assisted builder. Same validation and the same honest "nothing affordable" refusal. */
  @Public()
  @Post('fit')
  async fit(@Req() req: FastifyRequest, @Body() body: unknown) {
    await this.#caller(req, Permission.SHIPYARD_VIEW, 'You do not have access to the Shipyard.');

    const input = (body ?? {}) as Record<string, unknown>;
    const role = typeof input['role'] === 'string' ? input['role'] : '';
    const ROLES: readonly string[] = ['mining', 'combat', 'explorer', 'trader'];
    if (!ROLES.includes(role)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `Unknown role: ${role}`);
    }

    const budget =
      typeof input['budget'] === 'number' && input['budget'] > 0 ? input['budget'] : undefined;
    const shipId =
      typeof input['shipId'] === 'string' && input['shipId'] !== '' ? input['shipId'] : undefined;

    const fit = await this.builds.fit({ role: role as FitRole, budget, shipId });
    if (fit === null) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        budget === undefined
          ? 'No ship could be fitted for that.'
          : `Nothing can be fitted for that role within ${Math.round(budget / 1_000_000)} million credits.`,
      );
    }
    return fit;
  }

  /**
   * The boards and the member's own shelf, one route with a scope — the app's three lists.
   *
   * Unlike the website's shared route, `squadron` never silently falls back to `public` here:
   * a paired device always has a member, so the fallback's reason (a signed-out visitor following
   * a link) cannot occur, and keeping it would only hide a permission problem as the wrong list.
   */
  @Public()
  @Get('builds')
  async list(@Req() req: FastifyRequest, @Query('scope') scope?: string) {
    const caller = await this.#caller(
      req,
      Permission.SHIPYARD_VIEW,
      'You do not have access to the Shipyard.',
    );

    if (scope === 'mine') return { builds: await this.builds.mine(caller.userId) };
    const wanted = scope === 'squadron' ? 'squadron' : 'public';
    return { builds: await this.builds.shared(wanted, caller.userId) };
  }

  /** One shared build by token — the reader. The token is the capability, same as the website. */
  @Public()
  @Get('builds/shared/:token')
  async byToken(@Req() req: FastifyRequest, @Param('token') token: string) {
    const caller = await this.#caller(
      req,
      Permission.SHIPYARD_VIEW,
      'You do not have access to the Shipyard.',
    );
    const found = await this.builds.byToken(token, caller.userId);
    if (found === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'That build is not available.');
    }
    return found;
  }

  /** Save, with the website's exact permission ladder and refusal sentences. */
  @Public()
  @Post('builds')
  async save(@Req() req: FastifyRequest, @Body() body: unknown) {
    const input = (body ?? {}) as Record<string, unknown>;
    const visibility = input['visibility'];
    if (!isBuildVisibility(visibility)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Choose who may see this build.');
    }

    const need =
      visibility === 'public'
        ? Permission.SHIPYARD_SAVE | Permission.SHIPYARD_SHARE_PUBLIC
        : visibility === 'squadron'
          ? Permission.SHIPYARD_SAVE | Permission.SHIPYARD_SHARE
          : Permission.SHIPYARD_SAVE;

    const caller = await this.#caller(
      req,
      need,
      visibility === 'public'
        ? 'You cannot publish builds outside the squadron.'
        : visibility === 'squadron'
          ? 'You cannot share builds with the squadron.'
          : 'You cannot save builds.',
    );

    const build = input['build'];
    if (typeof build !== 'object' || build === null) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'No build was sent.');
    }

    const rawName = input['buildName'];
    const buildName =
      typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim().slice(0, 80) : null;

    return this.builds.save({ build: build as ShipBuild, buildName, visibility }, caller.userId);
  }
}
