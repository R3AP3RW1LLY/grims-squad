import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { Permission, ErrorCode, VIEW_AS_COOKIE, type PermissionMask } from '@grims/shared';
import { ViewAsService, type IRoleMaskLookup } from './view-as.service.js';
import { ViewAsGuard } from './view-as.guard.js';

/**
 * The rank preview, wired end to end.
 *
 * `view-as.spec.ts` in @grims/shared proves the RULES. This proves the wiring obeys them — which is
 * a different question, and the one that has actually gone wrong in this codebase before: a service
 * that was written, documented, tested against a fake, and never called by anything.
 */

const CADET: PermissionMask = Permission.FORUM_VIEW_MEMBER | Permission.FORUM_POST_MEMBER;
const OFFICER: PermissionMask =
  Permission.MEMBER_MANAGE | Permission.ROLE_MANAGE | Permission.FORUM_VIEW_MEMBER;

class Roles implements IRoleMaskLookup {
  constructor(private readonly table: Record<string, { name: string; mask: PermissionMask }>) {}
  async find(roleId: string) {
    return this.table[roleId] ?? null;
  }
}

/** A permission service reporting one fixed mask. */
const permissions = (mask: PermissionMask) =>
  ({ effectiveMask: async () => mask }) as never;

const req = (cookie: string | undefined, method = 'GET', url = '/v1/admin/activity') =>
  ({
    method,
    url,
    cookies: cookie === undefined ? {} : { [VIEW_AS_COOKIE]: cookie },
  }) as unknown as FastifyRequest;

function service(mask: PermissionMask): ViewAsService {
  return new ViewAsService(
    permissions(mask),
    new Roles({
      cadet: { name: 'Cadet', mask: CADET },
      webmaster: { name: 'Webmaster', mask: Permission.SITE_CONFIG | Permission.ROLE_MANAGE },
    }),
  );
}

describe('maskFor', () => {
  it('with no cookie, the real mask is untouched', async () => {
    expect(await service(OFFICER).maskFor('u1', req(undefined))).toBe(OFFICER);
  });

  it('MANDATORY: previewing narrows to the intersection', async () => {
    const mask = await service(OFFICER).maskFor('u1', req('cadet'));

    // The officer keeps only what a Cadet also has.
    expect(mask).toBe(Permission.FORUM_VIEW_MEMBER);
    expect((mask & Permission.MEMBER_MANAGE) === 0n).toBe(true);
  });

  it('MANDATORY: previewing a MORE powerful role grants nothing', async () => {
    /*
     * ★ THE ESCALATION THIS FEATURE WOULD OTHERWISE BE ★
     *
     * An officer who does not hold SITE_CONFIG previews the Webmaster. If the previewed mask were
     * the role's, they would now hold it. Intersection means the only thing they keep is what they
     * already had.
     */
    const mask = await service(OFFICER).maskFor('u1', req('webmaster'));

    expect((mask & Permission.SITE_CONFIG) === 0n, 'SITE_CONFIG was granted by a preview').toBe(true);
    expect(mask).toBe(Permission.ROLE_MANAGE);
  });

  it('MANDATORY: a deleted role previews as nothing, not as your own mask', async () => {
    /*
     * Falling back to the real mask would mean the banner still said "viewing as Cadet" while the
     * site showed the officer's own view — a preview lying about what it is showing.
     */
    expect(await service(OFFICER).maskFor('u1', req('gone'))).toBe(0n);
  });

  it('a junk cookie leaves the real mask alone', async () => {
    // Null from `readPreviewRoleId` means "no preview", which is the honest reading of nonsense.
    expect(await service(OFFICER).maskFor('u1', req('../../etc/passwd'))).toBe(OFFICER);
  });
});

describe('allows', () => {
  it('answers against the narrowed mask', async () => {
    const svc = service(OFFICER);

    expect(await svc.allows('u1', req(undefined), Permission.MEMBER_MANAGE)).toBe(true);
    expect(await svc.allows('u1', req('cadet'), Permission.MEMBER_MANAGE)).toBe(false);
  });

  it('an empty requirement is refused', async () => {
    // `has(user, 0n)` is almost always a constant that failed to resolve; "yes, you hold nothing"
    // opens a door.
    expect(await service(OFFICER).allows('u1', req(undefined), 0n)).toBe(false);
  });
});

describe('the write block', () => {
  const guard = (mask: PermissionMask) => new ViewAsGuard(service(mask));
  const ctx = (r: FastifyRequest): never =>
    ({ switchToHttp: () => ({ getRequest: () => r }) }) as never;

  it('does nothing when no preview is running', () => {
    expect(guard(OFFICER).canActivate(ctx(req(undefined, 'POST', '/v1/admin/roles/1')))).toBe(true);
  });

  it('reads are allowed while previewing', () => {
    expect(guard(OFFICER).canActivate(ctx(req('cadet', 'GET')))).toBe(true);
  });

  it('MANDATORY: writes are refused while previewing', () => {
    expect(() => guard(OFFICER).canActivate(ctx(req('cadet', 'POST', '/v1/admin/roles/1')))).toThrow();

    try {
      guard(OFFICER).canActivate(ctx(req('cadet', 'DELETE', '/v1/forum/posts/1')));
      expect.unreachable('a write inside a preview must be refused');
    } catch (e) {
      expect((e as { code?: string }).code).toBe(ErrorCode.PERMISSION_DENIED);
      // The message has to name the preview. "You do not have access" would send an officer to
      // check permissions instead of at the banner on their own screen.
      expect((e as { message?: string }).message).toContain('viewing the site as another rank');
    }
  });

  it('MANDATORY: leaving the preview is never blocked', () => {
    /*
     * Preview as Cadet and you no longer hold ROLE_MANAGE. If this DELETE were refused you would be
     * stuck inside the preview until the cookie expired, with the exit visible and inert.
     */
    expect(guard(OFFICER).canActivate(ctx(req('cadet', 'DELETE', '/v1/admin/view-as')))).toBe(true);
  });

  it('the query string does not defeat the exemption', () => {
    // The guard compares paths, so `?x=1` must not turn the exit into an ordinary route.
    expect(
      guard(OFFICER).canActivate(ctx(req('cadet', 'DELETE', '/v1/admin/view-as?from=banner'))),
    ).toBe(true);
  });
});
