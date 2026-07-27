import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { StatsController } from './stats.controller.js';
import { PrismaStatsStore } from './stats.store.js';
import { STATS_STORE } from './stats.tokens.js';

@Module({
  imports: [DatabaseModule],
  controllers: [StatsController],
  providers: [
    {
      provide: STATS_STORE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new PrismaStatsStore(db),
    },
  ],
})
export class PublicModule {}
