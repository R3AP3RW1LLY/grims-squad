/**
 * Forum signatures (P2 — the block under a member's posts).
 *
 * ★ WHAT THE OWNER ASKED FOR ★
 *
 * Squadron owner, 2026-07-30: "we also need an epic forum signature generator, make this an
 * awesome generator please make it feature ritch include the users avatar from discord as the
 * default, but allow users to upload a signature avatar if they want to customize it, also allow
 * them to make a custom banner to go on their signature that links to inara commander profile or
 * something of that nature or a stream channel if they are a streamer etc, make this fully
 * customizable ... the avatar upload should only be displayed on the forums and not replace their
 * global avatar that discord imports."
 *
 * ★ WHY THIS FILE EXISTS RATHER THAN VALIDATION SPRINKLED ACROSS THE API ★
 *
 * A signature is member-authored content rendered under EVERY post they have ever written. That is
 * the largest reach any single field on this site has: one bad value is not one bad page, it is a
 * hundred. So every limit is stated once, here, and both the editor and the server read it — an
 * editor that permits what the server refuses teaches members the site is broken, and an editor
 * stricter than the server hides a hole rather than closing it.
 */

/** Characters in the one-line tagline. Two sentences, not a paragraph. */
export const SIGNATURE_TAGLINE_MAX = 120;

/** Characters in the banner's link text. It is a label, not a second tagline. */
export const SIGNATURE_LABEL_MAX = 60;

/**
 * The accents a signature may use.
 *
 * ★ A CLOSED SET, AND WHY IT IS NOT A COLOUR PICKER ★
 *
 * "Fully customizable" was the instruction, and a free colour field is the naive reading of it.
 * It is also how a member ends up with near-black text on our near-black panel — not maliciously,
 * just by picking a colour that looked fine in the picker. Every one of those is a support message
 * from somebody who cannot read their own signature.
 *
 * These are the site's own accents, so every combination is legible against every surface we
 * render, in both the light and dark treatments, without anybody having to check.
 */
export const SIGNATURE_ACCENTS = ['orange', 'cyan', 'gold', 'steel'] as const;
export type SignatureAccent = (typeof SIGNATURE_ACCENTS)[number];

/**
 * Hosts a signature banner may link to.
 *
 * ★ AN ALLOWLIST, BECAUSE A SIGNATURE IS ADVERTISING SPACE ★
 *
 * The owner named the destinations: "inara commander profile or something of that nature or a
 * stream channel if they are a streamer". That is a short list, and writing it down costs nothing.
 *
 * An arbitrary URL is a different feature. A link under every post a member has written is a
 * hundred impressions a day on a site of 107 people, and the first time one points somewhere
 * unpleasant it is a moderation problem on every page that member has ever posted on — retroactive,
 * and not fixable by deleting one post.
 *
 * ★ SUBDOMAINS COUNT, ARBITRARY PREFIXES DO NOT ★
 *
 * `inara.cz` matches `inara.cz` and `www.inara.cz`. It does NOT match `inara.cz.evil.test`, which
 * is the entire reason this is a suffix check anchored on a dot rather than `includes()`.
 */
export const SIGNATURE_LINK_HOSTS = [
  'inara.cz',
  'twitch.tv',
  'youtube.com',
  'youtu.be',
  'kick.com',
  'edsm.net',
  'elitedangerous.com',
] as const;

/**
 * Whether a URL is one a signature may point at.
 *
 * HTTPS only. A plaintext link from a page served over TLS is a downgrade the reader did not
 * choose, and every host on the list above supports HTTPS.
 */
export function isAllowedSignatureLink(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;
  /*
   * Credentials in a URL (`https://user:pass@host/`) are refused outright. They are a classic way
   * to make a link LOOK like it points at an allowed host — the part before the `@` is what a
   * reader's eye lands on, and everything before it is ignored by the browser.
   */
  if (url.username !== '' || url.password !== '') return false;

  const host = url.hostname.toLowerCase();
  return SIGNATURE_LINK_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** A signature as the API accepts it. Every field optional: saving one control saves one field. */
export interface SignatureInput {
  readonly avatarMediaId?: string | null;
  readonly tagline?: string | null;
  readonly bannerMediaId?: string | null;
  readonly bannerUrl?: string | null;
  readonly bannerLabel?: string | null;
  readonly accent?: SignatureAccent;
  readonly showRank?: boolean;
  readonly showCommander?: boolean;
  readonly enabled?: boolean;
}

/** A signature as it is rendered. Paths only — never a third-party address. */
export interface SignatureView {
  readonly avatarUrl: string | null;
  readonly tagline: string | null;
  readonly bannerUrl: string | null;
  readonly bannerLink: string | null;
  readonly bannerLabel: string | null;
  readonly accent: SignatureAccent;
  readonly showRank: boolean;
  readonly showCommander: boolean;
  readonly enabled: boolean;
}
