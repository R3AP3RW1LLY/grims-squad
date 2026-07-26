import { Injectable } from '@nestjs/common';
import { PrismaClient, Prisma } from '@grims/db';
import type {
  IIdentityStore,
  IdentityUpsertInput,
  IdentityUpsertResult,
  StoredIdentity,
} from './identity.store.js';

/**
 * Prisma-backed identity store.
 *
 * Runs the whole upsert inside ONE transaction. A login that created a `users`
 * row and then failed to create the matching `discord_identities` row would
 * leave an account nobody can ever sign into again — the next attempt finds no
 * identity, creates a second user, and the first is orphaned with whatever
 * roles or history it had.
 */
@Injectable()
export class PrismaIdentityStore implements IIdentityStore {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertOnLogin(input: IdentityUpsertInput): Promise<IdentityUpsertResult> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.discordIdentity.findUnique({
        where: { discordId: input.discordUserId },
        select: { userId: true },
      });

      if (existing !== null) {
        await tx.discordIdentity.update({
          where: { discordId: input.discordUserId },
          data: {
            username: input.username,
            globalName: input.displayName,
            // Replaced wholesale, never merged: a role removed in Discord must
            // disappear here on the very next login (INV-008).
            guildRoles: [...input.guildRoles],
            guildJoinedAt: input.guildJoinedAt,
            accessTokenEnc: Buffer.from(input.accessTokenEnc, 'utf8'),
            refreshTokenEnc: Buffer.from(input.refreshTokenEnc, 'utf8'),
            tokenExpiresAt: input.tokenExpiresAt,
            syncedAt: new Date(),
          },
        });
        await tx.user.update({
          where: { id: existing.userId },
          // `handle` is NOT touched. It appears in URLs and mentions, so letting
          // a Discord rename rewrite it would break every existing link and
          // every historical @mention pointing at that member.
          data: {
            displayName: input.displayName,
            avatarUrl: input.avatar,
            lastSeenAt: new Date(),
          },
        });
        return { userId: existing.userId, isNewUser: false };
      }

      const user = await tx.user.create({
        data: {
          handle: await this.#uniqueHandle(tx, input.username),
          displayName: input.displayName,
          avatarUrl: input.avatar,
          // `email` is deliberately left null: we never request the scope
          // (decision D11 built no email channel), so there is nothing to store.
          lastSeenAt: new Date(),
        },
        select: { id: true },
      });

      await tx.discordIdentity.create({
        data: {
          userId: user.id,
          discordId: input.discordUserId,
          username: input.username,
          globalName: input.displayName,
          guildRoles: [...input.guildRoles],
          guildJoinedAt: input.guildJoinedAt,
          accessTokenEnc: Buffer.from(input.accessTokenEnc, 'utf8'),
          refreshTokenEnc: Buffer.from(input.refreshTokenEnc, 'utf8'),
          tokenExpiresAt: input.tokenExpiresAt,
        },
      });

      return { userId: user.id, isNewUser: true };
    });
  }

  async findByUserId(userId: string): Promise<StoredIdentity | null> {
    const row = await this.prisma.discordIdentity.findUnique({
      where: { userId },
      select: { userId: true, discordId: true, refreshTokenEnc: true },
    });
    if (row === null || row.refreshTokenEnc === null) return null;
    return {
      userId: row.userId,
      discordUserId: row.discordId,
      refreshTokenEnc: Buffer.from(row.refreshTokenEnc).toString('utf8'),
    };
  }

  /**
   * Derives a URL-safe handle, appending a numeric suffix on collision.
   *
   * Collisions are ordinary, not exceptional: Discord usernames are unique
   * globally but our sanitisation is lossy (`Grim.Reaper` and `Grim_Reaper`
   * both become `grim_reaper`), and `handle` is citext-unique. The loop is
   * bounded, and the final fallback is random rather than sequential so a
   * pathological case cannot spin.
   */
  async #uniqueHandle(tx: Prisma.TransactionClient, username: string): Promise<string> {
    const base =
      username
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .replace(/^[-_]+/, '')
        .slice(0, 24) || 'cmdr';

    for (let i = 0; i < 20; i += 1) {
      const candidate = i === 0 ? base : `${base}${i}`;
      const taken = await tx.user.findUnique({ where: { handle: candidate }, select: { id: true } });
      if (taken === null) return candidate;
    }
    return `${base}${Math.floor(Math.random() * 1_000_000)}`;
  }
}
