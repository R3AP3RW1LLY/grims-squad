import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { AppError, ErrorCode } from '@grims/shared';
import type { ISessionStore, SessionContext } from './session.store.js';
import { csrfCookieName } from '../common/csrf.js';

/**
 * P1.2 — sessions with rotating refresh tokens and reuse detection.
 *
 * Access tokens are short-lived JWTs; refresh tokens are long-lived, opaque,
 * single-use, and stored only as SHA-256 hashes.
 *
 * THE RULE THAT MATTERS: presenting an already-used refresh token is treated as
 * theft, not as a mistake. When a token is stolen, the attacker and the real
 * user both hold it. Whoever refreshes second presents a used token. Without
 * detection the attacker refreshes indefinitely and nobody ever finds out; with
 * it, the second use kills the whole family, so the theft becomes a logout the
 * real user notices.
 *
 * The FAMILY is revoked rather than the replayed token, because by then the
 * thief has usually already rotated into a fresh token. Killing only the token
 * that was replayed would leave the thief's current one alive — the exact
 * opposite of the intent.
 */

export const ACCESS_TTL_SEC = 15 * 60;

/**
 * How long one sign-in lasts, ABSOLUTELY.
 *
 * ★ FIXED AT LOGIN, NEVER EXTENDED ★
 *
 * Rotation mints a fresh refresh token every fifteen minutes, and each carries
 * its own expiry. Left to that alone, an active member's session slides forward
 * forever and "signed in for 14 days" would really mean "signed in until you
 * stop using it" — a session that never ends for exactly the accounts that use
 * the site most, which is the opposite of what a session limit is for.
 *
 * So the FAMILY carries the real deadline and rotation cannot move it. That is
 * also what makes the countdown on the dashboard mean something: it counts down
 * to a moment that exists, rather than resetting every quarter of an hour.
 */
export const SESSION_MAX_SEC = 14 * 24 * 60 * 60;

/**
 * How long an individual refresh token lives.
 *
 * Shorter than the session, and always clamped to the session's own deadline —
 * a token that outlived its family would be a credential the deadline does not
 * apply to.
 */
export const REFRESH_TTL_SEC = SESSION_MAX_SEC;

/** 256 bits of entropy. Guessing is not a viable attack on this. */
const REFRESH_BYTES = 32;
const MAX_REFRESH_LEN = 128;

export interface SessionConfig {
  readonly accessSecret: string;
  readonly issuer: string;
}

export interface IssuedSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly familyId: string;
  /** Whose session this is. The caller needs it to check the Discord grant. */
  readonly userId: string;
  /** When this SIGN-IN ends, regardless of rotation. Drives the dashboard countdown. */
  readonly expiresAt: Date;
}

export interface AccessClaims {
  readonly sub: string;
  readonly iat: number;
  readonly exp: number;
}

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

export class SessionService {
  #key: Uint8Array;

  constructor(
    private readonly store: ISessionStore,
    private readonly config: SessionConfig,
  ) {
    if (config.accessSecret.length < 32) {
      // A short HMAC secret is a forgeable session for every member at once.
      throw new Error('accessSecret must be at least 32 characters.');
    }
    this.#key = new TextEncoder().encode(config.accessSecret);
  }

  // ------------------------------------------------------------------- issue
  async issue(userId: string, ctx: SessionContext): Promise<IssuedSession> {
    // The deadline is set HERE, once, and nothing afterwards moves it.
    const expiresAt = new Date(Date.now() + SESSION_MAX_SEC * 1000);
    const familyId = await this.store.createFamily(userId, ctx, expiresAt);
    const refreshToken = await this.#mintRefresh(familyId, expiresAt);
    return {
      accessToken: await this.#mintAccess(userId),
      refreshToken,
      familyId,
      userId,
      expiresAt,
    };
  }

