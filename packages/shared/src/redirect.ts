/**
 * Post-login redirect sanitisation.
 *
 * An open redirect on the OAuth callback is a credential-phishing primitive: the
 * victim follows a genuine `grims-squad.com` link, authenticates on Discord's
 * real consent screen, and gets bounced — freshly authenticated and trusting —
 * to a clone. The address bar was ours right up to the hop.
 *
 * This is an ALLOWLIST, deliberately. Blocklisting `//` and `javascript:` is how
 * every open redirect in the wild was written; the bypass is always the encoding
 * nobody thought of. Here a value must be a single leading slash followed by
 * ordinary path characters, or it is discarded. `//evil.tld` is not "a path that
 * needs cleaning" — it is not a path.
 */

export const DEFAULT_REDIRECT = '/';

/** Generous enough for any real route, short enough to never be worth reflecting. */
const MAX_LENGTH = 512;

const BACKSLASH = 0x5c;
const DEL = 0x7f;
const LAST_CONTROL = 0x1f;

/**
 * Control characters split headers and smuggle newlines; backslashes are
 * normalised to forward slashes by browsers, so `/\evil.tld` goes cross-origin.
 *
 * Written as a scan rather than a regex because a character class containing
 * literal control-character escapes is exactly the kind of line that gets
 * silently corrupted by a tool in the middle and still compiles.
 */
function hasForbiddenChar(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c <= LAST_CONTROL || c === DEL || c === BACKSLASH) return true;
  }
  return false;
}

export function safeRedirectPath(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_REDIRECT;

  const raw = value.trim();
  if (raw === '' || raw.length > MAX_LENGTH) return DEFAULT_REDIRECT;

  // Must be a rooted path, and must not be protocol-relative.
  if (!raw.startsWith('/') || raw.startsWith('//')) return DEFAULT_REDIRECT;
  if (hasForbiddenChar(raw)) return DEFAULT_REDIRECT;

  // Percent-decode ONCE and re-check. `/%2f%2fevil.tld` reads as `///evil.tld`
  // to a browser that decodes before resolving, and `/%5c` is a backslash.
  // Decoding is for INSPECTION only — the original string is what we return, so
  // this can never introduce a decoded payload of its own.
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return DEFAULT_REDIRECT; // malformed escape sequence
  }
  if (decoded.startsWith('//') || hasForbiddenChar(decoded)) return DEFAULT_REDIRECT;
  if (decoded.includes('://')) return DEFAULT_REDIRECT;

  // Resolve against a throwaway origin. Landing anywhere other than that origin
  // means the value carried a scheme or an authority. Asking the URL parser is
  // right precisely because it is the same machinery the browser will use — one
  // more hand-rolled regex is what produces the next bypass.
  try {
    const probe = new URL(raw, 'https://redirect-probe.invalid');
    if (probe.origin !== 'https://redirect-probe.invalid') return DEFAULT_REDIRECT;
    if (probe.username !== '' || probe.password !== '') return DEFAULT_REDIRECT;
    return `${probe.pathname}${probe.search}${probe.hash}`;
  } catch {
    return DEFAULT_REDIRECT;
  }
}
