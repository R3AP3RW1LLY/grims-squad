import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { LeaderboardsModule } from '../leaderboards/leaderboards.module.js';
import { WeaponsStore } from './weapons.store.js';
import { MembersController } from './members.controller.js';
import { AccountController } from './account.controller.js';
import { PrismaMembersStore } from './members.store.js';
import { PrismaAccountStore } from './account.store.js';
import { MEMBERS_STORE, ACCOUNT_STORE } from './members.tokens.js';

@Module({
  // LeaderboardsModule for the badge resolver: the dashboard's own badge list rides on
  // /v1/me/commander, and reading it through the shared service is what keeps it agreeing with
  // the forum's author chips.
  imports: [DatabaseModule, LeaderboardsModule],
  controllers: [MembersController, AccountController],
  providers: [
    /*
     * The on-foot weapons chart. A plain provider: it takes only the database and answers one
     * aggregate question, so there is nothing to bind to a caller.
     */
    {
      provide: WeaponsStore,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new WeaponsStore(db),
    },
    {
      provide: MEMBERS_STORE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new PrismaMembersStore(db),
    },
    {
      provide: ACCOUNT_STORE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new PrismaAccountStore(db),
    },
  ],
})
export class MembersModule {}
