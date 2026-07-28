import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { HealthController } from './health/health.controller.js';
import { DatabaseModule } from './database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthzModule } from './authz/authz.module.js';
import { MembersModule } from './members/members.module.js';
import { CmdrModule } from './cmdr/cmdr.module.js';
import { AdminModule } from './admin/admin.module.js';
import { PublicModule } from './public/public.module.js';
import { TelemetryModule } from './telemetry/telemetry.module.js';
import { MediaModule } from './media/media.module.js';
import { AuthGuard } from './auth/auth.guard.js';
import { RequiresPermissionGuard } from './authz/requires-permission.guard.js';

@Module({
  imports: [DatabaseModule, AuthzModule, AuthModule, MembersModule, CmdrModule, AdminModule, PublicModule, TelemetryModule, MediaModule],
  controllers: [HealthController],
  providers: [
    /*
     * Both guards are GLOBAL, and the order matters: AuthGuard resolves the
     * session into req.user, then RequiresPermissionGuard reads it.
     *
     * A route is authenticated and permission-checked UNLESS it opts out with
     * @Public. The opposite default — open unless decorated — means forgetting
     * a decorator silently exposes an endpoint, and forgetting is the common
     * case. This way the failure mode is a locked door, not an open one.
     */
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RequiresPermissionGuard },
  ],
})
export class AppModule {}
