import { describe, it, expect } from 'vitest';
import { isAllowedSignatureLink, SIGNATURE_LINK_HOSTS } from './forum-signature.js';

/**
 * The signature link allowlist.
 *
 * ★ WHY THIS IS THE MOST-TESTED FUNCTION IN THE FEATURE ★
 *
 * A signature link is rendered under EVERY post its author has ever written. That makes it the
 * highest-reach field on the site: one bad value is not one bad page, it is retroactively every
 * page that member has posted on, and deleting one post does not fix it.
 *
 * So the check is a suffix match anchored on a dot, and the tests below are mostly about the ways
 * a host can be made to LOOK like an allowed one.
 */

describe('signature banner links', () => {
  describe('accepts', () => {
    it('an exact allowed host', () => {
      expect(isAllowedSignatureLink('https://inara.cz/elite/cmdr/12345/')).toBe(true);
    });

    it('www and other subdomains of an allowed host', () => {
      expect(isAllowedSignatureLink('https://www.inara.cz/')).toBe(true);
      expect(isAllowedSignatureLink('https://m.twitch.tv/somebody')).toBe(true);
    });

    it('every host on the list', () => {
      // Guards against somebody adding a host to the list in a shape the matcher cannot match.
      for (const host of SIGNATURE_LINK_HOSTS) {
        expect(isAllowedSignatureLink(`https://${host}/x`)).toBe(true);
      }
    });
  });

  describe('MANDATORY: refuses hosts that merely look allowed', () => {
    it('a suffix attack', () => {
      /*
       * THE ONE THIS FUNCTION EXISTS FOR. `inara.cz.evil.test` contains "inara.cz" and would pass
       * any `includes()` check. Anchoring on a leading dot is what makes the difference between a
       * subdomain of ours and somebody else's domain wearing our name.
       */
      expect(isAllowedSignatureLink('https://inara.cz.evil.test/')).toBe(false);
    });

    it('a prefix attack', () => {
      expect(isAllowedSignatureLink('https://eviltwitch.tv/')).toBe(false);
      expect(isAllowedSignatureLink('https://notinara.cz/')).toBe(false);
    });

    it('the allowed host in the PATH rather than the host', () => {
      expect(isAllowedSignatureLink('https://evil.test/inara.cz')).toBe(false);
      expect(isAllowedSignatureLink('https://evil.test/?x=https://inara.cz')).toBe(false);
    });

    it('MANDATORY: the allowed host in the CREDENTIALS', () => {
      /*
       * `https://inara.cz@evil.test/` points at evil.test. Everything before the `@` is a username
       * the browser discards — and it is exactly the part a reader's eye lands on. Refused outright
       * rather than parsed around.
       */
      expect(isAllowedSignatureLink('https://inara.cz@evil.test/')).toBe(false);
      expect(isAllowedSignatureLink('https://user:pass@inara.cz/')).toBe(false);
    });

    it('a host that differs only in case is still matched, not bypassed', () => {
      // Hostnames are case-insensitive; `INARA.CZ` is the same site and must not be a way in OR a
      // false rejection. `URL` lower-cases the hostname, and the check lower-cases again.
      expect(isAllowedSignatureLink('https://INARA.CZ/')).toBe(true);
      expect(isAllowedSignatureLink('https://INARA.CZ.EVIL.TEST/')).toBe(false);
    });
  });

  describe('MANDATORY: refuses schemes that are not https', () => {
    it('plain http, even to an allowed host', () => {
      // A plaintext link from a page served over TLS is a downgrade the reader did not choose, and
      // every host on the list supports https.
      expect(isAllowedSignatureLink('http://inara.cz/')).toBe(false);
    });

    it('javascript:', () => {
      expect(isAllowedSignatureLink('javascript:alert(1)')).toBe(false);
      // Whitespace and case are the classic ways this one is smuggled past a naive check.
      expect(isAllowedSignatureLink('JaVaScRiPt:alert(1)')).toBe(false);
      expect(isAllowedSignatureLink(' javascript:alert(1)')).toBe(false);
    });

    it('data: and other schemes', () => {
      expect(isAllowedSignatureLink('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(isAllowedSignatureLink('ftp://inara.cz/')).toBe(false);
      expect(isAllowedSignatureLink('file:///etc/passwd')).toBe(false);
    });
  });

  describe('refuses what is not a URL at all', () => {
    it('empty and whitespace', () => {
      expect(isAllowedSignatureLink('')).toBe(false);
      expect(isAllowedSignatureLink('   ')).toBe(false);
    });

    it('a bare host with no scheme', () => {
      // Deliberately NOT helpfully prefixed with https. Guessing what somebody meant and storing
      // it is how a link nobody typed ends up under their posts.
      expect(isAllowedSignatureLink('inara.cz')).toBe(false);
    });

    it('nonsense', () => {
      expect(isAllowedSignatureLink('not a url')).toBe(false);
      expect(isAllowedSignatureLink('://')).toBe(false);
    });
  });
});
