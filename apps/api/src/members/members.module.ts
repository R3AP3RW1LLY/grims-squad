import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { MembersController } from './members.controller.js';
import { PrismaMembersStore } from './members.store.js';
import { MEMBERS_STORE } from './members.tokens.js';

@Module({
  imports: [DatabaseModule],
  controllers: [MembersController],
  providers: [
    {
      provide: MEMBERS_STORE,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new PrismaMembersStore(db),
    },
  ],
})
export class MembersModule {}
