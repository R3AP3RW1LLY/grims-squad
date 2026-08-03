/**
 * Which window Windows currently has in front.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "the overlays need to only sit ontop of the game — if i minimize the game the overlays stay up on
 * the screen."
 *
 * They did, because nothing in the app had ever asked. Overlay windows were created at
 * `screen-saver` level and the only two states they had were "exists and is shown" and "destroyed".
 *
 * ★ WHY THIS NEEDS A NATIVE CALL AT ALL ★
 *
 * Electron cannot answer the question. `browser-window-focus` and `browser-window-blur` report only
 * the app's OWN windows; `screen` has no concept of a foreground window; `desktopCapturer` can
 * enumerate windows but renders thumbnails to do it and still does not report z-order. The answer
 * lives in `user32.dll` and nowhere else.
 *
 * ★ WHY POLLING AND NOT tasklist ★
 *
 * `game-process.ts` already detects Elite by spawning `tasklist`, measured at 190ms. That is fine
 * every twenty seconds and impossible twice a second. These three calls are in-process: measured at
 * 1.6 MICROSECONDS each — ten thousand samples in sixteen milliseconds. So the PID is sampled
 * cheaply and often, and the expensive question "is that PID Elite" is asked only when the PID
 * changes, which is a human alt-tabbing rather than a timer.
 *
 * ★ IT FAILS OPEN ★
 *
 * If the native binding will not load — a platform we did not expect, a packaging mistake, a
 * hardened environment — every reading is `null`, and the caller treats an unknown foreground as
 * "leave the overlays alone". A member whose overlays stop hiding has a small annoyance; a member
 * whose overlays vanish permanently has a broken app.
 */

export interface ForegroundWindow {
  /** Process id owning the foreground window. */
  readonly pid: number;
  /** True when that window is minimised, as distinct from merely not in front. */
  readonly minimised: boolean;
}

/** Reads the foreground window. Null when we cannot tell. */
export type ForegroundReader = () => ForegroundWindow | null;

/*
 * Bound once, lazily, and never re-attempted after a failure.
 *
 * `null` means "not tried yet"; a thrown load is recorded as `broken` so a missing DLL does not
 * cost a failed dynamic require every 500ms for the life of the session.
 */
let bound: { read: ForegroundReader } | 'broken' | null = null;

function bind(): { read: ForegroundReader } | 'broken' {
  try {
    /*
     * Required rather than imported, so a platform without the binding does not fail at module load
     * — this file is imported by the overlay runtime, which must work on macOS and Linux where
     * there is no user32 at all.
     */
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as {
      load(path: string): {
        func(signature: string): (...args: unknown[]) => unknown;
      };
    };

    const user32 = koffi.load('user32.dll');
    const getForegroundWindow = user32.func('void* GetForegroundWindow()');
    const getWindowThreadProcessId = user32.func(
      'uint32 GetWindowThreadProcessId(void* hWnd, _Out_ uint32* pid)',
    );
    const isIconic = user32.func('bool IsIconic(void* hWnd)');

    return {
      read: () => {
        const handle = getForegroundWindow();
        // No foreground window at all happens during a desktop switch and while the lock screen is
        // up. Not an error, and not something to hide overlays over.
        if (handle === null || handle === undefined) return null;

        const out = [0];
        getWindowThreadProcessId(handle, out);
        const pid = out[0] ?? 0;
        if (pid === 0) return null;

        return { pid, minimised: isIconic(handle) === true };
      },
    };
  } catch {
    return 'broken';
  }
}

/**
 * The foreground window, or null when we cannot tell.
 *
 * Windows only. Everywhere else this returns null for ever, which the caller reads as "do not
 * change anything" — and on macOS and Linux Elite is not running natively anyway.
 */
export function foregroundWindow(platform: NodeJS.Platform = process.platform): ForegroundWindow | null {
  if (platform !== 'win32') return null;

  bound ??= bind();
  if (bound === 'broken') return null;

  try {
    return bound.read();
  } catch {
    // A single failed reading is not worth tearing the binding down — the next tick tries again.
    return null;
  }
}

/** What should be on screen. The two kinds of panel are gated differently — see below. */
export interface OverlayVisibility {
  /** Panels drawn over the game itself. */
  readonly overGame: boolean;
  /** Panels the member put on a second monitor, or that we forced there because we cannot overlay. */
  readonly detached: boolean;
}

/**
 * Whether the overlays should be on screen.
 *
 * ★ TWO TIERS, AND THE SECOND ONE WAS MISSING — SQUADRON OWNER, 2026-08-03 ★
 *
 * "the overlays still appear even if the game is not open at all if the launcher is open!"
 *
 * The first version gated `over-game` panels on the game having focus, and left `detached` ones
 * alone on the reasoning that a member had deliberately put those on a second monitor.
 *
 * That reasoning was wrong for the case that matters. `destinationFor()` FORCES every panel to
 * detached when Elite is in exclusive fullscreen or when DisplaySettings.xml cannot be read —
 * because we genuinely cannot draw over the game then. So for anybody in fullscreen, every panel
 * was detached, nothing was gated, and the feature did nothing at all. Which is precisely the
 * report.
 *
 * So: whether the game is RUNNING gates everything, and whether it has FOCUS gates only the panels
 * drawn over it. An overlay of either kind is only useful while somebody is playing; a detached
 * panel on a second monitor is still worth leaving up while they alt-tab to a browser.
 *
 * ★ THE TERM PEOPLE FORGET ★
 *
 * SrvSurvey's rule is `focusElite || focusSrvSurvey`, and the second half is load-bearing: without
 * it, a member who clicks the companion window to arrange their panels watches every panel they are
 * trying to drag disappear. Arrange mode counts for the same reason, one step further.
 *
 * ★ NULL MEANS LEAVE IT ALONE ★
 *
 * `gameRunning` or `gameIsForeground` null is "we could not tell" — no native binding, or no
 * foreground window at all during a desktop switch. Hiding on an unknown reading would make a
 * failed lookup look like broken overlays, and a member whose panels vanish for good has no way to
 * find out why.
 */
export function overlaysShouldShow(input: {
  readonly gameRunning: boolean | null;
  readonly gameIsForeground: boolean | null;
  readonly ourWindowFocused: boolean;
  readonly editing: boolean;
}): OverlayVisibility {
  // Arranging, or working in the app itself. Everything stays up, whatever the game is doing —
  // otherwise the panels being positioned disappear the moment somebody clicks to position them.
  if (input.editing || input.ourWindowFocused) return { overGame: true, detached: true };

  // Not running at all. Nothing an overlay says is worth reading, wherever it is drawn.
  if (input.gameRunning === false) return { overGame: false, detached: false };

  return { overGame: input.gameIsForeground !== false, detached: true };
}
