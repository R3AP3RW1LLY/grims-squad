import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { basename } from 'node:path';
import { AppError, ErrorCode } from '@grims/shared';
import type { ReleaseAsset, ReleaseStore } from './release.service.js';
import { RELEASE_STORE } from './companion.tokens.js';

/**
 * Downloading the companion app.
 *
 * ★ MEMBERS ONLY, DELIBERATELY ★
 *
 * Not `@Public`. The app pairs to a squadron account and uploads journals to
 * us; there is no reason for it to be downloadable by anybody who is not a
 * member, and a signed-in-only download means the file cannot be linked to from
 * outside and passed around as "some Elite tool".
 *
 * ★ AND IT IS SERVED FROM HERE, NOT GITHUB ★
 *
 * Squadron owner's decision. A releases page asks a member to pick the right
 * file out of a list that also holds blockmaps and checksums, and puts a
 * developer-facing site in the middle of somebody's first five minutes.
 */
@Controller('v1/companion')
export class CompanionController {
  constructor(@Inject(RELEASE_STORE) private readonly releases: ReleaseStore) {}

  /** What is available to download. Empty when nothing has been built yet. */
  @Get('releases')
  async releasesList(): Promise<{ assets: ReleaseAsset[] }> {
    return { assets: await this.releases.list() };
  }

  /**
   * Streams one installer.
   *
   * ★ STREAMED, NOT READ INTO MEMORY ★
   *
   * The Windows build is ~100 MB. `readFile` would hold all of it in the
   * process per concurrent download, and a squadron announcement is precisely
   * the moment forty people click at once.
   */
  @Get('download/:file')
  async download(@Param('file') file: string, @Res() reply: FastifyReply): Promise<void> {
    const opened = await this.releases.open(file);

    if (opened === null) {
      /*
       * One error for "not an installer", "outside the directory" and "not
       * there". A caller cannot tell a rejected traversal from a missing file,
       * which is one fewer thing to probe.
       */
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No such download.');
    }

    const name = basename(file);
    void reply
      .header('content-type', 'application/octet-stream')
      // So the browser can show a progress bar and an ETA instead of an
      // indeterminate spinner for a hundred-megabyte file.
      .header('content-length', String(opened.sizeBytes))
      /*
       * The filename is quoted and taken from the RESOLVED path, not the
       * request. Our own filenames contain spaces ("Grims Squad Companion Setup
       * 0.1.0.exe"), and an unquoted header truncates at the first one — the
       * browser would save "Grims" with no extension.
       */
      .header('content-disposition', `attachment; filename="${name.replace(/"/g, '')}"`)
      // A build is immutable once published; a new one gets a new filename.
      .header('cache-control', 'public, max-age=86400, immutable')
      .send(opened.stream);
  }
}
