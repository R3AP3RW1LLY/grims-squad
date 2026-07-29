import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  SessionService,
  ACCESS_TTL_SEC,
  REFRESH_TTL_SEC,
  SESSION_MAX_SEC,
} from './session.service.js';
import { InMemorySessionStore } from './session.store.fake.js';
import { AppError, ErrorCode } from '@grims/shared';

/**
 * P1.2 — sessions with rotating refresh and reuse detection.
 *
 * The heart of this task is ONE property: a refresh token is single-use, and
 * presenting a used one is treated as theft rather than as a mistake.
 *
 * Why that matters. Refresh tokens are long-lived and sit in a cookie. If an
 * attacker steals one, both they and the legitimate user hold the same token.
 * Whoever refreshes second presents an already-used token. Without reuse
 * detection the attacker simply keeps refreshing forever and nobody ever knows.
 * WITH it, the second use kills the entire family — so the theft converts into
 * a logout that the real user notices, instead of silent indefinite access.
 *
 * That is why the acceptance criterion says the whole FAMILY dies, not just the
 * replayed token: revoking one token would leave the thief's freshly-rotated
 * token alive, which is precisely backwards.
 */

const SECRET = 'a'.repeat(48);
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

let store: InMemorySessionStore;
let svc: SessionService;

beforeEach(() => {
  store = new InMemorySessionStore();
  svc = new SessionService(store, { accessSecret: SECRET, issuer: 'grims-squad' });
});
afterEach(() => vi.useRealTimers());

const ctx = { userAgent: 'vitest', ipHash: sha256('127.0.0.1') };

describe('issuing a session', () => {
  it('returns an access token and a refresh token', async () => {
    const s = await svc.issue('user-1', ctx);
    expect(s.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/); // JWS compact
    expect(s.refreshToken).toBeTypeOf('string');
    expect(s.refreshToken.length).toBeGreaterThanOrEqual(43); // >=256 bits base64url
  });

  it('makes the refresh token opaque, not a JWT', async () => {
    // A self-describing refresh token invites someone to trust its claims
    // without a database lookup, which defeats revocation entirely.
    const { refreshToken } = await svc.issue('user-1', ctx);
    expect(refreshToken).not.toContain('.');
  });

  it('gives the access token 15 minutes and the sign-in 14 days', async () => {
    expect(ACCESS_TTL_SEC).toBe(15 * 60);
    expect(SESSION_MAX_SEC).toBe(14 * 24 * 60 * 60);

    const s = await svc.issue('user-1', ctx);
    const claims = await svc.verifyAccess(s.accessToken);
    expect(claims.exp - claims.iat).toBe(ACCESS_TTL_SEC);

    const row = store.tokens[0];
    expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 13 * 86400_000);
    expect(row?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 14 * 86400_000 + 1000);
  });

  it('MANDATORY: reports when the sign-in ends, for the countdown', async () => {
    const s = await svc.issue('user-1', ctx);
    const days = (s.expiresAt.getTime() - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14.01);
  });

  it('MANDATORY: rotation does NOT extend the sign-in', async () => {
    /*
     * ★ THE PROPERTY THE WHOLE FEATURE RESTS ON ★
     *
     * A fresh refresh token is minted roughly every fifteen minutes. If each
     * one reset the deadline, an active member would never be signed out — the
     * limit would apply only to people who had stopped using the site, which is
     * precisely backwards — and the dashboard countdown would reset on every
     * rotation instead of counting down to anything.
     */
    const first = await svc.issue('user-1', ctx);
    const second = await svc.rotate(first.refreshToken, ctx);

    expect(second.expiresAt.getTime()).toBe(first.expiresAt.getTime());
  });

  it('MANDATORY: refuses to rotate once the sign-in has run out', async () => {
    /*
     * The token may be perfectly valid while the SIGN-IN it belongs to has
     * expired. Checking only the token would let somebody rotate past their own
     * fourteen days indefinitely, a quarter of an hour at a time.
     */
    const s = await svc.issue('user-1', ctx);
    const family = store.families[0];
    if (family !== undefined) family.expiresAt = new Date(Date.now() - 1000);

    await expect(svc.rotate(s.refreshToken, ctx)).rejects.toThrow(/14 days|expired/i);
  });

  it('MANDATORY: a refresh token never outlives its sign-in', async () => {
    // A token expiring after its family would be a credential the fourteen-day
    // limit did not apply to — valid on its face, and exactly what the limit
    // exists to prevent.
    await svc.issue('user-1', ctx);
    const family = store.families[0];
    const token = store.tokens[0];

    expect(token?.expiresAt.getTime()).toBeLessThanOrEqual(family?.expiresAt.getTime() ?? 0);
  });

  it('stores ONLY the SHA-256 hash of the refresh token', async () => {
    const { refreshToken } = await svc.issue('user-1', ctx);
    const dump = JSON.stringify(store.tokens);
    expect(dump).not.toContain(refreshToken);
    expect(store.tokens[0]?.tokenHash).toBe(sha256(refreshToken));
  });

  it('never stores a raw IP address', async () => {
    await svc.issue('user-1', { userAgent: 'vitest', ipHash: sha256('203.0.113.9') });
    expect(JSON.stringify(store.families)).not.toContain('203.0.113.9');
  });

  it('starts a separate family per device, so one logout does not kill the others', async () => {
    await svc.issue('user-1', ctx);
    await svc.issue('user-1', { userAgent: 'phone', ipHash: sha256('10.0.0.2') });
    expect(store.families).toHaveLength(2);
  });
});

