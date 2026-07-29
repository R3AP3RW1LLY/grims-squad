/**
 * Is there a newer build than the one running?
 *
 * ★ A BANNER, NOT AN UPDATER ★
 *
 * Squadron owner's decision, 2026-07-29: no over-the-air updates. Shipping an
 * auto-updater needs a code-signing certificate to be worth anything — without
 * one, an app that downloads and runs a binary on its own is a worse idea than
 * one that asks the member to fetch it from a page they can see.
 *
 * So this decides ONE thing: whether to show a banner. Nothing is downloaded,
 * nothing is executed, and the button opens the website in the member's own
 * browser where the address bar is visible.
 */

/**
 * Compares two versions.
 *
 * ★ NUMERIC, SEGMENT BY SEGMENT — NOT STRING COMPARISON ★
 *
 * `'0.10.0' > '0.9.0'` is FALSE as strings, because '1' sorts before '9'. That
 * is the single most common way a version check silently stops working, and it
 * only starts failing at the tenth release — long after anybody is watching.
 *
 * Pre-release suffixes are ignored rather than ordered: `1.2.0-beta.1` compares
 * as `1.2.0`. Getting pre-release precedence right is a specification of its
 * own, and we do not publish them.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] =>
    // `?? ''` rather than a non-null assertion: `split` always returns at least
    // one element, but saying so with `!` is a claim the compiler cannot check
    // and the next edit could invalidate.
    ((v.trim().replace(/^v/i, '').split('-')[0]) ?? '')
      .split('.')
      .map((n) => Number.parseInt(n, 10))
      // A non-numeric segment becomes 0 rather than NaN, which would make every
      // comparison false and hide updates forever.
      .map((n) => (Number.isFinite(n) ? n : 0));

  const left = parts(a);
  const right = parts(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    // Missing segments are 0, so `1.2` and `1.2.0` are the same version.
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Should the member be told there is an update?
 *
 * ★ STRICTLY NEWER, AND NEVER ON MISSING DATA ★
 *
 * A null or unparseable latest version means the hub has published nothing, or
 * could not be reached. Showing a banner then would be an update notice for a
 * download that does not exist — and a member who follows it and finds nothing
 * will ignore the next one, which will be real.
 */
export function updateAvailable(current: string, latest: string | null): boolean {
  if (latest === null || latest.trim() === '') return false;
  if (current.trim() === '') return false;
  return compareVersions(latest, current) > 0;
}
