import { COMMANDER_AUDIT_JOB, type PromotionReport } from '@grims/shared';
import { PROMOTIONS_SERVICE } from './admin.tokens.js';
import type { PromotionsService, PromotionStanding } from './promotions.service.js';
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Inject,
  Optional,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCode, Permission } from '@grims/shared';
import { RequiresPermission, CloakAsNotFound } from '../authz/requires-permission.guard.js';
import {
  AdminGateGuard,
  RequiresTwoFactor,
  RequiresFreshTwoFactor,
} from '../auth/admin-gate.guard.js';
import { User, type CurrentUser } from '../auth/current-user.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import {
  ADMIN_STORE,
  DASHBOARD_STORE,
  ROLE_ADMIN,
  MAPPING_ADMIN,
  DISCORD_MODERATION,
} from './admin.tokens.js';
import { YTD, type DashboardStore, type DashboardData } from './dashboard.store.js';
import type {
  AdminStore,
  ActivityRow,
  AuditRow,
  MemberRow,
  SquadMemberRow,
} from './admin.store.js';
import {
  MAX_TIMEOUT_MINUTES,
  type DiscordModeration,
  type ModerationAction,
} from './discord-moderation.port.js';
import type { RoleAdminService, MaskPreview } from './role-admin.service.js';
import type { MappingAdminService, MappingRecord } from './mapping-admin.service.js';

/**
 * The admin console's API (P1.7).
 *
 * EVERY route here carries three checks, and they are not redundant:
 *
 *   AuthGuard              — is there a session at all
 *   RequiresPermission     — does this account hold MEMBER_MANAGE
 *   AdminGateGuard         — is a CONFIRMED second factor fresh in this session
 *
 * The third is the one that matters against a stolen session cookie, which the
 * first two cannot see anything wrong with.
 */
@UseGuards(AdminGateGuard)
@RequiresTwoFactor()
@RequiresPermission(Permission.MEMBER_MANAGE)
// A non-officer gets 404, not 403. A 403 confirms the admin surface exists and
// tells an outsider exactly what to go looking for.
@CloakAsNotFound()
@Controller('v1/admin')
export class AdminController {
  constructor(
    @Inject(ADMIN_STORE) private readonly store: AdminStore,
    @Inject(DASHBOARD_STORE) private readonly dash: DashboardStore,
    @Inject(ROLE_ADMIN) private readonly roles: RoleAdminService,
    @Inject(MAPPING_ADMIN) private readonly mappings: MappingAdminService,
    @Inject(DISCORD_MODERATION) private readonly discord: DiscordModeration,
    /*
     * @Optional, matching the pattern already used for LiveService on the cmdr controller: this
     * controller's own tests construct it directly with the collaborators they exercise, and a
     * required sixth would turn each of them into a wiring test.
     *
     * Its absence is not silently survivable — the promotion routes have nothing to answer with —
     * so `#promotions()` says so rather than dereferencing undefined.
     */
    @Optional() @Inject(PROMOTIONS_SERVICE) private readonly promotions?: PromotionsService,
  ) {}

  // ------------------------------------------------------------ squad roster
  /**
   * Every member of the Discord server.
   *
   * ★ SQUADRON OWNER, 2026-08-01 ★
   *
   * "we need to create a full on member roster that shows every member in our discord with full
   * administrative tools for them, kick, ban, timeout"
   *
   * Distinct from `members()`, which lists WEBSITE accounts — currently one, against a hundred and
   * seventeen people in Discord. An officer moderating the squadron works from the second list.
   */
  @Get('squad')
  async squad(): Promise<{ rows: SquadMemberRow[] }> {
    return { rows: await this.store.squadRoster() };
  }

  // ------------------------------------------------------------- promotions
  /**
   * Who WOULD be promoted if the run happened now. Writes nothing.
   *
   * ★ SQUADRON OWNER, 2026-08-02 ★
   *
   * "add a button to each month, that will trigger promotions beyond the job that runs once a month
   * on the 1st day of the month" — and, asked whether to preview first: yes for a whole-month run.
   *
   * The evaluation is the SAME one the monthly job performs, which is what the owner chose: only
   * complete months count, so this is "run it now" rather than "let somebody through".
   */
  @Post('promotions/preview')
  async promotionsPreview(@Query('month') month?: string): Promise<PromotionReport> {
    return this.#promotions().preview(month ?? null);
  }

