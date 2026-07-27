import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { MembersController } from './members.controller.js';
import { AccountController } from './account.controller.js';
import { PrismaMembersStore } from './members.store.js';
import { PrismaAccountStore } from './account.store.js';
import { MEMBERS_STORE, ACCOUNT_STORE } from './members.tokens.js';

@Module({
  imports: [DatabaseModule],
  controllers: [MembersController, AccountController],
  providers: [
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
