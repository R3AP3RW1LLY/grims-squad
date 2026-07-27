import { Controller, Get, Query, Inject, UseGuards } from '@nestjs/common';
import { Permission } from '@grims/shared';
import { RequiresPermission } from '../authz/requires-permission.guard.js';
import { AdminGateGuard, RequiresTwoFactor } from '../auth/admin-gate.guard.js';
import { ADMIN_STORE } from './admin.tokens.js';
import type { AdminStore, ActivityRow, AuditRow, MemberRow } from './admin.store.js';

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
@Controller('v1/admin')
export class AdminController {
  constructor(@Inject(ADMIN_STORE) private readonly store: AdminStore) {}

  /**
   * Monthly activity, the input to promotion.
   *
   * Officers see activity for everyone regardless of the member's privacy
   * toggles, and that is deliberate rather than an oversight of INV-027: the
   * `showActivity` toggle governs what the PUBLIC sees. Rank progression is
   * decided on this data, so an officer who cannot see it cannot do the job —
   * and the member's alternative is not to be enrolled in progression at all.
   */
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
   * The audit log.
   *
   * Read-only here and append-only in the database. An admin console that can
   * edit the audit log is an audit log that proves nothing (INV-009).
   */
  @Get('audit')
  async audit(@Query('limit') limit?: string): Promise<{ entries: AuditRow[] }> {
    const n = Number(limit ?? '100');
    const capped = Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 500) : 100;
    return { entries: await this.store.auditTail(capped) };
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
