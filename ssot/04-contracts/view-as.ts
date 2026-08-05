import { type PermissionMask, NO_PERMISSIONS } from './permissions.js';

/**
 * Seeing the site as another rank sees it.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "on the roles page, we need to add a way for the webmaster and officers to visually spoof a rank
 * and physically see what they see in the web app so we can verify that everything is working on
 * that front"
 *
 * Offered full impersonation and a read-only preview; the owner chose the preview.
 *
 * ★ IT CAN ONLY EVER TAKE PERMISSIONS AWAY ★
 *
 * The previewed mask is the INTERSECTION of what the viewer really holds with what the role grants.
 * Not the role's mask — the intersection.
 *
 * That one choice is the whole security story, and it is worth being exact about why. If the
 * previewed mask were simply the role's, then "view as Webmaster" would GRANT the webmaster's
 * permissions to whoever asked, and this feature would be a privilege escalation with a friendly
 * name on it. With an intersection there is no value of `roleMask` that produces a bit the viewer
 * did not already have, so the cookie carrying it does not need to be signed, cannot be usefully
 * forged, and is safe to be wrong about.
 *
 * A member who tampers with it can only take permissions away from themselves.
 *
 * ★ AND IT REFUSES EVERY WRITE ★
 *
 * A preview that could act would put the wrong name in the audit log — the log would record a
 * webmaster editing a role while they believed they were a Cadet looking at a page. Worse, a
 * reduced mask makes some writes SUCCEED that the viewer would expect to be refused, which is
 * exactly the confusion the feature exists to remove.
 *
 * So while a preview is active the answer to anything that changes state is no, with a sentence
 * saying why. Verifying what a rank can SEE is the whole ask; verifying what it can DO is a
 * question about permission masks, which the roles page already answers directly.
 */

/** The cookie carrying the previewed role. Cleared to leave. */
export const VIEW_AS_COOKIE = 'gs_view_as';

/**
 * How long a preview lasts before it lapses on its own.
 *
 * A backstop, not a feature. Somebody previews a Cadet, closes the tab, and comes back tomorrow
 * wondering why half the site is missing — the expiry means that ends by itself rather than
 * becoming a support question. Long enough to work through every page without being interrupted.
 */
export const VIEW_AS_MAX_AGE_SEC = 60 * 60;

/**
 * The mask to render and authorise with while previewing.
 *
 * Intersection, always. See the note above: this is the line that makes the feature safe rather
 * than a way to hand out permissions.
 */
export function previewMask(real: PermissionMask, role: PermissionMask): PermissionMask {
  return real & role;
}

/** Methods that change something. A preview refuses all of them. */
const WRITE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isWrite(method: string): boolean {
  return WRITE_METHODS.has(method.toUpperCase());
}

/**
 * Routes that keep working while a preview is active.
 *
 * ★ THE EXIT MUST NOT NEED A PERMISSION ★
 *
 * This is the trap, and it is not a small one. Preview as Cadet and you no longer hold ROLE_MANAGE
 * — so if leaving the preview required ROLE_MANAGE, or were refused for being a write, you would be
 * stuck inside it until the cookie expired, with the button to escape refusing you. An hour locked
 * out of the admin console for pressing a preview button.
 *
 * So clearing the preview is exempt from BOTH rules: it is allowed while previewing, and it needs
 * no permission beyond being signed in. Sign-out is exempt for the same reason.
 */
export const VIEW_AS_EXEMPT_PATHS: readonly string[] = [
  '/v1/admin/view-as',
  '/v1/auth/logout',
  '/v1/auth/signout',
];

/** Is this request allowed through untouched while a preview is active? */
export function isExemptFromPreview(path: string): boolean {
  return VIEW_AS_EXEMPT_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * May this request proceed while a preview is active?
 *
 * Reads: yes, against the reduced mask. Writes: no, with a reason. Exempt paths: yes, untouched.
 */
export function previewAllows(method: string, path: string): boolean {
  if (isExemptFromPreview(path)) return true;
  return !isWrite(method);
}

/** What a member is told when a preview refuses their action. */
export const VIEW_AS_REFUSAL =
  'You are viewing the site as another rank. Nothing can be changed until you leave the preview.';

/**
 * Reads the previewed role id from a cookie value.
 *
 * Returns null for anything unexpected. The value is a role id and nothing else — there is no
 * encoding to get wrong and no signature to check, because an intersection cannot grant anything
 * (see above). What this rejects is junk, so a malformed cookie leaves somebody at their real
 * permissions rather than in a broken preview they cannot explain.
 */
export function readPreviewRoleId(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > 64) return null;
  // Role ids are uuids or short keys. Anything with punctuation is not one of ours.
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

/** The mask when a preview names a role that no longer exists. */
export const PREVIEW_UNKNOWN_ROLE_MASK: PermissionMask = NO_PERMISSIONS;
