import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiCall, apiPost, apiDelete } from './api-client';

/**
 * The browser API client.
 *
 * ★ THE BUG THIS FILE EXISTS FOR ★
 *
 *   Body cannot be empty when content-type is set to 'application/json'
 *
 * Fastify, refusing a POST that declared JSON and carried none. It broke
 * starting two-factor enrolment — `POST /v1/auth/totp/enrol` takes no body,
 * because there is nothing to send: the server generates the secret.
 *
 * The mistake is trivial. It survived because the fetch code had been copied
 * into seven components, so nobody reading one of them could see the pattern.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // The suite runs in the NODE environment, so there is no document. Stubbed
  // rather than switching the whole project to jsdom for one cookie read —
  // this file tests fetch behaviour, not DOM behaviour.
  vi.stubGlobal('document', { cookie: 'gs_csrf=token-abc' });
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastInit(): RequestInit {
  return fetchMock.mock.calls[0]?.[1] as RequestInit;
}

function headersOf(): Record<string, string> {
  return (lastInit().headers ?? {}) as Record<string, string>;
}

describe('content-type', () => {
  it('MANDATORY: is NOT set when there is no body', async () => {
    /*
     * The whole bug. A request that says it is carrying JSON and carries
     * nothing is malformed, and Fastify rejects it before any handler runs — so
     * the endpoint never even sees it.
     */
    await apiPost('/v1/auth/totp/enrol');

    expect(headersOf()['content-type']).toBeUndefined();
    expect(lastInit().body).toBeUndefined();
  });

  it('MANDATORY: IS set when there is a body', async () => {
    await apiPost('/v1/auth/totp/confirm', { code: '123456' });

    expect(headersOf()['content-type']).toBe('application/json');
    expect(lastInit().body).toBe('{"code":"123456"}');
  });

  it('is not set on a bodyless DELETE either', async () => {
    // Revoking a device sends nothing; the id is in the path.
    await apiDelete('/v1/me/devices/abc');
    expect(headersOf()['content-type']).toBeUndefined();
  });

  it('MANDATORY: an explicitly null body still counts as a body', async () => {
    // `null` is valid JSON and an endpoint may legitimately expect it. Only
    // ABSENCE means "no body" — conflating the two would make it impossible to
    // send null on purpose.
    await apiCall('POST', '/somewhere', { body: null });

    expect(headersOf()['content-type']).toBe('application/json');
    expect(lastInit().body).toBe('null');
  });
});

describe('CSRF', () => {
  it('MANDATORY: is attached to everything that changes state', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      fetchMock.mockClear();
      await apiCall(method, '/somewhere');
      expect(headersOf()['x-csrf-token'], method).toBe('token-abc');
    }
  });

  it('is not attached to a GET', async () => {
    // Nothing to forge. Sending it anyway is harmless but implies a protection
    // that is not doing anything, which is its own kind of misleading.
    await apiCall('GET', '/somewhere');
    expect(headersOf()['x-csrf-token']).toBeUndefined();
  });

  it('MANDATORY: sends cookies, and only to our own origin', async () => {
    await apiPost('/v1/auth/logout');
    expect(lastInit().credentials).toBe('same-origin');
  });
});

describe('errors', () => {
  it("MANDATORY: surfaces the server's own message, not a generic one", async () => {
    /*
     * The API answers with an ENVELOPE. Reading `json.message` off the top
     * level always yields undefined — a mistake this codebase has already made
     * once, which turned a useful "try again in a few minutes" into "That did
     * not work."
     */
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'That code has expired.' } }), {
        status: 400,
      }),
    );

    await expect(apiPost('/v1/auth/totp/confirm', { code: '000000' })).rejects.toThrow(
      'That code has expired.',
    );
  });

  it('falls back only when the server said nothing useful', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    await expect(apiPost('/x', undefined, 'Could not reach the hub.')).rejects.toThrow(
      'Could not reach the hub.',
    );
  });
});

describe('responses', () => {
  it('survives a 204 with no body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(apiPost('/x')).resolves.toEqual({});
  });
});

/**
 * ★ THE STRUCTURAL FIX, NOT JUST THE SYMPTOM ★
 *
 * Fixing the two broken helpers would have left five more copies waiting to
 * grow the same bug. This walks the component tree and fails if a new one
 * appears.
 */
describe('nobody hand-rolls this again', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return walk(path);
      return path.endsWith('.tsx') || (path.endsWith('.ts') && !path.endsWith('.spec.ts'))
        ? [path]
        : [];
    });
  }

  it('MANDATORY: no component sets content-type by hand', () => {
    const offenders = walk(SRC)
      .filter((p) => !p.endsWith('api-client.ts') && !p.endsWith('api.ts'))
      .filter((p) => {
        const source = readFileSync(p, 'utf8')
          // Comments EXPLAIN this rule; matching the explanation would fail the
          // test on its own documentation.
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split(/\r?\n/)
          .filter((l) => !l.trim().startsWith('//'))
          .join('\n');
        return source.includes("'content-type': 'application/json'");
      })
      .map((p) => p.slice(SRC.length + 1));

    expect(
      offenders,
      `These set content-type by hand instead of using apiCall. That is how ` +
        `"Body cannot be empty when content-type is set to 'application/json'" ` +
        `got shipped — a bodyless POST that still declared JSON:\n` +
        offenders.map((o) => `  ${o}`).join('\n'),
    ).toEqual([]);
  });
});

