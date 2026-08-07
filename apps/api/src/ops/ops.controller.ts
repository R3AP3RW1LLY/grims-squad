import { Body, Controller, Delete, Get, Inject, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission, hasPermission } from '@grims/shared';
import { PermissionService } from '../authz/permission.service.js';
import { Public } from '../auth/auth.guard.js';
import { PAIRING_SERVICE } from '../telemetry/telemetry.tokens.js';
import type { PairingService } from '../telemetry/pairing.service.js';
import { OpsService, type SignupState } from './ops.service.js';

/**
 * Operations — the board, signing up, and the officer controls.
 *
 * Reading is OPS_VIEW, signing up is OPS_SIGNUP, posting is OPS_CREATE and changing an op's state
 * is OPS_MANAGE. Four bits because they are four different acts: seeing what is on, saying you are
 * coming, asking the squadron to turn out, and calling something off.
 */
@Controller('v1/ops')
export class OpsController {
  constructor(
    @Inject(OpsService) private readonly ops: OpsService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {}

  async #caller(req: FastifyRequest, need: bigint): Promise<string> {
    const userId = (req as FastifyRequest & { user?: { id?: string } }).user?.id;
    if (typeof userId !== 'string') {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in.');
    }

    const mask = await this.permissions.effectiveMask(userId);
    if (!hasPermission(mask, need)) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Not found.');
    }
    return userId;
  }

  @Get()
  async board(@Req() req: FastifyRequest) {
    const userId = await this.#caller(req, Permission.OPS_VIEW);
    return { ops: await this.ops.board(userId) };
  }

  @Get(':id')
  async one(@Req() req: FastifyRequest, @Param('id') id: string) {
    await this.#caller(req, Permission.OPS_VIEW);

    const found = await this.ops.one(id);
    if (found === null) throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Not found.');
    return found;
  }

  @Post()
  async create(
    @Req() req: FastifyRequest,
    @Body()
    body: {
      title?: unknown;
      opType?: unknown;
      startsAt?: unknown;
      description?: unknown;
      capacity?: unknown;
    },
  ) {
    const userId = await this.#caller(req, Permission.OPS_CREATE);

    const types = ['bgs', 'combat', 'mining', 'trade', 'exploration', 'rescue', 'social', 'training'];
    const opType = typeof body.opType === 'string' && types.includes(body.opType) ? body.opType : '';
    if (opType === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Say what kind of op this is.');
    }

    return this.ops.create({
      title: typeof body.title === 'string' ? body.title : '',
      opType,
      startsAt: new Date(typeof body.startsAt === 'string' ? body.startsAt : ''),
      description: typeof body.description === 'string' ? body.description : null,
      /*
       * Null means uncapped, which is a real choice rather than a missing value — so an absent or
       * zero capacity is treated as "no limit" instead of "nobody may come".
       */
      capacity:
        typeof body.capacity === 'number' && Number.isFinite(body.capacity) && body.capacity > 0
          ? Math.floor(body.capacity)
          : null,
      createdById: userId,
    });
  }

  @Post(':id/signup')
  async signUp(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: { state?: unknown; note?: unknown },
  ) {
    const userId = await this.#caller(req, Permission.OPS_SIGNUP);

    /*
     * `standby` is not offered here. It is decided by capacity at the moment of committing, not
     * chosen — a member asking for standby directly would be queueing behind nobody.
     */
    const wanted = ['yes', 'maybe', 'no'];
    const state = typeof body.state === 'string' && wanted.includes(body.state) ? body.state : '';
    if (state === '') throw new AppError(ErrorCode.VALIDATION_FAILED, 'Say yes, maybe or no.');

    await this.ops.signUp(
      id,
      userId,
      state as SignupState,
      typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null,
    );
    return { ok: true };
  }

  @Delete(':id/signup')
  async withdraw(@Req() req: FastifyRequest, @Param('id') id: string) {
    const userId = await this.#caller(req, Permission.OPS_SIGNUP);
    await this.ops.withdraw(id, userId);
    return { ok: true };
  }

  @Post(':id/status')
  async setStatus(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: { status?: unknown },
  ) {
    await this.#caller(req, Permission.OPS_MANAGE);
    await this.ops.setStatus(id, typeof body.status === 'string' ? body.status : '');
    return { ok: true };
  }
}

/**
 * The same board, for a paired companion.
 *
 * ★ SQUADRON OWNER, 2026-08-07 ★
 *
 * Asked whether Operations was fully built out. It was not: the website had the board and the
 * console, and the app had nothing at all.
 *
 * ★ COMMITTING FROM THE COCKPIT IS THE POINT ★
 *
 * An op is announced while people are already flying. A member who has to alt-tab to a website to
 * say they are coming is a member who says nothing, and the seat count is the whole mechanism — a
 * board where nobody commits is indistinguishable from a board with nothing on it.
 */
@Controller('v1/companion/ops')
export class OpsDeviceController {
  constructor(
    @Inject(OpsService) private readonly ops: OpsService,
    @Inject(PAIRING_SERVICE) private readonly pairing: PairingService,
  ) {}

  async #caller(req: FastifyRequest): Promise<string> {
    const header = req.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    const device = token === '' ? null : await this.pairing.authenticate(token, new Date());
    if (device === null) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'This device is not paired.');
    }
    return device.userId;
  }

  @Public()
  @Get()
  async board(@Req() req: FastifyRequest) {
    const userId = await this.#caller(req);
    return { ops: await this.ops.board(userId) };
  }

  @Public()
  @Post(':id/signup')
  async signUp(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: { state?: unknown; note?: unknown },
  ) {
    const userId = await this.#caller(req);

    /*
     * The state is re-read rather than trusted, and an unrecognised one is refused instead of
     * defaulting: silently recording "maybe" for somebody who meant "yes" would cost them a seat.
     */
    const state = typeof body.state === 'string' ? body.state : '';
    if (!['yes', 'maybe', 'no'].includes(state)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Say yes, maybe or no.');
    }

    await this.ops.signUp(
      id,
      userId,
      state as SignupState,
      typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null,
    );
    return { ok: true };
  }

  @Public()
  @Delete(':id/signup')
  async withdraw(@Req() req: FastifyRequest, @Param('id') id: string) {
    const userId = await this.#caller(req);
    await this.ops.withdraw(id, userId);
    return { ok: true };
  }
}
