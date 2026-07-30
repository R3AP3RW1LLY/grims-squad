import { notFound, redirect } from 'next/navigation';
import { getHandleForId } from '../../../../../lib/api';

/**
 * A mention link, resolved.
 *
 * ★ WHY MENTIONS POINT HERE AND NOT STRAIGHT AT A PROFILE ★
 *
 * A mention stores a user ID. That is the whole reason a mention survives somebody renaming
 * themselves — the alternative, scanning stored text for `@name` at read time, breaks every past
 * mention the moment a member changes their display name.
 *
 * But profiles are addressed by HANDLE, so an id has to become one somewhere. Doing it while
 * rendering a post would mean a roster lookup per mention per page view, which is exactly the cost
 * storing an id was meant to avoid. Doing it here means it happens once, when somebody clicks.
 *
 * ★ A REDIRECT, NOT A SECOND PROFILE PAGE ★
 *
 * The member ends up on the canonical `/members/<handle>` URL, which is the one worth sharing and
 * the one already built. Rendering the profile here instead would be a second copy of that page,
 * reachable by a different address, drifting from the first.
 */

export const dynamic = 'force-dynamic';

export default async function MentionRedirect({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;

  const res = await getHandleForId(userId);

  /*
   * 404 for every reason it could fail — no such id, a banned account, the API unreachable. A
   * distinct "that member was removed" page would confirm the id was real, which is a disclosure
   * the members routes already decline to make.
   */
  if (res === null) notFound();

  redirect(`/members/${encodeURIComponent(res.handle)}`);
}
