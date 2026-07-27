import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { Redis } from 'ioredis';
import { PermissionService } from './permission.service.js';
import { PrismaPermissionStore, RedisPermissionCache } from './permission.store.prisma.js';
import { RequiresPermissionGuard } from './requires-permission.guard.js';

/**
 * `@Global` because permission checks belong everywhere. Threading an import
 * through every feature module adds ceremony without adding safety, and the one
 * module that forgets it is the one with an unguarded route.
 */
@Global()
@Module({
  providers: [
    {
      provide: PermissionService,
      inject: [PrismaClient],
      useFactory: (prisma: PrismaClient) =>
        new PermissionService(
          new PrismaPermissionStore(prisma),
          new RedisPermissionCache(new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379')),
        ),
    },
    RequiresPermissionGuard,
  ],
  exports: [PermissionService, RequiresPermissionGuard],
})
export class AuthzModule {}
