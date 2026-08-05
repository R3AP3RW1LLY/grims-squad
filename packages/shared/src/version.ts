/**
 * The platform version — ONE number for the website and the companion app.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "lets keep the website and companion app versioned the same" — so there is exactly one place a
 * version is written, and it is here. Both sidebars print it; every changelog release records it;
 * the companion's own package.json (which electron-builder's updater requires) is held equal to
 * it by a spec, so the two cannot drift silently — bumping one without the other fails the build
 * rather than shipping a lie.
 *
 * ★ ITS OWN MODULE, ON PURPOSE ★
 *
 * Both sidebars are CLIENT bundles, and the shared barrel reaches node:crypto — the same reason
 * ./leaderboards and ./builds are subpath exports. This module imports nothing and never may.
 */
export const PLATFORM_VERSION = '0.5.1';
