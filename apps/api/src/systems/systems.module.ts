import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { AuthzModule } from '../authz/authz.module.js';
import { SystemMarksController } from './system-marks.controller.js';
import { SystemMarksService } from './system-marks.service.js';

/**
 * A member's own systems.
 *
 * Its own module rather than a corner of Logistics, because seven of the fourteen boxes that ask
 * for a system are NOT logistics screens — the scout, the planner, post-project and build types all
 * need it too, and none of them should have to import the market to get a dropdown.
 */
@Module({
  imports: [DatabaseModule, AuthzModule],
  controllers: [SystemMarksController],
  providers: [
    {
      provide: SystemMarksService,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new SystemMarksService(db),
    },
  ],
  exports: [SystemMarksService],
})
export class SystemsModule {}
