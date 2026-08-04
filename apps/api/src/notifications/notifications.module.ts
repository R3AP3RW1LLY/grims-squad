import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

/**
 * The bell: the read side of the notifications the rest of the platform writes. Producers do not
 * live here — they call notifyMembers/notifySquadron from @grims/db wherever the deed happens,
 * which is what lets the worker's sweeps notify without reaching into the API.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [NotificationsController],
  providers: [
    {
      provide: NotificationsService,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new NotificationsService(db),
    },
  ],
})
export class NotificationsModule {}
