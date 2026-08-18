/**
 * The identity of a station an officer has claimed for the squadron.
 *
 * ★ THE TABLE WAS READ BY THE RANKING AND WRITTEN BY NOTHING ★
 *
 * `station_ownership_claims` shipped with the buy-location ordering, is read on every where-to-buy
 * query, and had no route, no service method and no screen. The schema explains at length why an
 * officer's own claim is needed — "it does not cover a station we hold but never built here" — and
 * no officer could make one. That is the fourth time in this codebase a capability has been
 * complete everywhere except where somebody could reach it.
 *
 * ★ WHY THE KEY IS BUILT HERE ★
 *
 * The reader splits on the first `/` and matches the tail against a station name. A writer that
 * disagreed about that shape would produce rows that are stored, listed, and silently ignored by
 * the ranking they exist to change — a claim that appears to work and does nothing. One function
 * builds it, both sides use it.
 */

/**
 * `"<systemAddress>/<stationName>"`.
 *
 * The address rather than the system NAME, because two systems can be spelled differently by two
 * sources and the address cannot. Where the catalogue has no address for a station — a hand-typed
 * row, a port too new to be imported — the system name stands in: it keeps the key unique enough to
 * be a primary key, and the half the ranking actually reads is the station name either way.
 */
export function stationClaimKey(systemAddressOrName: string, stationName: string): string {
  const left = systemAddressOrName.trim();
  const right = stationName.trim();
  if (left === '' || right === '') return '';
  /*
   * A `/` in the LEFT half would move the split point and hand the reader a truncated station name,
   * so it is replaced rather than trusted. The right half may contain one — the reader rejoins
   * everything after the first separator — and station names with a slash do exist.
   */
  return `${left.replace(/\//g, '_')}/${right}`;
}

/**
 * The station name back out of a key.
 *
 * The same split the ranking does, expressed once so a change to the format cannot be applied to
 * the reader and forgotten in the writer.
 */
export function stationNameFromClaimKey(key: string): string {
  return key.split('/').slice(1).join('/').trim();
}

/** `squadron` or `member`, or null for anything else. */
export type ClaimOwnership = 'squadron' | 'member';

/**
 * Narrows whatever arrived to something the ranking understands.
 *
 * Null rather than a default, and the caller refuses. The schema says a third value "should degrade
 * to 'not ours' rather than break the sort" — which is the right behaviour for a row already in the
 * table, and the wrong behaviour for an officer pressing a button: silently storing a claim that
 * ranks as unowned is worse than telling them the value was not understood.
 */
export function readClaimOwnership(value: unknown): ClaimOwnership | null {
  return value === 'squadron' || value === 'member' ? value : null;
}