  // ------------------------------------------------------------------ rotate
  async rotate(refreshToken: string, ctx: SessionContext): Promise<IssuedSession> {
    if (typeof refreshToken !== 'string' || refreshToken.length > MAX_REFRESH_LEN) {
      throw new AppError(ErrorCode.REFRESH_TOKEN_INVALID, 'Invalid refresh token.');
    }

    const found = await this.store.findByHash(sha256(refreshToken));
    if (found === null) {
      throw new AppError(ErrorCode.REFRESH_TOKEN_INVALID, 'Invalid refresh token.');
    }
    const { token, family } = found;

    // Order matters. Reuse is checked BEFORE expiry and before the revocation
    // check, because a replayed token that also happens to be expired is still
    // evidence of theft and must still kill the family.
    if (token.usedAt !== null) {
      const at = new Date();
      await this.store.revokeFamily(family.id, 'refresh token reuse detected', at);
      await this.store.recordSecurityEvent('refresh_token_reuse', family.userId, {
        familyId: family.id,
        // No token, hashed or otherwise: this record is read by humans.
        firstUsedAt: token.usedAt.toISOString(),
        userAgent: ctx.userAgent,
      });
      throw new AppError(
        ErrorCode.REFRESH_TOKEN_REUSED,
        'This session was ended for security reasons. Please sign in again.',
      );
    }

    if (family.revokedAt !== null) {
      throw new AppError(ErrorCode.REFRESH_TOKEN_INVALID, 'This session is no longer valid.');
    }
    if (token.expiresAt.getTime() <= Date.now()) {
      throw new AppError(ErrorCode.SESSION_EXPIRED, 'Your session expired. Please sign in again.');
    }

    /*
     * ★ THE ABSOLUTE DEADLINE, CHECKED SEPARATELY ★
     *
     * The token above may be perfectly valid while the SIGN-IN it belongs to has
     * run out. Checking only the token would let a member rotate past their own
     * fourteen days indefinitely, one quarter-hour at a time, and the limit
     * would exist only on the dashboard.
     */
    if (family.expiresAt.getTime() <= Date.now()) {
      throw new AppError(
        ErrorCode.SESSION_EXPIRED,
        'You have been signed in for 14 days. Please sign in again.',
      );
    }

    await this.store.markUsed(token.id, new Date());
    const next = await this.#mintRefresh(family.id, family.expiresAt);
    return {
      accessToken: await this.#mintAccess(family.userId),
      refreshToken: next,
      familyId: family.id,
      userId: family.userId,
      expiresAt: family.expiresAt,
    };
  }

  /** Revokes the family a refresh token belongs to. Used by logout. */
  async revokeByRefreshToken(refreshToken: string, reason: string): Promise<void> {
    const found = await this.store.findByHash(sha256(refreshToken));
    if (found === null) return;
    await this.store.revokeFamily(found.family.id, reason, new Date());
  }

  async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.store.revokeFamily(familyId, reason, new Date());
  }

  // ------------------------------------------------------------------ verify
  async verifyAccess(token: string): Promise<AccessClaims> {
    // `algorithms` is pinned, so the token's own `alg` header is never trusted.
    // Omitting it is how alg=none and RS256->HS256 confusion attacks land.
    const { payload } = await jwtVerify(token, this.#key, {
      algorithms: ['HS256'],
      issuer: this.config.issuer,
      audience: this.config.issuer,
    });
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number' || typeof payload.iat !== 'number') {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Malformed session token.');
    }
    return { sub: payload.sub, iat: payload.iat, exp: payload.exp };
  }

  // ------------------------------------------------------------------ cookies
  cookieOptions(opts: { secure: boolean }): {
    accessName: string;
    refreshName: string;
    csrfName: string;
    options: {
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'lax';
      path: string;
      maxAge: number;
    };
  } {
    /*
     * `__Host-` is the strongest cookie prefix: it forces Secure, forbids Domain
     * and pins Path=/, so a sibling subdomain cannot overwrite the session.
     * Browsers REJECT it outright without Secure, so over plain http it is
     * dropped — otherwise local development breaks in a way that looks like an
     * application bug rather than a cookie rule.
     */
    const p = opts.secure ? '__Host-' : '';
    return {
      accessName: `${p}gs_at`,
      refreshName: `${p}gs_rt`,
      // Same source as every reader (common/csrf.ts), so the prefix rule lives
      // in one place rather than being restated wherever a cookie is read.
      csrfName: csrfCookieName(opts.secure),
      options: {
        httpOnly: true,
        secure: opts.secure,
        // Lax, not Strict: the Discord OAuth callback is a top-level cross-site
        // GET, and Strict would withhold the cookie on exactly that navigation.
        sameSite: 'lax',
        path: '/',
        maxAge: REFRESH_TTL_SEC,
      },
    };
  }

  // ------------------------------------------------------------------ private
  async #mintAccess(userId: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    // Deliberately no roles, mask or scopes. Permissions are resolved per
    // request from the database, so a demotion or a ban takes effect at once
    // rather than lingering for the token's remaining lifetime.
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(this.config.issuer)
      .setAudience(this.config.issuer)
      .setIssuedAt(now)
      .setExpirationTime(now + ACCESS_TTL_SEC)
      .sign(this.#key);
  }

  /**
   * A fresh refresh token, never outliving the sign-in it belongs to.
   *
   * Clamped to the family's deadline. A token that expired AFTER its family
   * would be a credential the fourteen-day limit did not apply to — valid on
   * its face, and the one thing the limit exists to prevent.
   */
  async #mintRefresh(familyId: string, familyExpiresAt: Date): Promise<string> {
    const token = randomBytes(REFRESH_BYTES).toString('base64url');
    const tokenExpiry = new Date(Date.now() + REFRESH_TTL_SEC * 1000);

    await this.store.insertToken(
      familyId,
      sha256(token),
      tokenExpiry < familyExpiresAt ? tokenExpiry : familyExpiresAt,
    );
    return token;
  }
}
