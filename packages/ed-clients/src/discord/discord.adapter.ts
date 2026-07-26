import {
  type IDiscordIdentityProvider,
  type DiscordTokenSet,
  type DiscordUser,
  type DiscordGuildMember,
  DISCORD_SCOPE_STRING,
  DiscordApiError,
} from './types.js';

/**
 * The real Discord adapter.
 *
 * @unverified — every test in P1.1 runs against `DiscordFake`. This file has
 * never been executed against Discord, because no application credentials exist
 * yet. It stays tagged until one live round-trip is recorded in STATUS.md.
 * A fake proves the abstraction; only the real API proves the contract.
 *
 * Uses `fetch` directly rather than an SDK: this is four endpoints, and a
 * dependency that wraps four endpoints is four endpoints plus a supply-chain
 * surface and an upgrade treadmill.
 */

const API = 'https://discord.com/api/v10';
const DEFAULT_TIMEOUT_MS = 8_000;

export interface DiscordAdapterConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly timeoutMs?: number;
}

export class DiscordAdapter implements IDiscordIdentityProvider {
  constructor(private readonly config: DiscordAdapterConfig) {}

  async exchangeCode(code: string, redirectUri: string): Promise<DiscordTokenSet> {
    return this.#token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });
  }

  async refresh(refreshToken: string): Promise<DiscordTokenSet> {
    return this.#token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async fetchUser(accessToken: string): Promise<DiscordUser> {
    const j = await this.#get<{
      id: string;
      username: string;
      global_name?: string | null;
      avatar?: string | null;
    }>('/users/@me', accessToken);
    return {
      id: j.id,
      username: j.username,
      globalName: j.global_name ?? null,
      avatar: j.avatar ?? null,
    };
  }

  async fetchGuildMember(
    accessToken: string,
    guildId: string,
  ): Promise<DiscordGuildMember | null> {
    const res = await this.#raw(`/users/@me/guilds/${guildId}/member`, accessToken);

    // 404 is the documented answer for "not a member of that guild". It is an
    // expected outcome and is returned as null, NEVER thrown — the caller must
    // be able to tell it apart from Discord being down without string-matching.
    if (res.status === 404) return null;
    if (!res.ok) throw await this.#toError(res);

    const j = (await res.json()) as {
      roles?: string[];
      nick?: string | null;
      joined_at?: string;
    };
    if (typeof j.joined_at !== 'string') {
      // Tenure rank is computed from this field (INV-047). Defaulting it to
      // "now" would silently reset a founding member to zero tenure, so we fail
      // instead and let the login error rather than quietly lie about rank.
      throw new DiscordApiError('Guild member payload had no joined_at.', 502, false);
    }
    return { roles: j.roles ?? [], nick: j.nick ?? null, joinedAt: j.joined_at };
  }

  // ------------------------------------------------------------------ private
  async #token(params: Record<string, string>): Promise<DiscordTokenSet> {
    const body = new URLSearchParams({ ...params, scope: DISCORD_SCOPE_STRING });
    const res = await this.#fetch(`${API}/oauth2/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        // Client credentials go in the Authorization header, never the body —
        // bodies end up in proxy logs and error reports far more often.
        authorization: `Basic ${Buffer.from(
          `${this.config.clientId}:${this.config.clientSecret}`,
        ).toString('base64')}`,
      },
      body,
    });
    if (!res.ok) throw await this.#toError(res);

    const j = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
    };
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiresInSec: j.expires_in,
      scope: j.scope,
    };
  }

  async #get<T>(path: string, accessToken: string): Promise<T> {
    const res = await this.#raw(path, accessToken);
    if (!res.ok) throw await this.#toError(res);
    return (await res.json()) as T;
  }

  #raw(path: string, accessToken: string): Promise<Response> {
    return this.#fetch(`${API}${path}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  }

  async #fetch(url: string, init: RequestInit): Promise<Response> {
    // An unbounded upstream call is an unbounded request on our side too.
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: ac.signal });
    } catch (cause) {
      throw new DiscordApiError(
        ac.signal.aborted ? 'Discord request timed out.' : 'Discord request failed.',
        504,
        true,
        { cause },
      );
    } finally {
      clearTimeout(t);
    }
  }

  async #toError(res: Response): Promise<DiscordApiError> {
    // The body is read and DISCARDED. Discord echoes request parameters in some
    // error payloads, which for the token endpoint can include the code or the
    // refresh token — putting that into an exception message would put it into
    // logs and error reports, breaking INV-012 by the back door.
    await res.text().catch(() => '');
    return new DiscordApiError(
      `Discord returned ${res.status}.`,
      res.status,
      res.status === 429 || res.status >= 500,
    );
  }
}
