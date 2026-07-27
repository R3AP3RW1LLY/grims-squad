import { describe, it, expect } from 'vitest';
import { parseApiError } from './api-error.js';

/**
 * ★ FOUND IN USE, 2026-07-27 ★
 *
 * A member linking an Inara key saw "That did not work." The server had said
 * "Could not reach Inara to check that key. Try again in a few minutes."
 *
 * The API answers with an ENVELOPE — { error: { code, message, requestId } } —
 * and three separate forms read `json.message` off the TOP level. Always
 * undefined, so all three independently fell through to their own generic
 * fallback and threw away the one useful sentence in the response.
 */
describe('parseApiError', () => {
  it('MANDATORY: reads the message out of the API envelope', () => {
    const body = {
      error: {
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'Could not reach Inara to check that key.',
        requestId: 'abc-123',
      },
    };
    const parsed = parseApiError(body);
    expect(parsed.message).toBe('Could not reach Inara to check that key.');
    expect(parsed.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(parsed.requestId).toBe('abc-123');
  });

  it('falls back to a FLAT message, for responses not from our error filter', () => {
    // A framework 404, or a proxy in front of us, does not use the envelope.
    expect(parseApiError({ message: 'Not Found' }).message).toBe('Not Found');
  });

  it('MANDATORY: never returns an empty string', () => {
    // An empty error renders as a blank red box, which reads as the page having
    // broken rather than as something having failed.
    for (const body of [null, undefined, {}, { error: {} }, { error: { message: '   ' } }]) {
      expect(parseApiError(body).message.trim().length).toBeGreaterThan(0);
    }
  });

  it('treats a missing retryable flag as NOT retryable', () => {
    // Assuming otherwise invites a UI that offers "try again" for something
    // which will never succeed.
    expect(parseApiError({ error: { message: 'x' } }).retryable).toBe(false);
    expect(parseApiError({ error: { message: 'x', retryable: true } }).retryable).toBe(true);
  });

  it('does not throw on a body that is not an object at all', () => {
    for (const body of ['plain text', 42, [], true]) {
      expect(() => parseApiError(body)).not.toThrow();
    }
  });
});

describe('no component re-implements this', () => {
  it('MANDATORY: nothing reads json.message off the top level', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { resolve, dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith('.tsx') && !full.endsWith('.spec.tsx')) files.push(full);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(0);

    for (const f of files) {
      /*
       * Comments stripped first. The FIXED files explain the old mistake in
       * prose, so matching raw source matches the explanation rather than the
       * code — a test that fails on its own documentation.
       *
       * Both strippers are multiline-flag regexes rather than a line split:
       * writing a newline literal here was mangled by the shell twice already,
       * and the `m` flag needs no escape at all.
       */
      const code = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

      // The exact mistake: pulling `message` off the parsed body rather than
      // out of `error`. Three files did this independently.
      expect(code, f).not.toMatch(/json\['message'\]|json\.message/);
    }
  });
});
