import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { AuthzModule } from '../authz/authz.module.js';
import { TelemetryModule } from '../telemetry/telemetry.module.js';
import { OpsController, OpsDeviceController } from './ops.controller.js';
import { OpsService } from './ops.service.js';

/**
 * Operations. Built on `operations` and `operation_signups`, which have been in the schema —
 * with capacity, standby overflow and attendance already thought through — and empty in production
 * since the module was designed.
 */
@Module({
  imports: [DatabaseModule, AuthzModule, TelemetryModule],
  controllers: [OpsController, OpsDeviceController],
  providers: [
    {
      provide: OpsService,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new OpsService(db),
    },
  ],
  exports: [OpsService],
})
export class OpsModule {}
