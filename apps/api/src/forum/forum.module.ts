import { Module } from '@nestjs/common';
import { ForumController } from './forum.controller.js';
import { CategoryService } from './category.service.js';
import { ThreadService } from './thread.service.js';
import { GrantService } from './grant.service.js';
import { PostService } from './post.service.js';
import { NotifyService } from './notify.service.js';
import { EngageService } from './engage.service.js';
import { SearchService } from './search.service.js';
import { ModerationService } from './moderation.service.js';
import { RecruitmentService } from './recruitment.service.js';
import { PendingReindexQueue } from './reindex.port.js';
import { UploadService } from '../media/upload.service.js';
import { MediaModule } from '../media/media.module.js';
import { ScreeningService } from '../ai/screening.service.js';
import { ALL_PERMISSIONS } from '@grims/shared';
import { SignatureService } from './signature.service.js';

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
  /*
   * ★ MediaModule, FOR THE YOUTUBE THUMBNAIL FETCH ★
   *
   * `UploadService` lives there and is exported there; without this import Nest cannot resolve it
   * and the API refuses to BOOT. Unit tests could not catch that — they construct `PostService`
   * directly and never ask the container to wire it — so the break only appeared on the first real
   * start after the thumbnail work. Worth naming: a green suite is not a booted app.
   */
  imports: [MediaModule],
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
    ModerationService,
    RecruitmentService,
    {
      provide: PostService,
      inject: [PendingReindexQueue, ModerationService, UploadService, ScreeningService],
      useFactory: (
        reindex: PendingReindexQueue,
        moderation: ModerationService,
        uploads: UploadService,
        screening: ScreeningService,
      ) =>
        new PostService(reindex, moderation, {
          /*
           * YouTube thumbnails go through the ORDINARY upload pipeline, so they are hardened,
           * re-encoded and EXIF-stripped like any other image — a file fetched from a third party
           * is exactly the kind that should not bypass that.
           *
           * `UPLOAD_PERMISSION` is passed as satisfied because the fetch is OURS, not the
           * member's: somebody without upload rights may still embed a video, and the thumbnail is
           * the server acting rather than them.
           */
          store: async (uploaderId, bytes) => {
            const result = await uploads.upload(uploaderId, ALL_PERMISSIONS, bytes);
            return result.id;
          },
        },
        /*
         * Screening runs BEFORE a post is written — see `PostService.create`. Injected here rather
         * than resolved inside the service so the dependency is visible in the wiring: a post now
         * depends on the AI, and that should be obvious to whoever reads this file next.
         */
        screening,
        ),
    },
    NotifyService,
    EngageService,
    SignatureService,
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
