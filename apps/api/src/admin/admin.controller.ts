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
import { ADMIN_STORE, DASHBOARD_STORE, ROLE_ADMIN, MAPPING_ADMIN } from './admin.tokens.js';
import type { DashboardStore, DashboardData } from './dashboard.store.js';
import type { AdminStore, ActivityRow, AuditRow, MemberRow } from './admin.store.js';
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
  ) {}

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
     * `month` is validated in the store (parseMonth) rather than here, and anything unparseable
     * falls back to the current month rather than erroring — a stale tab in somebody's URL should
     * show them today, not a stack trace.
     */
    return this.dash.dashboard(new Date(), month);
  }

  @Get('activity')
  async activity(@Query('month') month?: string): Promise<{ month: string; rows: ActivityRow[] }> {
    const key = normaliseMonth(month);
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
 * Coerces a month parameter to the first of a month, UTC.
 *
 * Anything unparseable becomes the CURRENT month rather than an error. A
 * dashboard that 400s because of a stray query string is more annoying than
 * useful, and there is no security consequence to the fallback.
 */
function normaliseMonth(raw: string | undefined): string {
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
