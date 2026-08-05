import { describe, expect, it, vi } from 'vitest';
import { GlobalExceptionFilter } from './exception.filter.js';
import { wantsHtml } from './error-page.js';
import { ErrorCode, type ErrorEnvelope } from '@grims/shared';
import type { ArgumentsHost } from '@nestjs/common';

/**
 * A rate limit is not a defect, and it must not answer like one.
 *
 * ★ WHAT THIS COST — SQUADRON OWNER, 2026-08-05 ★
 *
 * "we have a member who connected their app and it during a journal upload it said that the hub
 * refused the last upload, we need this fixed ASAP!"
 *
 * They had just paired the companion, which uploads the whole journal history on first run. That
 * burst crossed the per-device budget, `@fastify/rate-limit` refused four requests — correctly —
 * and every one came back as HTTP 500, logged as "Unhandled exception — this is a defect".
 *
 * The cause is a seam between two frameworks. Fastify signals a rejection with a plain `Error`
 * carrying a numeric `statusCode`; Nest signals one with `HttpException`. The filter understood
 * `AppError` and `HttpException` and nothing else, so anything a Fastify PLUGIN rejected — which
 * is every request refused before the handler runs — became a 500.
 *
 * The difference matters to the client and to nobody else: 429 means wait and try again, 500 means
 * something is broken and there is nothing you can do. The companion reads any failure as a
 * refusal, so the second reading is the one the member was shown.
 */

/** Narrows a recorded body to the error envelope, so the assertions need no cast. */
function envelopeOf(body: unknown): ErrorEnvelope {
  return body as ErrorEnvelope;
}

/** A reply that records what the filter did to it. */
function fakeReply(headers: Record<string, string | number> = {}) {
  const sent: { status?: number; body?: unknown; contentType?: string } = {};
  return {
    sent,
    getHeader: (name: string) => headers[name.toLowerCase()],
    status(code: number) {
      sent.status = code;
      return this;
    },
    // Fastify's reply is chainable and the filter uses it to set a content type for the HTML path.
    header(name: string, value: string) {
      if (name.toLowerCase() === 'content-type') sent.contentType = value;
      return this;
    },
    send(body: unknown) {
      sent.body = body;
    },
  };
}

function hostFor(reply: unknown): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => reply,
      // No `accept`: the companion app's shape, which must keep getting JSON.
      getRequest: () => ({
        id: 'req-1',
        method: 'POST',
        url: '/v1/telemetry/journal',
        headers: {},
      }),
    }),
  } as unknown as ArgumentsHost;
}

/** Exactly what @fastify/rate-limit throws: a plain Error with a statusCode. */
function rateLimitError(): Error {
  const e = new Error('Rate limit exceeded, retry in 27 seconds');
  (e as Error & { statusCode: number }).statusCode = 429;
  return e;
}

describe('a Fastify plugin rejection keeps its status', () => {
  it('MANDATORY: a rate limit answers 429, not 500', () => {
    const reply = fakeReply({ 'retry-after': 27 });
    new GlobalExceptionFilter().catch(rateLimitError(), hostFor(reply));

    expect(reply.sent.status).toBe(429);
  });

  it('MANDATORY: it is RATE_LIMITED, retryable, and says how long', () => {
    /*
     * `retryAfterSeconds` has been in the error contract from the start and nothing had ever set
     * it. Read from the header Fastify has already written rather than parsed out of the English
     * message, which upstream is free to reword.
     */
    const reply = fakeReply({ 'retry-after': 27 });
    new GlobalExceptionFilter().catch(rateLimitError(), hostFor(reply));

    expect(reply.sent.body).toMatchObject({
      error: {
        code: ErrorCode.RATE_LIMITED,
        retryable: true,
        retryAfterSeconds: 27,
        requestId: 'req-1',
      },
    });
  });

  it('a string Retry-After is read too, and a missing one is null rather than a guess', () => {
    const asString = fakeReply({ 'retry-after': '27' });
    new GlobalExceptionFilter().catch(rateLimitError(), hostFor(asString));
    expect(envelopeOf(asString.sent.body).error.retryAfterSeconds).toBe(27);

    const absent = fakeReply();
    new GlobalExceptionFilter().catch(rateLimitError(), hostFor(absent));
    expect(envelopeOf(absent.sent.body).error.retryAfterSeconds).toBeNull();
    // Still a 429 — the status is the part the client acts on.
    expect(absent.sent.status).toBe(429);
  });

  it('MANDATORY: a real defect is still a 500 that tells the client nothing', () => {
    /*
     * The point of the change is to stop MISREPORTING refusals, not to start leaking internals.
     * An error with no statusCode is still a bug, and still answers 500 with its detail confined
     * to the log.
     */
    const reply = fakeReply();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    new GlobalExceptionFilter().catch(new Error('column "wat" does not exist'), hostFor(reply));

    expect(reply.sent.status).toBe(500);
    expect(JSON.stringify(reply.sent.body)).not.toContain('does not exist');
    spy.mockRestore();
  });

  it('a 5xx from a plugin is NOT laundered into a client error', () => {
    // The pass-through is deliberately 4xx only: a plugin failing with a 503 is our problem, and
    // reporting it as an expected rejection would hide it.
    const e = new Error('upstream exploded');
    (e as Error & { statusCode: number }).statusCode = 503;

    const reply = fakeReply();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    new GlobalExceptionFilter().catch(e, hostFor(reply));

    expect(reply.sent.status).toBe(500);
    spy.mockRestore();
  });
});

