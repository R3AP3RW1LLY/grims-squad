import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  type IDiscordIdentityProvider,
  type DiscordGuildMember,
  DISCORD_SCOPE_STRING,
} from '@grims/ed-clients';
import { AppError, ErrorCode, safeRedirectPath } from '@grims/shared';
import type { TokenCipher } from '@grims/shared/server';
import type { IIdentityStore } from './identity.store.js';

/**
 * P1.1 — Discord OAuth login.
 *
 * Discord is the ONLY identity provider (ADR-004). There is no password to
 * forget, phish or breach, and guild membership is the membership check itself.
 *
 * Three things here are security-load-bearing rather than incidental:
 *
 *  · State is signed AND bound to a nonce cookie. Signing alone stops tampering
 *    but not login CSRF — an attacker can mint a perfectly valid state of their
 *    own and hand the victim the resulting callback link, silently logging the
 *    victim in as the attacker. Binding to a cookie the attacker cannot set on
 *    our origin is what closes that.
 *
 *  · The membership gate runs BEFORE any write. A refused login must leave no
 *    trace: no user row, no identity row, nothing to clean up.
 *
 *  · A Discord error is never read as "not a member". The two are one HTTP
 *    status apart and mean opposite things — one refuses a login, the other
 *    must not be allowed to silently strip every officer's roles during an
 *    outage.
 */

export interface DiscordAuthConfig {
  readonly guildId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly stateSecret: string;
}

export interface BeginLoginResult {
  readonly url: string;
  readonly state: string;
  /** Set as a short-lived __Host- cookie by the controller; never logged. */
  readonly nonce: string;
}

export interface CompleteLoginInput {
  readonly code: string;
  readonly state: string;
  readonly nonce: string;
}

export interface CompleteLoginResult {
  readonly userId: string;
  readonly discordUserId: string;
  readonly isNewUser: boolean;
  readonly redirectTo: string;
}

interface StatePayload {
  /** SHA-256 of the nonce cookie value. The raw nonce never leaves the browser. */
  readonly n: string;
  /** Already-sanitised redirect path. */
  readonly r: string;
  /** Expiry, epoch ms. */
  readonly e: number;
  /** Unique id, so a completed state cannot be replayed. */
  readonly j: string;
}

const STATE_TTL_MS = 10 * 60_000;

/** Token ciphertexts are bound to (purpose, discord user id). See TokenCipher. */
const CTX_ACCESS = (discordUserId: string) => `discord.access:${discordUserId}`;
const CTX_REFRESH = (discordUserId: string) => `discord.refresh:${discordUserId}`;

/**
 * Deliberately NOT `@Injectable()`. This is constructed by a factory in
 * AuthModule, and its constructor takes INTERFACES — which erase to nothing at
 * runtime and so have no DI token. Decorating it makes Nest attempt to resolve
 * them and fail at boot with a message about an argument named `r`.
 */
export class DiscordAuthService {
  /**
   * Consumed state ids, so a callback URL cannot be replayed.
   *
   * IN-PROCESS, and therefore correct only for a single API instance. Before we
   * run more than one, this must move to Redis with the same TTL — otherwise a
   * replayed callback simply lands on the other instance and succeeds. Recorded
   * here rather than in a ticket because the failure is invisible in testing and
   * only appears the day we scale out.
   */
  #consumed = new Map<string, number>();

  constructor(
    private readonly discord: IDiscordIdentityProvider,
    private readonly store: IIdentityStore,
    private readonly cipher: TokenCipher,
    private readonly config: DiscordAuthConfig,
  ) {}

  // ------------------------------------------------------------------ step 1
  beginLogin(redirect: unknown, nowMs: number = Date.now()): BeginLoginResult {
    const nonce = randomBytes(32).toString('base64url');
    const payload: StatePayload = {
      n: sha256(nonce),
      // Sanitised at MINT time, so a hostile value never survives inside a
      // signed token that we would later be tempted to trust.
      r: safeRedirectPath(redirect),
      e: nowMs + STATE_TTL_MS,
      j: randomBytes(16).toString('base64url'),
    };
    const state = this.#sign(payload);

    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('scope', DISCORD_SCOPE_STRING);
    url.searchParams.set('state', state);
    // Skip the consent screen for a member who has already authorised us.
    url.searchParams.set('prompt', 'none');

    return { url: url.toString(), state, nonce };
  }

  /** Verifies and reads the redirect without consuming the state. */
  peekRedirect(state: string): string {
    return this.#verify(state).r;
  }

  // ------------------------------------------------------------------ step 2
  async completeLogin(input: CompleteLoginInput): Promise<CompleteLoginResult> {
    const payload = this.#verify(input.state);

    if (Date.now() > payload.e) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Login attempt expired. Please try again.');
    }

