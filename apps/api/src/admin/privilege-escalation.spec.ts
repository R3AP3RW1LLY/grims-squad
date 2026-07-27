import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Permission } from '@grims/shared';

const HERE = dirname(fileURLToPath(import.meta.url));
const controller = readFileSync(resolve(HERE, 'admin.controller.ts'), 'utf8');

/**
 * ★ RED-TEAM FINDING, 2026-07-27 — PRIVILEGE ESCALATION ★
 *
 * The officer role bundle deliberately WITHHOLDS ROLE_MANAGE and SITE_CONFIG.
 * The migration that created it says why: "an officer who can grant roles can
 * grant themselves anything, which makes the tier boundary decorative."
 *
 * The role editor was first shipped guarded by MEMBER_MANAGE — which every
 * officer holds. That handed the withheld permissions straight back:
 *
 *   1. Officer opens the role editor (MEMBER_MANAGE — allowed).
 *   2. Adds ROLE_MANAGE and SITE_CONFIG to their own role.
 *   3. Saves. They are now a superuser.
 *
 * Nothing failed. The audit row read as an ordinary permissions edit, and the
 * whole superuser/officer boundary was decorative from the moment the editor
 * existed. The mapping editor was the same escalation by a different route:
 * point a Discord role you can already assign at a platform role with a wider
 * mask.
 *
 * These tests exist so the guard cannot be quietly relaxed back to
 * MEMBER_MANAGE by someone who finds it inconvenient.
 */
describe('@RED-TEAM the role editor cannot be reached with MEMBER_MANAGE alone', () => {
  /** Every route handler, with the decorators that immediately precede it. */
  function guardFor(routeDecorator: string): string {
    const at = controller.indexOf(routeDecorator);
    expect(at, `${routeDecorator} not found`).toBeGreaterThan(-1);
    // From the route decorator to the end of the method signature.
    return controller.slice(at, controller.indexOf('(', controller.indexOf('async', at)));
  }

  const ROLE_ROUTES = [
    "@Get('roles')",
    "@Post('roles/:id/preview')",
    "@Post('roles/:id')",
    "@Get('mappings')",
    "@Post('mappings')",
    "@Delete('mappings/:roleId/:discordRoleId')",
  ];

  it('MANDATORY: every role and mapping route requires ROLE_MANAGE', () => {
    for (const route of ROLE_ROUTES) {
      expect(guardFor(route), route).toContain('RequiresPermission(Permission.ROLE_MANAGE)');
    }
  });

  it('MANDATORY: ROLE_MANAGE is genuinely not in the officer bundle', () => {
    // The premise of the whole finding. If officers ever DID hold ROLE_MANAGE,
    // the guard above would be pointless and this test would say so rather than
    // passing quietly.
    const OFFICER_MASK = 1186364117243923545215n;
    expect(OFFICER_MASK & Permission.ROLE_MANAGE).toBe(0n);
    expect(OFFICER_MASK & Permission.SITE_CONFIG).toBe(0n);
    // ...while they DO hold the permission that guards the rest of the console,
    // which is exactly why the two must be different checks.
    expect(OFFICER_MASK & Permission.MEMBER_MANAGE).not.toBe(0n);
  });

  it('the read-only console routes still only need MEMBER_MANAGE', () => {
    // Officers must keep being able to do their job. The fix is a narrower
    // guard on the dangerous routes, not a broader one on everything.
    for (const route of ["@Get('activity')", "@Get('members')", "@Get('audit')"]) {
      expect(guardFor(route), route).not.toContain('ROLE_MANAGE');
    }
  });

  it('MANDATORY: the whole controller still requires two-factor', () => {
    // The class-level gate is what a stolen session cannot satisfy. A narrower
    // permission on some routes must not have displaced it.
    expect(controller).toContain('@RequiresTwoFactor()');
    expect(controller).toContain('@UseGuards(AdminGateGuard)');
  });
});
