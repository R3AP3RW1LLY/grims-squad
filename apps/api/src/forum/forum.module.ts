import { Module } from '@nestjs/common';
import { ForumController } from './forum.controller.js';
import { CategoryService } from './category.service.js';
import { ThreadService } from './thread.service.js';
import { PendingReindexQueue } from './reindex.port.js';

/**
 * The forum.
 *
 * No `PrismaClient` provider and no store: every read goes through the
 * `AclBoundClient` that `AclDbService` mints (INV-002), and `AclDbService` comes
 * from the @Global authz module. A Prisma client injected here would be the plain
 * one, which is exactly what `acl-usage.spec.ts` exists to prevent.
 *
 * `PendingReindexQueue` stands in for the P8 consumer. It records and logs rather
 * than silently discarding, so the gap is visible to whoever is looking rather
 * than discovered when RAG starts returning officer content to members.
 */
@Module({
  controllers: [ForumController],
  providers: [
    CategoryService,
    { provide: PendingReindexQueue, useFactory: () => new PendingReindexQueue() },
    {
      provide: ThreadService,
      inject: [CategoryService, PendingReindexQueue],
      useFactory: (categories: CategoryService, reindex: PendingReindexQueue) =>
        new ThreadService(categories, reindex),
    },
  ],
})
export class ForumModule {}
