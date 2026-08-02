import { permanentRedirect } from 'next/navigation';

/**
 * The old home of colonisation, kept as a redirect.
 *
 * ★ THE ROUTE MOVED WITH THE CATEGORY; LINKS DID NOT ★
 *
 * Every project link shared in Discord since this feature shipped points at the old path, and a 404
 * on one of those is how somebody concludes the board was taken down.
 *
 * `permanentRedirect`, not `redirect`: the move is permanent, and a 308 lets anything that caches
 * links stop asking.
 */
export default async function MovedProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<never> {
  const { id } = await params;
  permanentRedirect(`/colonisation/${encodeURIComponent(id)}`);
}
