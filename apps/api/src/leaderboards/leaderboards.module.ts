import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { AuthzModule } from '../authz/authz.module.js';
import { TelemetryModule } from '../telemetry/telemetry.module.js';
import { LeaderboardsController } from './leaderboards.controller.js';
import { LeaderboardsDeviceController } from './leaderboards-device.controller.js';
import { LeaderboardsService } from './leaderboards.service.js';

/**
 * Leaderboards — its own module rather than a corner of Bounties, because it is a different
 * subject: Bounties answers "where should somebody fly", this answers "who has done what across
 * every gamified board". The Data Runner standings feed it, but so do the colony and trade
 * ledgers the worker maintains.
 *
 * The service is EXPORTED, deliberately: it is the one badge resolver in the API, and the forum
 * (author chips) and the members module (the dashboard's own list) read badges through it rather
 * than each growing a second copy of the showcase rules.
 */
@Module({
  // TelemetryModule for PAIRING_SERVICE: the companion's door authenticates a paired device.
  imports: [DatabaseModule, AuthzModule, TelemetryModule],
  controllers: [LeaderboardsController, LeaderboardsDeviceController],
  providers: [
    {
      provide: LeaderboardsService,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new LeaderboardsService(db),
    },
  ],
  exports: [LeaderboardsService],
})
export class LeaderboardsModule {}
