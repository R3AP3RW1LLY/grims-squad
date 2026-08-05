/**
 * Which display mode Elite is in — and therefore whether an overlay can be drawn at all.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "we have alot of people who play in windowed mode too this needs to accomodate all graphics
 * options elite dangerous offers! this is non-negotiable!"
 *
 * ★ THE CONSTRAINT THAT CANNOT BE ENGINEERED AWAY ★
 *
 * Nothing composites over TRUE EXCLUSIVE FULLSCREEN. When a game takes exclusive fullscreen,
 * Windows hands it the display and the desktop compositor stops drawing on top — so a transparent
 * always-on-top window is simply not shown. This is not an Electron limitation and it is not
 * something a better implementation fixes: SrvSurvey has it, EDMCOverlay has it, every overlay that
 * is not injecting itself into the game's own render pipeline has it. Injection means hooking
 * DirectX inside another process, which is what anti-cheat exists to stop and is not something this
 * squadron should ship.
 *
 * So "accommodate all graphics options" is honoured the only honest way: DETECT the mode, draw the
 * overlay where it will actually be seen, and SAY SO. A member in exclusive fullscreen gets their
 * panels in a detachable window for a second screen and a plain sentence explaining why — never a
 * transparent window that silently shows nothing while the app claims to be working.
 *
 * ★ READ FROM ELITE'S OWN SETTINGS, NOT GUESSED FROM WINDOW RECTANGLES ★
 *
 * The obvious approach is to find the game's window and compare its rectangle to the monitor's.
 * It cannot tell borderless from exclusive fullscreen — both are a borderless window exactly
 * covering the screen — which is the one distinction that matters here.
 *
 * Elite writes the answer to disk:
 *
 *   %LOCALAPPDATA%/Frontier Developments/Elite Dangerous/Options/Graphics/DisplaySettings.xml
 *
 * with `<FullScreen>` as 0, 1 or 2. That is Frontier's own record of what the member chose, it
 * updates the moment they change it, and it needs no window handles or native code.
 */

/** What Elite is set to. */
export type DisplayMode = 'windowed' | 'fullscreen' | 'borderless' | 'unknown';

export interface DisplaySettings {
  readonly mode: DisplayMode;
  /** The monitor index Elite is set to use, so an overlay lands on the right screen. */
  readonly monitor: number | null;
  readonly width: number | null;
  readonly height: number | null;
}

export const UNKNOWN_DISPLAY: DisplaySettings = {
  mode: 'unknown',
  monitor: null,
  width: null,
  height: null,
};

/**
 * Frontier's own numbering, from DisplaySettings.xml.
 *
 * Verified against a live install on 2026-08-02, which read `<FullScreen>2</FullScreen>` while the
 * game was set to Borderless.
 */
const MODES: Record<string, DisplayMode> = {
  '0': 'windowed',
  '1': 'fullscreen',
  '2': 'borderless',
};

/** Pulls one integer element out of the XML. Deliberately not a parser — see below. */
function tag(xml: string, name: string): string | null {
  /*
   * A regex, and that is the right tool here. The file is written by the game, has one flat level
   * of elements, and never contains attributes or namespaces. Adding an XML parser to an app whose
   * entire dependency list is two packages would be a real cost for a file that looks like this:
   *
   *   <DisplayConfig><ScreenWidth>1280</ScreenWidth><FullScreen>2</FullScreen>…
   *
   * If Frontier ever changes the shape, every field returns null and the mode reads as `unknown` —
   * which routes overlays to the safe destination rather than the wrong one.
   */
  const match = new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`, 'i').exec(xml);
  return match?.[1] ?? null;
}

function int(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/** Reads the settings out of the XML. Pure, so the parsing is testable without a filesystem. */
export function parseDisplaySettings(xml: string): DisplaySettings {
  const raw = tag(xml, 'FullScreen');
  const mode = raw === null ? 'unknown' : (MODES[raw.trim()] ?? 'unknown');

  return {
    mode,
    monitor: int(tag(xml, 'Monitor')),
    width: int(tag(xml, 'ScreenWidth')),
    height: int(tag(xml, 'ScreenHeight')),
  };
}

/**
 * Can a transparent window be drawn over the game in this mode?
 *
 * ★ `unknown` IS TREATED AS NO, AND THAT IS THE WHOLE POINT ★
 *
 * We cannot read the file on a Proton install with a relocated prefix, on a fresh install that has
 * never saved graphics settings, or if Frontier changes the format. Guessing "yes" there produces
 * the exact failure this module exists to prevent: a member who has switched overlays on, sees
 * nothing over the game, and has no idea whether the app is broken or their settings are wrong.
 *
 * Guessing "no" costs them a detached window they can move to a second screen, plus a sentence
 * saying we could not tell. That is recoverable, and it is honest.
 */
export function canOverlay(mode: DisplayMode): boolean {
  return mode === 'borderless' || mode === 'windowed';
}

/** Where a panel should be shown, given the mode and what the member asked for. */
export type OverlayDestination = 'over-game' | 'detached';

export function destinationFor(input: {
  readonly mode: DisplayMode;
  /** What the member chose. `auto` follows the game; the others are explicit. */
  readonly preference: 'auto' | 'over-game' | 'detached';
}): OverlayDestination {
  if (input.preference === 'detached') return 'detached';

  /*
   * ★ AN EXPLICIT CHOICE IS STILL OVERRULED BY REALITY ★
   *
   * A member who has ticked "over the game" and then switched Elite to exclusive fullscreen has not
   * changed their mind — they have changed a setting somewhere else and forgotten this one. Drawing
   * an invisible window because they asked for it honours the tick box and fails the person.
   *
   * VR arrives here as `unknown` or `fullscreen` and is handled by the same rule, which is correct:
   * there is no desktop surface to composite onto in a headset either.
   */
  return canOverlay(input.mode) ? 'over-game' : 'detached';
}

/** What to tell the member, when the mode is not what they asked for. */
export function explain(mode: DisplayMode): string | null {
  switch (mode) {
    case 'fullscreen':
      return (
        'Elite is set to Fullscreen, and Windows will not draw anything over a fullscreen game. ' +
        'Switch Elite to Borderless to get overlays in-game, or keep these panels on a second screen.'
      );
    case 'unknown':
      return (
        'We could not read Elite’s display settings, so overlays are in their own windows rather ' +
        'than over the game. Set them to “Over the game” if you play in Borderless or Windowed.'
      );
    // Both of these work, so there is nothing to explain. Saying "overlays are working" to somebody
    // whose overlays are working is noise.
    case 'borderless':
    case 'windowed':
      return null;
  }
}
