import { createHash, randomBytes } from 'node:crypto';

/**
 * Frontier's Companion API — the authorisation half.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "we want to pull realtime journal info for all commanders ... the primary feature must be so that
 * players that are playing on Geforce Now and cloud platforms can use the companion app like
 * everyone else"
 *
 * That is what this unlocks. A commander on GeForce Now cannot run anything beside the game — there
 * is no local journal to read, no folder to watch, no process to install. cAPI is served by
 * Frontier, so it does not care where the game is running, and it is the ONLY route by which a
 * cloud player can exist on this platform at all.
 *
 * ★ THE FLOW RUNS SERVER-SIDE, AND ONLY SERVER-SIDE ★
 *
 * The website authorises; the companion links through the website and never sees a token. A
 * distributed desktop application cannot hold a secret — anyone who installs it can read it out of
 * the binary — and Electron redirect handling needs either a loopback listener or a custom protocol
 * handler, which is more attack surface bought for nothing. One registered redirect URI, tokens
 * that never leave our server, encrypted at rest with the keyring that already protects the Inara
 * keys (INV-012).
 *
 * ★ THIS MODULE IS PURE ★
 *
 * No fetch, no database, no clock of its own — every function takes the time it should reason
 * about. The network half lives beside it. These are the decisions that are worth testing exactly,
 * and they are the ones that fail silently when they are wrong.
 */

/**
 * How long Frontier honours a refresh chain, in days.
 *
 * Not ours to choose. The schema has recorded it since the cAPI columns were written:
 * "For cAPI: verifiedAt + 25 days. Frontier refresh tokens have a hard ceiling (ADR-003)."
 * It is repeated here because this module must not import the database to know a constant, and
 * there is a test asserting the two agree.
 */
export const CAPI_REFRESH_CEILING_DAYS = 25;

/** Warn this far out. Long enough to act on before anything stops working. */
const WARN_WITHIN_DAYS = 7;

/** Refresh an access token this long before it expires, rather than after it fails. */
const REFRESH_SKEW_MS = 10 * 60_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Pkce {
  readonly verifier: string;
  readonly challenge: string;
  readonly method: 'S256';
}

/**
 * A fresh PKCE pair.
 *
 * ★ THE CHALLENGE IS THE HASH, AND GETTING THAT WRONG IS INVISIBLE ★
 *
 * Sending the verifier as the challenge produces a flow that COMPLETES. Frontier only compares what
 * we send at the end against what we sent at the start, so the happy path is identical — it simply
 * removes every protection PKCE exists to provide, and nothing anywhere reports a problem.
 *
 * Base64url without padding, per RFC 7636. 32 random bytes gives a 43-character verifier, which is
 * the specification's floor.
 */
export async function makePkce(): Promise<Pkce> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  return { verifier, challenge, method: 'S256' };
}

export interface AuthorizeInput {
  readonly authBase: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly challenge: string;
}

/**
 * Where to send the member to authorise.
 *
 * `state` is carried and must be checked on the way back: a callback that cannot be tied to a
 * request we started is a callback anybody could have caused.
 *
 * The verifier is deliberately absent. It stays on the server until the token exchange — putting it
 * in the URL would place it in the member's history, in any proxy log along the way, and in the
 * Referer header of whatever Frontier's page loads next.
 */
export function authorizeUrl(input: AuthorizeInput): string {
  const url = new URL('/auth', input.authBase);

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  /*
   * `capi` is the scope the journal, profile, market, shipyard and fleetcarrier endpoints all sit
   * behind. Without it the flow succeeds and every subsequent call is refused — an authorisation
   * that looks complete and does nothing.
   */
  url.searchParams.set('scope', 'auth capi');

  return url.toString();
}

/**
 * Should the access token be exchanged now?
 *
 * Refreshed BEFORE expiry rather than on a 401. A poller that discovers expiry by failing loses
 * that cycle, and a poller that treats a failure as "nothing new" loses it silently — which is
 * precisely how a member's data stops arriving while their page goes on looking normal.
 */
export function refreshDue(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() - now.getTime() <= REFRESH_SKEW_MS;
}

export interface TokenState {
  /** Whole days before Frontier stops honouring the refresh chain. Never negative. */
  readonly daysLeft: number;
  /** Past the ceiling: no refresh will ever succeed again. */
  readonly stale: boolean;
  /** Worth telling the member about, either because it is close or because it is over. */
  readonly warn: boolean;
  /** What to show them. Never empty. */
  readonly sentence: string;
}

/**
 * How much life is left in a member's authorisation.
 *
 * ★ THE OWNER'S CHOICE: WARN EARLY, DEGRADE HONESTLY ★
 *
 * A lapsed link that silently stops updating is the same failure as a stale needs list — the
 * platform keeps showing the last thing it knew as though it were current, and somebody acts on it.
 * So this warns a week out, while everything still works and reconnecting is a minute's work.
 *
 * Past the ceiling it reports `stale` rather than pretending a retry might help. The schema already
 * describes what that means downstream: "Read access is retained; fleet writes are revoked. Never a
 * hard kick." Their history stays; it simply stops being presented as current.
 */
export function tokenState(authorisedAt: Date, now: Date): TokenState {
  const elapsedDays = Math.floor(Math.max(0, now.getTime() - authorisedAt.getTime()) / DAY_MS);
  const daysLeft = Math.max(0, CAPI_REFRESH_CEILING_DAYS - elapsedDays);

  if (daysLeft === 0) {
    return {
      daysLeft: 0,
      stale: true,
      warn: true,
      sentence:
        'Your Frontier connection has expired — Frontier only honours it for 25 days. Reconnect to ' +
        'start sending again; nothing you have already contributed is lost.',
    };
  }

  if (daysLeft <= WARN_WITHIN_DAYS) {
    return {
      daysLeft,
      stale: false,
      warn: true,
      sentence:
        `Your Frontier connection expires in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}. ` +
        'Reconnect whenever suits — everything keeps working until then.',
    };
  }

  return {
    daysLeft,
    stale: false,
    warn: false,
    sentence: `Frontier connection active, ${daysLeft} days remaining.`,
  };
}
