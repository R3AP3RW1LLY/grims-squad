import { Module } from '@nestjs/common';
import { PrismaClient, PrismaNonceStore } from '@grims/db';
import { NonceService } from '@grims/shared';
import { createKeyring, TokenCipher } from '@grims/shared/server';
import { Redis } from 'ioredis';
import { CapiService } from './capi.service.js';
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
import { LEADERSHIP_CEILING } from '../members/members.store.js';
import { CMDR_SERVICE,
  CAPI_SERVICE, NONCE_SERVICE, INARA_LINK, NICKNAME_SERVICE } from './cmdr.tokens.js';
import { NicknameService } from './nickname.service.js';
import { logger } from '../logging.js';
import { LIVE_SERVICE } from '../live/live.tokens.js';
import { liveNudgeOf } from '../live/live-nudge.js';
import type { LiveService } from '../live/live.service.js';

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
    /**
     * A nickname they chose instead of the convention.
     *
     * Read fresh on every check rather than cached: the whole point is that setting one takes
     * effect immediately, and a member who set it on the settings page thirty seconds ago must not
     * be renamed back by the next Inara call.
     */
    async overrideFor(userId) {
      const u = await prisma.user.findUnique({
        where: { id: userId },
        select: { nicknameOverride: true },
      });
      return u?.nicknameOverride ?? null;
    },
    setNickname: (g, d, nick) => discord.setMemberNickname(g, d, nick),
    /**
     * The rank that goes in front of their commander name.
     *
     * ★ APPOINTMENT FIRST, AND THE ORDERING IS INVERTED ★
     *
     * A leadership appointment outranks any tenure rank for display: somebody
     * is introduced as the Prime Legate, not as a Grand Master General who also
     * happens to hold an office.
     *
     * Within appointments the LOWEST rankOrder is the most senior — Galactic
     * Admiral is 10, Squadron Leader 60 — which is the reverse of the tenure
     * ladder, where Cadet is 100 and Grand Master General 190. Every officer
     * also holds Squadron Leader as a base, so reading these the same way round
     * would title the Galactic Admiral "Squadron Leader".
     */
    async rankFor(discordId) {
      const [member, mappings] = await Promise.all([
        prisma.discordGuildMember.findUnique({
          where: { discordId },
          select: { roles: true },
        }),
        prisma.roleMapping.findMany({
          where: { role: { isHierarchical: true } },
          select: { discordRoleId: true, role: { select: { name: true, rankOrder: true } } },
        }),
      ]);

      if (member === null) return null;

      const byId = new Map(mappings.map((m) => [m.discordRoleId, m.role]));
      const held = member.roles.flatMap((id) => {
        const r = byId.get(id);
        return r === undefined ? [] : [r];
      });

      const appointments = held.filter((r) => r.rankOrder < LEADERSHIP_CEILING);
      if (appointments.length > 0) {
        return appointments.reduce((a, b) => (b.rankOrder < a.rankOrder ? b : a)).name;
      }

      const tenure = held.filter((r) => r.rankOrder >= LEADERSHIP_CEILING);
      if (tenure.length === 0) return null;
      return tenure.reduce((a, b) => (b.rankOrder > a.rankOrder ? b : a)).name;
    },
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
      provide: NICKNAME_SERVICE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => {
        /*
         * The SAME Discord adapter the nickname sync uses, built the same way — including the empty
         * `grantableRoleIds`, which makes "this adapter renames people and never grants a role"
         * structural rather than a promise about how it happens to be called.
         *
         * Null when the guild or token is unset, which is the ordinary state in a development
         * environment. Choosing a nickname still works; it simply is not pushed anywhere.
         */
        const guildId = process.env['DISCORD_GUILD_ID'] ?? '';
        const botToken = process.env['DISCORD_BOT_TOKEN'] ?? '';

        if (guildId === '' || botToken === '') return new NicknameService(db, null);

        const discord = new DiscordAdapter({
          clientId: process.env['DISCORD_CLIENT_ID'] ?? '',
          clientSecret: process.env['DISCORD_CLIENT_SECRET'] ?? '',
          botToken,
          // EMPTY, deliberately — same reasoning as the sync adapter above. This exists to rename
          // people and must never grant a role.
          grantableRoleIds: [],
        });
        return new NicknameService(db, {
          guildId,
          set: (g, d, nick) => discord.setMemberNickname(g, d, nick),
        });
      },
    },
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
      provide: CAPI_SERVICE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient): CapiService => {
        const keyring = process.env['TOKEN_ENCRYPTION_KEYRING'] ?? '';
        if (keyring === '') {
          /*
           * Same refusal as the Inara link beside it, for the same reason: INV-012 has no degraded
           * mode. A Frontier refresh token is a standing grant to read a member's game account —
           * storing one in plaintext is worse than not storing it, and failing at BOOT is where
           * that is obvious rather than on the first member who tries to link.
           */
          throw new Error(
            'TOKEN_ENCRYPTION_KEYRING is required: a Frontier refresh token must not be stored unencrypted.',
          );
        }

        const clientId = process.env['FDEV_CAPI_CLIENT_ID'] ?? '';
        const redirectUri = process.env['FDEV_CAPI_REDIRECT_URI'] ?? '';
        if (clientId === '' || redirectUri === '') {
          /*
           * The deploy preflight already refuses without these, so reaching here means somebody
           * started the API another way. Refusing at boot keeps the two consistent: a running API
           * that cannot link Frontier accounts would leave every cloud player unable to join, and
           * would say so only when one of them tried.
           */
          throw new Error(
            'FDEV_CAPI_CLIENT_ID and FDEV_CAPI_REDIRECT_URI are required to link Frontier accounts.',
          );
        }

        return new CapiService(
          db,
          new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379'),
          new TokenCipher(createKeyring(keyring)),
          {
            authBase: process.env['FDEV_CAPI_AUTH_BASE'] ?? 'https://auth.frontierstore.net',
            apiBase: process.env['FDEV_CAPI_API_BASE'] ?? 'https://companion.orerve.net',
            clientId,
            redirectUri,
            clientSecret: process.env['FDEV_CAPI_SHARED_KEY'],
          },
        );
      },
    },
    {
      provide: INARA_LINK,
      // LIVE_SERVICE optional: the confirmation notices are decoration on a verification that
      // already happened, and a wiring without the live module must still verify people.
      inject: [PrismaClient, { token: LIVE_SERVICE, optional: true }],
      useFactory: (db: PrismaClient, live?: LiveService): InaraLinkService => {
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
          new PrismaInaraLinkStore(db, new TokenCipher(createKeyring(keyring)), liveNudgeOf(live)),
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
