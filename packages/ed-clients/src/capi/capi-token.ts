/**
 * Trading a callback code for tokens, and keeping them alive.
 *
 * ★ THE FAILURES ARE NOT INTERCHANGEABLE, AND THAT IS THE WHOLE DESIGN ★
 *
 * Three things can go wrong here and they call for opposite responses:
 *
 *   network       Frontier is unreachable. Try again shortly; nothing is wrong with the member.
 *   invalid_grant the refresh chain is dead. Retrying is the bug — the member must reauthorise,
 *                 and until something says so, they will not know to.
 *   rate limit    back off. Retrying immediately makes it worse and can extend the ban.
 *
 * A caller that catches all three as "no data this cycle" produces exactly the outage this platform
 * has already suffered through a different door: contributions stop, every individual cycle looks
 * unremarkable, and the member's last known state goes on being presented as current. So every
 * failure carries its kind and whether it is worth retrying, and the caller is made to choose.
 */

export type CapiFailure = 'network' | 'invalid_grant' | 'rate_limited' | 'malformed' | 'refused';

export class CapiAuthError extends Error {
  readonly kind: CapiFailure;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(kind: CapiFailure, message: string, status: number | null = null) {
    super(message);
    this.name = 'CapiAuthError';
    this.kind = kind;
    /*
     * Retryability is a property of the KIND, decided once here, so no caller has to remember which
     * of these is worth trying again. `invalid_grant` is the one that must never be retried: past
     * Frontier's ceiling it is the permanent answer, and a loop around it is a member silently
     * disconnected for ever.
     */
    this.retryable = kind === 'network' || kind === 'rate_limited';
    this.status = status;
  }
}

export interface CapiTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** An INSTANT, resolved from Frontier's `expires_in` seconds. See below. */
  readonly expiresAt: Date;
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  error?: unknown;
}

const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

/**
 * One place that turns any outcome into either tokens or a typed failure.
 *
 * `expires_in` is seconds from NOW, and it is resolved to an instant here rather than stored raw:
 * keeping the duration means every later comparison has to remember when "now" was, which is the
 * difference between a token refreshed on time and one refreshed whenever its row was last read.
 */
async function post(
  url: string,
  body: URLSearchParams,
  fetchImpl: typeof fetch,
  now: Date,
  fallbackRefresh: string | null,
): Promise<CapiTokens> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: FORM, body: body.toString() });
  } catch (e) {
    throw new CapiAuthError('network', `could not reach Frontier: ${(e as Error).message}`);
  }

  let json: TokenResponse;
  try {
    json = (await res.json()) as TokenResponse;
  } catch {
    throw new CapiAuthError('malformed', 'Frontier returned something that was not JSON', res.status);
  }

  if (!res.ok || typeof json.error === 'string') {
    const error = typeof json.error === 'string' ? json.error : `http ${res.status}`;

    if (error === 'invalid_grant') {
      throw new CapiAuthError(
        'invalid_grant',
        'Frontier refused the grant — the member must authorise again',
        res.status,
      );
    }
    if (res.status === 429 || error === 'slow_down') {
      throw new CapiAuthError('rate_limited', 'Frontier is rate limiting us', res.status);
    }
    throw new CapiAuthError('refused', `Frontier refused: ${error}`, res.status);
  }

  const accessToken = typeof json.access_token === 'string' ? json.access_token : '';
  if (accessToken === '') {
    /*
     * A 200 carrying no token would otherwise be stored as `undefined` and read later as "linked
     * but broken" — the worst state there is, because nothing prompts the member to fix what
     * nothing reports as wrong.
     */
    throw new CapiAuthError('malformed', 'Frontier returned no access token', res.status);
  }

  /*
   * Frontier ROTATES the refresh token on use. Keeping the old one means the next refresh presents
   * a spent token and fails as invalid_grant — a member disconnected about one access-token
   * lifetime after linking, for no reason anybody could see. When the response omits one, the
   * current token is still valid and is carried forward rather than discarded.
   */
  const refreshToken =
    typeof json.refresh_token === 'string' && json.refresh_token !== ''
      ? json.refresh_token
      : (fallbackRefresh ?? '');

  if (refreshToken === '') {
    throw new CapiAuthError('malformed', 'Frontier returned no refresh token', res.status);
  }

  const seconds = typeof json.expires_in === 'number' ? json.expires_in : 0;
  const expiresAt = new Date(now.getTime() + seconds * 1000);

  return { accessToken, refreshToken, expiresAt };
}

export interface ExchangeInput {
  readonly authBase: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly code: string;
  readonly verifier: string;
  readonly clientSecret?: string | undefined;
  readonly now?: Date | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

/** The callback code, traded for tokens. One use only — Frontier refuses a second attempt. */
export async function exchangeCode(input: ExchangeInput): Promise<CapiTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: input.clientId,
    code: input.code,
    redirect_uri: input.redirectUri,
    // Without this PKCE is decoration: a flow that omits it still completes against a server that
    // does not enforce it, and nothing anywhere reports the protection was never applied.
    code_verifier: input.verifier,
  });
  if (input.clientSecret !== undefined && input.clientSecret !== '') {
    body.set('client_secret', input.clientSecret);
  }

  return post(
    new URL('/token', input.authBase).toString(),
    body,
    input.fetchImpl ?? fetch,
    input.now ?? new Date(),
    null,
  );
}

export interface RefreshInput {
  readonly authBase: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly refreshToken: string;
  readonly clientSecret?: string | undefined;
  readonly now?: Date | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

/** A new access token, and whatever refresh token Frontier wants us to hold next. */
export async function refreshAccess(input: RefreshInput): Promise<CapiTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: input.clientId,
    refresh_token: input.refreshToken,
  });
  if (input.clientSecret !== undefined && input.clientSecret !== '') {
    body.set('client_secret', input.clientSecret);
  }

  return post(
    new URL('/token', input.authBase).toString(),
    body,
    input.fetchImpl ?? fetch,
    input.now ?? new Date(),
    input.refreshToken,
  );
}
