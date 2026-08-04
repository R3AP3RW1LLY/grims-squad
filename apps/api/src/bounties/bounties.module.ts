import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { AuthzModule } from '../authz/authz.module.js';
import { BountiesController } from './bounties.controller.js';
import { BountiesService } from './bounties.service.js';

/**
 * Data Bounties — its own module rather than a corner of Logistics, because it is a different
 * subject: Logistics answers "where do I trade", this answers "where should somebody FLY so that
 * question keeps having good answers". The two share nothing but the database.
 */
@Module({
  imports: [DatabaseModule, AuthzModule],
  controllers: [BountiesController],
  providers: [
    {
      provide: BountiesService,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new BountiesService(db),
    },
  ],
})
export class BountiesModule {}
