import { describe, it, expect } from 'vitest';
import {
  parseDisplaySettings,
  canOverlay,
  destinationFor,
  explain,
  UNKNOWN_DISPLAY,
} from './display-mode.js';

/**
 * Which display mode Elite is in, and therefore where a panel can be drawn.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "this needs to accomodate all graphics options elite dangerous offers! this is non-negotiable!"
 *
 * It is accommodated by DETECTING the mode and putting the panel somewhere it will be seen — never
 * by drawing a transparent window over an exclusive-fullscreen game, which shows nothing while
 * every part of the app reports success. That silent failure is what this suite exists to prevent.
 */

/** The real file, read from a live install on 2026-08-02 while the game was set to Borderless. */
const REAL = `<?xml version="1.0" encoding="UTF-8" ?>
<DisplayConfig>
\t<ScreenWidth>1280</ScreenWidth>
\t<ScreenHeight>720</ScreenHeight>
\t<VSync>true</VSync>
\t<FullScreen>2</FullScreen>
\t<PresentInterval>1</PresentInterval>
\t<Adapter>0</Adapter>
\t<Monitor>0</Monitor>
</DisplayConfig>`;

describe('reading Elite’s own display settings', () => {
  it('reads the real file from a live install', () => {
    // Frontier's numbering, confirmed against an install set to Borderless.
    expect(parseDisplaySettings(REAL)).toEqual({
      mode: 'borderless',
      monitor: 0,
      width: 1280,
      height: 720,
    });
  });

  it('knows all three of Frontier’s values', () => {
    const modeOf = (n: string): string =>
      parseDisplaySettings(`<DisplayConfig><FullScreen>${n}</FullScreen></DisplayConfig>`).mode;

    expect(modeOf('0')).toBe('windowed');
    expect(modeOf('1')).toBe('fullscreen');
    expect(modeOf('2')).toBe('borderless');
  });

  it('MANDATORY: anything it cannot read is `unknown`, never a guess', () => {
    /*
     * A truncated file, a format change, or a Proton prefix we cannot reach. Every one of these
     * must land on `unknown`, because `unknown` routes the panel to the destination that always
     * works — see the destination test below.
     */
    expect(parseDisplaySettings('').mode).toBe('unknown');
    expect(parseDisplaySettings('<DisplayConfig></DisplayConfig>').mode).toBe('unknown');
    expect(parseDisplaySettings('<DisplayConfig><FullScreen>7</FullScreen>').mode).toBe('unknown');
    expect(parseDisplaySettings('not xml at all').mode).toBe('unknown');
    expect(UNKNOWN_DISPLAY.mode).toBe('unknown');
  });

  it('survives the file being written differently', () => {
    // Whitespace and case are not a contract. Neither is element order.
    const odd = `<DisplayConfig><Monitor> 1 </Monitor><fullscreen>0</fullscreen></DisplayConfig>`;
    const s = parseDisplaySettings(odd);
    expect(s.mode).toBe('windowed');
    expect(s.monitor).toBe(1);
  });
});

describe('where a panel can be drawn', () => {
  it('MANDATORY: never over an exclusive-fullscreen game', () => {
    /*
     * The constraint that cannot be engineered away. Windows hands an exclusive-fullscreen game the
     * display and stops compositing on top, so a transparent always-on-top window shows NOTHING —
     * not because of Electron, and not because of anything we could write differently.
     */
    expect(canOverlay('fullscreen')).toBe(false);
    expect(destinationFor({ mode: 'fullscreen', preference: 'over-game' })).toBe('detached');
  });

  it('draws over the game in borderless and windowed', () => {
    // The two modes where the desktop compositor is still in charge of the screen.
    expect(canOverlay('borderless')).toBe(true);
    expect(canOverlay('windowed')).toBe(true);
    expect(destinationFor({ mode: 'borderless', preference: 'auto' })).toBe('over-game');
    expect(destinationFor({ mode: 'windowed', preference: 'auto' })).toBe('over-game');
  });

  it('MANDATORY: an unknown mode falls back rather than gambling', () => {
    /*
     * Guessing "yes" here produces exactly the failure this module exists to prevent: overlays
     * switched on, nothing visible over the game, and no way to tell whether the app is broken.
     * Guessing "no" costs a window the member can move, plus a sentence saying we could not tell.
     */
    expect(canOverlay('unknown')).toBe(false);
    expect(destinationFor({ mode: 'unknown', preference: 'over-game' })).toBe('detached');
  });

  it('MANDATORY: reality overrules an explicit “over the game”', () => {
    /*
     * A member who ticked "over the game" and later switched Elite to fullscreen has not changed
     * their mind — they changed a setting somewhere else and forgot this one. Honouring the tick box
     * draws an invisible window: it satisfies the setting and fails the person.
     */
    expect(destinationFor({ mode: 'fullscreen', preference: 'over-game' })).toBe('detached');
  });

  it('honours “detached” in every mode, including ones that could overlay', () => {
    // Second screen is a legitimate preference, not a fallback. Somebody who wants their panels on
    // a tablet gets them there even though borderless would allow an overlay.
    for (const mode of ['borderless', 'windowed', 'fullscreen', 'unknown'] as const) {
      expect(destinationFor({ mode, preference: 'detached' })).toBe('detached');
    }
  });
});

describe('what the member is told', () => {
  it('explains fullscreen, and names the fix', () => {
    const said = explain('fullscreen');
    expect(said).toMatch(/Fullscreen/);
    // The actionable part. "Overlays are unavailable" is a dead end; "switch to Borderless" is not.
    expect(said).toMatch(/Borderless/);
  });

  it('admits when it could not tell', () => {
    expect(explain('unknown')).toMatch(/could not read/i);
  });

  it('MANDATORY: says nothing when everything is working', () => {
    // Telling somebody whose overlays work that their overlays work is noise, and noise is how a
    // status line stops being read on the day it matters.
    expect(explain('borderless')).toBeNull();
    expect(explain('windowed')).toBeNull();
  });
});
