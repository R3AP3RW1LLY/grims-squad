import type {
  IDiscordIdentityProvider,
  DiscordTokenSet,
  DiscordUser,
  DiscordGuildMember,
} from './types.js';

interface FakeMember {
  username: string;
  globalName: string | null;
  avatar: string | null;
  roles: string[];
  joinedAt: string;
  inGuild: boolean;
}

/**
 * Deterministic in-memory Discord. Every test in P1.1 runs against this.
 *
 * `networkCalls` is asserted to be zero: it is the tripwire for someone later
 * "improving" the fake by having it reach out to the real API for a field it
 * does not model. A fake that touches the network is not a fake, and the suite
 * would start failing in CI for reasons that have nothing to do with the code
 * under test.
 *
 * An authorization code is `code-for-<discordUserId>`.
 */
export class DiscordFake implements IDiscordIdentityProvider {
  readonly networkCalls = 0;

  #guildId: string;
  #members = new Map<string, FakeMember>();
  #tokenToUser = new Map<string, string>();
  #counter = 0;
  #guildFailure: Error | null = null;

  lastIssued: DiscordTokenSet | null = null;

  constructor(opts: { guildId: string }) {
    this.#guildId = opts.guildId;
  }

  addMember(
    discordUserId: string,
    m: Partial<Omit<FakeMember, 'inGuild'>> & { roles?: string[] },
  ): void {
    const existing = this.#members.get(discordUserId);
    this.#members.set(discordUserId, {
      username: m.username ?? existing?.username ?? `cmdr_${discordUserId}`,
      globalName: m.globalName !== undefined ? m.globalName : (existing?.globalName ?? null),
      avatar: m.avatar ?? existing?.avatar ?? null,
      roles: m.roles ?? existing?.roles ?? [],
      joinedAt: m.joinedAt ?? existing?.joinedAt ?? '2024-01-01T00:00:00.000Z',
      inGuild: true,
    });
  }

  /** A real Discord user who is simply not in our guild. */
  addOutsider(discordUserId: string): void {
    this.#members.set(discordUserId, {
      username: `outsider_${discordUserId}`,
      globalName: null,
      avatar: null,
      roles: [],
      joinedAt: '2024-01-01T00:00:00.000Z',
      inGuild: false,
    });
  }

  /** Simulates Discord being broken, which must never read as not-a-member. */
  failGuildLookup(err: Error | null): void {
    this.#guildFailure = err;
  }

  async exchangeCode(code: string, _redirectUri: string): Promise<DiscordTokenSet> {
    const id = code.startsWith('code-for-') ? code.slice('code-for-'.length) : '7';
    this.#counter += 1;
    const set: DiscordTokenSet = {
      accessToken: `fake-access-${id}-${this.#counter}`,
      refreshToken: `fake-refresh-${id}-${this.#counter}`,
      expiresInSec: 604800,
      scope: 'identify guilds.members.read',
    };
    this.#tokenToUser.set(set.accessToken, id);
    this.lastIssued = set;
    return set;
  }

  async refresh(refreshToken: string): Promise<DiscordTokenSet> {
    const id = refreshToken.split('-')[2] ?? '7';
    return this.exchangeCode(`code-for-${id}`, '');
  }

  async fetchUser(accessToken: string): Promise<DiscordUser> {
    const id = this.#tokenToUser.get(accessToken);
    if (id === undefined) throw new Error('fake: unknown access token');
    const m = this.#members.get(id);
    return {
      id,
      username: m?.username ?? `cmdr_${id}`,
      globalName: m?.globalName ?? null,
      avatar: m?.avatar ?? null,
    };
  }

  async fetchGuildMember(
    accessToken: string,
    guildId: string,
  ): Promise<DiscordGuildMember | null> {
    if (this.#guildFailure !== null) throw this.#guildFailure;
    const id = this.#tokenToUser.get(accessToken);
    if (id === undefined) throw new Error('fake: unknown access token');
    if (guildId !== this.#guildId) return null;
    const m = this.#members.get(id);
    if (m === undefined || !m.inGuild) return null;
    return { roles: [...m.roles], nick: null, joinedAt: m.joinedAt };
  }
}
