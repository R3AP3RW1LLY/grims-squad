import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Reflector } from '@nestjs/core';
import {
  AdminGateGuard,
  twoFactorFreshInSession,
  STEP_UP_TTL_MS,
  FRESH_STEP_UP_TTL_MS,
} from '../auth/admin-gate.guard.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const admin = readFileSync(resolve(HERE, 'admin.controller.ts'), 'utf8');
const cmdr = readFileSync(resolve(HERE, '../cmdr/cmdr.controller.ts'), 'utf8');
const main = readFileSync(resolve(HERE, '../main.ts'), 'utf8');

/**
 * Findings from the project-wide adversarial review, 2026-07-27.
 *
 * Each of these was live in merged code. They are pinned here rather than in
 * the file they touch, because the thing worth protecting is the RULE — and the
 * rule is easiest to break by adding a new route that quietly does not follow
 * it.
 */

/* ───────────────────────── FINDING 1 — RED-TEAM ───────────────────────── */
describe('officer CMDR routes are gated the same as the console', () => {
  /**
   * They approve who a member CLAIMS TO BE — privileged, and affecting somebody
   * other than the caller — but were guarded by MEMBER_MANAGE alone. A stolen
   * session cookie could approve verifications while /app refused the same
   * officer, which is an inconsistency an attacker only has to find once.
   */
  it('MANDATORY: every admin/ route on the CMDR controller requires two-factor', () => {
    const routes = cmdr.split('\n').filter((l) => l.includes("@Post('admin/") || l.includes("@Get('admin/"));
    expect(routes.length).toBeGreaterThan(0);

    for (const route of routes) {
      const at = cmdr.indexOf(route);
      // The decorators immediately above the route line.
      const preceding = cmdr.slice(Math.max(0, at - 260), at);
      expect(preceding, route.trim()).toContain('@RequiresTwoFactor()');
    }
  });

  it('MANDATORY: the MEMBER routes are still reachable with one factor', () => {
    // Linking your own Inara key or declaring your own commander must not need
    // a second factor. A class-level guard would have locked ordinary members
    // out of their own account — which is why it is applied per route.
    const at = cmdr.indexOf("@Post('me/inara')");
    expect(cmdr.slice(Math.max(0, at - 200), at)).not.toContain('@RequiresTwoFactor()');
  });
});

/* ───────────────────── FINDING 2 — RED-TEAM (rate limit) ──────────────── */
describe('the API is rate limited', () => {
  it('MANDATORY: a limiter is registered at all', () => {
    // There was none. TOTP had its own lockout, which was the loudest case and
    // hid the general one — every other endpoint was unthrottled.
    expect(main).toContain('fastifyRateLimit');
  });

  it('keys on the session where there is one, not on IP alone', () => {
    // IP-only would let one member behind a shared address exhaust the budget
    // for everyone else on it. For a squadron that games together that is a
    // realistic Saturday night.
    const block = main.slice(main.indexOf('fastifyRateLimit'), main.indexOf('allowList'));
    expect(block).toContain('keyGenerator');
    expect(block).toContain('req.ip');
  });

  it('MANDATORY: hashes the session token before using it as a key', () => {
    // A rate-limit key ends up in memory and in metrics. The refresh token is a
    // credential and must not be either of those things in the clear.
    const block = main.slice(main.indexOf('keyGenerator'), main.indexOf('allowList'));
    expect(block).toContain("createHash('sha256')");
  });

  it('exempts the health endpoint', () => {
    // Polled by the container runtime. Throttling it makes a busy API look
    // unhealthy and gets it restarted, which is a self-inflicted outage.
    expect(main).toContain("req.url.startsWith('/v1/health')");
  });
});

