import { describe, expect, it } from 'vitest';
import {
  previewMask,
  previewAllows,
  isExemptFromPreview,
  isWrite,
  readPreviewRoleId,
  VIEW_AS_EXEMPT_PATHS,
  VIEW_AS_MAX_AGE_SEC,
} from './view-as.js';
import { Permission, ALL_PERMISSIONS, NO_PERMISSIONS } from './permissions.js';

/**
 * Viewing the site as another rank.
 *
 * Two properties carry the whole feature, and both are invisible when broken: a preview must never
 * grant anything, and it must never be possible to get stuck inside one.
 */

describe('previewMask', () => {
  it('MANDATORY: a preview can only ever REMOVE permissions', () => {
    /*
     * ★ THE LINE THAT MAKES THIS SAFE RATHER THAN A BACK DOOR ★
     *
     * If the previewed mask were simply the role's, "view as Webmaster" would GRANT the webmaster's
     * permissions to whoever pressed it. With an intersection there is no role mask that produces a
     * bit the viewer did not already hold — so the cookie carrying it need not be signed and cannot
     * be usefully forged.
     */
    const officer = Permission.MEMBER_MANAGE | Permission.AUDIT_VIEW;

    // Viewing as a role that holds EVERYTHING gains nothing.
    expect(previewMask(officer, ALL_PERMISSIONS)).toBe(officer);

    // Viewing as a role that holds SITE_CONFIG — which this officer does not — still grants none.
    expect(previewMask(officer, Permission.SITE_CONFIG)).toBe(NO_PERMISSIONS);
  });

  it('keeps only what both hold', () => {
    const viewer = Permission.MEMBER_MANAGE | Permission.AUDIT_VIEW | Permission.FORUM_MODERATE;
    const cadet = Permission.FORUM_VIEW_MEMBER | Permission.AUDIT_VIEW;

    expect(previewMask(viewer, cadet)).toBe(Permission.AUDIT_VIEW);
  });

  it('viewing as a role with nothing leaves nothing', () => {
    expect(previewMask(ALL_PERMISSIONS, NO_PERMISSIONS)).toBe(NO_PERMISSIONS);
  });

  it('MANDATORY: no combination of inputs yields a bit the viewer lacks', () => {
    // Walked rather than spot-checked: this is the property, not an example of it.
    const viewer = Permission.FORUM_POST_MEMBER | Permission.OPS_VIEW;

    for (const role of [ALL_PERMISSIONS, NO_PERMISSIONS, Permission.SITE_CONFIG, viewer]) {
      const result = previewMask(viewer, role);
      expect((result & ~viewer) === 0n, `role mask ${role} leaked a bit`).toBe(true);
    }
  });
});

describe('previewAllows', () => {
  it('reads are allowed', () => {
    expect(previewAllows('GET', '/v1/me')).toBe(true);
    expect(previewAllows('HEAD', '/v1/admin/activity')).toBe(true);
  });

  it('MANDATORY: writes are refused', () => {
    /*
     * A preview that could act would put the wrong name in the audit log — a webmaster editing a
     * role while believing they were a Cadet looking at a page.
     */
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(previewAllows(method, '/v1/admin/roles/1'), method).toBe(false);
    }
  });

  it('is not fooled by a lowercase method', () => {
    expect(previewAllows('post', '/v1/admin/roles/1')).toBe(false);
    expect(isWrite('delete')).toBe(true);
  });

  it('MANDATORY: leaving the preview always works', () => {
    /*
     * ★ THE TRAP THIS EXISTS TO STOP ★
     *
     * Preview as Cadet and you no longer hold ROLE_MANAGE. If the exit were refused for being a
     * write — which it is, a DELETE — you would be stuck inside the preview until the cookie
     * expired, with the button to escape refusing you. An hour locked out of the console for
     * pressing a preview button.
     */
    expect(previewAllows('DELETE', '/v1/admin/view-as')).toBe(true);
    expect(previewAllows('POST', '/v1/admin/view-as')).toBe(true);
  });

  it('MANDATORY: signing out always works', () => {
    // The other way out. Being unable to sign out of a preview would be worse than being in one.
    expect(previewAllows('POST', '/v1/auth/logout')).toBe(true);
  });

  it('exemption matches the path and its children, not a prefix of another route', () => {
    expect(isExemptFromPreview('/v1/admin/view-as')).toBe(true);
    expect(isExemptFromPreview('/v1/admin/view-as/anything')).toBe(true);

    // `/v1/admin/view-asthing` must NOT be exempt: a startsWith check without the boundary would
    // exempt any route whose name happened to begin with an exempt one.
    expect(isExemptFromPreview('/v1/admin/view-asthing')).toBe(false);
  });

  it('every exempt path is a way OUT, never a way to act', () => {
    // If this list ever grows an editing route, a preview could write through it.
    for (const path of VIEW_AS_EXEMPT_PATHS) {
      expect(path, `${path} is not an exit`).toMatch(/view-as|logout|signout/);
    }
  });
});

describe('readPreviewRoleId', () => {
  it('accepts a plain id', () => {
    expect(readPreviewRoleId('f096ede9-d3c8-4916-96b7-fd37d00a0bf6')).toBe(
      'f096ede9-d3c8-4916-96b7-fd37d00a0bf6',
    );
    expect(readPreviewRoleId('cadet')).toBe('cadet');
  });

  it('MANDATORY: junk leaves the viewer at their real permissions', () => {
    /*
     * Null means "no preview", which is the viewer's own mask. A malformed cookie must not put
     * somebody into a broken preview they cannot account for.
     */
    expect(readPreviewRoleId(undefined)).toBeNull();
    expect(readPreviewRoleId('')).toBeNull();
    expect(readPreviewRoleId('   ')).toBeNull();
    expect(readPreviewRoleId('../../etc/passwd')).toBeNull();
    expect(readPreviewRoleId('a'.repeat(65))).toBeNull();
    expect(readPreviewRoleId("'; DROP TABLE roles;--")).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(readPreviewRoleId('  cadet  ')).toBe('cadet');
  });
});

describe('the preview lapses on its own', () => {
  it('is bounded to an hour', () => {
    // Somebody previews a Cadet, closes the tab, and comes back tomorrow wondering why half the
    // site is missing. The expiry ends that by itself.
    expect(VIEW_AS_MAX_AGE_SEC).toBe(3600);
  });
});
