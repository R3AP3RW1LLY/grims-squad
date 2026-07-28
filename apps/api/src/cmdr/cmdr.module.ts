import { Module } from '@nestjs/common';
import { PrismaClient, PrismaNonceStore } from '@grims/db';
import { NonceService } from '@grims/shared';
import { createKeyring, TokenCipher } from '@grims/shared/server';
import {
  DiscordAdapter,
  InaraAdapter,
  INARA_APP_NAME,
  INARA_APP_VERSION,
} from '@grims/ed-clients';
import { DatabaseModule } from '../database.module.js';
import { CmdrController } from './cmdr.controller.js';
import { CmdrService } from './cmdr.service.js';
import { PrismaCmdrStore } from './cmdr.store.prisma.js';
import { InaraLinkService } from './inara-link.service.js';
import { PrismaInaraLinkStore } from './inara-link.store.prisma.js';
import { NicknameSyncService } from './nickname-sync.service.js';
import { CMDR_SERVICE, NONCE_SERVICE, INARA_LINK } from './cmdr.tokens.js';
import { logger } from '../logging.js';

/**
 * Builds the nickname reconciler, or nothing.
 *
 * Returns undefined when the bot is not configured, and the link service then
 * skips the rename. A missing bot token must not stop a member verifying their
 * commander — the verification is the point and the nickname is cosmetic.
 */
function nicknameReconciler(prisma: PrismaClient): NicknameSyncService | undefined {
  const guildId = process.env['DISCORD_GUILD_ID'] ?? '';
  const botToken = process.env['DISCORD_BOT_TOKEN'] ?? '';
  if (guildId === '' || botToken === '') {
    logger.warn('Discord nickname sync disabled: guild id or bot token missing.');
    return undefined;
  }

  const discord = new DiscordAdapter({
    clientId: process.env['DISCORD_CLIENT_ID'] ?? '',
    clientSecret: process.env['DISCORD_CLIENT_SECRET'] ?? '',
    botToken,
    // EMPTY, deliberately. This adapter exists to rename people and must never
    // grant a role; an empty ceiling makes that structural rather than a
    // promise about how it happens to be called.
    grantableRoleIds: [],
  });

  return new NicknameSyncService({
    guildId,
    async verifiedNameFor(userId) {
      const v = await prisma.cmdrVerification.findFirst({
        where: { userId, isVerified: true, revokedAt: null },
        select: { cmdrName: true },
      });
      return v?.cmdrName ?? null;
    },
    async currentNickFor(discordId) {
      // Read from our stored identity rather than a Discord round trip. It is
      // refreshed by the OAuth callback, gateway events and the nightly
      // reconciliation, so a stale value costs one redundant rename rather than
      // an extra API call on every single check.
      const i = await prisma.discordIdentity.findUnique({
        where: { discordId },
        select: { guildNick: true },
      });
      return i?.guildNick ?? null;
    },
    setNickname: (g, d, nick) => discord.setMemberNickname(g, d, nick),
    async rememberNickname(discordId, nickname) {
      // updateMany, not update: an identity row that has since been deleted is
      // not an error worth failing a rename over.
      await prisma.discordIdentity.updateMany({
        where: { discordId },
        data: { guildNick: nickname },
      });
    },
    async writeAudit(entry) {
      await prisma.auditLog.create({
        data: {
          actorId: null,
          actorType: 'system',
          action: String(entry['action']),
          targetType: String(entry['targetType']),
          targetId: String(entry['targetId']),
          before: entry['before'] as never,
          after: entry['after'] as never,
        },
      });
    },
  });
}

@Module({
  imports: [DatabaseModule],
  controllers: [CmdrController],
  providers: [
    {
      provide: CMDR_SERVICE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new CmdrService(new PrismaCmdrStore(db)),
    },
    {
      provide: NONCE_SERVICE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new NonceService(new PrismaNonceStore(db)),
    },
    {
      provide: INARA_LINK,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient): InaraLinkService => {
        const keyring = process.env['TOKEN_ENCRYPTION_KEYRING'] ?? '';
        if (keyring === '') {
          // INV-012 has no degraded mode. Refusing to construct is better than
          // storing a member's Inara credential in plaintext — and it fails at
          // BOOT, where it is obvious, rather than on the first member who
          // tries to link a key.
          throw new Error(
            'TOKEN_ENCRYPTION_KEYRING is required: an Inara API key must not be stored unencrypted.',
          );
        }

        return new InaraLinkService(
          new PrismaInaraLinkStore(db, new TokenCipher(createKeyring(keyring))),
          // The adapter's OWN key is irrelevant to verification: every check
          // runs with the MEMBER's key, which is exactly what makes the
          // returned name proof rather than a claim.
          new InaraAdapter({
            appName: INARA_APP_NAME,
            appVersion: INARA_APP_VERSION,
            apiKey: process.env['INARA_API_KEY'] ?? '',
            isDeveloped: process.env['NODE_ENV'] !== 'production',
          }),
          nicknameReconciler(db),
          async (userId: string) => {
            const i = await db.discordIdentity.findUnique({
              where: { userId },
              select: { discordId: true },
            });
            return i?.discordId ?? null;
          },
        );
      },
    },
  ],
})
export class CmdrModule {}
