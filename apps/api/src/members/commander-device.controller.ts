import { Controller, Get, Inject, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { Public } from '../auth/auth.guard.js';
import { PAIRING_SERVICE } from '../telemetry/telemetry.tokens.js';
import type { PairingService } from '../telemetry/pairing.service.js';
import { MEMBERS_STORE } from './members.tokens.js';
import type { MembersStore } from './members.store.js';
import { buildCommanderProfile } from './commander-profile.service.js';

/**
 * Where the commander is, for the companion app.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "can we also add the location to the companion app status page, and show it like it is shown in
 * the web app please."
 *
 * ★ THE HUB ANSWERS, THE APP DRAWS ★
 *
 * The app reads the journals and could work this out for itself — it already tracks `dockedAt` for
 * the colonisation panels. It deliberately does not.
 *
 * `hub-colony.ts` states the rule for this whole surface: "a second copy that could disagree with
 * the website is exactly the bug a member would report as 'the app says something different' and
 * nobody could reproduce". Location is the field with the worst history of exactly that — it has
 * been wrong twice, both times because two places decided it and only one was fixed.
 *
 * So there is one implementation, `buildCommanderProfile`, and both surfaces read its answer. "Show
 * it like it is shown in the web app" is then true by construction rather than by care.
 *
 * ★ ONLY THE LOCATION ★
 *
 * Not the whole profile. Ranks, credits and the fleet are not on this page, and sending a
 * member's balance to a screen that does not display it is collecting a risk for nothing.
 */
@Controller('v1/companion/commander')
export class CommanderDeviceController {
  constructor(
    @Inject(PAIRING_SERVICE) private readonly pairing: PairingService,
    @Inject(MEMBERS_STORE) private readonly store: MembersStore,
  ) {}

  /**
   * The device behind this request.
   *
   * No permission beyond being paired: this is the member's OWN position, returned to the machine
   * they paired themselves, and it is the same data that machine sent us in the first place.
   */
  async #caller(req: FastifyRequest): Promise<{ userId: string }> {
    const header = req.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    const device = token === '' ? null : await this.pairing.authenticate(token, new Date());
    if (device === null) {
      // The same opaque answer every other device route gives: unknown, revoked and wrongly-scoped
      // are one reply, so a caller learns only that their token is not usable.
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'This device is not paired.');
    }

    return { userId: device.userId };
  }

  @Public()
  @Get('location')
  async location(@Req() req: FastifyRequest): Promise<{
    currentSystem: string | null;
    systemSeenAt: string | null;
    currentLocation: string | null;
    locationSeenAt: string | null;
  }> {
    const me = await this.#caller(req);
    const events = await this.store.profileEvents(me.userId);

    /*
     * `null` for the name and for Inara: neither contributes to a position, and fetching ranks to
     * throw them away would be a second query per poll for nothing.
     */
    const profile = buildCommanderProfile(events, null, null);

    return {
      currentSystem: profile.currentSystem,
      systemSeenAt: profile.systemSeenAt,
      currentLocation: profile.currentLocation,
      locationSeenAt: profile.locationSeenAt,
    };
  }
}
