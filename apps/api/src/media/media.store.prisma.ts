import type { PrismaClient } from '@grims/db';
import type { AvatarStore } from './avatar.service.js';

export class PrismaAvatarStore implements AvatarStore {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  async readIdentity(
    userId: string,
  ): Promise<{ discordId: string; avatarHash: string | null } | null> {
    const identity = await this.#db.discordIdentity.findUnique({
      where: { userId },
      select: { discordId: true },
    });
    if (identity === null) return null;

    const user = await this.#db.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });

    // `avatarUrl` holds Discord's avatar HASH despite its name — see the note
    // on the column. The rename is not worth the migration it would cost.
    return { discordId: identity.discordId, avatarHash: user?.avatarUrl ?? null };
  }

  async recordStoredHash(userId: string, hash: string | null): Promise<void> {
    await this.#db.user.update({ where: { id: userId }, data: { avatarStoredHash: hash } });
  }

  async storedHash(userId: string): Promise<string | null> {
    const user = await this.#db.user.findUnique({
      where: { id: userId },
      select: { avatarStoredHash: true },
    });
    return user?.avatarStoredHash ?? null;
  }
}
