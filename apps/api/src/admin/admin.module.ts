import { Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminController } from './admin.controller.js';
import { PrismaAdminStore } from './admin.store.js';
import { RoleAdminService } from './role-admin.service.js';
import { MappingAdminService } from './mapping-admin.service.js';
import { PrismaRoleAdminStore, PrismaMappingAdminStore } from './role-admin.store.prisma.js';
import { ADMIN_STORE, ROLE_ADMIN, MAPPING_ADMIN } from './admin.tokens.js';

/**
 * Imports AuthModule for TotpService: the AdminGateGuard resolves it, and a
 * guard whose dependency is missing from the injector fails at request time
 * rather than at boot — which would mean discovering it in production.
 */
const cache = (): Redis => new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [AdminController],
  providers: [
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
      provide: MAPPING_ADMIN,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) =>
        new MappingAdminService(new PrismaMappingAdminStore(db, cache())),
    },
  ],
})
export class AdminModule {}