describe('rotation', () => {
  it('issues a NEW refresh token and marks the old one used', async () => {
    const first = await svc.issue('user-1', ctx);
    const second = await svc.rotate(first.refreshToken, ctx);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(store.tokens.find((t) => t.tokenHash === sha256(first.refreshToken))?.usedAt).not.toBeNull();
    expect(store.tokens).toHaveLength(2);
  });

  it('keeps the rotated token in the SAME family', async () => {
    const first = await svc.issue('user-1', ctx);
    await svc.rotate(first.refreshToken, ctx);
    expect(new Set(store.tokens.map((t) => t.familyId)).size).toBe(1);
  });

  it('rejects a refresh token that was never issued', async () => {
    await expect(svc.rotate('not-a-real-token', ctx)).rejects.toMatchObject({
      code: ErrorCode.REFRESH_TOKEN_INVALID,
    });
  });

  it('rejects an expired refresh token', async () => {
    vi.useFakeTimers();
    const s = await svc.issue('user-1', ctx);
    vi.advanceTimersByTime((REFRESH_TTL_SEC + 60) * 1000);
    await expect(svc.rotate(s.refreshToken, ctx)).rejects.toThrow(AppError);
  });
});

// ---------------------------------------------------------------------------
describe('reuse detection @INV-005', () => {
  it('MANDATORY: replaying a used refresh token revokes the ENTIRE family', async () => {
    const a = await svc.issue('user-1', ctx);
    const b = await svc.rotate(a.refreshToken, ctx); // legitimate rotation
    // The attacker replays the stolen (already-used) token.
    await expect(svc.rotate(a.refreshToken, ctx)).rejects.toMatchObject({
      code: ErrorCode.REFRESH_TOKEN_REUSED,
    });

    const fam = store.families[0];
    expect(fam?.revokedAt).not.toBeNull();
    expect(fam?.revokeReason).toMatch(/reuse/i);

    // And the token the ATTACKER just rotated into is dead too. Revoking only
    // the replayed token would leave their fresh one alive — backwards.
    await expect(svc.rotate(b.refreshToken, ctx)).rejects.toThrow(AppError);
  });

  it('kills every session for that DEVICE, but not the user other devices', async () => {
    const desktop = await svc.issue('user-1', ctx);
    const phone = await svc.issue('user-1', { userAgent: 'phone', ipHash: sha256('10.0.0.2') });
    await svc.rotate(desktop.refreshToken, ctx);
    await svc.rotate(desktop.refreshToken, ctx).catch(() => {});

    // The compromised device is gone; the phone is untouched. Logging a member
    // out of everything on any suspicion would train them to ignore it.
    expect(store.families.find((f) => f.userAgent === 'vitest')?.revokedAt).not.toBeNull();
    expect(store.families.find((f) => f.userAgent === 'phone')?.revokedAt).toBeNull();
    await expect(svc.rotate(phone.refreshToken, ctx)).resolves.toBeDefined();
  });

  it('refuses a revoked family BEFORE natural expiry', async () => {
    const s = await svc.issue('user-1', ctx);
    await svc.revokeFamily(store.families[0]!.id, 'user signed out');
    await expect(svc.rotate(s.refreshToken, ctx)).rejects.toThrow(AppError);
  });

  it('records the reuse so an officer can see it happened', async () => {
    const a = await svc.issue('user-1', ctx);
    await svc.rotate(a.refreshToken, ctx);
    await svc.rotate(a.refreshToken, ctx).catch(() => {});
    // A silent revocation leaves the member confused and leaves nobody able to
    // tell a theft from a bug.
    expect(store.securityEvents.some((e) => /reuse/i.test(e.kind))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('access token verification', () => {
  it('accepts a token it issued and returns the subject', async () => {
    const s = await svc.issue('user-42', ctx);
    expect((await svc.verifyAccess(s.accessToken)).sub).toBe('user-42');
  });

  it('rejects a token signed with a different secret', async () => {
    const other = new SessionService(new InMemorySessionStore(), {
      accessSecret: 'b'.repeat(48),
      issuer: 'grims-squad',
    });
    const foreign = (await other.issue('user-1', ctx)).accessToken;
    await expect(svc.verifyAccess(foreign)).rejects.toThrow();
  });

  it('REJECTS alg=none — the classic JWT forgery', async () => {
    // Strip the signature and claim no algorithm. A verifier that honours the
    // token's own `alg` header lets anyone mint any identity they like.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'user-admin', iat: 0, exp: 9_999_999_999 }),
    ).toString('base64url');
    await expect(svc.verifyAccess(`${header}.${payload}.`)).rejects.toThrow();
  });

  it('rejects a tampered payload', async () => {
    const s = await svc.issue('user-1', ctx);
    const [h, , sig] = s.accessToken.split('.');
    const evil = Buffer.from(JSON.stringify({ sub: 'user-admin' })).toString('base64url');
    await expect(svc.verifyAccess(`${h}.${evil}.${sig}`)).rejects.toThrow();
  });

  it('rejects an expired access token', async () => {
    vi.useFakeTimers();
    const s = await svc.issue('user-1', ctx);
    vi.advanceTimersByTime((ACCESS_TTL_SEC + 120) * 1000);
    await expect(svc.verifyAccess(s.accessToken)).rejects.toThrow();
  });

  it('rejects a token issued for a different audience or issuer', async () => {
    const other = new SessionService(store, { accessSecret: SECRET, issuer: 'somewhere-else' });
    await expect(svc.verifyAccess((await other.issue('u', ctx)).accessToken)).rejects.toThrow();
  });

  it('carries NO permission data in the token', async () => {
    // Permissions live server-side and are checked per request. Baking them
    // into a 15-minute token means a demotion takes 15 minutes to take effect,
    // and a ban does too.
    const claims = await svc.verifyAccess((await svc.issue('user-1', ctx)).accessToken);
    const dump = JSON.stringify(claims);
    expect(dump).not.toMatch(/perm|mask|role|scope/i);
  });
});

// ---------------------------------------------------------------------------
describe('cookie attributes', () => {
  it('uses __Host- prefixed, HttpOnly, Secure, SameSite=Lax cookies in production', () => {
    const c = svc.cookieOptions({ secure: true });
    expect(c.refreshName.startsWith('__Host-')).toBe(true);
    expect(c.options.httpOnly).toBe(true);
    expect(c.options.secure).toBe(true);
    expect(c.options.sameSite).toBe('lax');
    expect(c.options.path).toBe('/');
    // __Host- forbids Domain; setting one silently invalidates the prefix.
    expect(c.options).not.toHaveProperty('domain');
  });

  it('drops the __Host- prefix ONLY when insecure, i.e. local http development', () => {
    // Browsers refuse a __Host- cookie without Secure, so keeping the prefix
    // over plain http would break login locally in a way that looks like a bug.
    const c = svc.cookieOptions({ secure: false });
    expect(c.refreshName.startsWith('__Host-')).toBe(false);
    expect(c.options.secure).toBe(false);
  });

  it('scopes the refresh cookie to the whole site, not just the refresh path', () => {
    // Path-scoping a refresh cookie is a common trick, but it breaks silently
    // behind a proxy that rewrites paths, and Path is not a security boundary.
    expect(svc.cookieOptions({ secure: true }).options.path).toBe('/');
  });
});
