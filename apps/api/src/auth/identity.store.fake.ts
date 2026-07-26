import { randomUUID } from 'node:crypto';
import type {
  IIdentityStore,
  IdentityUpsertInput,
  IdentityUpsertResult,
  StoredIdentity,
} from './identity.store.js';

export interface FakeUserRow {
  id: string;
  displayName: string;
  status: 'active';
}

export interface FakeIdentityRow {
  userId: string;
  discordUserId: string;
  username: string;
  guildNick: string | null;
  avatar: string | null;
  guildRoles: string[];
  guildJoinedAt: Date | null;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  tokenExpiresAt: Date | null;
}

/**
 * In-memory identity store for unit tests.
 *
 * Note what is deliberately ABSENT from `FakeUserRow`: any tenure or loyalty
 * rank column. Tenure is computed from `guildJoinedAt` on read (INV-047), and a
 * fake that offered a `tenureRank` field would make it far too easy to write
 * production code that expects one to exist.
 */
export class InMemoryIdentityStore implements IIdentityStore {
  readonly users: FakeUserRow[] = [];
  readonly identities: FakeIdentityRow[] = [];

  async upsertOnLogin(input: IdentityUpsertInput): Promise<IdentityUpsertResult> {
    const existing = this.identities.find((i) => i.discordUserId === input.discordUserId);

    if (existing !== undefined) {
      existing.username = input.username;
      existing.guildNick = input.guildNick;
      existing.avatar = input.avatar;
      existing.guildRoles = [...input.guildRoles];
      existing.guildJoinedAt = input.guildJoinedAt;
      existing.accessTokenEnc = input.accessTokenEnc;
      existing.refreshTokenEnc = input.refreshTokenEnc;
      existing.tokenExpiresAt = input.tokenExpiresAt;
      const user = this.users.find((u) => u.id === existing.userId);
      if (user !== undefined) user.displayName = input.displayName;
      return { userId: existing.userId, isNewUser: false };
    }

    const userId = randomUUID();
    this.users.push({ id: userId, displayName: input.displayName, status: 'active' });
    this.identities.push({
      userId,
      discordUserId: input.discordUserId,
      username: input.username,
      guildNick: input.guildNick,
      avatar: input.avatar,
      guildRoles: [...input.guildRoles],
      guildJoinedAt: input.guildJoinedAt,
      accessTokenEnc: input.accessTokenEnc,
      refreshTokenEnc: input.refreshTokenEnc,
      tokenExpiresAt: input.tokenExpiresAt,
    });
    return { userId, isNewUser: true };
  }

  async findByUserId(userId: string): Promise<StoredIdentity | null> {
    const i = this.identities.find((r) => r.userId === userId);
    return i === undefined
      ? null
      : { userId: i.userId, discordUserId: i.discordUserId, refreshTokenEnc: i.refreshTokenEnc };
  }
}
