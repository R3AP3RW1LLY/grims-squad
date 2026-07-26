import { describe, it, expect } from 'vitest';
import { safeRedirectPath, DEFAULT_REDIRECT } from './redirect.js';

/**
 * P1.1 — "The redirect parameter is validated against an internal-path allowlist
 * — an external URL is rejected."
 *
 * An open redirect on an OAuth callback is not a cosmetic bug. The attack is:
 * send a member a perfectly genuine `grims-squad.com` login link carrying
 * `?redirect=//evil.tld`, they authenticate against the REAL Discord consent
 * screen, and we bounce them — freshly authenticated and trusting — to a clone
 * that asks them to "re-confirm" something. The domain in the address bar was
 * ours right up until the hop.
 *
 * So the rule is an allowlist, not a blocklist: a single leading slash, no
 * scheme, no authority, or we fall back to the default. Every case below is a
 * real-world bypass of the naive `startsWith('/')` check.
 */
describe('safeRedirectPath', () => {
  it('allows an ordinary internal path', () => {
    expect(safeRedirectPath('/forum')).toBe('/forum');
    expect(safeRedirectPath('/fleet/carriers?tab=cargo')).toBe('/fleet/carriers?tab=cargo');
    expect(safeRedirectPath('/profile#ships')).toBe('/profile#ships');
  });

  it('falls back to the default when absent, empty or not a string', () => {
    for (const v of [undefined, null, '', '   ', 42, {}, []]) {
      expect(safeRedirectPath(v as unknown as string)).toBe(DEFAULT_REDIRECT);
    }
  });

  it('rejects an absolute URL on another origin', () => {
    for (const v of ['https://evil.tld/x', 'http://evil.tld', 'https://grims-squad.com.evil.tld']) {
      expect(safeRedirectPath(v)).toBe(DEFAULT_REDIRECT);
    }
  });

  it('rejects a protocol-relative URL — the classic startsWith("/") bypass', () => {
    // `//evil.tld` starts with "/" but the browser reads it as a full origin.
    for (const v of ['//evil.tld', '//evil.tld/path', '///evil.tld', '////evil.tld']) {
      expect(safeRedirectPath(v)).toBe(DEFAULT_REDIRECT);
    }
  });

  it('rejects backslash variants, which browsers normalise to slashes', () => {
    for (const v of ['/\\evil.tld', '\\\\evil.tld', '/\\/evil.tld', '\\/evil.tld']) {
      expect(safeRedirectPath(v)).toBe(DEFAULT_REDIRECT);
    }
  });

  it('rejects a scheme, including javascript: and data:', () => {
    for (const v of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      ' javascript:alert(1)',
    ]) {
      expect(safeRedirectPath(v)).toBe(DEFAULT_REDIRECT);
    }
  });

  it('rejects encoded and obfuscated authority forms', () => {
    for (const v of [
      '/%2f%2fevil.tld',
      '/%5cevil.tld',
      '%2f%2fevil.tld',
      '/%09/evil.tld',
      '/\t/evil.tld',
      '/\n//evil.tld',
    ]) {
      expect(safeRedirectPath(v)).toBe(DEFAULT_REDIRECT);
    }
  });

  it('rejects header-injection payloads', () => {
    for (const v of ['/ok\r\nSet-Cookie: a=b', '/ok\nLocation: https://evil.tld', '/ok\r\n\r\n<html>']) {
      expect(safeRedirectPath(v)).toBe(DEFAULT_REDIRECT);
    }
  });

  it('rejects a userinfo-authority trick', () => {
    // `https://grims-squad.com@evil.tld` looks like us and lands on them.
    expect(safeRedirectPath('https://grims-squad.com@evil.tld')).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath('//grims-squad.com@evil.tld')).toBe(DEFAULT_REDIRECT);
  });

  it('rejects an over-long value rather than reflecting it', () => {
    expect(safeRedirectPath(`/${'a'.repeat(4096)}`)).toBe(DEFAULT_REDIRECT);
  });

  it('never returns a value that fails its own check when fed back in', () => {
    // Idempotence: sanitising an already-sanitised value must be a no-op.
    for (const v of ['/forum', '//evil.tld', 'javascript:alert(1)', '/\\evil.tld', '']) {
      const once = safeRedirectPath(v);
      expect(safeRedirectPath(once)).toBe(once);
    }
  });
});
