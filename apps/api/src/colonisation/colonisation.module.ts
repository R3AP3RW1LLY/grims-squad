import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { AuthzModule } from '../authz/authz.module.js';
import { TelemetryModule } from '../telemetry/telemetry.module.js';
import { ScoutController, ScoutDeviceController } from './scout.controller.js';
import { ScoutService } from './scout.service.js';

/**
 * The colonisation scout — finding the next system worth claiming.
 *
 * Separate from the existing colonisation module, which is about projects already under
 * construction. This one is about the decision made before any of that: which system, bought from
 * which station, extending whose power.
 */
@Module({
  imports: [DatabaseModule, AuthzModule, TelemetryModule],
  controllers: [ScoutController, ScoutDeviceController],
  providers: [
    {
      provide: ScoutService,
      inject: [PrismaClient],
      // The galaxy reader is left at its default here; tests inject a fake so they never touch the
      // network, which is the only reason it is a constructor parameter at all.
      useFactory: (db: PrismaClient) => new ScoutService(db),
    },
  ],
  exports: [ScoutService],
})
export class ColonisationScoutModule {}
