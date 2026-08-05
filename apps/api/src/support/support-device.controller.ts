import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission } from '@grims/shared';
import { Public } from '../auth/auth.guard.js';
import { PermissionService } from '../authz/permission.service.js';
import { PAIRING_SERVICE } from '../telemetry/telemetry.tokens.js';
import type { PairingService } from '../telemetry/pairing.service.js';
import { SupportService } from './support.service.js';

/**
 * The support console, for the companion app.
 *
 * ★ THE SAME SERVICE, THE SAME PERMISSION — A DIFFERENT DOOR ★
 *
 * Every route delegates to the identical `SupportService` the website's console uses, and
 * checks the identical SUPPORT_AGENT bit. The ONLY difference is how the caller is identified:
 * the site has a session cookie, the app has a paired device token — the same shape as
 * `ColonyDeviceController`, and for the same reason: a second implementation would drift, and
 * the half that drifted would be the one deciding who may read a member's private conversation.
 *
 * The permission is resolved from the USER behind the token, never from the device: an
 * officer's laptop is an officer, and the same laptop after they are demoted is not.
 *
 * ★ EVERY ROUTE IS @Public(), AND THE SPEC ENFORCES IT ★
 *
 * A device has no session, so a route without the decorator answers 401 to a correctly paired
 * app — the exact bug colony-device documents at length. `support-device-public.spec.ts` fails
 * the build for a route that loses it, exactly as `device-routes-public.spec.ts` does for the
 * colony door.
 */
@Controller('v1/companion/support')
export class SupportDeviceController {
  constructor(
    @Inject(SupportService) private readonly support: SupportService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(PAIRING_SERVICE) private readonly pairing: PairingService,
  ) {}

  /** The member behind a bearer token, having checked they may work the console. */
  async #agent(req: FastifyRequest): Promise<{ userId: string }> {
    const device = await this.#device(req);
    const mask = await this.permissions.effectiveMask(device.userId);
    if ((mask & Permission.SUPPORT_AGENT) !== Permission.SUPPORT_AGENT) {
      throw new AppError(
        ErrorCode.PERMISSION_DENIED,
        'You do not have access to the support console.',
      );
    }
    return { userId: device.userId };
  }

  async #device(req: FastifyRequest): Promise<{ userId: string }> {
    const header = req.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    const device = token === '' ? null : await this.pairing.authenticate(token, new Date());
    if (device === null) {
      // The same opaque answer every device door gives: unknown, revoked and wrongly-scoped are
      // one reply, so a caller learns only that their token is not usable.
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'This device is not paired.');
    }
    return { userId: device.userId };
  }

  /**
   * Whether the paired member may work the console at all — the app's sidebar reads this.
   *
   * A non-throwing answer, deliberately: "no" is the ordinary case for most members, and the
   * sidebar deciding whether to draw an entry must not read as an error in anybody's log. The
   * console routes below still check for themselves; this is a rendering hint, never the gate.
   */
  @Public()
  @Get('access')
  async access(@Req() req: FastifyRequest) {
    const device = await this.#device(req);
    const mask = await this.permissions.effectiveMask(device.userId);
    return { agent: (mask & Permission.SUPPORT_AGENT) === Permission.SUPPORT_AGENT };
  }

  @Public()
  @Get('badge')
  async badge(@Req() req: FastifyRequest) {
    await this.#agent(req);
    return this.support.consoleBadge();
  }

  @Public()
  @Get('conversations')
  async list(@Req() req: FastifyRequest, @Query('status') status?: string) {
    await this.#agent(req);
    return {
      conversations: await this.support.consoleList(status === 'closed' ? 'closed' : 'open'),
    };
  }

  @Public()
  @Get('conversations/:id')
  async read(@Req() req: FastifyRequest, @Param('id') id: string) {
    await this.#agent(req);
    return this.support.consoleRead(id);
  }

  /**
   * A reply from the app carries the same identity as one from the site — the officer behind
   * the device, by name and face. No attachment parameter: the hardened upload path is a
   * browser session's, and the app's composer does not offer what the API would refuse.
   */
  @Public()
  @Post('conversations/:id/messages')
  async reply(@Req() req: FastifyRequest, @Param('id') id: string, @Body() body: { body?: string }) {
    const me = await this.#agent(req);
    return { message: await this.support.replyAsOfficer(me.userId, id, body.body, undefined) };
  }

  @Public()
  @Patch('conversations/:id/close')
  async close(@Req() req: FastifyRequest, @Param('id') id: string) {
    const me = await this.#agent(req);
    await this.support.transition(me.userId, id, 'close');
    return { ok: true };
  }

  @Public()
  @Patch('conversations/:id/reopen')
  async reopen(@Req() req: FastifyRequest, @Param('id') id: string) {
    const me = await this.#agent(req);
    await this.support.transition(me.userId, id, 'reopen');
    return { ok: true };
  }
}
