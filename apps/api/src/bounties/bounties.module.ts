import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { AuthzModule } from '../authz/authz.module.js';
import { TelemetryModule } from '../telemetry/telemetry.module.js';
import { BountiesController } from './bounties.controller.js';
import { BountiesDeviceController } from './bounties-device.controller.js';
import { BountiesService } from './bounties.service.js';

/**
 * Data Bounties — its own module rather than a corner of Logistics, because it is a different
 * subject: Logistics answers "where do I trade", this answers "where should somebody FLY so that
 * question keeps having good answers". The two share nothing but the database.
 */
@Module({
  // TelemetryModule for PAIRING_SERVICE: the companion's door authenticates a paired device.
  imports: [DatabaseModule, AuthzModule, TelemetryModule],
  controllers: [BountiesController, BountiesDeviceController],
  providers: [
    {
      provide: BountiesService,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new BountiesService(db),
    },
  ],
})
export class BountiesModule {}