/**
 * A browser gets a page; a program gets the envelope.
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * "we jsut got this error: {"error":{"code":"INTERNAL_ERROR" ... }} no error screen! what the
 * fuck! we want error screens instead of showing this shit."
 *
 * The website's error boundaries could never have covered it. Next's `error.tsx` catches a failure
 * while REACT renders, and this JSON came from `GET /v1/auth/discord/callback` — a URL the browser
 * navigates to directly as the last leg of signing in. Next is not involved at any point.
 *
 * So the API decides by `Accept`, which is the header that exists for exactly this question. The
 * companion app and every script keep the envelope, because `retryable` and `retryAfterSeconds`
 * are a contract the app reads.
 */
describe('what a browser is shown', () => {
  const browser = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

  function hostAccepting(reply: unknown, accept: string | undefined): ArgumentsHost {
    return {
      switchToHttp: () => ({
        getResponse: () => reply,
        getRequest: () => ({
          id: 'req-1',
          method: 'GET',
          url: '/v1/auth/discord/callback',
          headers: accept === undefined ? {} : { accept },
        }),
      }),
    } as unknown as ArgumentsHost;
  }

  it('MANDATORY: a browser navigation gets HTML, not the envelope', () => {
    const reply = fakeReply();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    new GlobalExceptionFilter().catch(new Error('discord blew up'), hostAccepting(reply, browser));

    expect(reply.sent.status).toBe(500);
    expect(reply.sent.contentType).toContain('text/html');
    expect(String(reply.sent.body)).toContain('<!doctype html>');
    // The requestId survives — it is what gets somebody helped quickly.
    expect(String(reply.sent.body)).toContain('req-1');
    // And the internals do not.
    expect(String(reply.sent.body)).not.toContain('discord blew up');
    spy.mockRestore();
  });

  it('MANDATORY: the companion app still gets JSON', () => {
    /*
     * The app reads `retryable` and `retryAfterSeconds` and backs off on them. Handing it HTML
     * would break every client on the platform to fix a screen.
     */
    const reply = fakeReply();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    new GlobalExceptionFilter().catch(new Error('boom'), hostAccepting(reply, 'application/json'));

    expect(reply.sent.body).toMatchObject({ error: { code: ErrorCode.INTERNAL_ERROR } });
    spy.mockRestore();
  });

  it('a request with no Accept header gets JSON — the safe default for a program', () => {
    const reply = fakeReply();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    new GlobalExceptionFilter().catch(new Error('boom'), hostAccepting(reply, undefined));

    expect(reply.sent.body).toMatchObject({ error: {} });
    spy.mockRestore();
  });

  it('a rate limit renders as a page too, when a browser asks', () => {
    const reply = fakeReply({ 'retry-after': 27 });
    new GlobalExceptionFilter().catch(rateLimitError(), hostAccepting(reply, browser));

    expect(reply.sent.status).toBe(429);
    expect(String(reply.sent.body)).toContain('<!doctype html>');
  });
});

describe('wantsHtml', () => {
  it('says yes to a browser and no to everything else', () => {
    expect(wantsHtml('text/html,application/xhtml+xml,*/*;q=0.8')).toBe(true);
    expect(wantsHtml('application/json')).toBe(false);
    expect(wantsHtml('*/*')).toBe(false);
    expect(wantsHtml(undefined)).toBe(false);
    expect(wantsHtml('')).toBe(false);
  });

  it('when both are named, the one asked for FIRST wins', () => {
    // A client that says "json, or html if you must" wants json.
    expect(wantsHtml('application/json, text/html')).toBe(false);
    expect(wantsHtml('text/html, application/json')).toBe(true);
  });
});
