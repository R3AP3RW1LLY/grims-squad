import { describe, it, expect, beforeEach } from 'vitest';
import { Reflector } from '@nestjs/core';
import {
  AdminGateGuard,
  twoFactorFreshInSession,
  STEP_UP_ABSOLUTE_MS,
  STEP_UP_TTL_MS,
  FRESH_STEP_UP_TTL_MS,
} from './admin-gate.guard.js';

/**
 * The gate on the admin console.
 *
 * ★ WHY TWO CHECKS AND NOT ONE ★
 *
 * "Enrolled" is a property of the ACCOUNT. "Stepped up recently" is a property
 * of the SESSION. Checking only the first means someone who enrolled in March
 * walks into the console in July on a cookie alone — which is exactly as good
 * as no second factor at all for anyone holding a stolen session.
 *
 * The threat this defends against is a session cookie in the wrong hands. The
 * auth guard and the permission guard both see that request as perfectly valid,
 * because it is: it carries a real session belonging to a real officer.
 */

const NOW = new Date('2026-07-27T12:00:00Z');

class FakeTotp {
  enrolled = new Set<string>();
  async isEnrolled(userId: string): Promise<boolean> {
    return this.enrolled.has(userId);
  }
}

/** A Reflector that reports whether the route asked for 2FA. */
function reflector(required: boolean): Reflector {
  return { getAllAndOverride: () => (required ? true : undefined) } as unknown as Reflector;
}

function ctx(req: unknown): never {
  // getHandler/getClass are required: the guard passes both to the Reflector
  // before it looks at the request at all.
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
}

let totp: FakeTotp;

beforeEach(() => {
  totp = new FakeTotp();
});

describe('routes that do not ask for 2FA', () => {
  it('passes straight through', async () => {
    const guard = new AdminGateGuard(totp as never, reflector(false));
    await expect(guard.canActivate(ctx({ user: { userId: 'u1' } }))).resolves.toBe(true);
  });
});

describe('routes that DO ask for 2FA', () => {
  it('MANDATORY: refuses an officer who has never enrolled', async () => {
    // Enrolment is FORCED, not suggested. An officer with permissions and no
    // second factor is precisely the account worth stealing.
    const guard = new AdminGateGuard(totp as never, reflector(true));
    await expect(guard.canActivate(ctx({ user: { userId: 'u1' } }))).rejects.toThrow(
      /two-factor|set up/i,
    );
  });

  it('MANDATORY: refuses an ENROLLED officer who has not stepped up this session', async () => {
    // The stolen-cookie case. Everything else about this request is valid.
    totp.enrolled.add('u1');
    const guard = new AdminGateGuard(totp as never, reflector(true));
    await expect(guard.canActivate(ctx({ user: { userId: 'u1' } }))).rejects.toThrow(
      /confirm your authenticator/i,
    );
  });

  it('admits an enrolled officer with a fresh step-up', async () => {
    totp.enrolled.add('u1');
    const guard = new AdminGateGuard(totp as never, reflector(true));
    await expect(
      guard.canActivate(ctx({ user: { userId: 'u1' }, twoFactorAt: new Date() })),
    ).resolves.toBe(true);
  });

  it('refuses an anonymous caller before looking at anything else', async () => {
    const guard = new AdminGateGuard(totp as never, reflector(true));
    await expect(guard.canActivate(ctx({}))).rejects.toThrow(/sign in/i);
  });

  it('MANDATORY: refuses when no TOTP service is configured — never waves through', async () => {
    // A missing environment variable must not silently disable the gate. An
    // admin console that drops its own protection because of a config gap is
    // worse than one that is unavailable.
    const guard = new AdminGateGuard(null, reflector(true));
    await expect(
      guard.canActivate(ctx({ user: { userId: 'u1' }, twoFactorAt: new Date() })),
    ).rejects.toThrow(/not configured/i);
  });
});

describe('step-up freshness', () => {
  it('is false when there is no step-up at all', () => {
    expect(twoFactorFreshInSession({} as never, NOW)).toBe(false);
  });

  it('is true inside the window and false outside it', () => {
    const inside = new Date(NOW.getTime() - STEP_UP_TTL_MS + 1_000);
    const outside = new Date(NOW.getTime() - STEP_UP_TTL_MS - 1_000);
    expect(twoFactorFreshInSession({ twoFactorAt: inside } as never, NOW)).toBe(true);
    expect(twoFactorFreshInSession({ twoFactorAt: outside } as never, NOW)).toBe(false);
  });

  it('MANDATORY: a step-up timestamp in the FUTURE does not extend the window', async () => {
    // The value comes from a cookie we set, but cookies are client-side storage
    // and a forged far-future timestamp must not buy a permanent step-up.
    const future = new Date(NOW.getTime() + 86_400_000);
    expect(twoFactorFreshInSession({ twoFactorAt: future } as never, NOW)).toBe(false);
  });

  it('MANDATORY: the general window is eight hours of INACTIVITY', () => {
    /*
     * Squadron owner, 2026-07-31: "can we make the 2FA timeout every 8 hours unless activity is
     * detected?"
     *
     * Raised from two hours, and the meaning changed with it: this is now measured from the last
     * admin request rather than from entering a code, so a long shift is never interrupted.
     */
    expect(STEP_UP_TTL_MS).toBe(8 * 60 * 60_000);
  });

  it('MANDATORY: a sliding window still has an absolute ceiling', () => {
    /*
     * ★ WITHOUT THIS, THE SECOND FACTOR STOPS APPLYING ★
     *
     * A purely sliding window never ends. A browser tab left open on a polling admin page renews
     * itself indefinitely, so the machine MOST likely to have been walked away from is the one that
     * stays privileged forever. The ceiling is measured from when a code was entered and nothing
     * moves it.
     */
    expect(STEP_UP_ABSOLUTE_MS).toBe(24 * 60 * 60_000);
    expect(STEP_UP_ABSOLUTE_MS).toBeGreaterThan(STEP_UP_TTL_MS);
  });

  it('MANDATORY: tier-3 is fifteen minutes, and does NOT slide', () => {
    /*
     * ★ RAISED FROM TWO MINUTES ON THE OWNER'S INSTRUCTION, WITH THE COST STATED ★
     *
     * Squadron owner, 2026-07-31, after being shown the trade. Two minutes meant re-entering a code
     * between each change while working through a batch of role edits — the kind of friction that
     * gets a control switched off entirely.
     *
     * The cost is real: a stepped-up session left unattended can grant permissions for a quarter of
     * an hour rather than two minutes.
     *
     * What keeps it defensible is that tier-3 measures from the CODE, not from activity. Clicking
     * around the console extends the eight-hour window and does nothing for this one. If these ever
     * converge, or if this ever starts sliding, the reasoning collapses — which is why they are
     * asserted together.
     */
    expect(FRESH_STEP_UP_TTL_MS).toBe(15 * 60_000);
    expect(FRESH_STEP_UP_TTL_MS).toBeLessThan(STEP_UP_TTL_MS);
  });
});
