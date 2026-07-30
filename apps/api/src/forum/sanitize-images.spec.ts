import { describe, it, expect } from 'vitest';
import { renderPostBody, looksDangerous, isOwnMediaSrc, MEDIA_PATH_PREFIX } from './sanitize.js';

/**
 * Images in posts (INV-035).
 *
 * ★ WHY IMAGES GOT THEIR OWN SPEC FILE ★
 *
 * `img` was deliberately absent from the allowlist until now, on the grounds that a
 * REMOTE image lets a post leak every reader's IP to a third-party host — a privacy
 * failure rather than an XSS one. Allowing the tag reopens that question, and the answer
 * is a single rule: the `src` must be a relative path under our own media route.
 *
 * That rule is the entire security boundary for a new capability, so it is tested
 * against the specific bypasses that have historically defeated "is this URL ours"
 * checks, rather than against a couple of happy paths.
 */

const html = (md: string): string => renderPostBody(md).bodyHtml;
const OWN = `${MEDIA_PATH_PREFIX}a1b2c3d4.png`;

describe('isOwnMediaSrc — the whole boundary', () => {
  it('accepts a path the upload endpoint would mint', () => {
    expect(isOwnMediaSrc(OWN)).toBe(true);
    expect(isOwnMediaSrc(`${MEDIA_PATH_PREFIX}abc123`)).toBe(true);
    expect(isOwnMediaSrc(`${MEDIA_PATH_PREFIX}a-b_c.2.webp`)).toBe(true);
  });

  it('MANDATORY: refuses any absolute URL, ours included', () => {
    /*
     * ★ NO HOST COMPARISON HAPPENS AT ALL ★
     *
     * Refusing our own absolute URL is not an oversight — it is the point. "Is this host
     * ours" is a question with a long history of wrong answers, and a relative path is
     * structurally incapable of naming another origin. Nothing generates an absolute URL
     * here, so refusing the form costs nothing and removes the question.
     */
    for (const src of [
      'https://45-63-35-93.sslip.io/v1/media/uploads/x.png',
      'http://localhost:5001/v1/media/uploads/x.png',
      'https://grimssquad.example/v1/media/uploads/x.png',
    ]) {
      expect(isOwnMediaSrc(src), src).toBe(false);
    }
  });

  it('MANDATORY: refuses every classic host-confusion trick', () => {
    /*
     * Each of these defeats a naive "starts with our domain" or "parse and compare host"
     * check. None of them can survive a rule that demands a relative path.
     */
    for (const src of [
      // A suffix that merely begins with our name.
      'https://45-63-35-93.sslip.io.evil.test/v1/media/uploads/x.png',
      // Userinfo: the real host is after the @, and parsers have disagreed about this.
      'https://45-63-35-93.sslip.io@evil.test/v1/media/uploads/x.png',
      'https://evil.test\\@45-63-35-93.sslip.io/v1/media/uploads/x.png',
      // Percent-encoded host.
      'https://45-63-35-93%2esslip%2eio.evil.test/v1/media/uploads/x.png',
      // Protocol-relative: inherits our scheme and reads as a path when skimmed.
      '//evil.test/v1/media/uploads/x.png',
      '/\\evil.test/v1/media/uploads/x.png',
    ]) {
      expect(isOwnMediaSrc(src), src).toBe(false);
    }
  });

  it('MANDATORY: refuses a leading control character or space', () => {
    /*
     * ★ THE BYPASS THIS EXISTS FOR ★
     *
     * A browser strips leading whitespace and C0 controls before fetching. So a `src` of
     * "\\x00https://evil.test/x" fails `startsWith` — and is fetched anyway. The prefix
     * check has to reject these rather than trim them, because "what does a browser do
     * with this byte" is exactly the question this function avoids asking.
     */
    for (const prefix of ['\x00', ' ', '\t', '\n', '\r', '\x0b', '\x1f', '\x7f']) {
      expect(isOwnMediaSrc(`${prefix}${OWN}`), JSON.stringify(prefix)).toBe(false);
      expect(isOwnMediaSrc(`${prefix}https://evil.test/x.png`), JSON.stringify(prefix)).toBe(false);
    }
  });

  it('MANDATORY: refuses path traversal that satisfies the prefix', () => {
    // Satisfies startsWith and is not a media path. The serve endpoint validates its own
    // id, but a stored src that only LOOKS contained is a trap for the next reader.
    expect(isOwnMediaSrc(`${MEDIA_PATH_PREFIX}../../etc/passwd`)).toBe(false);
    expect(isOwnMediaSrc(`${MEDIA_PATH_PREFIX}..%2f..%2fetc`)).toBe(false);
  });

  it('MANDATORY: refuses a query string or fragment', () => {
    // Neither has meaning here, so their presence means the string did not come from us.
    // A query is also where an open-redirect payload would hide.
    expect(isOwnMediaSrc(`${OWN}?x=1`)).toBe(false);
    expect(isOwnMediaSrc(`${OWN}#frag`)).toBe(false);
    expect(isOwnMediaSrc(`${OWN}?next=//evil.test`)).toBe(false);
  });

  it('MANDATORY: refuses dangerous schemes outright', () => {
    for (const src of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'data:image/svg+xml,<svg onload=alert(1)>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      expect(isOwnMediaSrc(src), src).toBe(false);
    }
  });

  it('refuses an empty id, and an absurdly long one', () => {
    expect(isOwnMediaSrc(MEDIA_PATH_PREFIX)).toBe(false);
    expect(isOwnMediaSrc(`${MEDIA_PATH_PREFIX}${'a'.repeat(200)}`)).toBe(false);
  });

  it('refuses a nested path under the prefix', () => {
    // One flat id, which is what the endpoint mints. A slash would mean a directory
    // structure this route does not have.
    expect(isOwnMediaSrc(`${MEDIA_PATH_PREFIX}a/b.png`)).toBe(false);
  });

  it('MANDATORY: the id pattern is anchored and character-restricted', () => {
    /*
     * ★ THE TEST THAT ACTUALLY HAS TEETH, AND WHY IT EXISTS ★
     *
     * Mutation testing showed the behavioural cases above are weaker than they look:
     * deleting the control-character check, deleting the traversal check, and weakening
     * `startsWith` to `includes` each left the entire image suite GREEN. Not because the
     * suite is bad, but because ONE guard — the id pattern — rejects every payload on its
     * own, so removing any of the others changes nothing observable.
     *
     * That makes the id pattern the thing worth pinning directly. Asserted structurally
     * because the property is about the PATTERN (anchoring, allowed characters), and a
     * behavioural test cannot distinguish "anchored" from "happens to reject my examples".
     *
     * If somebody widens this to allow subdirectories or a query string — both plausible
     * requests — this test fails and points at the guards that then have to carry weight.
     */
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const src = readFileSync(new URL('./sanitize.ts', import.meta.url), 'utf8');

    const line = src.split('\n').find((l) => l.includes('const MEDIA_ID'));
    expect(line, 'MEDIA_ID should be a named constant').toBeDefined();

    // Anchored at BOTH ends. Unanchored, it would match our id anywhere in a hostile
    // string — the single most dangerous change available to this pattern.
    expect(line).toContain('/^');
    expect(line).toMatch(/\$\/;?\s*$/);

    // None of the characters that turn an id into a path, scheme, query or fragment.
    for (const forbidden of ['/', '\\', ':', '?', '#', '&', '%']) {
      expect(line, `MEDIA_ID must not permit ${forbidden}`).not.toContain(`${forbidden}]`);
    }

    // Bounded length.
    expect(line).toMatch(/\{0,\d+\}/);
  });

  it('MANDATORY: a loosened id pattern cannot smuggle a host', () => {
    /*
     * The behavioural companion to the structural test above. Every one of these depends
     * on the id pattern refusing a slash or a colon — asserted here as a group so the
     * intent is legible: an id may not contain anything that could name another origin.
     */
    for (const evil of [
      'x.png/../../evil',
      'https:evil.test',
      'x%2f..%2fevil',
      'x:1',
      'x&y=1',
      'x#y',
      '.hidden',
      '..',
    ]) {
      expect(isOwnMediaSrc(`${MEDIA_PATH_PREFIX}${evil}`), evil).toBe(false);
    }
  });
});