  /** Runs them for real. Same evaluation as the preview, one flag apart. */
  @Post('promotions/run')
  async promotionsRun(
    @User() caller: CurrentUser | undefined,
    @Query('month') month?: string,
  ): Promise<PromotionReport> {
    const report = await this.#promotions().apply(month ?? null);

    await this.store.writeAudit({
      actorId: caller?.userId ?? null,
      action: 'promotion.run.manual',
      targetType: 'system',
      targetId: 'promotions',
      before: null,
      /*
       * The COUNT and the names. A run that promoted nobody is a real outcome worth being able to
       * point at later — "we did press it, and nobody was due" is a different fact from silence.
       */
      after: {
        // The month is recorded because it changes what the run MEANT. "We ran promotions" and "we
        // ran July's promotions in October" are different facts.
        month: month ?? null,
        promoted: report.promoted,
        considered: report.considered,
        who: report.wouldPromote,
      },
    });

    return report;
  }

  /** Where every member stands on the ladder, for the members page. */
  @Get('promotions/standings')
  async promotionStandings(): Promise<{ standings: PromotionStanding[] }> {
    return { standings: [...(await this.#promotions().standings()).values()] };
  }

  /**
   * Promotes one member by an officer's decision.
   *
   * ★ AN OVERRIDE, DELIBERATELY UNCONDITIONAL — SQUADRON OWNER, 2026-08-02 ★
   *
   * "we are still onboarding, and we need an override!" Asked whether this should follow the rules
   * or override them, the owner chose the override: an officer's judgement, always available.
   *
   * It still refuses to skip rungs — the only rank it grants is the one directly above — so a slip
   * cannot put a new member at Grand Master General.
   */
  @Post('members/:userId/promote')
  async promoteMember(
    @User() caller: CurrentUser | undefined,
    @Param('userId') userId: string,
  ): Promise<{ from: string; to: string }> {
    if (caller === undefined) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    return this.#promotions().promoteOne(userId, caller.userId);
  }

  /** The promotions service, or a clear refusal rather than a crash on undefined. */
  #promotions(): PromotionsService {
    if (this.promotions === undefined) {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, 'Promotions are not configured here.');
    }
    return this.promotions;
  }

  /**
   * Runs the Inara commander check now.
   *
   * ★ SQUADRON OWNER, 2026-08-02 ★
   *
   * "add a button to the admin console to trigger an inara update manually please. that way we can
   * trigger this if we need too ... pressing this should not interupt the daily job."
   *
   * ★ IT REQUESTS, AND THE JOB DECIDES ★
   *
   * NOTIFY, not a queue row. A request is only meaningful while somebody is listening: if the
   * daemon is down there is nothing to run it, and a row sitting in a table would execute at some
   * unknowable later moment when it may no longer be wanted. That is exactly the semantics of a
   * button press.
   *
   * Not interrupting the nightly run is NOT enforced here, and could not be. Both callers contend
   * for one Postgres advisory lock inside `daily-audit.ts` — cron at 00:15 and this — and whichever
   * arrives second is declined and says so. Doing it in this controller would guard only the half
   * of the traffic that comes through the website.
   *
   * ★ MEMBER_MANAGE, MATCHING THE PAGE IT SITS ON ★
   *
   * The button is on Squad members. Anybody who can kick somebody from the guild can certainly ask
   * Inara whether they are still in the squadron.
   */
  @Post('squad/refresh-inara')
  async refreshInara(@User() caller: CurrentUser | undefined): Promise<{ requested: true }> {
    /*
     * `pg_notify` through the same channel the ingest buttons use. The payload is the job name the
     * daemon's registry and the audit's lock both key on — one string, agreed in one place.
     */
    await this.store.requestJob(COMMANDER_AUDIT_JOB);

    await this.store.writeAudit({
      actorId: caller?.userId ?? null,
      action: 'inara.commander-audit.requested',
      targetType: 'system',
      targetId: COMMANDER_AUDIT_JOB,
      before: null,
      after: { source: 'admin console' },
    });

    return { requested: true };
  }

  /**
   * Times out, kicks or bans a Discord member.
   *
   * ★ WHY ONE ENDPOINT AND NOT FIVE ★
   *
   * Every action shares the same four steps in the same order — check the caller may act on this
   * person, call Discord, record what happened whether or not it worked, report it in words. Split
   * five ways, that is five places for one of the four to be forgotten, and the one that gets
   * forgotten is always the audit row.
   *
   * ★ MEMBER_MANAGE, BY THE OWNER'S DECISION ★
   *
   * 2026-08-01, offered separate MEMBER_TIMEOUT / MEMBER_KICK / MEMBER_BAN bits and chose to keep
   * all three under MEMBER_MANAGE. So anybody who can manage members can ban, and that is
   * deliberate. It is inherited from the controller, along with the two-factor gate.
   */
  @Post('squad/:discordId/moderate')
  async moderate(
    @User() caller: CurrentUser | undefined,
    @Param('discordId') discordId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ applied: boolean; problem?: string }> {
    const actorId = requireUser(caller);
    csrf(req);

    const input = (body ?? {}) as Record<string, unknown>;
    const action = readString(input, 'action') as ModerationAction;

    const ALLOWED: readonly ModerationAction[] = ['timeout', 'untimeout', 'kick', 'ban', 'unban'];
    if (!ALLOWED.includes(action)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `Unknown moderation action: ${action}`);
    }

    /*
     * A reason is REQUIRED, and it is not bureaucracy.
     *
     * It goes into Discord's own server audit log as well as ours, so the next officer scrolling
     * that log sees why somebody vanished. Without it a ban issued from this site is
     * indistinguishable from one issued by a compromised bot.
     */
    const reason = readString(input, 'reason').trim();
    if (reason.length < 3) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Give a reason. It is written to the squadron audit log and to the one in Discord.',
      );
    }

    const roster = await this.store.squadRoster();
    const target = roster.find((r) => r.discordId === discordId);

    if (target === undefined) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_VISIBLE,
        'That member is not in the Discord server.',
      );
    }

    /*
     * Acting on yourself is refused before Discord ever sees it. Banning your own account from the
     * console is a mistake with no undo from inside the console, and nobody needs this to do it —
     * the Discord client is right there if they genuinely mean to.
     *
     * The caller's Discord id is looked up rather than read off the session: `CurrentUser` carries
     * a userId and nothing else, and widening it for one check here would put a Discord id on every
     * authenticated request in the application.
     */
    if ((await this.store.discordIdFor(actorId)) === discordId) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'You cannot use this on your own account.');
    }

    /*
     * `unban` is the exception to the hierarchy rule: the person is not in the guild, so they hold
     * no roles to outrank anybody with. Refusing it on `moderatable` would make an accidental ban
     * unfixable from here, which is the one thing this page must never be.
     */
    if (!target.moderatable && action !== 'unban') {
      throw new AppError(
        ErrorCode.PERMISSION_DENIED,
        target.notModeratableBecause ?? 'Discord will not let the bot act on this member.',
      );
    }

    const minutes = action === 'timeout' ? readTimeoutMinutes(input) : undefined;
    const deleteMessageDays = action === 'ban' ? readDeleteDays(input) : undefined;

    const outcome = await this.discord.apply({
      action,
      discordId,
      reason,
      ...(minutes === undefined ? {} : { minutes }),
      ...(deleteMessageDays === undefined ? {} : { deleteMessageDays }),
    });

    /*
     * Recorded even when Discord refused.
     *
     * An audit log that only holds SUCCESSFUL moderation is a flattering fiction: "who tried to ban
     * this member last week" is exactly the question it should be able to answer.
     */
    await this.store.recordModeration({
      actorId,
      discordId,
      targetName: target.nick ?? target.globalName ?? target.username,
      action,
      reason,
      minutes,
      deleteMessageDays,
      applied: outcome.ok,
      problem: outcome.problem,
    });

    return outcome.ok ? { applied: true } : { applied: false, problem: outcome.problem ?? '' };
  }

  /**
   * Monthly activity, the input to promotion.
   *
   * Officers see activity for everyone regardless of the member's privacy
   * toggles, and that is deliberate rather than an oversight of INV-027: the
   * `showActivity` toggle governs what the PUBLIC sees. Rank progression is
   * decided on this data, so an officer who cannot see it cannot do the job —
   * and the member's alternative is not to be enrolled in progression at all.
   */
  /**
   * The dashboard's figures.
   *
   * ★ AGGREGATES ONLY ★
   *
   * Everything here is a squadron-wide count or total. No member's location,
   * credits or fleet appears, because those are governed by their own consent
   * toggles and a dashboard is exactly where they would quietly stop being.
   *
   * Behind the same second-factor gate as every other read on this controller.
   */
  @Get('dashboard')
  async dashboard(@Query('month') month?: string): Promise<DashboardData> {
    /*
     * `month` is the PERIOD — `YYYY-MM`, a bare `YYYY`, or `ytd` — validated in the store
     * (parseMonth/parseYear) rather than here, and anything unparseable falls back to the
     * current month rather than erroring — a stale tab in somebody's URL should show them
     * today, not a stack trace.
     */
    return this.dash.dashboard(new Date(), month);
  }

  @Get('activity')
  async activity(@Query('month') month?: string): Promise<{ month: string; rows: ActivityRow[] }> {
    const key = normalisePeriod(month);
    return { month: key, rows: await this.store.activityForMonth(key) };
  }

  @Get('members')
  async members(): Promise<{ members: MemberRow[] }> {
    return { members: await this.store.members() };
  }

  /**
   * The audit log, filtered.
   *
   * Read-only here and append-only in the database. An admin console that can
   * edit the audit log is an audit log that proves nothing (INV-009).
   *
   * Filters AND together and every one is optional. A flat tail answers neither
   * of the two questions this log exists for — "what did this officer do last
   * week" and "who has been granting roles".
   */
  @Get('audit')
  async audit(
    @Query('limit') limit?: string,
    @Query('page') page?: string,
    @Query('actor') actor?: string,
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
  ): Promise<{
    entries: AuditRow[];
    actions: string[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const n = Number(limit ?? '100');
    const capped = Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 500) : 100;

    /*
     * Page is 1-based because it is shown to a person. Anything unparseable,
     * negative or zero reads as page 1 rather than erroring: a bad page number
     * in a URL should show the first page, not a stack trace.
     */
    const requested = Number(page ?? '1');
    const currentPage = Number.isFinite(requested) ? Math.max(Math.trunc(requested), 1) : 1;

    const [result, actions] = await Promise.all([
      this.store.auditSearch({
        offset: (currentPage - 1) * capped,
        ...(actor === undefined ? {} : { actor }),
        ...(action === undefined ? {} : { action }),
        ...(targetType === undefined ? {} : { targetType }),
        ...(targetId === undefined ? {} : { targetId }),
        ...dateRange(since, until),
        limit: capped,
      }),
      // Offered to the UI so the action filter is a list to pick from rather
      // than a string somebody has to guess the spelling of.
      this.store.auditActions(),
    ]);

    return {
      entries: result.rows,
      actions,
      total: result.total,
      page: currentPage,
      pageSize: capped,
    };
  }

  /* ---------------------------------------------------------------- roles
   *
   * ★ THESE ROUTES REQUIRE ROLE_MANAGE, NOT MEMBER_MANAGE ★
   *
   * The officer bundle deliberately WITHHOLDS ROLE_MANAGE and SITE_CONFIG, for
   * a reason stated in the migration that created it: "an officer who can grant
   * roles can grant themselves anything, which makes the tier boundary
   * decorative."
   *
   * Guarding the role editor with MEMBER_MANAGE — which every officer holds —
   * hands that back. An officer could open the editor, add ROLE_MANAGE and
   * SITE_CONFIG to their own role, save, and become a superuser. Nothing would
   * fail, and the audit row would look like an ordinary permissions edit.
   *
   * The mapping editor is the same escalation by a different route: mapping a
   * Discord role they can already assign onto a platform role with a wider mask.
   */
  @Get('roles')
  @RequiresPermission(Permission.ROLE_MANAGE)
  async listRoles(): Promise<{ roles: Array<Record<string, unknown>> }> {
    const rows = await this.roles.listRoles();
    return {
      roles: rows.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        // Decimal STRING. A mask above 2^53 loses precision as a JSON number
        // (INV-006), and this response feeds an editor that sends it back.
        permMask: r.permMask.toString(),
        rankOrder: r.rankOrder,
        isHierarchical: r.isHierarchical,
      })),
    };
  }

  /**
   * What a mask change WOULD do. Writes nothing.
   *
   * A POST despite being read-only: the mask is a 70-bit decimal string that
   * belongs in a body rather than a URL, and a preview of a change nobody has
   * made should not be a cacheable, linkable, logged GET.
   */
  @Post('roles/:id/preview')
  @RequiresPermission(Permission.ROLE_MANAGE)
  async previewRole(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<MaskPreview> {
    csrf(req);
    return this.roles.previewMaskChange(id, readMask(body));
  }

  @Post('roles/:id')
  @RequiresPermission(Permission.ROLE_MANAGE)
  // TIER 3 (ADR-021): grants permissions, so it asks for the code again.
  @RequiresFreshTwoFactor()
  async saveRole(
    @User() caller: CurrentUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<MaskPreview> {
    const actorId = requireUser(caller);
    csrf(req);
    return this.roles.saveMask(id, readMask(body), actorId);
  }

  /**
   * Clears a member's second factor so they can enrol a new one.
   *
   * ★ P1.10: "Losing the device is recoverable by a sysadmin, and that recovery
   * is audited." ★
   *
   * The realistic failure: an officer's phone is lost or wiped, their recovery
   * codes were never saved, and they are now locked out of the console
   * permanently. Without this the only remedy is a hand-written UPDATE, which
   * is unaudited and exactly the thing the console exists to replace.
   *
   * SITE_CONFIG, not ROLE_MANAGE, and a FRESH step-up: this is the one action
   * that can turn a two-factor account back into a one-factor account, so an
   * attacker who reached it could strip the protection from every officer and
   * then walk in behind them. It is the most dangerous button in the product.
   *
   * It does NOT grant access — it removes the enrolment, so the member is put
   * back through the forced onboarding flow on their next sign-in.
   */
  @Post('members/:userId/reset-two-factor')
  @RequiresPermission(Permission.SITE_CONFIG)
  @RequiresFreshTwoFactor()
  async resetTwoFactor(
    @User() caller: CurrentUser | undefined,
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ reset: true }> {
    const actorId = requireUser(caller);
    csrf(req);

    const reason = readString(body as Record<string, unknown> | null, 'reason');
    if (actorId === userId) {
      // Resetting your OWN second factor from inside a session that required
      // it is a way to launder a temporary compromise into a permanent one.
      // Use a recovery code, or ask another sysadmin.
      throw new AppError(
        ErrorCode.PERMISSION_DENIED,
        'You cannot reset your own second factor here. Use a recovery code, or ask another sysadmin.',
      );
    }

    await this.store.resetTwoFactor(userId, actorId, reason);
    return { reset: true };
  }

  // ---------------------------------------------------------------- mappings
  @Get('mappings')
  @RequiresPermission(Permission.ROLE_MANAGE)
  async listMappings(): Promise<{ mappings: MappingRecord[] }> {
    return { mappings: await this.mappings.list() };
  }

  @Post('mappings')
  @RequiresPermission(Permission.ROLE_MANAGE)
  // TIER 3 (ADR-021): grants permissions, so it asks for the code again.
  @RequiresFreshTwoFactor()
  async addMapping(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ created: true }> {
    const actorId = requireUser(caller);
    csrf(req);
    const b = body as Record<string, unknown> | null;
    await this.mappings.add(readString(b, 'roleId'), readString(b, 'discordRoleId'), actorId);
    return { created: true };
  }

  @Delete('mappings/:roleId/:discordRoleId')
  @RequiresPermission(Permission.ROLE_MANAGE)
  // TIER 3 (ADR-021): grants permissions, so it asks for the code again.
  @RequiresFreshTwoFactor()
  async removeMapping(
    @User() caller: CurrentUser | undefined,
    @Param('roleId') roleId: string,
    @Param('discordRoleId') discordRoleId: string,
    @Req() req: FastifyRequest,
  ): Promise<{ removed: boolean; willAffect: string[]; warning: string }> {
    const actorId = requireUser(caller);
    csrf(req);
    return this.mappings.remove(roleId, discordRoleId, actorId);
  }
}

/**
 * Coerces a period parameter to `YYYY-MM` for a month, or a bare `YYYY` for a year.
 *
 * The period control sends three shapes — `YYYY-MM`, `YYYY`, and `ytd` (the current year).
 * The first two pass through; `ytd` becomes the current year, so the store has exactly two
 * cases to serve. This used to accept only months, so the YTD and Year chips silently showed
 * the CURRENT MONTH under a control that looked like it had answered.
 *
 * Anything unparseable becomes the CURRENT month rather than an error. A
 * dashboard that 400s because of a stray query string is more annoying than
 * useful, and there is no security consequence to the fallback.
 */
function normalisePeriod(raw: string | undefined): string {
  if (raw === YTD) return String(new Date().getUTCFullYear());
  if (raw !== undefined && /^\d{4}$/.test(raw)) {
    const year = Number(raw);
    // The same absurdity guard as the dashboard's parser: a typo must not scan for year 9999.
    if (year >= 2020 && year <= 2100) return raw;
  }
  const d = raw === undefined ? new Date() : new Date(`${raw}-01T00:00:00Z`);
  const use = Number.isNaN(d.getTime()) ? new Date() : d;
  return `${use.getUTCFullYear()}-${String(use.getUTCMonth() + 1).padStart(2, '0')}`;
}

const DATE_ONLY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/**
 * Parses the two date filters.
 *
 * A bare `until` date is pushed to the END of that day. Somebody filtering to
 * "2026-07-27" means the whole day, and treating it as midnight would silently
 * exclude everything that happened on the day they asked about — which is the
 * most recent activity, and usually exactly what they were looking for.
 */
export function dateRange(since?: string, until?: string): { since?: Date; until?: Date } {
  const out: { since?: Date; until?: Date } = {};

  if (since !== undefined && since !== '') {
    const d = new Date(since);
    if (!Number.isNaN(d.getTime())) out.since = d;
  }
  if (until !== undefined && until !== '') {
    const d = new Date(until);
    if (!Number.isNaN(d.getTime())) {
      out.until = DATE_ONLY.test(until) ? new Date(d.getTime() + 86_400_000 - 1) : d;
    }
  }
  return out;
}

/** Masks arrive as DECIMAL STRINGS and are parsed with BigInt, never Number. */
function readMask(body: unknown): bigint {
  const v = (body as Record<string, unknown> | null)?.['permMask'];
  if (typeof v !== 'string' || !/^[0-9]+$/.test(v)) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      'permMask must be a decimal string. A JSON number would lose precision above 2^53.',
    );
  }
  return BigInt(v);
}

