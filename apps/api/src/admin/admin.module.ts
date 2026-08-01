import { Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminController } from './admin.controller.js';
import { ViewAsController } from './view-as.controller.js';
import { PrismaAdminStore } from './admin.store.js';
import { RoleAdminService } from './role-admin.service.js';
import { MappingAdminService } from './mapping-admin.service.js';
import { PrismaRoleAdminStore, PrismaMappingAdminStore } from './role-admin.store.prisma.js';
import { RestDiscordModeration } from './discord-moderation.port.js';
import {
  ADMIN_STORE,
  DASHBOARD_STORE,
  ROLE_ADMIN,
  MAPPING_ADMIN,
  DISCORD_MODERATION,
} from './admin.tokens.js';
import { PrismaDashboardStore } from './dashboard.store.js';

/**
 * Imports AuthModule for TotpService: the AdminGateGuard resolves it, and a
 * guard whose dependency is missing from the injector fails at request time
 * rather than at boot — which would mean discovering it in production.
 */
const cache = (): Redis => new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [AdminController, ViewAsController],
  providers: [
    {
      provide: DASHBOARD_STORE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new PrismaDashboardStore(db),
    },
    {
      provide: ADMIN_STORE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new PrismaAdminStore(db),
    },
    {
      provide: ROLE_ADMIN,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new RoleAdminService(new PrismaRoleAdminStore(db, cache())),
    },
    {
      /*
       * ★ THE ONE PROVIDER HERE THAT REACHES OUTSIDE ★
       *
       * Kick, ban and timeout are HTTP calls to Discord, so this is the only thing in the admin
       * module that can have an effect nobody here can undo. Behind a port so the controller can be
       * tested without a network, and so a missing token is a refusal with a sentence rather than a
       * crash on the first ban.
       */
      provide: DISCORD_MODERATION,
      useFactory: () =>
        new RestDiscordModeration(
          process.env['DISCORD_BOT_TOKEN'] ?? '',
          process.env['DISCORD_GUILD_ID'] ?? '',
        ),
    },
    {
      provide: MAPPING_ADMIN,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) =>
        new MappingAdminService(new PrismaMappingAdminStore(db, cache())),
    },
  ],
})
export class AdminModule {}
