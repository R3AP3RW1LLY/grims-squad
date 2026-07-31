import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLAYER = readFileSync(resolve(HERE, 'youtube-consent.tsx'), 'utf8');
const CSP = readFileSync(resolve(HERE, '../../lib/csp.ts'), 'utf8');

/**
 * Clicking a video actually plays it.
 *
 * ★ SQUADRON OWNER, 2026-07-31 ★
 *
 * "when i click a video to play, it just shows a stale black screen it does not actually play the
 * video".
 *
 * ★ WHAT IT WAS ★
 *
 * The iframe was sandboxed WITHOUT `allow-same-origin`, which gives it an opaque origin. YouTube's
 * player cannot reach its own storage from there, so it fails during start-up and paints a black
 * rectangle. Nothing on our side errored, because nothing on our side went wrong — which is why it
 * looked like a stale or broken embed rather than a permissions problem.
 *
 * The comment defending the omission was also wrong, and that is the part worth guarding. It said
 * the flag would let the frame "reach our origin". It would not: `allow-same-origin` keeps the
 * FRAME's own origin, and the same-origin policy still separates youtube-nocookie.com from us.
 * A plausible-sounding security rationale is exactly the kind of thing that gets "restored" later.
 */

/**
 * The sandbox string as the browser actually receives it.
 *
 * Guards here must read the CODE, not the comments. The first version of the allow-top-navigation
 * check matched the word inside the comment that explains why it is absent, and failed — a guard
 * that cannot tell an explanation from behaviour is one that gets deleted instead of fixed. This is
 * the second time that exact mistake has been made in this codebase, hence a named helper.
 */
function sandboxAttr(): string {
  const code = PLAYER.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // `[\s\S]*?` rather than `\s*\n?\s*` — the call is formatted across lines by the formatter, and
  // the exact wrapping is not something a guard should depend on.
  return /'sandbox',[\s\S]*?'([^']+)'/.exec(code)?.[1] ?? '';
}

describe('the sandbox lets the player start', () => {
  it('MANDATORY: allow-same-origin is present', () => {
    // Its absence is the entire bug. A black box, every time, on every video.
    expect(sandboxAttr()).toContain('allow-same-origin');
  });

  it('MANDATORY: allow-scripts is present', () => {
    // The player is JavaScript. Without this it cannot run at all.
    expect(sandboxAttr()).toContain('allow-scripts');
  });

  it('MANDATORY: allow-top-navigation is NOT granted', () => {
    /*
     * This is the flag that actually protects the reader — it is what stops an embed navigating the
     * page out from under them. Distinct from allow-same-origin, which never did that job.
     */
    expect(sandboxAttr()).not.toContain('allow-top-navigation');
  });

  it('does not grant allow-forms or allow-modals either', () => {
    // Nothing a video player legitimately needs. Kept narrow on purpose.
    expect(sandboxAttr()).not.toMatch(/allow-forms|allow-modals/);
  });
});

describe('the frame it builds', () => {
  it('MANDATORY: uses the nocookie host, which CSP is the one that allows', () => {
    /*
     * `frame-src` names exactly one host. Pointing the player at youtube.com would be blocked and
     * would produce the same black rectangle from a completely different cause.
     */
    expect(PLAYER).toMatch(/youtube-nocookie\.com\/embed\//);
    expect(CSP).toMatch(/frame-src https:\/\/www\.youtube-nocookie\.com/);
  });

  it('MANDATORY: re-validates the id before it reaches a URL', () => {
    /*
     * The id is read out of the DOM, and the DOM is not a trust boundary — an extension, a devtools
     * edit, or a future bug rendering an unvalidated document all put an arbitrary string here.
     */
    expect(PLAYER).toMatch(/\[A-Za-z0-9_-\]\{11\}/);
  });

  it('autoplays, because the click WAS the intent to watch', () => {
    // A reader who pressed play and then has to press play again reports it as broken.
    expect(PLAYER).toMatch(/autoplay=1/);
  });
});
