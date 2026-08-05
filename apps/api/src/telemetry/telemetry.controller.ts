import { Optional, Controller, Post, Get, Put, Delete, Body, Param, Req, Inject } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { Public } from '../auth/auth.guard.js';
import { User, type CurrentUser } from '../auth/current-user.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import { PAIRING_SERVICE, INGEST_SERVICE, CONSENT_SERVICE } from './telemetry.tokens.js';
import type { PairingService } from './pairing.service.js';
import { DeviceLinkService } from './device-link.service.js';
import type { JournalIngestService, IncomingEvent } from './journal-ingest.service.js';
import type { ConsentService } from './consent.service.js';
import { LIVE_SERVICE } from '../live/live.tokens.js';
import type { LiveService } from '../live/live.service.js';
import { TELEMETRY_CATALOGUE, REQUIRED_CATEGORY } from '@grims/shared';
import { RELEASE_STORE } from '../companion/companion.tokens.js';
import { newestVersion } from '../companion/release.service.js';
import type { ReleaseStore } from '../companion/release.service.js';

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
    /*
     * OPTIONAL, like the live service. The companion's settings call must not
     * fail because no release store is configured — what a member has switched
     * off matters far more than whether an update exists.
     */
    @Optional() @Inject(RELEASE_STORE) private readonly releases: ReleaseStore | null = null,
    @Optional() @Inject(DeviceLinkService) private readonly links: DeviceLinkService | null = null,
  ) {}

  // ------------------------------------------------------------- device links
  /**
   * The app asks to be linked. Nobody is signed in yet, so this is public.
   *
   * ★ SQUADRON OWNER, 2026-08-01: "COMPANION Discord login; remove key generator" ★
   *
   * Open by design and safe because the result is inert: a link grants nothing until a signed-in
   * member approves that specific code in a browser, and the caller has no way to approve their
   * own. See `DeviceLinkService.start`.
   */
  @Public()
  @Post('telemetry/links')
  async startLink(
    @Body() body: unknown,
  ): Promise<{ code: string; pollSecret: string; expiresAt: string; verifyUrl: string }> {
    const links = this.requireLinks();
    const label = (body as Record<string, unknown> | null)?.['label'];
    const started = await links.start(typeof label === 'string' ? label : '');

    return {
      code: started.code,
      pollSecret: started.pollSecret,
      expiresAt: started.expiresAt.toISOString(),
      /*
       * Built here rather than in the app. The app would have to be rebuilt and redistributed to
       * follow a domain change; the server already knows where it lives.
       */
      verifyUrl: `${webBase()}/link-device?code=${encodeURIComponent(started.code)}`,
    };
  }

  /** What the approval page shows before the member commits. Public: the code IS the lookup. */
  @Public()
  @Get('telemetry/links/:code')
  async describeLink(@Param('code') code: string): Promise<{ label: string } | { label: null }> {
    const links = this.requireLinks();
    const found = await links.describe(code);
    // Null rather than a 404: "no such code" and "expired code" must look identical, and a status
    // code is exactly the sort of difference somebody guessing codes would measure.
    return found ?? { label: null };
  }

  /** A signed-in member approves. This is where the account is bound and the device minted. */
  @Post('telemetry/links/:code/approve')
  async approveLink(
    @User() caller: CurrentUser | undefined,
    @Param('code') code: string,
    @Req() req: FastifyRequest,
  ): Promise<{ label: string }> {
    const userId = requireUser(caller);
    csrf(req);
    return this.requireLinks().approve(userId, code);
  }

  /**
   * The app collects its token. Public, because the app has no session — the polling secret is
   * what authenticates it, and that secret was never displayed to anybody.
   */
  @Public()
  @Post('telemetry/links/:code/poll')
  async pollLink(
    @Param('code') code: string,
    @Body() body: unknown,
  ): Promise<{ status: string; token?: string }> {
    const secret = (body as Record<string, unknown> | null)?.['pollSecret'];
    const state = await this.requireLinks().poll(code, typeof secret === 'string' ? secret : '');
    return state.status === 'approved'
      ? { status: 'approved', token: state.token }
      : { status: state.status };
  }

  /** The service is optional for the same reason the others are; say so plainly if it is absent. */
  private requireLinks(): DeviceLinkService {
    if (this.links === null) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'Device linking is not available.');
    }
    return this.links;
  }

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
  /**
   * What the companion app needs to describe itself to the member.
   *
   * ★ WHY THIS IS NOT `me/telemetry-consent` ★
   *
   * That route is authenticated by a SESSION, and the app deliberately holds no
   * session — its whole identity is a device token, which is a far smaller
   * credential than a cookie that can act as the member anywhere on the site.
   * So the app gets its own route with its own authentication, returning only
   * what a settings panel needs.
   *
   * ★ WHY NOT FOLD IT INTO THE UPLOAD RESPONSE ★
   *
   * Because the uploader does not call the hub at all when there is nothing to
   * send and the game is not running — which is most of the time. The panel
   * would then be blank or stale for exactly the member who opened the app to
   * check on it.
   *
   * ★ READ ONLY ★
   *
   * The app can SEE what has been switched off; it cannot change it. Settings
   * are changed on the website behind a real sign-in, because a device token
   * pasted into the wrong place must never be able to alter what is collected
   * about somebody.
   */
  @Public()
  @Get('telemetry/settings')
  async deviceSettings(@Req() req: FastifyRequest): Promise<{
    optOutCategories: readonly string[];
    optOutEvents: readonly string[];
    catalogue: typeof TELEMETRY_CATALOGUE;
    requiredCategory: string;
    storedEvents: number;
    firstEventAt: string | null;
    latestVersion: string | null;
  }> {
    const device = await this.#device(req);

    const [state, contribution, assets] = await Promise.all([
      this.consent.get(device.userId),
      this.ingest.contribution(device.userId),
      /*
       * ★ THE UPDATE CHECK RIDES ALONG HERE ★
       *
       * The app already calls this every five minutes with its device token, so
       * telling it the newest published version costs no extra request, no new
       * endpoint and no second authentication path.
       *
       * Optional, so a deployment with no release store configured simply never
       * offers an update rather than failing this call — which the app relies
       * on for what it collects.
       */
      this.releases?.list().catch(() => []) ?? Promise.resolve([]),
    ]);

    return {
      optOutCategories: state.categories,
      optOutEvents: state.events,
      /*
       * The whole catalogue, so the app can name and explain every category
       * without carrying its own copy. Two copies would drift, and the drift
       * would be an app telling a member something is being collected that the
       * server stopped storing — or worse, the reverse.
       */
      catalogue: TELEMETRY_CATALOGUE,
      requiredCategory: REQUIRED_CATEGORY,
      storedEvents: contribution.storedEvents,
      firstEventAt: contribution.firstEventAt?.toISOString() ?? null,
      /*
       * The newest version across every platform, not per-platform: a release
       * publishes all three together, and an app comparing against another
       * platform's build would be comparing the same number anyway.
       */
      /*
       * ★ WAS A STRING SORT, AND THAT WAS A REAL BUG ★
       *
       * `.sort((x, y) => x < y ? 1 : -1)` compares versions as TEXT. With
       * 0.10.0 and 0.9.0 both in the bucket it answered 0.9.0 — and from the
       * tenth release onward the app would have stopped being told about
       * updates at all, silently, with nothing to see.
       *
       * `newestVersion` compares numerically and is the SAME function the
       * website uses, so the app and the site can no longer disagree about
       * which build is current.
       */
      latestVersion: newestVersion(assets),
    };
  }

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
    const device = await this.#device(req);

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
    /*
     * A STATEMENT, not the absence of one. The app sends this once when the
     * game closes, so presence drops in seconds instead of ageing out over five
     * minutes — and an ordinary upload that simply omits the flag leaves
     * presence exactly as it was.
     */
    const gameStopped = (body as Record<string, unknown> | null)?.['gameStopped'] === true;

    const result = await this.ingest.ingest(
      device.userId,
      device.id,
      events as IncomingEvent[],
      undefined,
      { gameRunning, gameStopped },
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
    if (gameRunning === true || gameStopped === true) {
      // Both directions. A roster that updated when somebody arrived and not
      // when they left would drift further from the truth with every session.
      this.live?.publish({ type: 'presence', userId: null });
    }

    return result;
  }

  /**
   * The device behind a bearer token, or 401.
   *
   * ★ ONE RULE, TWO ROUTES ★
   *
   * Extracted when the settings route was added rather than copied. Two
   * inlined copies of an authentication check is how one of them ends up
   * accepting a token the other rejects — and the looser one is always the one
   * nobody notices.
   */
  async #device(req: FastifyRequest): Promise<{ id: string; userId: string }> {
    const header = req.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    const device =
      token === '' ? null : await this.pairing.authenticate(token, new Date(), appVersionOf(req));
    if (device === null) {
      // 401 with no detail. Unknown, revoked and wrongly-scoped are one answer,
      // so a caller learns only that their token is not usable.
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'This device is not paired.');
    }

    return device;
  }
}

