import {
  type IDiscordIdentityProvider,
  type DiscordTokenSet,
  type DiscordUser,
  type DiscordGuildMember,
  type DiscordGuildMemberSummary,
  type DiscordGuildRole,
  DISCORD_SCOPE_STRING,
  DiscordApiError,
} from './types.js';
import { assertNotDestructive, assertRoleGrantAllowed } from './guard.js';

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
/** Discord's documented ceiling for this endpoint. */
const MEMBER_PAGE_SIZE = 1000;
/** 100k members. A guild of 108 will never reach this; a pagination bug would. */
const MAX_MEMBER_PAGES = 100;

export interface DiscordAdapterConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Needed only for guild writes (adding a member, applying a role). */
  readonly botToken: string;
  /**
   * The ONLY role ids this adapter may ever grant. The bot sits above every
   * leadership role in the live guild, so Discord's own hierarchy check will
   * not stop it handing out Galactic Admiral — this ceiling is ours.
   */
  readonly grantableRoleIds?: readonly string[];
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

  /**
   * Adds a user to the guild with roles pre-applied, using THEIR access token
   * (scope `guilds.join`) plus the bot's own authority. Requires the bot to hold
   * CREATE_INSTANT_INVITE, and its role to sit above every role being applied.
   *
   * 201 = added. 204 = they were already a member and nothing changed — which is
   * a success, not a failure, and treating it otherwise shows an error to
   * someone whose join worked.
   */
  async addGuildMember(
    guildId: string,
    userId: string,
    userAccessToken: string,
    roles: readonly string[],
  ): Promise<void> {
    for (const r of roles) assertRoleGrantAllowed(r, this.config.grantableRoleIds ?? []);
    const res = await this.#fetch(`${API}/guilds/${guildId}/members/${userId}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bot ${this.config.botToken}`,
      },
      body: JSON.stringify({ access_token: userAccessToken, roles: [...roles] }),
    });
    if (res.status !== 201 && res.status !== 204) throw await this.#toError(res);
  }

  /**
   * Every member of the guild, following Discord's `after` cursor.
   *
   * Requires the SERVER MEMBERS privileged intent. WITHOUT it Discord answers
   * 200 with an empty array rather than an error — which is why the reconciler
   * refuses to act on an empty list. A silent empty page here is far more
   * likely to be a missing intent than a deserted server.
   *
   * A read, so the destructive guard permits it. Capped so a pagination bug
   * cannot spin forever against the API.
   */
  async listGuildMembers(guildId: string): Promise<DiscordGuildMemberSummary[]> {
    const out: DiscordGuildMemberSummary[] = [];
    let after = '0';

    for (let page = 0; page < MAX_MEMBER_PAGES; page += 1) {
      const res = await this.#fetch(
        `${API}/guilds/${guildId}/members?limit=${MEMBER_PAGE_SIZE}&after=${after}`,
        { headers: { authorization: `Bot ${this.config.botToken}` } },
      );
      if (!res.ok) throw await this.#toError(res);

      const batch = (await res.json()) as Array<{
        user?: { id?: string };
        roles?: string[];
        nick?: string | null;
      }>;
      if (batch.length === 0) break;

      for (const m of batch) {
        const id = m.user?.id;
        // A member object with no user is a bot-scoped payload or a partial.
        // Skipping is right: we cannot key it to an account either way.
        if (typeof id !== 'string') continue;
        out.push({ discordId: id, roles: m.roles ?? [], nick: m.nick ?? null });
      }

      // Snowflakes are monotonic, so the highest id on the page is the cursor.
      const last = batch[batch.length - 1]?.user?.id;
      if (typeof last !== 'string') break;
      after = last;
      if (batch.length < MEMBER_PAGE_SIZE) break;
    }

    return out;
  }

  /**
   * Every role in the guild, with its colour.
   *
   * ★ THE COLOUR IS AN INTEGER, AND 0 MEANS "NO COLOUR" ★
   *
   * Discord stores a role colour as a 24-bit integer, and zero is not black —
   * it is the sentinel for "this role has no colour set", in which case the
   * member's name takes the colour of the next role down that does have one.
   *
   * Rendering 0 as #000000 would paint every uncoloured role invisible against
   * a dark background, which is both wrong and the kind of wrong that looks
   * like a CSS bug.
   */
  async listGuildRoles(guildId: string): Promise<DiscordGuildRole[]> {
    const res = await this.#fetch(`${API}/guilds/${guildId}/roles`, {
      headers: { authorization: `Bot ${this.config.botToken}` },
    });
    if (!res.ok) throw await this.#toError(res);

    const roles = (await res.json()) as Array<{
      id?: string;
      name?: string;
      color?: number;
      position?: number;
    }>;

    return roles
      .filter((r): r is { id: string; name: string; color?: number; position?: number } =>
        typeof r.id === 'string' && typeof r.name === 'string',
      )
      .map((r) => ({
        id: r.id,
        name: r.name,
        colour:
          typeof r.color === 'number' && r.color > 0
            ? `#${r.color.toString(16).padStart(6, '0')}`
            : null,
        position: typeof r.position === 'number' ? r.position : 0,
      }));
  }

  async addRoleToMember(guildId: string, userId: string, roleId: string): Promise<void> {
    assertRoleGrantAllowed(roleId, this.config.grantableRoleIds ?? []);
    const res = await this.#fetch(`${API}/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
      method: 'PUT',
      headers: { authorization: `Bot ${this.config.botToken}` },
    });
    if (!res.ok && res.status !== 204) throw await this.#toError(res);
  }

  /**
   * Removes ONE role from a member.
   *
   * Subject to the same grantable ceiling as adding: a method that can strip
   * any role is as dangerous as one that can grant any role — arguably more so,
   * since it can demote every officer in the guild in a loop.
   *
   * Path is /guilds/{g}/members/{u}/roles/{r}, which the destructive guard
   * permits. The rules it DOES block are guild-level role management
   * (/guilds/{g}/roles) and member deletion (DELETE /guilds/{g}/members/{u});
   * neither pattern matches this one, and that distinction is deliberate rather
   * than an oversight — assigning a role is routine, restructuring the guild is
   * not.
   *
   * 404 is treated as success: the member does not have the role, which is the
   * state the caller asked for.
   */
  async removeRoleFromMember(guildId: string, userId: string, roleId: string): Promise<void> {
    assertRoleGrantAllowed(roleId, this.config.grantableRoleIds ?? []);
    const res = await this.#fetch(`${API}/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
      method: 'DELETE',
      headers: { authorization: `Bot ${this.config.botToken}` },
    });
    if (!res.ok && res.status !== 204 && res.status !== 404) throw await this.#toError(res);
  }

  /**
   * Sets a member's guild nickname.
   *
   * ★ THREE THINGS DISCORD WILL REFUSE, AND ONE IT WILL TRUNCATE ★
   *
   * 1. The GUILD OWNER can never be renamed by a bot. Not a permissions
   *    problem and not fixable — Discord forbids it outright, and the owner is
   *    exactly the sort of person who will notice their name did not change and
   *    report it as a bug.
   * 2. A member whose highest role sits ABOVE the bot's own is untouchable.
   * 3. Without MANAGE_NICKNAMES it is a flat 403.
   *
   * And a nickname over 32 characters is rejected, so it is truncated here
   * rather than failing — a commander with a long name should get a shortened
   * nickname, not no nickname and an error.
   *
   * Returns a RESULT rather than throwing on refusal. Every one of the cases
   * above is an ordinary fact about the guild, not an exception, and the caller
   * (a login handler) must not be broken by any of them.
   */
  async setMemberNickname(
    guildId: string,
    userId: string,
    nickname: string,
  ): Promise<{ ok: boolean; reason: string | null }> {
    // Discord's ceiling. Truncating beats failing: a shortened nickname is
    // still the right person, and no nickname at all is a support question.
    const nick = nickname.trim().slice(0, 32);

    const res = await this.#fetch(`${API}/guilds/${guildId}/members/${userId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bot ${this.config.botToken}`,
      },
      body: JSON.stringify({ nick }),
    });

    if (res.ok || res.status === 204) return { ok: true, reason: null };

    // Read and DISCARD the body, as everywhere else in this adapter: Discord
    // echoes request parameters in some error payloads (INV-012).
    await res.text().catch(() => '');

    if (res.status === 403) {
      return {
        ok: false,
        reason:
          'Discord refused: the member is the server owner, outranks the bot, or the bot lacks Manage Nicknames.',
      };
    }
    if (res.status === 429) return { ok: false, reason: 'Rate limited by Discord.' };
    return { ok: false, reason: `Discord returned ${res.status}.` };
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
    // EVERY call funnels through here, so the guard cannot be bypassed by a new
    // method being added later that forgets to check. That is the whole reason
    // it lives at this layer rather than in each caller.
    assertNotDestructive({
      method: init.method ?? 'GET',
      path: url.startsWith(API) ? url.slice(API.length) : url,
    });

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