describe('rendering an image in a post', () => {
  it('keeps an image the member uploaded', () => {
    const out = html(`![a screenshot](${OWN})`);

    expect(out).toContain('<img');
    expect(out).toContain(`src="${OWN}"`);
    expect(out).toContain('alt="a screenshot"');
  });

  it('MANDATORY: forces lazy loading, so a guide does not block on a dozen shots', () => {
    // Set by the transform rather than accepted from the author, so it is true of the
    // STORED html and every consumer inherits it.
    const out = html(`![x](${OWN})`);
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('decoding="async"');
  });

  it('MANDATORY: a remote image becomes text, not a broken image', () => {
    /*
     * The privacy rule, and the reason the element is REPLACED rather than stripped: an
     * `img` with no src renders a broken-image icon, which reads as "the site lost my
     * picture". Keeping the author's alt text preserves the meaning of the sentence
     * around it and says what happened.
     */
    const out = html('![my ship](https://evil.test/tracker.png)');

    expect(out).not.toContain('<img');
    expect(out).not.toContain('evil.test');
    expect(out).toContain('[image: my ship]');
  });

  it('says something useful even with no alt text', () => {
    const out = html('![](https://evil.test/tracker.png)');
    expect(out).toContain('[image removed: not hosted here]');
  });

  /*
   * ★ THE THREE TESTS BELOW ASSERT THE *LIVE* PROPERTY, NOT THE ABSENCE OF A SUBSTRING ★
   *
   * My first versions asserted the payload text was gone. All three failed, and the
   * sanitiser was right in every case: markdown-it with `html: false` ESCAPES raw HTML
   * rather than removing it, so `<img onerror=...>` becomes `&lt;img onerror=...&gt;` —
   * visible text, not an element. It cannot execute, and it is what somebody who typed
   * those characters should see.
   *
   * `sanitize.spec.ts` already documents this exact lesson in its script-tag case. I
   * repeated the mistake it had recorded, which is a good argument for the note being
   * where the next person will hit it too.
   */
  it('MANDATORY: a javascript: image source produces no image at all', () => {
    const out = html('![x](javascript:alert(1))');

    // markdown-it refuses the scheme outright and emits the literal text, which is
    // stronger than an img with a stripped src: there is no element.
    expect(out).not.toMatch(/<\s*img/i);
    expect(looksDangerous(out)).toBe(false);
  });

  it('MANDATORY: an onerror handler never becomes live', () => {
    /*
     * `<img src=x onerror=alert(1)>` is the most common XSS payload in existence. Layer 1
     * escapes it to text so there is no element for the handler to attach to; the
     * attribute allowlist is the backstop if that ever changes.
     */
    const out = html(`<img src="${OWN}" onerror="alert(1)">`);

    expect(out).not.toMatch(/<\s*img/i);
    // Escaped, so the author can see what they typed.
    expect(out).toContain('&lt;img');
    expect(looksDangerous(out)).toBe(false);
  });

  it('MANDATORY: srcset cannot arrive as live markup', () => {
    /*
     * Markdown cannot produce srcset, so it reaches here only through raw HTML — which
     * layer 1 escapes. Asserted anyway, because srcset is parsed differently by different
     * engines and is exactly the attribute a future "responsive images" change would
     * reach for; this test then becomes the thing that objects.
     */
    const out = html(`<img src="${OWN}" srcset="https://evil.test/x.png 2x">`);

    expect(out).not.toMatch(/<\s*img/i);
    expect(looksDangerous(out)).toBe(false);
  });

  it('MANDATORY: srcset is absent from the ALLOWLIST, not just unreachable', () => {
    /*
     * The test above proves layer 1 handles it. This proves layer 2 would too, by
     * checking the allowlist itself — because "unreachable today" is not a guarantee, and
     * the two layers exist precisely so neither has to be.
     */
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const src = readFileSync(new URL('./sanitize.ts', import.meta.url), 'utf8');
    const imgLine = src.split('\n').find((l) => l.trimStart().startsWith('img: ['));

    expect(imgLine, 'the img attribute allowlist should exist').toBeDefined();
    expect(imgLine).not.toContain('srcset');
    expect(imgLine).not.toContain('sizes');
    expect(imgLine).toContain('src');
  });

  it('MANDATORY: a data: URI image is refused', () => {
    // Allowing data: selectively is how the exception becomes the hole — and
    // data:image/svg+xml is a script container.
    const out = html('![x](data:image/svg+xml,<svg onload=alert(1)>)');
    expect(out).not.toContain('<img');
    expect(looksDangerous(out)).toBe(false);
  });

  it('MANDATORY: an image inside a link still cannot escape either rule', () => {
    const out = html(`[![shot](${OWN})](https://inara.cz)`);

    expect(out).toContain('<img');
    expect(out).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(looksDangerous(out)).toBe(false);
  });

  it('a guide with several screenshots renders them all', () => {
    const body = [1, 2, 3].map((n) => `![step ${n}](${MEDIA_PATH_PREFIX}shot${n}.png)`).join('\n\n');
    const out = html(body);

    expect(out.match(/<img/g)).toHaveLength(3);
    expect(looksDangerous(out)).toBe(false);
  });
});

describe('the rest of the sanitiser is unaffected', () => {
  it('still refuses script, svg and iframe', () => {
    for (const payload of [
      '<script>alert(1)</script>',
      '<svg onload=alert(1)></svg>',
      '<iframe src="https://evil.test"></iframe>',
    ]) {
      expect(looksDangerous(html(payload)), payload).toBe(false);
    }
  });

  it('still hardens ordinary links', () => {
    const out = html('[Inara](https://inara.cz)');
    expect(out).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(out).toContain('target="_blank"');
  });
});