/**
 * The companion version the caller says it is running.
 *
 * ★ VALIDATED, BECAUSE IT IS DISPLAYED ★
 *
 * This string is written by a client we do not control and is shown back to the
 * member on the devices page. Accepting it verbatim would put whatever a caller
 * sent into somebody's browser, and "the app told us" is not a reason to trust
 * a value with a token that anybody holding the device already has.
 *
 * A version is digits and dots, with an optional pre-release tag — anything
 * else is not a version and is dropped rather than cleaned up, because a
 * half-scrubbed string is still a string somebody chose.
 *
 * Returns `undefined` when the header is absent, which leaves the stored value
 * untouched. Only the settings poll sends it, and the ingest route must not
 * wipe a known version on every batch.
 */
/**
 * Where the website lives, for the link-approval URL the app opens.
 *
 * Read from OUR configuration, never from the request. The app is told where to send its member,
 * and a caller-supplied base here would be an open redirect with a credential at the end of it.
 *
 * ★ IT FALLS BACK TO PUBLIC_URL, AND THAT IS THE WHOLE FIX ★
 *
 * Squadron owner, 2026-08-05: "when we go to add the app to our production website it redirects us
 * to the localhost site!"
 *
 * This read WEB_BASE_URL alone and returned an empty string when it was unset, making the answer a
 * RELATIVE path — correct on a laptop, where the app and the site share an origin, and useless
 * from a desktop app talking to a server, which resolved it against its own default and opened
 * localhost. Nobody set WEB_BASE_URL in production because nothing said it was load-bearing.
 *
 * PUBLIC_URL is already REQUIRED in production (the deploy refuses without it) and is already the
 * address the deployment serves, so the environment answers this question by itself: production
 * gets the production site, a laptop with neither variable set keeps the relative path it wants.
 * WEB_BASE_URL still wins when present, for a split origin.
 */
function webBase(): string {
  const explicit = (process.env['WEB_BASE_URL'] ?? '').trim();
  const fallback = (process.env['PUBLIC_URL'] ?? '').trim();
  return (explicit === '' ? fallback : explicit).replace(/\/+$/, '');
}

function appVersionOf(req: FastifyRequest): string | undefined {
  const raw = req.headers['x-app-version'];
  if (typeof raw !== 'string') return undefined;

  const value = raw.trim();
  if (value === '') return undefined;
  // Bounded before the regex runs. A megabyte of digits is a valid-looking
  // version and a pointless amount of work to match against.
  if (value.length > 32) return undefined;

  return /^\d+(\.\d+){0,3}(-[0-9A-Za-z.-]+)?$/.test(value) ? value : undefined;
}

function csrf(req: FastifyRequest): void {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);
}

function requireUser(caller: CurrentUser | undefined): string {
  if (caller === undefined) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
  return caller.userId;
}
