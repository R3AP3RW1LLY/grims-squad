import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeRedirectPath } from '@grims/shared';

const HERE = dirname(fileURLToPath(import.meta.url));
const controller = readFileSync(resolve(HERE, 'discord.controller.ts'), 'utf8');

/**
 * Where the browser goes after a successful Discord login.
 *
 * ★ THE BUG ★
 *
 * `safeRedirectPath` returns a PATH, which is right in production: Caddy serves
 * the API and the site from ONE origin under /v1, so `/` lands on the site.
 * Locally they are separate ports, so the same relative redirect landed on the
 * API's own root — a login that succeeded and then dumped the member on
 * `{"error":{"code":"RESOURCE_NOT_VISIBLE","message":"Cannot GET /"}}`.
 *
 * ★ AND WHY THE FIX IS NOT AN OPEN REDIRECT ★
 *
 * The base comes from configuration and the path from the allowlist. A caller
 * controls neither. Building it from anything request-supplied would be the
 * textbook hole, and this file exists so that stays true.
 */
describe('post-login redirect', () => {
  it('MANDATORY: the base is read from the environment, never from the request', () => {
    // The whole safety argument. If this ever reads a query parameter or a
    // header, an attacker chooses where a freshly-authenticated browser lands.
    const decl = controller.slice(
      controller.indexOf('const WEB_BASE_URL'),
      controller.indexOf('function afterLogin'),
    );
    expect(decl).toContain("process.env['WEB_BASE_URL']");
    expect(decl).not.toMatch(/@Query|req\.|request|headers/i);
  });

  it('MANDATORY: the path half still goes through safeRedirectPath', () => {
    // The base being trusted does not make the path trusted. Both halves have
    // to hold for the result to be safe.
    const service = readFileSync(resolve(HERE, 'discord.service.ts'), 'utf8');
    expect(service).toContain('safeRedirectPath(redirect)');
  });

  it('the allowlist still refuses the usual escapes', () => {
    // Belt and braces on the half that DOES come from the caller.
    for (const evil of [
      'https://evil.example/steal',
      '//evil.example',
      // DOUBLE backslash in source, so the VALUE is "/\evil.example". Some
      // browsers normalise that to "//evil.example" and follow it off-site.
      // Written with care because a shell heredoc eats the escape and silently
      // turns this into an ordinary relative path, which then rightly passes —
      // a test that looks like it covers the case and does not.
      '/\\evil.example',
      'javascript:alert(1)',
      '/path\r\nSet-Cookie: x=1',
    ]) {
      expect(safeRedirectPath(evil), evil).toBe('/');
    }
  });

  it('keeps a legitimate relative path', () => {
    expect(safeRedirectPath('/app')).toBe('/app');
  });

  it('trims a trailing slash from the base so the join cannot double up', () => {
    // "http://localhost:5000/" + "/app" is "http://localhost:5000//app", which
    // some servers treat as a protocol-relative URL — the exact shape the
    // allowlist rejects when it comes from a caller.
    // A substring, not a regex matching a regex literal — that is unreadable
    // escaped and was itself a syntax error the first time.
    expect(controller).toContain("replace(/\\/+$/, '')");
  });

  it('is empty by default, preserving production behaviour', () => {
    // Production is same-origin behind Caddy and must keep emitting a relative
    // redirect. A default of localhost would break the live site.
    expect(controller).toMatch(/WEB_BASE_URL'\] \?\? ''/);
  });
});
