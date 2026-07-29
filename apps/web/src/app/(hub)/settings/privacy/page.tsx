import { redirect } from 'next/navigation';

/**
 * Moved into Commander Management.
 *
 * A redirect rather than a deletion: this URL is in members' bookmarks, in
 * older links across the site, and quite possibly in a Discord message
 * somebody pinned. A 404 would be a broken promise for no benefit.
 */
export default function PrivacySettingsRedirect(): never {
  /*
   * Straight to the page, not to `?tab=privacy`. That tab was removed on
   * 2026-07-29 and its controls now sit on the first one. `resolveTab` would
   * fall back correctly either way, but pointing at a tab that no longer
   * exists is a bookmark that works by accident.
   */
  redirect('/settings/commander');
}
