import { Controller, Get, Inject } from '@nestjs/common';
import { Permission } from '@grims/shared';
import { RequiresPermission } from '../authz/requires-permission.guard.js';
import { ChangelogStore } from './changelog.store.js';
import { readPendingChangelog } from './pending.js';

/**
 * The changelog: what each deploy changed, in the commit messages' own words.
 *
 * ★ TWO DOORS WITH TWO GATES, DELIBERATELY ★
 *
 * The released list is for EVERY member — the global AuthGuard requires a
 * session and nothing more, matching the nav entry's `requires: null`. What
 * has shipped is already visible by using the site; the list only saves
 * members discovering it by tripping over it.
 *
 * The PENDING preview is different in kind: it describes work that is merged
 * but NOT deployed, which is a promise the site has not kept yet. Members
 * reading "the outfitter now does X" before the deploy would find a page that
 * does not do X. SITE_CONFIG gates it because previewing an undeployed
 * release is site operation, and the webmaster override already lives inside
 * `effectiveMask` — the same reasoning as the AI conversations screen, where
 * using the ordinary permission satisfies the owner's "visible to the
 * webmaster" requirement without a second code path that could drift.
 */
@Controller('v1/changelog')
export class ChangelogController {
  constructor(@Inject(ChangelogStore) private readonly store: ChangelogStore) {}

  /** Every recorded release, newest first. */
  @Get()
  async list() {
    return { releases: await this.store.releases() };
  }

  /**
   * The not-yet-deployed preview, from `.changelog-pending.json` — see
   * `pending.ts` for why this is a file rather than the API running git.
   * `pending: null` is a real answer meaning "nothing staged here", not an
   * error: production never has the file, and that is by design.
   */
  @Get('pending')
  @RequiresPermission(Permission.SITE_CONFIG)
  pending() {
    return { pending: readPendingChangelog() };
  }
}
