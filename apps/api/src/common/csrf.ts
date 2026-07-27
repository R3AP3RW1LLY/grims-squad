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

/**
 * The CSRF cookie's name, which is NOT constant.
 *
 * Over https it carries the `__Host-` prefix; over plain http browsers reject
 * that prefix outright, so local development uses the bare name. Any reader
 * that hard-codes one spelling verifies against a cookie that is not there —
 * and because `verifyCsrf` fails closed, the symptom is every write returning
 * CSRF_TOKEN_INVALID in exactly one environment. Derived here so there is a
 * single place that decides.
 */
export function csrfCookieName(secure: boolean): string {
  return `${secure ? '__Host-' : ''}gs_csrf`;
}

/** Reads the CSRF cookie, choosing the right name for the current environment. */
export function readCsrfCookie(
  cookies: Record<string, string | undefined>,
  secure: boolean = process.env['NODE_ENV'] === 'production',
): string | undefined {
  return cookies[csrfCookieName(secure)];
}

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
