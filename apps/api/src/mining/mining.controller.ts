import { Body, Controller, Get, Inject, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { Public } from '../auth/auth.guard.js';
import { PAIRING_SERVICE } from '../telemetry/telemetry.tokens.js';
import type { PairingService } from '../telemetry/pairing.service.js';
import { MiningService } from './mining.service.js';

/**
 * The mining module's front doors.
 *
 * ★ TWO DOORS, ONE SERVICE — THE SAME RULE AS COLONISATION ★
 *
 * The website arrives with a session cookie and the companion with a paired device token, and both
 * reach the identical `MiningService`. A second implementation for the app would drift, and the
 * half that drifted would be whichever one nobody re-reads.
 *
 * The device routes are their own controller for the reason set out at length in
 * `colony-device.controller.ts`: a device token is longer-lived and weaker than a session, and the
 * surface it can reach has to be a list somebody adds to on purpose.
 */

/** A hold, as the companion reports it: material name to tonnes. */
interface CargoBody {
  readonly hold?: Record<string, unknown>;
  readonly system?: unknown;
  readonly withinLy?: unknown;
}

/**
 * Read a hold off the wire.
 *
 * Rejected rather than repaired when it is not an object: a hold is the whole input to a valuation,
 * and quietly valuing `{}` would answer "your cargo is worth nothing" to a member whose app sent
 * something malformed — an answer they would believe.
 */
function readHold(body: CargoBody): Record<string, number> {
  const raw = body.hold;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'Send a hold of material names to tonnes.');
  }

  const hold: Record<string, number> = {};
  for (const [name, tonnes] of Object.entries(raw)) {
    if (typeof tonnes !== 'number' || !Number.isFinite(tonnes) || tonnes <= 0) continue;
    if (name.trim() === '') continue;
    hold[name.trim()] = Math.floor(tonnes);
  }
  return hold;
}

/** Clamped so a hand-written request cannot ask the market for the whole bubble. */
function readRange(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 100;
  return Math.max(10, Math.min(500, n));
}

function readSystem(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

@Controller('v1/mining')
export class MiningController {
  constructor(@Inject(MiningService) private readonly mining: MiningService) {}

  /**
   * Which rings the squadron has been finding worth mining.
   *
   * Public in the same sense the leaderboards are: it is squadron-wide aggregate over rocks, with
   * no member named in it. Ten rocks minimum per ring, so nothing here can be traced to one
   * commander's evening.
   */
  @Get('rings')
  async rings(
    @Query('material') material?: string,
    @Query('days') days?: string,
    @Query('limit') limit?: string,
  ) {
    return {
      rings: await this.mining.rings(
        readSystem(material),
        Number(days ?? 14) || 14,
        Number(limit ?? 20) || 20,
      ),
    };
  }

  /** The signed-in member's own mining evenings. */
  @Get('sessions')
  async sessions(@Req() req: FastifyRequest, @Query('limit') limit?: string) {
    const userId = (req as FastifyRequest & { user?: { id?: string } }).user?.id;
    if (typeof userId !== 'string') {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to see your mining history.');
    }
    return { sessions: await this.mining.sessions(userId, Number(limit ?? 20) || 20) };
  }

  /** What a hold is worth and where to take it. */
  @Post('valuation')
  async valuation(@Body() body: CargoBody) {
    return this.mining.valueCargo(readHold(body), readSystem(body.system), readRange(body.withinLy));
  }
}

/**
 * The same three answers, for a paired companion.
 *
 * ★ VALUATION IS THE ONE THE OVERLAY LIVES ON ★
 *
 * A miner asks "what is this hold worth" at the end of a session, in the ring, with the game in
 * front of them — which is the app, not the website. The website route exists so the numbers can be
 * checked afterwards; this one is where it is actually used.
 */
@Controller('v1/companion/mining')
export class MiningDeviceController {
  constructor(
    @Inject(MiningService) private readonly mining: MiningService,
    @Inject(PAIRING_SERVICE) private readonly pairing: PairingService,
  ) {}

  /**
   * The member behind a bearer token.
   *
   * No permission bit is checked: mining reads are a member's own data and squadron-wide aggregate,
   * the same standing the leaderboards need. Being paired at all is the bar.
   */
  async #caller(req: FastifyRequest): Promise<string> {
    const header = req.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    const device = token === '' ? null : await this.pairing.authenticate(token, new Date());
    if (device === null) {
      // The same opaque answer the telemetry routes give — unknown, revoked and wrongly-scoped are
      // one reply, so a caller learns only that their token is not usable.
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'This device is not paired.');
    }
    return device.userId;
  }

  @Public()
  @Post('valuation')
  async valuation(@Req() req: FastifyRequest, @Body() body: CargoBody) {
    await this.#caller(req);
    return this.mining.valueCargo(readHold(body), readSystem(body.system), readRange(body.withinLy));
  }

  @Public()
  @Get('rings')
  async rings(
    @Req() req: FastifyRequest,
    @Query('material') material?: string,
    @Query('days') days?: string,
  ) {
    await this.#caller(req);
    return { rings: await this.mining.rings(readSystem(material), Number(days ?? 14) || 14, 20) };
  }

  @Public()
  @Get('sessions')
  async sessions(@Req() req: FastifyRequest, @Query('limit') limit?: string) {
    const userId = await this.#caller(req);
    return { sessions: await this.mining.sessions(userId, Number(limit ?? 20) || 20) };
  }
}
