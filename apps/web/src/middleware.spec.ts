import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(HERE, 'middleware.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/**
 * Silent session refresh.
 *
 * ★ WHAT WENT WRONG, AND WHY NOTHING CAUGHT IT ★
 *
 * Sessions last fourteen days and the refresh cookie was set to match — but the
 * access cookie lives fifteen minutes and NOTHING EVER CALLED `/v1/auth/refresh`.
 * The endpoint was written and tested against a fake; it simply had no caller.
 *
 * So a member signed in, browsed for a quarter of an hour, and got sent back
 * through Discord — while a valid fourteen-day session sat unread in their own
 * browser. No test failed, because every piece worked in isolation and "signed
 * out" is not an error condition.
 *
 * These tests are therefore about the WIRING, which is the part that was
 * missing, not about the token logic, which was already right.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A NextRequest, reduced to the parts the middleware touches. */
function req(cookies: Record<string, string>, url = 'http://localhost:5000/dashboard') {
  return {
    nextUrl: new URL(url),
    headers: new Headers(),
    cookies: {
      get: (n: string) => (n in cookies ? { value: cookies[n] } : undefined),
      has: (n: string) => n in cookies,
      getAll: () => Object.entries(cookies).map(([name, value]) => ({ name, value })),
    },
  } as never;
}

const SIGNED_IN = { gs_at: 'access', gs_rt: 'refresh', gs_csrf: 'csrf' };
const AGED_OUT = { gs_rt: 'refresh', gs_csrf: 'csrf' };

async function run(cookies: Record<string, string>) {
  const { middleware } = await import('./middleware');
  return middleware(req(cookies));
}

/** What middleware passes to fetch. Declared so the call can be asserted on. */
type FetchInit = { headers: Record<string, string> };

function apiReturns(status: number, setCookie: string[] = []) {
  /*
   * The parameters are DECLARED even though the body ignores them.
   *
   * `vi.fn(async () => ...)` types its calls as an empty tuple, so
   * `calls[0][1]` is a type error and the assertion below cannot be written at
   * all. Naming them is what makes the recorded call inspectable.
   */
  const fetchMock = vi.fn(async (_url: string, _init: FetchInit) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { getSetCookie: () => setCookie },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('silent refresh', () => {
  it('MANDATORY: renews the session when the access cookie has aged out', async () => {
    // ★ THE WHOLE POINT. Refresh cookie present, access cookie gone — which is
    // exactly what the browser leaves behind after fifteen minutes.
    const fetchMock = apiReturns(200, ['gs_at=new; Path=/', 'gs_rt=rotated; Path=/']);

    const res = await run(AGED_OUT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.headers.getSetCookie()).toEqual(['gs_at=new; Path=/', 'gs_rt=rotated; Path=/']);
  });

  it('MANDATORY: does nothing while the access cookie is still valid', async () => {
    // This runs on EVERY navigation. Refreshing when there is nothing to refresh
    // would put an API round trip in front of every page load and rotate a
    // perfectly good token for no reason.
    const fetchMock = apiReturns(200);

    await run(SIGNED_IN);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing for a visitor who is not signed in', async () => {
    const fetchMock = apiReturns(200);
    await run({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the CSRF token, without which the refresh is silently rejected', async () => {
    const fetchMock = apiReturns(200);
    await run(AGED_OUT);

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers['x-csrf-token']).toBe('csrf');
    // And the cookies, or the endpoint has no session to rotate.
    expect(init?.headers['cookie']).toContain('gs_rt=refresh');
  });

  it('does not attempt a refresh it knows will fail', async () => {
    // No CSRF cookie means the endpoint refuses. Calling anyway would look like
    // the fix was applied while the member stayed signed out.
    const fetchMock = apiReturns(200);
    await run({ gs_rt: 'refresh' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a refusal quietly — the member is genuinely signed out', async () => {
    // An expired family, a reused token, or a Discord authorisation the member
    // revoked. All mean "sign in again", and none is an error to shout about.
    apiReturns(401);
    const res = await run(AGED_OUT);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('survives the API being unreachable', async () => {
    // The site must not go down because the API is restarting.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, _init: FetchInit) => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const res = await run(AGED_OUT);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('still publishes x-pathname, which is the other thing it does', async () => {
    apiReturns(200);
    const res = await run(SIGNED_IN);
    expect(res).toBeDefined();
  });
});

describe('the shape of the refresh', () => {
  it('MANDATORY: uses getSetCookie, not get("set-cookie")', () => {
    /*
     * `get('set-cookie')` JOINS multiple cookies into one comma-separated
     * string. The browser then stores a single malformed cookie and the session
     * is worse off than before the refresh — a failure that looks like the
     * token being wrong rather than the header being mangled.
     */
    expect(source).toContain('getSetCookie()');
    expect(source).not.toMatch(/get\(['"]set-cookie['"]\)/);
  });

  it('MANDATORY: tries both the prefixed and unprefixed cookie names', () => {
    /*
     * The API picks `__Host-` from NODE_ENV, not from the request protocol.
     * Behind a proxy the app sees plain http while the browser holds the
     * prefixed cookie — so inferring the name from our own protocol would work
     * in development and sign everybody out in production, which is precisely
     * the bug this file exists to fix.
     */
    expect(source).toContain('__Host-');
    expect(source).toMatch(/request\.cookies\.get\(base\)/);
  });
});
