import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { Permission } from '@grims/shared';
import { AdminGateGuard } from '../auth/admin-gate.guard.js';
import { RequiresPermissionGuard } from '../authz/requires-permission.guard.js';
import type { ViewAsService } from '../authz/view-as.service.js';
import { RoadmapManageController, RoadmapPromotableController } from './roadmap.controller.js';

/**
 * The promote panel must not vanish for an idle webmaster.
 *
 * ★ THE BUG THIS PINS ★
 *
 * The thread page draws the promote panel only when the API ANSWERS the "is this thread
 * promotable" probe; a refusal collapses to null and no panel is drawn. That probe lived on the
 * manage controller, behind `AdminGateGuard` + `@RequiresTwoFactor()`. The step-up window is eight
 * hours of ADMIN activity, and reading the forum is not admin activity — so a webmaster who had
 * not opened the console since the morning was shown nothing at all on a Feature Requests thread,
 * with no way to tell that apart from "this is not that board".
 *
 * A refusal that degrades to invisibility is the failure mode. The read moved to a route gated on
 * SITE_CONFIG alone; every mutation kept both decorators.
 *
 * ★ WHY THIS RUNS THE REAL GUARD AGAINST THE REAL CLASSES ★
 *
 * The property is "which decorators are on which class", and that is metadata, not behaviour any
 * stub can stand in for. A real `Reflector` reading the actual controller classes is the only
 * thing that fails when somebody moves a route between them — which is precisely the edit that
 * caused this, and it typechecked perfectly.
 */

class FakeTotp {
  enrolled = new Set<string>();
  async isEnrolled(userId: string): Promise<boolean> {
    return this.enrolled.has(userId);
  }
}

/**
 * A context pointing at a REAL handler on a REAL controller class — what the guard reflects over.
 *
 * `getResponse` answers an empty object on purpose: the guard re-stamps the sliding step-up cookie
 * on its way out, and does nothing when the reply cannot set one.
 */
