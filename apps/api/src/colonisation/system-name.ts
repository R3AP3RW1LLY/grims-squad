/**
 * Repairing the case of a system name.
 *
 * ★ REPORTED BY THE SYSTEM'S OWNER, 2026-08-07 ★
 *
 * They typed "COL 285 SECTOR GL-W C2-12" — their own colony — and the scout answered that we hold
 * no coordinates for it. Our own lookup is case-insensitive so that was never the problem; the
 * galaxy service we fall back to IS case-sensitive, and it answers a mis-cased name with an empty
 * result rather than an error, which is indistinguishable from "no such system".
 *
 * ★ ELITE'S PROCEDURAL NAMES HAVE A FIXED SHAPE ★
 *
 * `Col 285 Sector GL-W c2-12` — title-cased words, then an UPPERCASE two-letter block with a
 * hyphen, then a lowercase class letter with numbers. Catalogue prefixes (HIP, HR, LHS) are
 * genuinely uppercase. That is enough structure to repair what people actually mistype.
 *
 * Only used as a FALLBACK, after the name as typed has already failed — so a name this gets wrong
 * costs nothing that was not already lost.
 */

/** Catalogue prefixes that are uppercase in their real form, not title case. */
const CATALOGUES = new Set(['HIP', 'HR', 'LHS', 'LTT', 'LP', 'NLTT', 'GCRV', 'BD', 'CD', 'CPD', 'CPC', 'WISE', 'PSR', '2MASS', 'IC', 'NGC', 'HD']);

/** The sector block: two letters, a hyphen, one letter. Always uppercase. */
const SECTOR_BLOCK = /^[A-Za-z]{2}-[A-Za-z]$/;

/** The body designation: a class letter then numbers, optionally hyphenated. Always lowercase. */
const DESIGNATION = /^[A-Za-z]\d+(-\d+)?$/;

export function canonicalSystemName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed === '') return '';

  return trimmed
    .split(' ')
    .map((word) => {
      const upper = word.toUpperCase();
      if (CATALOGUES.has(upper)) return upper;
      if (SECTOR_BLOCK.test(word)) return upper;
      if (DESIGNATION.test(word)) return word.toLowerCase();
      // Pure numbers, and anything else, get title case — which leaves digits untouched.
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}
