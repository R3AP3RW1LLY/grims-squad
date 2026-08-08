import { Body, Controller, Delete, Get, Inject, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { Public } from '../auth/auth.guard.js';
import type { PairingService } from '../telemetry/pairing.service.js';
import { PAIRING_SERVICE } from '../telemetry/telemetry.tokens.js';
import { SystemMarksService } from './system-marks.service.js';

/**
 * The same saved systems, for the app.
 *
 * ★ THE WHOLE POINT IS THAT IT IS THE SAME LIST ★
 *
 * A member who pins a system on the website and then opens the app is looking at one account. If
 * these were two stores the feature would be worse than the text boxes it replaces — somebody would
 * pin something, not find it, and stop trusting the star.
 *
 * So this is the same service, the same table and the same ranking (`rankSystemChoices` in
 * @grims/shared). Only the door is different: the app authenticates a paired device rather than a
 * browser session.
 *
 * ★ NO PERMISSION GATE, DELIBERATELY ★
 *
 * The bounty and colonisation device routes check a permission because they return squadron data.
 * This returns a member's own bookmarks and nothing else — there is no shape of any request here
 * that reaches another account, because the user id comes from the paired device and nowhere else.
 * Gating it behind TRADE_QUERY would mean a member who cannot see the market also cannot use the
 * system box on the scout page, which is a rule nobody asked for.
 */
@Controller('v1/companion/systems')
export class SystemMarksDeviceController {
  constructor(
    private readonly marks: SystemMarksService,
    @Inject(PAIRING_SERVICE) private readonly pairing: PairingService,
  ) {}

  async #caller(req: FastifyRequest): Promise<string> {
    const header = req.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    const device = token === '' ? null : await this.pairing.authenticate(token, new Date());
    if (device === null) {
      // Unknown, revoked and wrongly-scoped are one reply, matching the telemetry routes.
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'This device is not paired.');
    }
    return device.userId;
  }

  @Public()
  @Get()
  async list(@Req() req: FastifyRequest) {
    return { systems: await this.marks.list(await this.#caller(req)) };
  }

  @Public()
  @Post('use')
  async use(@Req() req: FastifyRequest, @Body() body: { system?: string; systemId64?: string }) {
    await this.marks.use(await this.#caller(req), body.system ?? '', body.systemId64 ?? null);
    return { ok: true };
  }

  @Public()
  @Post('pin')
  async pin(@Req() req: FastifyRequest, @Body() body: { system?: string; label?: string }) {
    await this.marks.pin(await this.#caller(req), body.system ?? '', body.label ?? null);
    return { ok: true };
  }

  @Public()
  @Delete('pin')
  async unpin(@Req() req: FastifyRequest, @Query('system') system?: string) {
    await this.marks.unpin(await this.#caller(req), system ?? '');
    return { ok: true };
  }
}
