import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ErrorCode, ERROR_STATUS } from '@grims/shared';
import { RequiresPermissionGuard } from './requires-permission.guard.js';

/**
 * P1.7: "A non-officer receives 404, not 403, on every admin route."
 *
 * A 403 CONFIRMS the route exists. On the admin surface that hands an outsider
 * a map of what the console can do and where to attack it. A 404 tells them the
 * same thing as a typo.
 *
 * NOT the default everywhere: for a route a member legitimately knows about, a
 * 404 is a lie that sends them hunting a bug instead of asking for access.
 */
class DenyAll {
  async has(): Promise<boolean> {
    return false;
  }
}
class AllowAll {
  async has(): Promise<boolean> {
    return true;
  }
}

/** Reflector reporting the required mask and whether the route cloaks. */
function reflector(cloak: boolean): Reflector {
  return {
    getAllAndOverride: (key: string) =>
      key === 'authz:cloak-404' ? (cloak ? true : undefined) : '1',
  } as unknown as Reflector;
}

const ctx = (req: unknown): never =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  }) as never;

const officer = { user: { userId: 'u1' } };

describe('cloaked routes', () => {
  it('MANDATORY: a non-officer gets RESOURCE_NOT_VISIBLE, which is a 404', async () => {
    const guard = new RequiresPermissionGuard(new DenyAll() as never, reflector(true));
    await expect(guard.canActivate(ctx(officer))).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_VISIBLE,
    });
    expect(ERROR_STATUS[ErrorCode.RESOURCE_NOT_VISIBLE]).toBe(404);
  });

  it('an officer still gets through', async () => {
    const guard = new RequiresPermissionGuard(new AllowAll() as never, reflector(true));
    await expect(guard.canActivate(ctx(officer))).resolves.toBe(true);
  });
});

describe('ordinary routes', () => {
  it('still answer 403, because pretending they do not exist is a lie', async () => {
    const guard = new RequiresPermissionGuard(new DenyAll() as never, reflector(false));
    await expect(guard.canActivate(ctx(officer))).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
    });
    expect(ERROR_STATUS[ErrorCode.PERMISSION_DENIED]).toBe(403);
  });

  it('neither variant names the missing permission', async () => {
    // Telling an attacker exactly which bit to acquire is a map of the way in.
    for (const cloak of [true, false]) {
      const guard = new RequiresPermissionGuard(new DenyAll() as never, reflector(cloak));
      await guard.canActivate(ctx(officer)).catch((e: Error) => {
        expect(e.message).not.toMatch(/MEMBER_MANAGE|mask|bit|permission \d/i);
      });
    }
  });
});
