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
export default function MovedColonisationPage(): never {
  // The squadron board, because that is what this page led with before it was split in three.
  permanentRedirect('/colonisation/squadron');
}
