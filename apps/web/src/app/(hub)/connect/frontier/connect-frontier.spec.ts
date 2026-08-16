import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The link from the app to Frontier.
 *
 * ★ SQUADRON OWNER, 2026-08-16 ★
 *
 * "whe i click connect with frontier in the companion app it sends me to the suqadron website not
 * frontier! ... I CAN NOT USE THE APP AT ALL"
 *
 * ★ THE SHAPE OF THE BUG ★
 *
 * `POST /v1/me/capi/start` existed and worked. NOTHING IN THE WEB APP EVER CALLED IT. The companion
 * opened /settings/privacy and expected the member to find a Connect button that had never been
 * built — so the mandatory step had no way to be completed by anybody, on any surface.
 *
 * Both halves are asserted here because either alone is the same dead end: a page that starts the
 * handshake but no app pointing at it, or an app pointing at a page that does nothing.
 */

const WEB = join(process.cwd(), 'src/app/(hub)/connect/frontier');
const MAIN = join(process.cwd(), '../companion/src/main.ts');

describe('the website can start the handshake', () => {
  it('★ MANDATORY: the page calls capiStart ★', () => {
    // The route that had no caller. This is the caller.
    expect(readFileSync(join(WEB, 'start-frontier.tsx'), 'utf8')).toContain('/v1/me/capi/start');
  });

  it('★ MANDATORY: it forwards to Frontier rather than showing a second button ★', () => {
    /*
     * The member already pressed a button — in the app, which is what sent them here. Asking again
     * is a step that exists only because of how this is plumbed, and reads as the app not working.
     */
    const src = readFileSync(join(WEB, 'start-frontier.tsx'), 'utf8');

    expect(src).toContain('window.location.replace(url)');
    expect(src, 'Back from Frontier must not start a second handshake').not.toContain(
      'window.location.assign',
    );
  });

  it('★ MANDATORY: a signed-out browser is TOLD, not left blank ★', () => {
    // The real failure: app paired, website not signed in, capiStart answers 401. Silence there is
    // the same dead end being fixed.
    expect(readFileSync(join(WEB, 'start-frontier.tsx'), 'utf8')).toContain('setProblem');
  });
});

describe('the app points at it', () => {
  it('★ MANDATORY: the companion opens /connect/frontier, not a settings page ★', () => {
    const src = readFileSync(MAIN, 'utf8');
    const handler = src.slice(src.indexOf("ipcMain.handle('connectFrontier'"));

    /*
     * Comments stripped first. The block above explains the old path by name, and an assertion that
     * reads prose passes or fails on the wording rather than on what the app opens — the same trap
     * that made an earlier IPC test green while the code underneath it was wrong.
     */
    const code = handler.slice(0, 2_400).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

    expect(code).toContain('/connect/frontier');
    expect(code, 'the settings page has no Connect button and never had one').not.toContain(
      '/settings/privacy',
    );
  });
});
