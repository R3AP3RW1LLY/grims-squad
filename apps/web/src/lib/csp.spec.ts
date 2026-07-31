import { describe, it, expect } from 'vitest';
import { buildCsp, newNonce } from './csp';

/**
 * The Content Security Policy (INV-035).
 *
 * ★ THESE ASSERT THE PRODUCTION POLICY WHILE RUNNING IN TEST ★
 *
 * That is the whole reason `buildCsp` takes a `dev` flag instead of reading NODE_ENV. A
 * policy assembled inline in middleware is a string nobody looks at until a browser blocks
 * something in front of a member — and the one that matters is the one this machine never
 * runs.
 */

const prod = (nonce = 'TESTNONCE') => buildCsp({ nonce, dev: false });
const dev = (nonce = 'TESTNONCE') => buildCsp({ nonce, dev: true });

/** Pulls one directive out of a policy for assertion. */
function directive(policy: string, name: string): string | undefined {
  return policy
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
}

describe('the production policy', () => {
  it('MANDATORY @INV-035: frame-ancestors is none', () => {
    /*
     * Named explicitly by the invariant. Clickjacking: without it an attacker overlays an
     * invisible copy of our page and harvests clicks on real controls — a member "confirming"
     * something they never saw.
     */
    expect(directive(prod(), 'frame-ancestors')).toBe("frame-ancestors 'none'");
  });

  it('MANDATORY @INV-035: scripts are nonce-gated, never unsafe-inline', () => {
    /*
     * The layer that makes a sanitiser bug survivable. `'unsafe-inline'` here would mean one
     * escaped `<script>` in stored member HTML becomes execution; a nonce means it does not,
     * because injected markup cannot guess the nonce.
     */
    const s = directive(prod(), 'script-src');

    expect(s).toContain("'nonce-TESTNONCE'");
    expect(s).not.toContain('unsafe-inline');
  });

  it('MANDATORY: production has NO unsafe-eval', () => {
    /*
     * ★ THE ASSERTION THIS ENTIRE FILE EXISTS FOR ★
     *
     * `'unsafe-eval'` is needed by React Fast Refresh and is added for dev only. If it ever
     * leaks into the production branch, most of what the script policy achieves is gone —
     * and it would be invisible, because every local page would keep working.
     */
    expect(prod()).not.toContain('unsafe-eval');
    // And it IS present in dev, so this test is comparing two real things.
    expect(dev()).toContain('unsafe-eval');
  });

  it('MANDATORY: default-src is self, so anything unnamed is denied', () => {
    // The backstop for resource types not listed — including ones the platform adds later.
    expect(directive(prod(), 'default-src')).toBe("default-src 'self'");
  });

  it('MANDATORY: no remote image hosts', () => {
    /*
     * Member uploads are served from our own API and Discord avatars are copied onto our
     * storage rather than hotlinked — deliberately, so rendering the roster does not tell
     * Discord which members are being looked at. A permissive img-src would quietly undo
     * that privacy decision from a completely unrelated file.
     */
    const img = directive(prod(), 'img-src');

    /*
     * blob: added 2026-08-01 for client-side image previews. It is not a remote host — the URL is
     * minted by our own script from bytes already in the page and is opaque to everybody else — so
     * the property this asserts, that rendering a page tells no third party what is being looked
     * at, is unchanged. Named explicitly rather than matched loosely, so a future widening to a
     * real host still fails here.
     */
    expect(img).toBe("img-src 'self' data: blob:");
    expect(img).not.toContain('http');
    expect(img).not.toContain('*');
  });

  it('MANDATORY: object-src and frame-src are none, base-uri is self', () => {
    // An injected <base href> silently repoints every relative URL on the page, including
    // form actions and script sources.
    expect(directive(prod(), 'object-src')).toBe("object-src 'none'");
    expect(directive(prod(), 'base-uri')).toBe("base-uri 'self'");
  });

  it('MANDATORY: frame-src names ONE host and it is the nocookie one', () => {
    /*
     * ★ THIS DIRECTIVE CHANGED FROM 'none' AND THE NARROWNESS IS THE POINT ★
     *
     * P2.3 added YouTube embeds. `frame-src` was `'none'`; it now names exactly one host.
     *
     * The stored HTML still contains no iframe — a video is a placeholder until a reader clicks —
     * so for anybody who does not click this directive is never exercised and Google is told
     * nothing. That is why click-to-play was chosen: this squadron includes minors (D15).
     *
     * `youtube-nocookie.com` rather than `youtube.com`: the same player without tracking cookies
     * on first load. Pinned as an EXACT string so widening it to a wildcard, or adding a second
     * host, is a visible edit to this test rather than a quiet one.
     */
    expect(directive(prod(), 'frame-src')).toBe('frame-src https://www.youtube-nocookie.com');
    expect(prod()).not.toContain('frame-src *');
    // And the clickjacking protection is untouched by the change.
    expect(directive(prod(), 'frame-ancestors')).toBe("frame-ancestors 'none'");
  });

  it('MANDATORY: no OTHER third-party host is permitted anywhere', () => {
    /*
     * The check on the check. One allowance is defensible; a second added by habit is how a
     * policy stops meaning anything. Every directive except frame-src must still be self-only.
     */
    const policy = prod();
    for (const d of policy.split(';').map((x) => x.trim())) {
      if (d.startsWith('frame-src')) continue;
      expect(d, d).not.toMatch(/https?:\/\//);
    }
  });

  it('MANDATORY: forms may only submit to us', () => {
    expect(directive(prod(), 'form-action')).toBe("form-action 'self'");
  });

  it('MANDATORY: connect-src does not permit arbitrary hosts in production', () => {
    /*
     * The directive an exfiltration payload would use. `ws:`/`wss:` are dev-only for HMR,
     * and a wildcard here would let injected script post anywhere.
     */
    const c = directive(prod(), 'connect-src');

    expect(c).toBe("connect-src 'self'");
    expect(c).not.toContain('ws:');
  });

  it('upgrades insecure requests in production and NOT in dev', () => {
    // Dev is http on localhost; this directive would break every asset there.
    expect(prod()).toContain('upgrade-insecure-requests');
    expect(dev()).not.toContain('upgrade-insecure-requests');
  });

  it('does NOT use strict-dynamic', () => {
    /*
     * Deliberate. `'strict-dynamic'` lets a nonced script load further scripts without a
     * nonce — transitive trust that suits tag managers and has no use here, where every
     * script is one we ship.
     */
    expect(prod()).not.toContain('strict-dynamic');
  });

  it('allows inline STYLE, and the trade is recorded', () => {
    /*
     * Not an oversight. A few components set `style={{ fontFamily: 'var(--font-display)' }}`,
     * and nonces cannot apply to style attributes at all — so the alternative is removing
     * every inline style in the app.
     *
     * Narrow exposure: CSS cannot execute script in any supported browser, and the forum
     * sanitiser refuses `style` and `class` on member content, so a post cannot inject CSS in
     * the first place. Script execution is what is being defended, and that is nonce-gated.
     */
    expect(directive(prod(), 'style-src')).toBe("style-src 'self' 'unsafe-inline'");
    expect(directive(prod(), 'style-src-attr')).toBe("style-src-attr 'unsafe-inline'");
  });
});

describe('the policy is well formed', () => {
  it('has no empty directives and no double semicolons', () => {
    // A malformed policy is not a strict policy — browsers skip what they cannot parse, and
    // they do it silently.
    expect(prod()).not.toMatch(/;\s*;/);
    expect(prod().endsWith(';')).toBe(false);
    for (const d of prod().split(';')) {
      expect(d.trim().length).toBeGreaterThan(0);
    }
  });

  it('names each directive at most once', () => {
    /*
     * A repeated directive is not merged — the FIRST occurrence wins and the rest are
     * ignored, so a duplicate silently discards whatever the later one intended.
     */
    for (const policy of [prod(), dev()]) {
      const names = policy.split(';').map((d) => d.trim().split(' ')[0]);
      expect(new Set(names).size, policy).toBe(names.length);
    }
  });

  it('embeds the nonce it was given, verbatim', () => {
    const nonce = 'aBc123+/=';
    expect(buildCsp({ nonce, dev: false })).toContain(`'nonce-${nonce}'`);
  });
});

describe('newNonce', () => {
  it('MANDATORY: is unguessable and never repeats', () => {
    /*
     * The single value the whole script policy rests on. A predictable nonce is not a nonce —
     * injected markup could simply include it.
     */
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(newNonce());

    expect(seen.size).toBe(500);
  });

  it('is 128 bits, base64', () => {
    const n = newNonce();
    // 16 bytes -> 24 base64 characters with one '=' of padding.
    expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it('contains nothing that would break the header', () => {
    // A nonce carrying a quote or a semicolon would terminate the directive early and
    // silently truncate the policy.
    for (let i = 0; i < 200; i++) {
      const n = newNonce();
      expect(n).not.toMatch(/[;'"\s]/);
    }
  });
});
