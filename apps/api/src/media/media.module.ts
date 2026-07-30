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
        return new FileObjectStore(join(process.cwd(), '.local-storage'));
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