function readString(body: Record<string, unknown> | null, key: string): string {
  const v = body?.[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `${key} is required.`);
  }
  return v.trim();
}

function csrf(req: FastifyRequest): void {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);
}

function requireUser(caller: CurrentUser | undefined): string {
  if (caller === undefined) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
  return caller.userId;
}

/**
 * How long a timeout lasts, in minutes.
 *
 * Clamped rather than rejected at the top: Discord's ceiling is 28 days, and an officer who types
 * 60 days meant "as long as possible", not "fail". Below one minute IS rejected, because a
 * zero-minute timeout reports success and does nothing.
 */
function readTimeoutMinutes(input: Record<string, unknown>): number {
  const raw = input['minutes'];
  const n = typeof raw === 'number' ? raw : Number(raw);

  if (!Number.isFinite(n) || n < 1) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'Choose how long the timeout should last.');
  }
  return Math.min(Math.floor(n), MAX_TIMEOUT_MINUTES);
}

/**
 * How much of a banned member's recent history to delete, in days.
 *
 * Defaults to ZERO — deleting nothing. Wiping a week of somebody's messages is a much larger act
 * than removing them: it takes conversations other members were part of with it, and none of it
 * comes back. It has to be asked for explicitly.
 */
function readDeleteDays(input: Record<string, unknown>): number {
  const raw = input['deleteMessageDays'];
  if (raw === undefined || raw === null) return 0;

  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 7) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'Message deletion must be between 0 and 7 days.');
  }
  return Math.floor(n);
}
