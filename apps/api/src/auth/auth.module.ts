import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { AuthzModule } from '../authz/authz.module.js';
import { DiscordAdapter } from '@grims/ed-clients';
import { createKeyring, TokenCipher } from '@grims/shared/server';
import { DiscordAuthController } from './discord.controller.js';
import { SessionController } from './session.controller.js';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingService } from './onboarding.service.js';
import { DiscordAuthService, type DiscordAuthConfig } from './discord.service.js';
import { PrismaIdentityStore } from './identity.store.prisma.js';
import { SessionService } from './session.service.js';
import { TotpService } from './totp.service.js';
import { PrismaTotpStore } from './totp.store.prisma.js';
import { TotpController } from './totp.controller.js';
import { MeController } from './me.controller.js';
import { MediaModule } from '../media/media.module.js';
import { PrismaSessionStore } from './session.store.prisma.js';
import { logger } from '../logging.js';

/**
 * Wires Discord sign-in, but only when it is fully configured.
 *
 * Partial configuration is treated as NO configuration. Booting with, say, a
 * client id but no state secret would produce an auth flow that looks alive and
 * fails in a way that reads like a bug; refusing to construct the service means
 * the endpoint answers "not configured" and says which variables are missing.
 */
const REQUIRED = [
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_GUILD_ID',
  'DISCORD_REDIRECT_URI',
  'OAUTH_STATE_SECRET',
  'TOKEN_ENCRYPTION_KEYRING',
] as const;

@Module({
  // AuthzModule for PermissionService: the OAuth callback needs the effective
  // mask to decide where to send the member, and a guard whose dependency is
  // missing from the injector fails at request time rather than at boot.
  imports: [DatabaseModule, AuthzModule, MediaModule],
  controllers: [
    DiscordAuthController,
    OnboardingController,
    SessionController,
    TotpController,
    MeController,
  ],
  providers: [
    {
      provide: TotpService,
      inject: [PrismaClient],
      useFactory: (prisma: PrismaClient): TotpService | null => {
        const keyring = process.env['TOKEN_ENCRYPTION_KEYRING'] ?? '';
        if (keyring === '') {
          // Without the keyring the secret cannot be encrypted at rest, and
          // INV-012 does not have a degraded mode. No service means the admin
          // gate refuses rather than waving requests through.
          logger.warn('Two-factor disabled: TOKEN_ENCRYPTION_KEYRING is not set.');
          return null;
        }
        return new TotpService(
          new PrismaTotpStore(prisma, new TokenCipher(createKeyring(keyring))),
        );
      },
    },
    {
      provide: SessionService,
      inject: [PrismaClient],
      useFactory: (prisma: PrismaClient): SessionService | null => {
        const secret = process.env['OAUTH_STATE_SECRET'] ?? '';
        if (secret === '') {
          logger.warn('Sessions disabled: OAUTH_STATE_SECRET is not set.');
          return null;
        }
        return new SessionService(new PrismaSessionStore(prisma), {
          // Reuses the state secret rather than adding a fifth key to rotate.
          // Both are HMAC secrets of the same strength, both live only on the
          // server, and one fewer secret is one fewer thing to lose.
          accessSecret: secret,
          issuer: 'grims-squad',
        });
      },
    },
    {
      // Shares the Discord adapter and the state secret with the sign-in flow,
      // but is a separate service because the two do opposite things: one
      // REFUSES non-members, the other exists to admit them.
      provide: OnboardingService,
      useFactory: (): OnboardingService | null => {
        const missing = REQUIRED.filter((k) => (process.env[k] ?? '') === '');
        if (missing.length > 0) return null;
        return new OnboardingService(
          new DiscordAdapter({
            clientId: process.env['DISCORD_CLIENT_ID'] as string,
            clientSecret: process.env['DISCORD_CLIENT_SECRET'] as string,
            botToken: process.env['DISCORD_BOT_TOKEN'] as string,
            // The adapter refuses to grant anything outside this list, even
            // though Discord would allow it.
            grantableRoleIds: [
              process.env['DISCORD_ROLE_SQUADRON'] ?? '',
              process.env['DISCORD_ROLE_ALLY'] ?? '',
            ].filter((v) => v !== ''),
          }),
          {
            // From the environment, never from source (INV-008).
            roleIds: [
              { intent: 'squadron' as const, roleId: process.env['DISCORD_ROLE_SQUADRON'] ?? '' },
              { intent: 'ally' as const, roleId: process.env['DISCORD_ROLE_ALLY'] ?? '' },
            ].filter((b) => b.roleId !== ''),
            guildId: process.env['DISCORD_GUILD_ID'] as string,
            clientId: process.env['DISCORD_CLIENT_ID'] as string,
            clientSecret: process.env['DISCORD_CLIENT_SECRET'] as string,
            redirectUri: (process.env['DISCORD_REDIRECT_URI'] as string).replace(
              /\/callback$/,
              '/join/callback',
            ),
            stateSecret: process.env['OAUTH_STATE_SECRET'] as string,
          },
        );
      },
    },
    {
      provide: DiscordAuthService,
      inject: [PrismaClient],
      useFactory: (prisma: PrismaClient): DiscordAuthService | null => {
        const missing = REQUIRED.filter((k) => (process.env[k] ?? '') === '');
        if (missing.length > 0) {
          logger.warn(
            { missing },
            'Discord sign-in disabled: configuration incomplete. /v1/auth/discord will answer 503.',
          );
          return null;
        }

        const stateSecret = process.env['OAUTH_STATE_SECRET'] as string;
        if (stateSecret.length < 32) {
          // A short HMAC secret is a forgeable state, which is the whole
          // protection. Refuse rather than run weakened.
          throw new Error('OAUTH_STATE_SECRET must be at least 32 characters.');
        }

        const config: DiscordAuthConfig = {
          guildId: process.env['DISCORD_GUILD_ID'] as string,
          clientId: process.env['DISCORD_CLIENT_ID'] as string,
          clientSecret: process.env['DISCORD_CLIENT_SECRET'] as string,
          redirectUri: process.env['DISCORD_REDIRECT_URI'] as string,
          stateSecret,
        };

        return new DiscordAuthService(
          new DiscordAdapter({
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            botToken: process.env['DISCORD_BOT_TOKEN'] as string,
          }),
          new PrismaIdentityStore(prisma),
          new TokenCipher(createKeyring(process.env['TOKEN_ENCRYPTION_KEYRING'] as string)),
          config,
        );
      },
    },
  ],
  exports: [SessionService, TotpService],
})
export class AuthModule {}
