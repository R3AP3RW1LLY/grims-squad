import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_API_ORIGIN } from './api.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const nextConfig = readFileSync(resolve(HERE, '../../next.config.mjs'), 'utf8');
const apiMain = readFileSync(resolve(HERE, '../../../api/src/main.ts'), 'utf8');

/**
 * One value, written down in three places.
 *
 * ★ THE BUG THIS PREVENTS ★
 *
 * next.config.mjs defaulted the API to :5001 and lib/api.ts defaulted it to
 * :3001. Browser-side calls went through the rewrite and worked; SERVER-side
 * calls hit :3001, got ECONNREFUSED, and were swallowed into a null by the
 * client's catch.
 *
 * The visible symptom was a dashboard rendering "sign in with Discord"
 * immediately after a SUCCESSFUL login — the one state that makes you doubt
 * the auth code rather than the URL. Nothing in any log said otherwise, because
 * the request never reached the API to be logged.
 */
describe('the API origin agrees everywhere', () => {
  it('MANDATORY: the rewrite default matches the client default', () => {
    expect(nextConfig).toContain(DEFAULT_API_ORIGIN);
  });

  it('MANDATORY: both match the port the API actually binds', () => {
    // apps/api/src/main.ts: Number(process.env['API_PORT'] ?? 5001)
    const port = /API_PORT'\]\s*\?\?\s*(\d+)/.exec(apiMain)?.[1];
    expect(port, 'could not read the API default port').toBeDefined();
    expect(DEFAULT_API_ORIGIN).toContain(`:${port as string}`);
  });

  it('both read the same environment variable', () => {
    // Otherwise setting it in one place fixes half the app, which is worse
    // than fixing none of it — the half that still works hides the half that
    // does not.
    expect(nextConfig).toContain('API_INTERNAL_URL');
  });
});
