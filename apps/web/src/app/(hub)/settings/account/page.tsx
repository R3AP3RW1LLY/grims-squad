import { redirect } from 'next/navigation';

/**
 * Moved into Commander Management.
 *
 * A redirect rather than a deletion: this URL is in members' bookmarks, in
 * older links across the site, and quite possibly in a Discord message
 * somebody pinned. A 404 would be a broken promise for no benefit.
 */
export default function AccountSettingsRedirect(): never {
  redirect('/settings/commander?tab=account');
}
