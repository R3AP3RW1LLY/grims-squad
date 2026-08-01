import { errorFromResponse } from './api-error';

/**
 * The browser's way of talking to the API.
 *
 * ★ WHY THIS EXISTS ★
 *
 * Seven components had grown their own copy of "POST some JSON with a CSRF
 * token and read the error out". Every copy repeated the same three decisions,
 * and each one was a chance to get one of them subtly wrong.
 *
 * They did. Two of them sent `content-type: application/json` on a request with
 * NO BODY, and Fastify rejects that outright:
 *
 *     Body cannot be empty when content-type is set to 'application/json'
 *
 * Which is correct of it — a request that declares it is carrying JSON and then
 * carries nothing is malformed. It broke starting two-factor enrolment, because
 * `POST /v1/auth/totp/enrol` takes no body: there is nothing to send, the server
 * generates the secret.
 *
 * The bug is trivial. The reason it survived is that the code implementing it
 * existed in seven places, so nobody reading any one of them saw a pattern. One
 * helper, one set of decisions, one place to fix the next thing we get wrong.
 */

/** Methods that change something, and therefore need a CSRF token. */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Reads the CSRF cookie.
 *
 * Deliberately readable by JavaScript — that IS the mechanism. The cookie is
 * echoed back in a header, and an attacker on another origin can cause the
 * cookie to be SENT but cannot read it to build the header.
 *
 * Both spellings are checked: the `__Host-` prefix is only valid over https, so
 * the name differs between localhost and production.
 */
function readCsrf(): string {
  const jar = document.cookie.split('; ');
  for (const name of ['__Host-gs_csrf', 'gs_csrf']) {
    const hit = jar.find((c) => c.startsWith(`${name}=`));
    if (hit !== undefined) return decodeURIComponent(hit.slice(name.length + 1));
  }
  return '';
}

/** The refresh endpoint itself. Retrying a failed refresh with a refresh would recurse. */
const REFRESH_PATH = '/v1/auth/refresh';

function isRefreshCall(path: string): boolean {
  return path.startsWith(REFRESH_PATH);
}

/**
 * Renews the access cookie from the refresh cookie. True when it worked.
 *
 * ★ IN FLIGHT ONLY ONCE ★
 *
 * A page that fires several requests at load — and several of ours do — would otherwise send one
 * refresh per request the moment the token ages out. The refresh endpoint rotates the token family,
 * so concurrent refreshes race: the second one presents a token the first has already consumed,
 * which reads as a stolen-token replay and can invalidate the whole family. Sharing one promise
 * means the burst produces exactly one refresh and everybody waits on it.
 */