/* ─────────────────── FINDING 3 — tier-3 fresh step-up ─────────────────── */
describe('tier-3 actions require a FRESH step-up', () => {
  /**
   * P1.10: "A tier-3 action (role grant, site config, AI kill switch) requires
   * a fresh step-up challenge even within a live session."
   *
   * The console window is fifteen minutes, which is right for reading a
   * dashboard and wrong for handing somebody ROLE_MANAGE: an attacker at a
   * stepped-up machine had a quarter of an hour to grant themselves everything.
   */
  it('MANDATORY: saving a role mask needs a fresh code', () => {
    const at = admin.indexOf("@Post('roles/:id')");
    expect(admin.slice(at, at + 300)).toContain('@RequiresFreshTwoFactor()');
  });

  it('MANDATORY: editing Discord mappings needs a fresh code', () => {
    for (const route of ["@Post('mappings')", "@Delete('mappings/:roleId/:discordRoleId')"]) {
      const at = admin.indexOf(route);
      expect(admin.slice(at, at + 320), route).toContain('@RequiresFreshTwoFactor()');
    }
  });

  it('the fresh window is much shorter than the ordinary one', () => {
    // Both raised 2026-07-31 on the owner's instruction: 2h -> 8h general, 2min -> 15min tier-3.
    // The RATIO is the property that matters and it is asserted, not just the value.
    expect(FRESH_STEP_UP_TTL_MS).toBeLessThan(STEP_UP_TTL_MS);
    expect(FRESH_STEP_UP_TTL_MS).toBe(15 * 60_000);
    expect(STEP_UP_TTL_MS / FRESH_STEP_UP_TTL_MS).toBeGreaterThanOrEqual(8);
  });

  it('MANDATORY: a step-up old enough for the console is NOT fresh enough for tier 3', () => {
    // The exact gap the finding was about: valid for /app, refused for a grant.
    const now = new Date('2026-07-27T12:00:00Z');
    // Twenty minutes, since tier-3 moved from two minutes to fifteen. The POINT of this test is the
    // gap between the two windows, so the value has to sit inside one and outside the other.
    const twentyMinutesAgo = new Date(now.getTime() - 20 * 60_000);
    const req = { twoFactorAt: twentyMinutesAgo } as never;

    expect(twoFactorFreshInSession(req, now)).toBe(true);
    expect(twoFactorFreshInSession(req, now, FRESH_STEP_UP_TTL_MS)).toBe(false);
  });

  it('refuses a tier-3 route when the step-up is stale', async () => {
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === 'authz:requires-fresh-2fa' || key === 'authz:requires-2fa' ? true : undefined,
    } as unknown as Reflector;
    const guard = new AdminGateGuard({ isEnrolled: async () => true } as never, reflector);

    const ctx = (req: unknown): never =>
      ({
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({ getRequest: () => req }),
      }) as never;

    // Twenty minutes: past the fifteen-minute tier-3 window, well inside the eight-hour general
    // one — so this asserts the tier-3 gate specifically, not merely an expired session.
    const stale = new Date(Date.now() - 20 * 60_000);
    await expect(
      guard.canActivate(ctx({ user: { userId: 'u1' }, twoFactorAt: stale })),
    ).rejects.toThrow(/fresh/i);

    // ...and a genuinely fresh one gets through.
    await expect(
      guard.canActivate(ctx({ user: { userId: 'u1' }, twoFactorAt: new Date() })),
    ).resolves.toBe(true);
  });
});

/* ──────────────── FINDING 4 — sysadmin two-factor recovery ─────────────── */
describe('a lost authenticator is recoverable', () => {
  /**
   * P1.10: "Losing the device is recoverable by a sysadmin, and that recovery
   * is audited." Without it, an officer whose phone died and who never saved
   * their recovery codes is locked out permanently, and the only remedy is a
   * hand-written UPDATE — unaudited, and exactly what the console replaces.
   */
  it('MANDATORY: the reset needs SITE_CONFIG and a fresh step-up', () => {
    const at = admin.indexOf("@Post('members/:userId/reset-two-factor')");
    expect(at).toBeGreaterThan(-1);
    const decorators = admin.slice(at, at + 340);

    // The most dangerous button in the product: it turns a two-factor account
    // back into a one-factor account.
    expect(decorators).toContain('Permission.SITE_CONFIG');
    expect(decorators).toContain('@RequiresFreshTwoFactor()');
  });

  it('MANDATORY: nobody can reset their OWN second factor here', () => {
    // Otherwise a temporary compromise of a stepped-up session becomes a
    // permanent one: strip the factor, keep the access.
    expect(admin).toContain('You cannot reset your own second factor here');
  });

  it('requires a reason, and audits it', () => {
    const store = readFileSync(resolve(HERE, 'admin.store.ts'), 'utf8');
    expect(admin).toContain("readString(body as Record<string, unknown> | null, 'reason')");
    expect(store).toContain("action: 'security.two_factor.reset'");
    // A HUMAN did this — unlike a reconciliation, where nobody chose anything.
    expect(store.slice(store.indexOf('security.two_factor.reset') - 400)).toContain('actorId,');
  });

  it('MANDATORY: removes the recovery codes too', () => {
    // A half-reset leaves codes that unlock nothing, and the member is told to
    // use one.
    const store = readFileSync(resolve(HERE, 'admin.store.ts'), 'utf8');
    const block = store.slice(store.indexOf('async resetTwoFactor'), store.indexOf('async auditActions'));
    expect(block).toContain('twoFactorRecovery.deleteMany');
    expect(block).toContain('twoFactorCredential.deleteMany');
    expect(block).toContain('$transaction');
  });
});
