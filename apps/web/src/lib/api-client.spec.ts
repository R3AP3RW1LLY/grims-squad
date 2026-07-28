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