    // Login-CSRF binding. Constant-time, though the value is a hash rather than
    // a secret, because the habit is worth more than the microseconds.
    if (typeof input.nonce !== 'string' || input.nonce === '') {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Login attempt could not be verified.');
    }
    if (!constantTimeEqual(sha256(input.nonce), payload.n)) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Login attempt could not be verified.');
    }

    this.#pruneConsumed();
    if (this.#consumed.has(payload.j)) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'This login link was already used (replay).');
    }
    this.#consumed.set(payload.j, payload.e);

    const tokens = await this.discord.exchangeCode(input.code, this.config.redirectUri);
    const user = await this.discord.fetchUser(tokens.accessToken);

    // --- membership gate, BEFORE any write ---------------------------------
    let member: DiscordGuildMember | null;
    try {
      member = await this.discord.fetchGuildMember(tokens.accessToken, this.config.guildId);
    } catch (cause) {
      // Discord is broken. This is NOT "not a member" — collapsing the two would
      // mean an outage silently demotes everyone.
      throw new AppError(
        ErrorCode.UPSTREAM_UNAVAILABLE,
        'Could not confirm your Discord membership right now. Please try again shortly.',
        { cause: cause instanceof Error ? cause : undefined },
      );
    }
    if (member === null) {
      throw new AppError(
        ErrorCode.DISCORD_GUILD_MEMBERSHIP_REQUIRED,
        'You must be a member of the Grim’s Squad Discord server to sign in.',
      );
    }

    const result = await this.store.upsertOnLogin({
      discordUserId: user.id,
      username: user.username,
      guildNick: member.nick,
      // Precedence: server nickname > global name > username.
      //
      // The squadron asks members to set their server nickname to their CMDR
      // name, so it is the most accurate identity we can read. Reaching for
      // globalName first pulls in whatever they use across the whole of Discord
      // — frequently their REAL NAME — and publishes it on the roster. That is a
      // privacy regression nobody asked for, and it already happened once here.
      displayName: member.nick ?? user.globalName ?? user.username,
      avatar: user.avatar,
      guildRoles: member.roles,
      guildJoinedAt: new Date(member.joinedAt),
      accessTokenEnc: this.cipher.encrypt(tokens.accessToken, CTX_ACCESS(user.id)),
      refreshTokenEnc: this.cipher.encrypt(tokens.refreshToken, CTX_REFRESH(user.id)),
      tokenExpiresAt: new Date(Date.now() + tokens.expiresInSec * 1000),
    });

    // Note what is not here: no token, encrypted or otherwise (INV-012).
    return {
      userId: result.userId,
      discordUserId: user.id,
      isNewUser: result.isNewUser,
      redirectTo: payload.r,
    };
  }

  /**
   * Decrypts a stored refresh token for a background worker.
   *
   * Throws if the ciphertext was not sealed for THIS user, which is what makes
   * copying another row's value into your own useless rather than powerful.
   */
  async getRefreshToken(userId: string): Promise<string> {
    const row = await this.store.findByUserId(userId);
    if (row === null) throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No Discord identity for that user.');
    return this.cipher.decrypt(row.refreshTokenEnc, CTX_REFRESH(row.discordUserId));
  }

  // ------------------------------------------------------------------ state
  #sign(payload: StatePayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.#mac(body)}`;
  }

  #mac(body: string): string {
    return createHmac('sha256', this.config.stateSecret).update(body).digest('base64url');
  }

  #verify(state: string): StatePayload {
    const bad = () =>
      new AppError(ErrorCode.UNAUTHENTICATED, 'Login attempt could not be verified.');

    if (typeof state !== 'string') throw bad();
    const idx = state.lastIndexOf('.');
    if (idx <= 0) throw bad();

    const body = state.slice(0, idx);
    const sig = state.slice(idx + 1);
    // MAC is checked before the payload is parsed: never deserialise something
    // whose integrity is still unproven.
    if (!constantTimeEqual(sig, this.#mac(body))) throw bad();

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      throw bad();
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as StatePayload).n !== 'string' ||
      typeof (parsed as StatePayload).r !== 'string' ||
      typeof (parsed as StatePayload).e !== 'number' ||
      typeof (parsed as StatePayload).j !== 'string'
    ) {
      throw bad();
    }
    const p = parsed as StatePayload;
    // Belt and braces: even a correctly-signed state gets its redirect
    // re-sanitised, so a bug that ever let one be minted cannot be exploited.
    return { ...p, r: safeRedirectPath(p.r) };
  }

  #pruneConsumed(): void {
    const now = Date.now();
    for (const [j, exp] of this.#consumed) if (exp < now) this.#consumed.delete(j);
  }
}

const sha256 = (v: string): string => createHash('sha256').update(v).digest('base64url');

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
