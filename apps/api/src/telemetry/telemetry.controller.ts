import { Optional, Controller, Post, Get, Put, Delete, Body, Param, Req, Inject } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { Public } from '../auth/auth.guard.js';
import { User, type CurrentUser } from '../auth/current-user.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import { PAIRING_SERVICE, INGEST_SERVICE, CONSENT_SERVICE } from './telemetry.tokens.js';
import type { PairingService } from './pairing.service.js';
import type { JournalIngestService, IncomingEvent } from './journal-ingest.service.js';
import type { ConsentService } from './consent.service.js';
import { LIVE_SERVICE } from '../live/live.tokens.js';
import type { LiveService } from '../live/live.service.js';
import { TELEMETRY_CATALOGUE, REQUIRED_CATEGORY } from '@grims/shared';

@Controller('v1')
export class TelemetryController {
  constructor(
    @Inject(PAIRING_SERVICE) private readonly pairing: PairingService,
    @Inject(INGEST_SERVICE) private readonly ingest: JournalIngestService,
    @Inject(CONSENT_SERVICE) private readonly consent: ConsentService,
    /*
     * OPTIONAL. Ingest must not fail because the live stream is unavailable —
     * a member's upload is the thing that matters and a notification is not.
     */
    @Optional() @Inject(LIVE_SERVICE) private readonly live: LiveService | null = null,
  ) {}

  // ------------------------------------------------------------------ pairing
  /**
   * Mints a device token. Requires a normal signed-in SESSION.
   *
   * The token is returned once, in this response, and never again — we hold
   * only its hash. The member pastes it into the app.
   */
  @Post('me/devices')
  async pairDevice(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ token: string; deviceId: string; label: string }> {
    const userId = requireUser(caller);
    csrf(req);
    const label = (body as Record<string, unknown> | null)?.['label'];
    return this.pairing.pair(userId, typeof label === 'string' ? label : '');
  }

  /** The member's paired devices. Never includes a token or a hash. */
  @Get('me/devices')
  async listDevices(@User() caller: CurrentUser | undefined): Promise<{
    devices: Array<{ id: string; label: string; lastUsedAt: string | null; createdAt: string }>;
  }> {
    const userId = requireUser(caller);
    const devices = await this.pairing.listDevices(userId);
    return {
      devices: devices
        .filter((d) => d.revokedAt === null)
        .map((d) => ({
          id: d.id,
          label: d.label,
          lastUsedAt: d.lastUsedAt?.toISOString() ?? null,
          createdAt: d.createdAt.toISOString(),
        })),
    };
  }

  @Delete('me/devices/:id')
  async revokeDevice(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<{ revoked: true }> {
    const userId = requireUser(caller);
    csrf(req);
    await this.pairing.revoke(userId, id);
    return { revoked: true };
  }

  // ----------------------------------------------------------------- consent
  /**
   * What the member has switched OFF, and the full catalogue of what they could.
   *
   * ★ THE CATALOGUE TRAVELS WITH THE ANSWER ★
   *
   * Under opt-out a member can only decide about things they can SEE, so the
   * page needs every category, every event, and a sentence saying what each
   * reveals. Sending it from here rather than keeping a copy in the web app
   * means the two cannot drift — a settings page offering a switch the server
   * would reject is worse than no switch at all.
   */
  @Get('me/telemetry-consent')
  async getConsent(@User() caller: CurrentUser | undefined): Promise<{
    optOutCategories: readonly string[];
    optOutEvents: readonly string[];
    catalogue: typeof TELEMETRY_CATALOGUE;
    requiredCategory: string;
  }> {
    const userId = requireUser(caller);
    const state = await this.consent.get(userId);

    return {
      optOutCategories: state.categories,
      optOutEvents: state.events,
      catalogue: TELEMETRY_CATALOGUE,
      // Named rather than left for the page to hardcode, so the one thing that
      // cannot be switched off is decided in exactly one place.
      requiredCategory: REQUIRED_CATEGORY,
    };
  }

  /**
   * Replaces what the member has switched off, purging anything newly declined.
   *
   * PUT rather than PATCH, and the whole set rather than one toggle: a settings
   * screen that sends one flag at a time races itself, and the second request
   * overwrites the first with a stale view of the rest.
   *
   * Declining `session` is REFUSED with an explanation rather than quietly
   * dropped — see the service.
   */
  @Put('me/telemetry-consent')
  async setConsent(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ optOutCategories: readonly string[]; optOutEvents: readonly string[]; purged: number }> {
    const userId = requireUser(caller);
    csrf(req);

    const b = body as Record<string, unknown> | null;
    const categories = b?.['optOutCategories'];
    const events = b?.['optOutEvents'];

    const isStrings = (v: unknown): v is string[] =>
      Array.isArray(v) && v.every((x) => typeof x === 'string');

    if (!isStrings(categories) || !isStrings(events)) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Expected optOutCategories and optOutEvents arrays.',
      );
    }

