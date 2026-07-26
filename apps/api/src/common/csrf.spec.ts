import { describe, it, expect } from 'vitest';
import { verifyCsrf, SAFE_METHODS, issueCsrfToken } from './csrf.js';

/**
 * P1.2 — CSRF double-submit.
 *
 * Our session cookie is SameSite=Lax, which already blocks cross-site POSTs in
 * every current browser. This is the second layer, and it exists because Lax is
 * a browser-side control: an old browser, a misconfigured proxy that strips the
 * attribute, or a future relaxation of the rule would remove it silently. A
 * server-side check fails closed instead.
 */
const good = 'x'.repeat(43);

describe('verifyCsrf', () => {
  it('exempts safe methods, which by definition change nothing', () => {
    expect(SAFE_METHODS).toEqual(['GET', 'HEAD', 'OPTIONS']);
    for (const m of SAFE_METHODS) {
      expect(() => verifyCsrf(m, undefined, undefined)).not.toThrow();
    }
  });

  it('accepts a state-changing request whose cookie and header agree', () => {
    expect(() => verifyCsrf('POST', good, good)).not.toThrow();
  });

  it('rejects a state-changing request with no token at all', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(() => verifyCsrf(m, undefined, undefined)).toThrow();
    }
  });

  it('rejects when the header is missing but the cookie is present', () => {
    // This is the actual cross-site case: the browser sends the cookie
    // automatically, but an attacker's page cannot read it to set the header.
    expect(() => verifyCsrf('POST', good, undefined)).toThrow();
  });

  it('rejects when the cookie is missing but the header is present', () => {
    expect(() => verifyCsrf('POST', undefined, good)).toThrow();
  });

  it('rejects a mismatch', () => {
    expect(() => verifyCsrf('POST', good, 'y'.repeat(43))).toThrow();
  });

  it('rejects an empty-string pair, which would otherwise "match"', () => {
    // Two empty values are equal. Without a length floor, an attacker who can
    // clear the cookie passes the check trivially.
    expect(() => verifyCsrf('POST', '', '')).toThrow();
    expect(() => verifyCsrf('POST', ' ', ' ')).toThrow();
  });

  it('rejects a token that is too short to be a real one', () => {
    expect(() => verifyCsrf('POST', 'abc', 'abc')).toThrow();
  });

  it('treats the method case-insensitively', () => {
    expect(() => verifyCsrf('post', good, good)).not.toThrow();
    expect(() => verifyCsrf('get', undefined, undefined)).not.toThrow();
  });
});

describe('issueCsrfToken', () => {
  it('mints a high-entropy token, distinct every time', () => {
    const seen = new Set(Array.from({ length: 200 }, () => issueCsrfToken()));
    expect(seen.size).toBe(200);
    expect([...seen][0]!.length).toBeGreaterThanOrEqual(43);
  });
});
