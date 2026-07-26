import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError, ErrorCode } from '@grims/shared';

/**
 * CSRF double-submit verification.
 *
 * The session cookie is SameSite=Lax, which already stops cross-site POSTs in
 * current browsers. This is a deliberate second layer: Lax is enforced by the
 * BROWSER, so an old client, a proxy that strips the attribute, or a future
 * change to the rule removes it without anything failing loudly. A server-side
 * check fails closed instead.
 *
 * The mechanism: a random token is set in a readable (non-HttpOnly) cookie and
 * must be echoed in a header. A cross-site attacker's page causes the cookie to
 * be sent automatically but cannot READ it, so it cannot set the header.
 */

export const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const;

/** 32 bytes base64url. Shorter than this is not a token we minted. */
const MIN_LEN = 43;

export function issueCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function verifyCsrf(
  method: string,
  cookieValue: string | undefined,
  headerValue: string | undefined,
): void {
  if ((SAFE_METHODS as readonly string[]).includes(method.toUpperCase())) return;

  const a = (cookieValue ?? '').trim();
  const b = (headerValue ?? '').trim();

  // The length floor is load-bearing, not cosmetic: two empty strings are equal,
  // so without it anyone able to clear the cookie passes by supplying nothing.
  if (a.length < MIN_LEN || b.length < MIN_LEN) {
    throw new AppError(ErrorCode.CSRF_TOKEN_INVALID, 'Missing or malformed CSRF token.');
  }
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length || !timingSafeEqual(ab, bb)) {
    throw new AppError(ErrorCode.CSRF_TOKEN_INVALID, 'CSRF token mismatch.');
  }
}
