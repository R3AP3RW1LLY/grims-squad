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

export interface ApiCallOptions {
  /** Sent as JSON. Omit entirely when the endpoint takes no body. */
  readonly body?: unknown;
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
  if (MUTATING.has(upper)) headers['x-csrf-token'] = readCsrf();

  const init: RequestInit = {
    method: upper,
    // same-origin, so the cookies go with it and nothing else does.
    credentials: 'same-origin',
    headers,
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);

  const res = await fetch(path, init);
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

export const apiPost = <T>(path: string, body?: unknown, fallbackMessage?: string): Promise<T> =>
  apiCall<T>('POST', path, { ...(body !== undefined && { body }), ...(fallbackMessage !== undefined && { fallbackMessage }) });

export const apiPut = <T>(path: string, body?: unknown): Promise<T> =>
  apiCall<T>('PUT', path, { ...(body !== undefined && { body }) });

export const apiPatch = <T>(path: string, body?: unknown): Promise<T> =>
  apiCall<T>('PATCH', path, { ...(body !== undefined && { body }) });

export const apiDelete = <T>(path: string, body?: unknown): Promise<T> =>
  apiCall<T>('DELETE', path, { ...(body !== undefined && { body }) });