    const { state, purged } = await this.consent.set(userId, { categories, events });
    return { optOutCategories: state.categories, optOutEvents: state.events, purged };
  }

  // ------------------------------------------------------------------ ingest
  /**
   * Receives journal events from the companion app.
   *
   * ★ @Public, AND THAT IS NOT A HOLE ★
   *
   * `@Public()` opts out of the SESSION guard, not out of authentication. This
   * endpoint authenticates with a device token in an Authorization header
   * instead, because the app is not a browser and has no session — it must not
   * be carrying one.
   *
   * The distinction matters: a session cookie would be sent automatically by
   * anything running in a browser context, whereas a bearer token is presented
   * deliberately. A companion app holding a session would be a far larger
   * credential than it needs.
   *
   * ★ AND NO CSRF CHECK, DELIBERATELY ★
   *
   * CSRF protects cookie-authenticated requests, because a browser attaches
   * cookies to cross-site requests without being asked. Nothing attaches a
   * bearer token on somebody's behalf, so there is no forgery to prevent — and
   * requiring a CSRF cookie here would mean the app had to hold one, which
   * would defeat the point.
   */
  @Public()
  @Post('telemetry/journal')
  async journal(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{
    accepted: number;
    duplicates: number;
    rejected: number;
    refused: Record<string, number>;
  }> {
    const header = req.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    const device = token === '' ? null : await this.pairing.authenticate(token);
    if (device === null) {
      // 401 with no detail. Unknown, revoked and wrongly-scoped are one answer,
      // so a caller learns only that their token is not usable.
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'This device is not paired.');
    }

    const events = (body as Record<string, unknown> | null)?.['events'];
    if (!Array.isArray(events)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Expected an events array.');
    }

    /*
     * ★ THE HEARTBEAT ★
     *
     * `gameRunning` says the member's journal is still being WRITTEN, which is
     * the only honest "playing right now" signal we have. Elite's journal
     * clusters at session start and then goes quiet for hours, so presence
     * inferred from event recency would report somebody mid-flight as offline.
     *
     * A batch may carry this with NO events at all — that is the case it exists
     * for, and why an empty array is accepted here rather than rejected.
     */
    const gameRunning = (body as Record<string, unknown> | null)?.['gameRunning'] === true;

    const result = await this.ingest.ingest(
      device.userId,
      device.id,
      events as IncomingEvent[],
      undefined,
      { gameRunning },
    );

    /*
     * ★ ONLY WHEN SOMETHING ACTUALLY CHANGED ★
     *
     * The companion app uploads on a timer, and most batches are empty or
     * entirely duplicates. Publishing on every request would wake every open
     * tab several times a minute to re-fetch data that is identical — which is
     * worse than not being live at all, because it is constant work with no
     * visible result.
     *
     * `gameRunning` is published separately: it is a heartbeat, so it changes
     * "playing now" without any event being stored.
     */
    if (result.accepted > 0) {
      this.live?.publish({ type: 'telemetry', userId: device.userId });
    }
    if (gameRunning === true) {
      this.live?.publish({ type: 'presence', userId: null });
    }

    return result;
  }
}

function csrf(req: FastifyRequest): void {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);
}

function requireUser(caller: CurrentUser | undefined): string {
  if (caller === undefined) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
  return caller.userId;
}
