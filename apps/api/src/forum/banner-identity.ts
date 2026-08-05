/**
 * What a banner's text layers resolve to for one member.
 *
 * ★ DECLARED SERVER-SIDE, MIRRORING THE RENDERER ★
 *
 * The renderer lives in the web app and owns the drawing; this is the shape the API promises to
 * fill. Duplicating the interface rather than importing across the boundary is deliberate — the
 * API has no business depending on a React component, and the two are checked against each other
 * by the thread response's type at the call site.
 */
export interface BannerIdentity {
  readonly commander: string | null;
  readonly squadronRank: string | null;
  readonly squadron: string;
  readonly allegiance: string | null;
  readonly ranks: Record<string, string | null>;
  readonly ship: string | null;
  readonly memberSince: string | null;
  readonly lastPlayed: string | null;
}
