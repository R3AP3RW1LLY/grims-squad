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

/**
 * Whether the overlays should be on screen.
 *
 * ★ THE SECOND TERM IS THE ONE PEOPLE FORGET ★
 *
 * SrvSurvey's rule is `focusElite || focusSrvSurvey`, and the second half is load-bearing: without
 * it, a member who clicks the companion window to arrange their panels watches every panel they are
 * trying to drag disappear. Arrange mode counts for the same reason, one step further — the panels
 * must stay up while somebody is positioning them even if focus lands somewhere odd mid-drag.
 *
 * `gameIsForeground` null means "we could not tell", and the answer is to leave things visible.
 * Hiding on an unknown reading would make a failed binding look like broken overlays.
 */
export function overlaysShouldShow(input: {
  readonly gameIsForeground: boolean | null;
  readonly ourWindowFocused: boolean;
  readonly editing: boolean;
}): boolean {
  if (input.editing || input.ourWindowFocused) return true;
  return input.gameIsForeground !== false;
}
