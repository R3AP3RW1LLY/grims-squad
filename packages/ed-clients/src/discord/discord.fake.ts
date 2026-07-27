import type {
  IDiscordIdentityProvider,
  DiscordTokenSet,
  DiscordUser,
  DiscordGuildMember,
  DiscordGuildMemberSummary,
} from './types.js';

interface FakeMember {
  username: string;
  globalName: string | null;
  avatar: string | null;
  roles: string[];
  joinedAt: string;
  nick: string | null;
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
  readonly addedMembers: Array<{ guildId: string; userId: string; roles: string[] }> = [];
  #addFailure: Error | null = null;

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
      nick: existing?.nick ?? null,
      inGuild: true,
    });
  }

  /** Sets or clears the member SERVER PROFILE nickname. */
  setNick(discordUserId: string, nick: string | null): void {
    const m = this.#members.get(discordUserId);
    if (m !== undefined) m.nick = nick;
  }

  /** A real Discord user who is simply not in our guild. */
  addOutsider(discordUserId: string): void {
    this.#members.set(discordUserId, {
      username: `outsider_${discordUserId}`,
      globalName: null,
      avatar: null,
      roles: [],
      joinedAt: '2024-01-01T00:00:00.000Z',
      nick: null,
      inGuild: false,
    });
  }

  /** Simulates the bot lacking CREATE_INSTANT_INVITE. */
  failAddMember(err: Error | null): void {
    this.#addFailure = err;
  }

  rolesOf(discordUserId: string): string[] {
    return [...(this.#members.get(discordUserId)?.roles ?? [])];
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
    return { roles: [...m.roles], nick: m.nick, joinedAt: m.joinedAt };
  }

  async addGuildMember(
    guildId: string,
    userId: string,
    _userAccessToken: string,
    roles: readonly string[],
  ): Promise<void> {
    if (this.#addFailure !== null) throw this.#addFailure;
    this.addedMembers.push({ guildId, userId, roles: [...roles] });
    const m = this.#members.get(userId);
    if (m === undefined) {
      this.addMember(userId, { roles: [...roles] });
    } else {
      // Mirrors Discord: this REPLACES roles. The service must not call it for
      // an existing member, and this fake makes that mistake visible.
      m.roles = [...roles];
      m.inGuild = true;
    }
  }

  async removeRoleFromMember(_guildId: string, userId: string, roleId: string): Promise<void> {
    if (this.#addFailure !== null) throw this.#addFailure;
    const m = this.#members.get(userId);
    if (m === undefined) throw new Error('fake: not a member');
    m.roles = m.roles.filter((r) => r !== roleId);
  }

  async listGuildMembers(guildId: string): Promise<DiscordGuildMemberSummary[]> {
    if (this.#guildFailure !== null) throw this.#guildFailure;
    if (guildId !== this.#guildId) return [];
    return [...this.#members.entries()]
      .filter(([, m]) => m.inGuild)
      .map(([id, m]) => ({ discordId: id, roles: [...m.roles], nick: m.nick }));
  }

  async addRoleToMember(_guildId: string, userId: string, roleId: string): Promise<void> {
    if (this.#addFailure !== null) throw this.#addFailure;
    const m = this.#members.get(userId);
    if (m === undefined) throw new Error('fake: not a member');
    if (!m.roles.includes(roleId)) m.roles.push(roleId);
  }
}
