import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission, hasPermission } from '@grims/shared';
import { PermissionService } from '../authz/permission.service.js';
import { Public } from '../auth/auth.guard.js';
import { User, type CurrentUser } from '../auth/current-user.js';
import { PAIRING_SERVICE } from '../telemetry/telemetry.tokens.js';
import type { PairingService } from '../telemetry/pairing.service.js';
import { ScoutService } from './scout.service.js';

/**
 * The colonisation scout.
 *
 * ★ SQUADRON OWNER, 2026-08-07 ★
 *
 * "can we build a tool into our web and companion app that literally does what we just did here for
 * this planning and research and system selection?"
 *
 * ★ GATED ON THE COLONY BITS, NOT A NEW ONE ★
 *
 * Scouting is planning, and planning already has a permission. Inventing a bit for it would mean
 * every officer who can run the colonisation module has to be granted a second thing before the new
 * page works, which is how a feature ships and nobody can see it.
 */
@Controller('v1/colonisation')
export class ScoutController {
  constructor(
    @Inject(ScoutService) private readonly scout: ScoutService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {}

  async #assert(caller: CurrentUser | undefined): Promise<void> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to scout for systems.');
    }

    const mask = await this.permissions.effectiveMask(caller.userId);
    if (!hasPermission(mask, Permission.COLONY_VIEW)) {
      // Cloaked like every other gated read (INV-002).
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Not found.');
    }
  }

  @Get('scout')
  async search(
    @User() caller: CurrentUser | undefined,
    @Query('anchor') anchor?: string,
    @Query('range') range?: string,
    @Query('prefer') prefer?: string,
  ) {
    await this.#assert(caller);
    return this.scout.scout(readQuery(anchor, range, prefer));
  }
}

/**
 * Re-read rather than trusted, like every query on this platform.
 *
 * The range is clamped: a member typing 500 would sweep a quarter of the bubble through somebody
 * else's free API, and a claim does not reach that far anyway.
 */
function readQuery(anchor?: string, range?: string, prefer?: string) {
  const typed = anchor?.trim() ?? '';
  if (typed === '') {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'Name a system to search around.');
  }

  const parsed = Number(range);
  const out: { anchor: string; rangeLy?: number; prefer?: string } = { anchor: typed };

  if (Number.isFinite(parsed) && parsed > 0) out.rangeLy = Math.min(Math.max(parsed, 1), 40);

  /*
   * Only the three real powers. Anything else is dropped rather than passed through, so a typo
   * cannot silently mean "no preference" while the member believes it was applied.
   */
  const want = prefer?.trim().toLowerCase();
  if (want === 'federation' || want === 'empire' || want === 'alliance') {
    out.prefer = want.charAt(0).toUpperCase() + want.slice(1);
  }

  return out;
}

/**
 * The same scout, for a paired companion.
 *
 * A member picks their next system while flying, which is the app rather than the website — the
 * same reasoning the recruiting and BGS surfaces already follow.
 */
@Controller('v1/companion/colonisation')
export class ScoutDeviceController {
  constructor(
    @Inject(ScoutService) private readonly scout: ScoutService,
    @Inject(PAIRING_SERVICE) private readonly pairing: PairingService,
  ) {}

  async #paired(req: FastifyRequest): Promise<void> {
    const header = req.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    const device = token === '' ? null : await this.pairing.authenticate(token, new Date());
    if (device === null) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'This device is not paired.');
    }
  }

  @Public()
  @Get('scout')
  async search(
    @Req() req: FastifyRequest,
    @Query('anchor') anchor?: string,
    @Query('range') range?: string,
    @Query('prefer') prefer?: string,
  ) {
    await this.#paired(req);
    return this.scout.scout(readQuery(anchor, range, prefer));
  }
}