function ctx(cls: new (...args: never[]) => object, method: string, req: unknown): never {
  return {
    getClass: () => cls,
    getHandler: () => (cls.prototype as Record<string, unknown>)[method],
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as never;
}

/** An enrolled webmaster whose last authenticator code was entered a long time ago. */
function idleWebmaster(): { user: { userId: string } } {
  return { user: { userId: 'webmaster-1' } };
}

function guard(totp: FakeTotp): AdminGateGuard {
  // The genuine Reflector — it reads the metadata the decorators actually wrote.
  return new AdminGateGuard(totp as never, new Reflector());
}

describe('the promotable probe — SITE_CONFIG, no step-up', () => {
  it('MANDATORY: an idle webmaster gets an ANSWER, so the panel is drawn', async () => {
    /*
     * No `twoFactorAt` at all — the exact session that produced the invisible panel. The gate must
     * wave this through, because the route carries no `@RequiresTwoFactor()`.
     */
    const totp = new FakeTotp();
    totp.enrolled.add('webmaster-1');

    await expect(
      guard(totp).canActivate(ctx(RoadmapPromotableController, 'cardForThread', idleWebmaster())),
    ).resolves.toBe(true);
  });

  it('passes even for a webmaster who has never enrolled — the gate is not on this route', async () => {
    // Not an endorsement of unenrolled webmasters; a statement that THIS read does not decide it.
    // SITE_CONFIG is still required, and `requiresTwoFactor` still obliges the enrolment itself.
    await expect(
      guard(new FakeTotp()).canActivate(
        ctx(RoadmapPromotableController, 'cardForThread', idleWebmaster()),
      ),
    ).resolves.toBe(true);
  });

  it('MANDATORY: the probe class carries no two-factor metadata at all', () => {
    /*
     * Asserted directly as well as through the guard, so the failure message names the cause. A
     * `@RequiresTwoFactor()` reappearing on this class — or the route moving back to the manage
     * controller — brings the invisible panel back with it.
     */
    const required = new Reflector().getAllAndOverride<boolean>('authz:requires-2fa', [
      RoadmapPromotableController.prototype.cardForThread,
      RoadmapPromotableController,
    ]);
    expect(required).toBeUndefined();
  });
});

describe('every mutation still refuses without a step-up', () => {
  /*
   * The other half, and it is not decoration: lowering the gate on the read is only defensible
   * while the writes keep theirs. Walked across ALL of them rather than spot-checking promote,
   * because the one that gets moved is never the one somebody thought to test.
   */
  const mutations = ['promote', 'create', 'edit', 'move', 'archive', 'restore'] as const;

  for (const method of mutations) {
    it(`MANDATORY: ${method} refuses with the admin gate's own sentence`, async () => {
      const totp = new FakeTotp();
      totp.enrolled.add('webmaster-1');

      await expect(
        guard(totp).canActivate(ctx(RoadmapManageController, method, idleWebmaster())),
      ).rejects.toThrow(/confirm your authenticator code to continue/i);
    });
  }

  it('MANDATORY: the console list is refused too — it is the screen the writes are done from', async () => {
    const totp = new FakeTotp();
    totp.enrolled.add('webmaster-1');

    await expect(
      guard(totp).canActivate(ctx(RoadmapManageController, 'list', idleWebmaster())),
    ).rejects.toThrow(/confirm your authenticator code to continue/i);
  });

  it('admits a webmaster who HAS stepped up recently — the gate is a delay, not a wall', async () => {
    const totp = new FakeTotp();
    totp.enrolled.add('webmaster-1');

    await expect(
      guard(totp).canActivate(
        ctx(RoadmapManageController, 'promote', {
          user: { userId: 'webmaster-1' },
          twoFactorAt: new Date(),
          twoFactorIssuedAt: new Date(),
        }),
      ),
    ).resolves.toBe(true);
  });

  it('MANDATORY: lowering the step-up did NOT lower the permission', () => {
    /*
     * The read is open to a webmaster who has not typed a code today, and to nobody else. If this
     * bit went missing the probe would answer every signed-in member "yes, this is the Feature
     * Requests board" and the panel would render for people whose promote can only ever fail.
     */
    const required = new Reflector().getAllAndOverride<string>('authz:required', [
      RoadmapPromotableController.prototype.cardForThread,
      RoadmapPromotableController,
    ]);
    expect(required).toBe(Permission.SITE_CONFIG.toString());
  });

  it('MANDATORY: an ordinary member is refused the probe, so no panel is drawn for them', async () => {
    // The permission guard, run for real: `allows` is the intersection-aware check, and a member
    // without SITE_CONFIG never gets an answer to reason about.
    const viewAs = { allows: async () => false } as unknown as ViewAsService;
    const permissionGuard = new RequiresPermissionGuard(viewAs, new Reflector());

    await expect(
      permissionGuard.canActivate(
        ctx(RoadmapPromotableController, 'cardForThread', { user: { userId: 'member-1' } }),
      ),
    ).rejects.toThrow(/do not have access/i);
  });

  it('a SITE_CONFIG holder passes the permission guard on the probe', async () => {
    const viewAs = { allows: async () => true } as unknown as ViewAsService;
    const permissionGuard = new RequiresPermissionGuard(viewAs, new Reflector());

    await expect(
      permissionGuard.canActivate(
        ctx(RoadmapPromotableController, 'cardForThread', idleWebmaster()),
      ),
    ).resolves.toBe(true);
  });

  it('MANDATORY: the probe is not a route on the manage controller any more', () => {
    /*
     * The whole fix, stated as a shape: if `cardForThread` is ever moved back, the panel goes
     * invisible again for exactly the person it exists for.
     */
    expect(
      (RoadmapManageController.prototype as unknown as Record<string, unknown>)['cardForThread'],
    ).toBeUndefined();
    expect(typeof RoadmapPromotableController.prototype.cardForThread).toBe('function');
  });
});
