import { Controller, Post, Get, Delete, Body, Param, Req, Inject } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { Public } from '../auth/auth.guard.js';
import { User, type CurrentUser } from '../auth/current-user.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import { PAIRING_SERVICE, INGEST_SERVICE } from './telemetry.tokens.js';
import type { PairingService } from './pairing.service.js';
import type { JournalIngestService, IncomingEvent } from './journal-ingest.service.js';

@Controller('v1')
export class TelemetryController {
  constructor(
    @Inject(PAIRING_SERVICE) private readonly pairing: PairingService,
    @Inject(INGEST_SERVICE) private readonly ingest: JournalIngestService,
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
  ): Promise<{ accepted: number; duplicates: number; rejected: number }> {
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

    return this.ingest.ingest(device.userId, device.id, events as IncomingEvent[]);
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
