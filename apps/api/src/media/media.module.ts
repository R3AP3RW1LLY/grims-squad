import { Module, Logger } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { join } from 'node:path';
import { DatabaseModule } from '../database.module.js';
import { MediaController } from './media.controller.js';
import { AvatarService } from './avatar.service.js';
import { PrismaAvatarStore } from './media.store.prisma.js';
import { s3ConfigFrom, type ObjectStore } from './object-store.js';
import { S3ObjectStore, FileObjectStore } from './object-store.drivers.js';
import { AVATAR_SERVICE, OBJECT_STORE } from './media.tokens.js';
import { UploadService } from './upload.service.js';

/**
 * Object storage and the things stored in it.
 *
 * The driver is chosen ONCE, here, from the environment: S3 when it is
 * configured, a folder on disk when it is not. Nothing downstream branches on
 * which, so a developer with no bucket sees exactly the behaviour production
 * has.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [MediaController],
  providers: [
    {
      provide: OBJECT_STORE,
      useFactory: (): ObjectStore => {
        const config = s3ConfigFrom(process.env);
        if (config !== null) return new S3ObjectStore(config);

        // Said out loud rather than assumed. Local disk in production would be
        // a real problem — files vanish on every redeploy — and the one thing
        // that must never happen is it being SILENT.
        new Logger('MediaModule').warn(
          'S3 is not configured; storing uploads on local disk. Fine for development, ' +
            'wrong for production — files are lost on redeploy.',
        );
        /*
         * ★ MEDIA_LOCAL_ROOT — squadron owner, 2026-08-01 ★
         *
         * "for localhost testing they should be saved on the F Drive please. or D drive."
         *
         * Overridable rather than hardcoded to a drive letter: this same code path runs on the
         * Linux server whenever S3 is unconfigured, and `D:/` there is a directory called "D:"
         * sitting in the repo root — which would look like it worked.
         *
         * The old default stays as the fallback. Changing it outright would orphan every image
         * already under `.local-storage` on a machine that had been running for weeks, and they
         * would come back as broken pictures rather than as an error anybody could act on.
         */
        const root = process.env['MEDIA_LOCAL_ROOT']?.trim();
        return new FileObjectStore(
          root === undefined || root === '' ? join(process.cwd(), '.local-storage') : root,
        );
      },
    },
    {
      /*
       * Takes the plain PrismaClient, not an AclBoundClient. `media_uploads` carries no
       * ACL column and is not an ACL-bearing model: an image's visibility follows the post
       * that references it, and the reasoning for not resolving that per request is on
       * `UploadService.serve`.
       */
      provide: UploadService,
      inject: [OBJECT_STORE, PrismaClient],
      useFactory: (objects: ObjectStore, db: PrismaClient) => new UploadService(objects, db),
    },
    {
      provide: AVATAR_SERVICE,
      inject: [OBJECT_STORE, PrismaClient],
      useFactory: (objects: ObjectStore, db: PrismaClient) =>
        new AvatarService(objects, new PrismaAvatarStore(db)),
    },
  ],
  exports: [AVATAR_SERVICE, UploadService],
})
export class MediaModule {}