describe('the enrolment outage of 2026-07-31', () => {
  /**
   * ★ WHAT HAPPENED ★
   *
   * A new admin could not finish two-factor enrolment in production. `POST /v1/auth/totp/enrol`
   * returned 201; every following `POST /v1/auth/totp/confirm` returned 401 in about a millisecond,
   * with `failed_count` still 0 in the database — proving the six-digit code was never checked.
   *
   * The access cookie lives fifteen minutes and the browser drops it by itself. `middleware.ts`
   * refreshes it silently, but its matcher excludes `v1/`, so that refresh only runs on a page
   * NAVIGATION. Enrolment is the one flow that sits still for minutes without navigating — install
   * an authenticator, scan the QR, wait for a code — and the security page is a forced wall, so
   * there was nowhere to navigate that would have fixed it.
   *
   * The member was permanently stuck, and pressing the button again could never work.
   */

  /** Replies 401 to the first call at `path`, then 200; the refresh always succeeds. */
  function expiringSession(path: string): string[] {
    const seen: string[] = [];
    let first = true;
    fetchMock.mockImplementation(async (url: string) => {
      seen.push(url);
      if (url === '/v1/auth/refresh') return new Response('{}', { status: 200 });
      if (url === path && first) {
        first = false;
        return new Response(JSON.stringify({ error: { message: 'Sign in to continue.' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{"recoveryCodes":["a","b"]}', { status: 200 });
    });
    return seen;
  }

  it('MANDATORY: a 401 refreshes the session and retries once', async () => {
    const seen = expiringSession('/v1/auth/totp/confirm');

    const out = await apiPost<{ recoveryCodes: string[] }>('/v1/auth/totp/confirm', {
      code: '123456',
    });

    expect(out.recoveryCodes).toEqual(['a', 'b']);
    expect(seen).toEqual(['/v1/auth/totp/confirm', '/v1/auth/refresh', '/v1/auth/totp/confirm']);
  });

  it('MANDATORY: the retry carries the ROTATED csrf token, not the stale one', async () => {
    /*
     * The refresh rotates the CSRF cookie. Replaying the original token turns the 401 into a 403 —
     * the member stays exactly as stuck, and the symptom changes just enough to look like a
     * different bug entirely.
     */
    const sent: Array<string | undefined> = [];
    let first = true;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/v1/auth/refresh') {
        vi.stubGlobal('document', { cookie: 'gs_csrf=token-rotated' });
        return new Response('{}', { status: 200 });
      }
      sent.push(((init?.headers ?? {}) as Record<string, string>)['x-csrf-token']);
      if (first) {
        first = false;
        return new Response('{}', { status: 401 });
      }
      return new Response('{}', { status: 200 });
    });

    await apiPost('/v1/auth/totp/confirm', { code: '123456' });

    expect(sent[0]).toBe('token-abc');
    expect(sent[1]).toBe('token-rotated');
  });

  it('MANDATORY: gives up after one retry rather than looping', async () => {
    // A genuinely signed-out member must see an error, not become a request storm against our own
    // auth endpoint.
    let confirms = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/v1/auth/refresh') return new Response('{}', { status: 200 });
      confirms += 1;
      return new Response('{}', { status: 401 });
    });

    await expect(apiPost('/v1/auth/totp/confirm', { code: '1' })).rejects.toThrow();
    expect(confirms).toBe(2);
  });

  it('does not retry the original call when the refresh itself fails', async () => {
    // The session is genuinely over. Retrying would fail identically and only delay telling them.
    let confirms = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/v1/auth/refresh') return new Response('{}', { status: 401 });
      confirms += 1;
      return new Response('{}', { status: 401 });
    });

    await expect(apiPost('/v1/auth/totp/confirm', { code: '1' })).rejects.toThrow();
    expect(confirms).toBe(1);
  });

  it('MANDATORY: never tries to refresh a failing refresh', async () => {
    // Otherwise: infinite recursion, aimed at our own auth endpoint.
    let refreshes = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/v1/auth/refresh') refreshes += 1;
      return new Response('{}', { status: 401 });
    });

    await expect(apiCall('POST', '/v1/auth/refresh')).rejects.toThrow();
    expect(refreshes).toBe(1);
  });

  it('MANDATORY: a 403 is not retried', async () => {
    /*
     * 403 is permission denied, not expired. Refreshing returns the same answer, and retrying a
     * refused privileged action is precisely the noise an audit log does not need.
     */
    const seen: string[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify({ error: { message: 'You cannot do that.' } }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(apiPost('/v1/admin/roles', {})).rejects.toThrow(/cannot/i);
    expect(seen).toEqual(['/v1/admin/roles']);
  });

  it('a successful call never refreshes', async () => {
    // The overwhelmingly common case must cost nothing extra.
    const seen: string[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      seen.push(url);
      return new Response('{}', { status: 200 });
    });

    await apiPost('/v1/forum/threads', { title: 'x' });
    expect(seen).toEqual(['/v1/forum/threads']);
  });

  it('MANDATORY: a burst of expired calls produces exactly ONE refresh', async () => {
    /*
     * Several of our pages fire multiple requests at load. The refresh rotates the token family, so
     * concurrent refreshes race — the second presents a token the first already consumed, which
     * reads as a stolen-token replay and can invalidate the whole family, signing the member out
     * for real. One shared in-flight promise is what prevents that.
     */
    let refreshes = 0;
    const expired = new Set<string>();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/v1/auth/refresh') {
        refreshes += 1;
        return new Response('{}', { status: 200 });
      }
      if (!expired.has(url)) {
        expired.add(url);
        return new Response('{}', { status: 401 });
      }
      return new Response('{}', { status: 200 });
    });

    await Promise.all([apiPost('/v1/a', {}), apiPost('/v1/b', {}), apiPost('/v1/c', {})]);
    expect(refreshes).toBe(1);
  });
});
