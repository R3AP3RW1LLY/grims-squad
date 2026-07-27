import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminController } from './admin.controller.js';
import { PrismaAdminStore } from './admin.store.js';
import { ADMIN_STORE } from './admin.tokens.js';

/**
 * Imports AuthModule for TotpService: the AdminGateGuard resolves it, and a
 * guard whose dependency is missing from the injector fails at request time
 * rather than at boot — which would mean discovering it in production.
 */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [AdminController],
  providers: [
    {
      provide: ADMIN_STORE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new PrismaAdminStore(db),
    },
  ],
})
export class AdminModule {}
