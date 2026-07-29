import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { basename } from 'node:path';
import { AppError, ErrorCode } from '@grims/shared';
import { User, type CurrentUser } from '../auth/current-user.js';
import type { ReleaseAsset, ReleaseStore } from './release.service.js';
import { newestRelease } from './release.service.js';
import { RELEASE_STORE, DEVICE_VERSIONS } from './companion.tokens.js';

/**
 * What versions a member's active devices are running.
 *
 * ★ A NARROW READER, NOT `PairingService` ★
 *
 * `PairingService` lives in the telemetry module, and the telemetry module
 * already imports THIS one for the release store. Injecting it here would close
 * the loop into a circular dependency — resolvable with `forwardRef`, but that
 * is a workaround for a design where two modules each need half of the other.
 *
 * One method, over the one table, so the dependency stays one-directional.
 */
export interface DeviceVersionReader {
  /** Active devices only. Null entries have not reported a version yet. */
  versionsFor(userId: string): Promise<Array<string | null>>;
}

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
  constructor(
    @Inject(RELEASE_STORE) private readonly releases: ReleaseStore,
    @Inject(DEVICE_VERSIONS) private readonly devices: DeviceVersionReader,
  ) {}

  /**
   * What the website needs to decide whether to announce a new release.
   *
   * ★ FACTS, NOT THE DECISION ★
   *
   * The rule — newest version, published within fourteen days, and not already
   * installed on every one of this member's machines — lives in ONE place on
   * the web side, where it is tested. Deciding half of it here and half there
   * is how one of the three conditions quietly stops being checked.
   *
   * `deviceVersions` is the member's OWN devices and nobody else's. It is
   * scoped by the session, so there is no id in the request to tamper with.
   */
  @Get('update-status')
  async updateStatus(@User() caller: CurrentUser | undefined): Promise<{
    latestVersion: string | null;
    releasedAt: string | null;
    deviceVersions: Array<string | null>;
  }> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in first.');
    }

    /*
     * A failing release store must not take the page down. An empty list reads
     * as "nothing to announce", which is the honest answer when we cannot see
     * what has been published.
     */
    const [assets, deviceVersions] = await Promise.all([
      this.releases.list().catch((): ReleaseAsset[] => []),
      this.devices.versionsFor(caller.userId).catch((): Array<string | null> => []),
    ]);

    /*
     * The newest across every platform, not per platform: a release publishes
     * all three together, so an app comparing against another platform's build
     * would be comparing the same number anyway.
     *
     * Sorted by BUILD TIME rather than by version string. `list()` already
     * returns newest-first, and '0.10.0' sorts below '0.9.0' as a string — the
     * exact bug the web-side comparison exists to avoid, which must not be
     * reintroduced here by sorting the wrong way.
     */
    /*
     * ★ THE HIGHEST VERSION, NOT THE MOST RECENTLY BUILT ★
     *
     * This was `assets.find(...)` over a list sorted by build time, so
     * rebuilding an older installer — or a failed prune leaving an old file
     * with a newer timestamp — made a PREVIOUS version "latest".
     *
     * `newestRelease` also returns the EARLIEST build of that version, so a
     * rebuild at the same version does not move the release date and does not
     * restart the banner's fortnight. Squadron owner, 2026-07-29.
     */
    const newest = newestRelease(assets);

    return {
      latestVersion: newest?.version ?? null,
      releasedAt: newest?.builtAt ?? null,
      // Active devices only — see `versionsFor`. A revoked device is a machine
      // the member has disowned, and holding its old version against them would
      // keep the banner up for a laptop they stopped using.
      deviceVersions,
    };
  }

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
