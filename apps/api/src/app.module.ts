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
import { LogisticsModule } from './logistics/logistics.module.js';
import { BountiesModule } from './bounties/bounties.module.js';
import { LeaderboardsModule } from './leaderboards/leaderboards.module.js';
import { ShipyardDeviceModule } from './ai/shipyard-device.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { TelemetryModule } from './telemetry/telemetry.module.js';
import { CompanionModule } from './companion/companion.module.js';
import { ForumModule } from './forum/forum.module.js';
import { ChangelogModule } from './changelog/changelog.module.js';
import { AnnouncementsModule } from './announcements/announcements.module.js';
import { AiModule } from './ai/ai.module.js';
import { LiveModule } from './live/live.module.js';
import { MediaModule } from './media/media.module.js';
import { AuthGuard } from './auth/auth.guard.js';
import { RequiresPermissionGuard } from './authz/requires-permission.guard.js';
import { ViewAsGuard } from './authz/view-as.guard.js';

@Module({
  imports: [DatabaseModule, AuthzModule, AuthModule, MembersModule, CmdrModule, AdminModule, PublicModule, LogisticsModule, BountiesModule, LeaderboardsModule, ShipyardDeviceModule, NotificationsModule, TelemetryModule, MediaModule, CompanionModule, LiveModule, AiModule, ForumModule, ChangelogModule, AnnouncementsModule],
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
    /*
     * ★ BEFORE the permission guard, and after AuthGuard ★
     *
     * A preview refuses every write outright, so it should answer before anything works out whether
     * the narrowed mask would have allowed one — otherwise a write inside a preview could be
     * refused for the WRONG reason ("you do not have access") and send an officer looking at
     * permissions rather than at the banner on their own screen.
     */
    { provide: APP_GUARD, useClass: ViewAsGuard },
    { provide: APP_GUARD, useClass: RequiresPermissionGuard },
  ],
})
export class AppModule {}