let refreshInFlight: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(REFRESH_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        // CSRF applies to the refresh too — without the header the API refuses it.
        headers: { 'x-csrf-token': readCsrf() },
      });
      return res.ok;
    } catch {
      // Offline, or the API is down. Neither is worth surfacing here: the original request's own
      // error is the one the member needs to see.
      return false;
    } finally {
      // Cleared so a LATER expiry can refresh again. Holding a resolved promise would mean one
      // refresh per page load forever.
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export interface ApiCallOptions {
  /** Sent as JSON. Omit entirely when the endpoint takes no body. */
  readonly body?: unknown;
  /**
   * Sent AS IS, with `contentType`.
   *
   * ★ WHY IMAGE UPLOADS COME THROUGH HERE RATHER THAN CALLING fetch ★
   *
   * The upload route posts the file as the request body with an image content type — no multipart,
   * no form fields (see the note in main.ts). That used to mean a bare `fetch` at each call site,
   * which quietly skipped the two things this function exists for: the CSRF header, and the
   * refresh-and-retry that a 401 needs. An upload that failed because the access token had aged out
   * simply failed, and the member saw "that did not go through" on a perfectly good file.
   */
  readonly rawBody?: Blob;
  readonly contentType?: string;
  /** Shown if the server does not supply a better one. */
  readonly fallbackMessage?: string;
}

/**
 * Calls the API, and throws an Error carrying the server's own message.
 *
 * ★ THE CONTENT-TYPE RULE ★
 *
 * The header is set ONLY when there is a body to describe. It is not an
 * optimisation and it is not stylistic: declaring a body that does not exist is
 * a malformed request, and Fastify refuses it before any handler runs.
 */
export async function apiCall<T>(
  method: string,
  path: string,
  options: ApiCallOptions = {},
): Promise<T> {
  const upper = method.toUpperCase();
  const headers: Record<string, string> = {};

  if (options.body !== undefined) headers['content-type'] = 'application/json';
  // A raw body declares its own type. The server still decides the real format by DECODING the
  // bytes — this only selects the parser (see RAW_IMAGE_TYPES in main.ts).
  if (options.rawBody !== undefined && options.contentType !== undefined) {
    headers['content-type'] = options.contentType;
  }
  if (MUTATING.has(upper)) headers['x-csrf-token'] = readCsrf();

  const init: RequestInit = {
    method: upper,
    // same-origin, so the cookies go with it and nothing else does.
    credentials: 'same-origin',
    headers,
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  if (options.rawBody !== undefined) init.body = options.rawBody;

  let res = await fetch(path, init);

  /*
   * ★ ONE REFRESH-AND-RETRY, AND THE OUTAGE THAT PUT IT HERE ★
   *
   * 2026-07-31: a new admin could not finish two-factor enrolment in production. `enrol` returned
   * 201 and every subsequent `confirm` returned 401 in about a millisecond, with `failed_count`
   * still 0 in the database — the code was never even checked.
   *
   * The access cookie lives fifteen minutes and the browser drops it on its own. `middleware.ts`
   * silently refreshes it, but its matcher excludes `v1/`, so the refresh only ever runs on a page
   * NAVIGATION. Enrolment is the one flow that sits still for minutes without navigating: install
   * an authenticator, scan the QR, wait for a code. The token aged out in that gap, and because the
   * security page is a forced wall there was nowhere to navigate to that would have fixed it. The
   * member was permanently stuck, and retrying could never work.
   *
   * ★ WHY THIS DOES NOT CONTRADICT middleware.ts ★
   *
   * That file explains at length why refresh belongs in middleware "and not a retry on 401". Its
   * reasoning is about SERVER COMPONENTS: they cannot set a cookie during render, so a retry there
   * would fetch a new token and have nowhere to put it.
   *
   * This file runs in the BROWSER, where that constraint does not exist — the browser stores
   * `Set-Cookie` from the refresh response itself, automatically. Middleware still covers
   * navigations; this covers the XHR gap it structurally cannot reach.
   *
   * Exactly once. A loop here would turn a genuinely signed-out member into a request storm against
   * our own auth endpoint.
   */
  if (res.status === 401 && !isRefreshCall(path)) {
    if (await tryRefresh()) {
      // The CSRF cookie is rotated by the refresh, so the header must be rebuilt from the NEW
      // cookie. Replaying the old token would turn a 401 into a 403 and look like a different bug.
      if (MUTATING.has(upper)) headers['x-csrf-token'] = readCsrf();
      res = await fetch(path, { ...init, headers });
    }
  }

  if (!res.ok) {
    // The API answers with an ENVELOPE — { error: { message } }. Reading
    // `json.message` off the top level always yields undefined and throws away
    // the real reason, which is a mistake this codebase has already made once.
    throw new Error((await errorFromResponse(res, options.fallbackMessage)).message);
  }

  // 204, or a body that is not JSON. Callers expecting nothing get an empty
  // object rather than a parse error.
  return (await res.json().catch(() => ({}))) as T;
}

/**
 * A browser-side GET.
 *
 * Server components read through `lib/api.ts` instead; this is for the cases where a page fetches
 * AFTER it has rendered — expanding one conversation out of a hundred, rather than sending all of
 * them down with the page.
 */
export const apiGet = <T>(path: string, fallbackMessage?: string): Promise<T> =>
  apiCall<T>('GET', path, { ...(fallbackMessage !== undefined && { fallbackMessage }) });

export const apiPost = <T>(path: string, body?: unknown, fallbackMessage?: string): Promise<T> =>
  apiCall<T>('POST', path, { ...(body !== undefined && { body }), ...(fallbackMessage !== undefined && { fallbackMessage }) });

export const apiPut = <T>(path: string, body?: unknown): Promise<T> =>
  apiCall<T>('PUT', path, { ...(body !== undefined && { body }) });

export const apiPatch = <T>(path: string, body?: unknown): Promise<T> =>
  apiCall<T>('PATCH', path, { ...(body !== undefined && { body }) });

export const apiDelete = <T>(path: string, body?: unknown): Promise<T> =>
  apiCall<T>('DELETE', path, { ...(body !== undefined && { body }) });
