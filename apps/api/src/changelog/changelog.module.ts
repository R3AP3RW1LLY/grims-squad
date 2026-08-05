import { Module } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { DatabaseModule } from '../database.module.js';
import { AuthzModule } from '../authz/authz.module.js';
import { ChangelogController } from './changelog.controller.js';
import { ChangelogStore } from './changelog.store.js';

/**
 * The changelog — its own module rather than a corner of Admin, because its
 * main surface is for every member: the released list feeds /changelog in the
 * hub, and only the pending preview is privileged. AuthzModule is imported
 * for the permission guard's dependencies, the same as every other guarded
 * module.
 */
@Module({
  imports: [DatabaseModule, AuthzModule],
  controllers: [ChangelogController],
  providers: [
    {
      provide: ChangelogStore,
      inject: [PrismaClient],
      useFactory: (db: PrismaClient) => new ChangelogStore(db),
    },
  ],
})
export class ChangelogModule {}
