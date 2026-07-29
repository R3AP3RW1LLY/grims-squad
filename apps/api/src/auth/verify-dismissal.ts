/**
 * The cookie that hides the "not verified" prompt for one session.
 *
 * ★ A COOKIE, NOT sessionStorage ★
 *
 * sessionStorage is scoped to a TAB. Dismiss the banner, open the hub in a
 * second tab, and it is back — which reads as the dismissal not working rather
 * than as a subtle scoping difference.
 *
 * A cookie is per-browser and, because logout clears it, per SESSION. That is
 * what "dismissed for as long as the session persists" actually means.
 *
 * ★ NOT httpOnly, DELIBERATELY ★
 *
 * The browser sets it, because dismissing is a UI action and a round trip to
 * the server to hide a banner would be silly. It carries no secret — its entire
 * content is "this person clicked the X" — so nothing is lost by it being
 * readable, and the server still decides whether there is anything to dismiss.
 */
export const VERIFY_DISMISSED_COOKIE = 'gs_verify_dismissed';
