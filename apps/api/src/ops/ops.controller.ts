import { Body, Controller, Delete, Get, Inject, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission, hasPermission } from '@grims/shared';
import { PermissionService } from '../authz/permission.service.js';
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
