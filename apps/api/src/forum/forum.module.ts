import { Module } from '@nestjs/common';
import { ForumController } from './forum.controller.js';
import { CategoryService } from './category.service.js';
import { ThreadService } from './thread.service.js';
import { GrantService } from './grant.service.js';
import { PostService } from './post.service.js';
import { NotifyService } from './notify.service.js';
import { EngageService } from './engage.service.js';
import { SearchService } from './search.service.js';
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
    /*
     * No dependencies of its own: every method takes the caller's bound client as its
     * first argument, which is what keeps "you cannot grant access to a thread you
     * cannot see" a property of the call rather than of this wiring.
     */
    GrantService,
    { provide: PendingReindexQueue, useFactory: () => new PendingReindexQueue() },
    {
      provide: PostService,
      inject: [PendingReindexQueue],
      useFactory: (reindex: PendingReindexQueue) => new PostService(reindex),
    },
    NotifyService,
    EngageService,
    SearchService,
    {
      provide: ThreadService,
      inject: [CategoryService, PendingReindexQueue, NotifyService],
      useFactory: (categories: CategoryService, reindex: PendingReindexQueue, notify: NotifyService) =>
        new ThreadService(categories, reindex, notify),
    },
  ],
})
export class ForumModule {}
