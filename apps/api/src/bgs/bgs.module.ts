import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { AuthzModule } from '../authz/authz.module.js';
import { BgsController } from './bgs.controller.js';
import { BgsService } from './bgs.service.js';

/**
 * BGS — the factions the squadron backs and the orders about them.
 *
 * Built on `tracked_factions` and `bgs_orders`, which have existed in the schema since the module
 * was designed and have been sitting empty in production ever since.
 */
@Module({
  imports: [DatabaseModule, AuthzModule],
  controllers: [BgsController],
  providers: [
    {
      provide: BgsService,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new BgsService(db),
    },
  ],
  exports: [BgsService],
})
export class BgsModule {}
