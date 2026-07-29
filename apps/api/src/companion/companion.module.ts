import { Module } from '@nestjs/common';
import { CompanionController } from './companion.controller.js';
import { s3ConfigFrom } from '../media/object-store.js';
import { S3ReleaseBucket } from './release-bucket.s3.js';
import {
  BucketReleaseStore,
  DirectoryReleaseStore,
  releaseDirFrom,
  type ReleaseStore,
} from './release.service.js';
import { RELEASE_STORE } from './companion.tokens.js';

/**
 * Serving the companion app's installers.
 *
 * ★ BUCKET IN PRODUCTION, DISK IN DEVELOPMENT ★
 *
 * The same choice the avatar store makes, for the same reason: a download that
 * only works once somebody has provisioned object storage is one nobody tests
 * while building the page it sits on. `s3ConfigFrom` returns null when nothing
 * is configured and THROWS when it is half configured — so a typo in one of the
 * five variables is loud rather than a silent fallback to disk in production.
 *
 * No database. The bucket IS the source of truth: CI writes it and this reads
 * whatever is there, so there is no manifest to keep in step and no way to
 * offer a build that does not exist.
 */
@Module({
  controllers: [CompanionController],
  providers: [
    {
      provide: RELEASE_STORE,
      useFactory: (): ReleaseStore => {
        const s3 = s3ConfigFrom(process.env);
        return s3 === null
          ? new DirectoryReleaseStore(releaseDirFrom(process.env))
          : new BucketReleaseStore(new S3ReleaseBucket(s3));
      },
    },
  ],
  /*
   * Exported so the TELEMETRY module can read it.
   *
   * The companion's settings call tells the app the newest published version,
   * which is how the update banner works. Without this export the injection
   * resolves to null — and because it is `@Optional()`, silently: no error, no
   * banner, ever.
   */
  exports: [RELEASE_STORE],
})
export class CompanionModule {}
