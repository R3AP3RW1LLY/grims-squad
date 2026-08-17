import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { foregroundWindow, overlaysShouldShow } from './foreground.js';
import { isGameRunning, isPidGame } from './game-process.js';
import {
  parseDisplaySettings,
  UNKNOWN_DISPLAY,
  type DisplayMode,
  type DisplaySettings,
} from './display-mode.js';
import {
  normaliseLayout,
  withEditMode,
  OVERLAY_IDS,
  type OverlayId,
  type OverlayLayout,
  type OverlayPlacement,
} from './overlay-config.js';
import { OverlayWindows } from './overlay-windows.js';
import type { OverlayData } from './renderer/overlay.js';

/**
 * Everything the overlays need from the main process, in one place.
 *
 * ★ WHY A SEPARATE FILE FROM main.ts ★
 *
 * `main.ts` is 1,235 lines and owns pairing, uploading, the tray, updates and the journal watcher.
 * Threading a windowing subsystem through it would make both harder to read and would put the
 * overlay's failure modes inside the file that must never fail.
 *
 * This owns the overlay lifecycle and exposes four functions. `main.ts` calls them and holds no
 * overlay state of its own.
 */

/**
 * Where Elite records the display mode it is set to.
 *
 * ★ THE WINDOWS PATH, AND THE WINE ONES ★
 *
 * Elite has no native Mac or Linux build; both run the Windows binary under Proton, CrossOver or
 * Whisky, which put a `drive_c` inside a prefix. The same relative path applies under each, which
 * is why this is a list of roots rather than a platform switch.
 *
 * Not finding it is a normal outcome, not an error — a member with a relocated prefix simply gets
 * `unknown`, which routes their panels to a detached window and tells them why.
 */
function displaySettingsPaths(): string[] {
  const relative = join(
    'Frontier Developments',
    'Elite Dangerous',
    'Options',
    'Graphics',
    'DisplaySettings.xml',
  );

  const roots: string[] = [];

  const local = process.env['LOCALAPPDATA'];
  if (local !== undefined && local !== '') roots.push(local);

  const home = homedir();
  roots.push(
    join(home, 'AppData', 'Local'),
    // Steam Proton, the common case on Linux.
    join(home, '.steam', 'steam', 'steamapps', 'compatdata', '359320', 'pfx', 'drive_c', 'users', 'steamuser', 'AppData', 'Local'),
    // CrossOver / Whisky bottles keep the same shape under a different root.
    join(home, 'Library', 'Application Support', 'CrossOver', 'Bottles', 'Elite Dangerous', 'drive_c', 'users', 'crossover', 'AppData', 'Local'),
  );

  return roots.map((r) => join(r, relative));
}

export function readDisplaySettings(): DisplaySettings {
  for (const path of displaySettingsPaths()) {
    try {
      if (!existsSync(path)) continue;
      return parseDisplaySettings(readFileSync(path, 'utf8'));
    } catch {
      // Unreadable is the same as absent: fall through to the next root, and to `unknown` if none
      // work. A permissions error on one prefix must not stop us checking another.
      continue;
    }
  }
  return UNKNOWN_DISPLAY;
}

export interface OverlayRuntimeHost {
  /** The saved layout. Read fresh each time so the caller owns persistence. */
  readonly layout: () => OverlayLayout;
  /** Persists a changed layout. */
  readonly save: (layout: OverlayLayout) => void;
  /** Called when anything changes, so the main window can re-render its overlay settings. */
  readonly changed: () => void;
}

let windows: OverlayWindows | null = null;
let host: OverlayRuntimeHost | null = null;
/**
 * The last data pushed, kept so a window that opens late is not blank until the next pass.
 *
 * ★ WITHOUT THIS, ENABLING A PANEL MID-SESSION SHOWS NOTHING FOR TWENTY SECONDS ★
 *
 * `broadcast` drops a message to a window that is still loading, and the display-mode watcher
 * destroys and re-creates windows whenever the member alt-tabs between fullscreen and windowed. In
 * both cases the panel would sit on its placeholder until the next journal pass happened to push
 * again — which reads as "the overlay is broken", because for twenty seconds it is.
 */
let lastData: OverlayData | null = null;
let mode: DisplayMode = 'unknown';
let editing = false;

/**
 * How often to re-read Elite's display settings.
 *
 * The file changes only when a member changes a graphics setting, which is rare and never urgent —
 * but it must be noticed without a restart, because "switch Elite to Borderless" is the advice we
 * give and it has to take effect when they do it. Fifteen seconds is imperceptible to a person and
 * nothing to a disk.
 */
const DISPLAY_POLL_MS = 15_000;

/**
 * How often the game's foreground state is sampled.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "the overlays need to only sit ontop of the game — if i minimize the game the overlays stay up on
 * the screen."
 *
 * Half a second is the worst-case staleness a member sees after minimising. SrvSurvey uses 200ms
 * and EDMCOverlay 1000ms, so this sits squarely between two shipped Elite overlays. The sample
 * itself costs about 1.6 microseconds, so the interval is chosen for how it FEELS rather than for
 * what it costs.
 */
const FOCUS_POLL_MS = 500;

/*
 * `windowsHide` so no console flashes when the foreground owner changes, and a short timeout so a
 * wedged `tasklist` cannot hold the resolver flag for ever.
 */
const runProcess = promisify(execFile);
const listProcesses = async (
  command: string,
  args: readonly string[],
): Promise<{ stdout: string }> =>
  runProcess(command, [...args], { timeout: 2_000, windowsHide: true });

/** Display settings are read every Nth focus tick, so there is still only one timer. */
const DISPLAY_EVERY = DISPLAY_POLL_MS / FOCUS_POLL_MS;

let displayTimer: NodeJS.Timeout | null = null;

/**
 * Starts one short of the slow cadence, on purpose.
 *
 * The slow tick is what answers "is Elite running at all", and `gameRunning` is unknown until it
 * has. Unknown means leave the panels up — so starting at zero would show every overlay for the
 * first fifteen seconds of a session where only the launcher is open, which is exactly the case
 * being fixed. Beginning one short makes the very first 500ms tick do the slow work too.
 */
let ticks = DISPLAY_EVERY - 1;

/**
 * The last foreground PID we resolved, and whether it was Elite.
 *
 * ★ THE PID IS CHEAP AND THE NAME IS NOT ★
 *
 * Reading the foreground PID is a microsecond. Turning a PID into "is that Elite Dangerous" means
 * spawning `tasklist`, measured at 190ms — impossible twice a second and unnecessary, because the
 * answer only changes when a human alt-tabs. So the PID is sampled every tick and the name is
 * resolved only when the PID is one we have not seen.
 */
let lastForegroundPid = 0;
let foregroundIsGame: boolean | null = null;
/** True while a `tasklist` is in flight, so a slow one cannot stack. */
let resolving = false;

/**
 * Whether Elite is running AT ALL, as distinct from having focus.
 *
 * ★ SQUADRON OWNER, 2026-08-03 ★
 *
 * "the overlays still appear even if the game is not open at all if the launcher is open!"
 *
 * Focus alone could not answer this. In exclusive fullscreen — or when DisplaySettings.xml cannot
 * be read — `destinationFor()` forces every panel to `detached`, because we genuinely cannot draw
 * over the game then. The focus gate deliberately left detached panels alone, so for anybody in
 * fullscreen nothing was gated at all and the feature did nothing.
 *
 * Refreshed on the slow tick rather than the fast one: `tasklist` costs 190ms, and the answer
 * changes when somebody launches or quits a game rather than between frames.
 */
let gameRunning: boolean | null = null;
let checkingRunning = false;

export function startOverlays(h: OverlayRuntimeHost): void {
  host = h;

  windows = new OverlayWindows({
    htmlPath: join(app.getAppPath(), 'dist', 'renderer', 'overlay.html'),
    preloadPath: join(app.getAppPath(), 'dist', 'preload.cjs'),
    onMoved: (id, placement) => rememberPlacement(id, placement),
  });

  mode = readDisplaySettings().mode;
  windows.apply(h.layout(), mode);

  displayTimer = setInterval(() => {
    followTheGame();

    // The display settings and the is-it-running check, on the same timer at their own cadence.
    // One timer, three jobs.
    if (++ticks % DISPLAY_EVERY !== 0) return;

    if (!checkingRunning) {
      checkingRunning = true;
      void isGameRunning(process.platform, listProcesses)
        .then((yes) => {
          gameRunning = yes;
        })
        .catch(() => {
          // Unknown rather than false: a failed lookup must not hide somebody's panels for good.
          gameRunning = null;
        })
        .finally(() => {
          checkingRunning = false;
        });
    }

    const next = readDisplaySettings().mode;
    if (next === mode) return;
    /*
     * The mode changed under us — the member alt-tabbed out, changed a graphics setting and came
     * back. The destination may now be different, which means windows are rebuilt with a different
     * shape. This is the whole reason the poll exists.
     */
    mode = next;
    windows?.refresh(mode);
    host?.changed();
  }, FOCUS_POLL_MS);

  /*
   * Displays come and go: a laptop docked or undocked, a monitor switched off, a resolution change.
   * Every one of those can leave a saved placement pointing at coordinates that no longer exist,
   * and `ontoScreen` only runs when a layout is applied — so it has to be applied again.
   */
  screen.on('display-removed', () => windows?.refresh(mode));
  screen.on('display-added', () => windows?.refresh(mode));
  screen.on('display-metrics-changed', () => windows?.refresh(mode));

  ipcMain.on('overlay:ready', () => {
    // A window finished loading and wants its state. Re-applying is the simplest correct answer and
    // is idempotent by design.
    if (host !== null) windows?.apply(host.layout(), mode);
    // And its data, which it missed by not existing yet. See the note on `lastData`.
    if (lastData !== null) windows?.broadcast('overlay:data', lastData);
  });

  /*
   * A panel reporting how tall its content is, so the window can grow to fit it.
   *
   * Both arguments are re-read rather than trusted, like every renderer-supplied value: an unknown
   * id is ignored, and a non-numeric height would otherwise reach `setBounds` as NaN. `measured`
   * itself decides whether the change is worth acting on.
   */
  ipcMain.on('overlay:measured', (_event, id: unknown, height: unknown) => {
    if (typeof id !== 'string' || typeof height !== 'number') return;
    if (!(OVERLAY_IDS as readonly string[]).includes(id)) return;
    windows?.measured(id as OverlayId, height);
  });
}

/**
 * Shows or hides the over-game panels to match where the game is.
 *
 * ★ THE RULE, AND THE TERM PEOPLE FORGET ★
 *
 * SrvSurvey's is `focusElite || focusSrvSurvey`, and the second half is load-bearing: without it, a
 * member who clicks the companion window to arrange their panels watches every panel they are
 * trying to drag vanish. Arrange mode counts for the same reason, one step further.
 *
 * An unknown foreground — no native binding, no foreground window during a desktop switch — leaves
 * everything visible. A member whose overlays stop hiding has a small annoyance; one whose overlays
 * disappear for good has a broken app.
 */
function followTheGame(): void {
  const front = foregroundWindow();

  if (front !== null && front.pid !== lastForegroundPid && !resolving) {
    lastForegroundPid = front.pid;
    resolving = true;
    /*
     * The expensive question, asked only when a human has alt-tabbed. Not awaited: the tick must
     * not block, and the previous answer stays in force for the ~190ms it takes — which is one
     * tick, and invisible.
     */
    void isPidGame(front.pid, process.platform, listProcesses)
      .then((yes) => {
        foregroundIsGame = yes;
      })
      .catch(() => {
        // Unknown rather than false. See the note above on failing open.
        foregroundIsGame = null;
      })
      .finally(() => {
        resolving = false;
      });
  }

  /*
   * The foreground window belonging to Elite is proof it is running, and it is free — so the
   * expensive check is skipped entirely while somebody is actually playing, which is most of the
   * time the overlays are on screen.
   */
  if (foregroundIsGame === true) gameRunning = true;

  const show = overlaysShouldShow({
    gameRunning,
    // A minimised game is never the foreground window, so this covers minimise for free — but the
    // flag is read anyway because "minimised" and "alt-tabbed" are different things to be sure of.
    gameIsForeground: front === null ? null : foregroundIsGame === true && !front.minimised,
    ourWindowFocused: BrowserWindow.getFocusedWindow() !== null,
    /*
     * Any of our windows minimised counts. The member tucks the app away to see the game, and the
     * overlays are what they tucked it away FOR — see `ourWindowMinimised`.
     */
    ourWindowMinimised: BrowserWindow.getAllWindows().some((w) => w.isMinimized()),
    editing,
  });

  windows?.setVisible(show);
}

function rememberPlacement(id: OverlayId, placement: OverlayPlacement): void {
  if (host === null) return;

  const layout = host.layout();
  const next: OverlayLayout = { ...layout, [id]: { ...layout[id], placement } };
  host.save(next);
  host.changed();
}

/** Applies a layout the member changed in the main window. */
export function setLayout(raw: unknown): OverlayLayout | null {
  if (host === null) return null;

  // Normalised even though it came from our own UI. The renderer is the least trusted thing that
  // can reach here, and every clamp in `normaliseLayout` protects against a panel nobody can see.
  const layout = normaliseLayout(raw);
  host.save(layout);
  windows?.apply(layout, mode);
  return layout;
}

/**
 * Arrange mode: every overlay takes the mouse so it can be dragged.
 *
 * The per-overlay lock is not lost — `withEditMode` writes a temporary unlock and leaving arrange
 * mode locks everything again, which is what the member expects from a mode they turned on.
 */
export function setEditing(on: boolean): OverlayLayout | null {
  if (host === null) return null;

  editing = on;
  const layout = withEditMode(host.layout(), on);
  windows?.apply(layout, mode);
  /*
   * Deliberately NOT saved. Arrange mode is a moment, not a preference — persisting the unlocked
   * state would mean an app that crashed while arranging came back with every overlay loose over
   * somebody's game.
   */
  return layout;
}

export function isEditing(): boolean {
  return editing;
}

export function currentMode(): DisplayMode {
  return mode;
}

/**
 * Pushes live data to every open overlay. Cheap to call; does nothing when none are open.
 *
 * The payload is remembered BEFORE the open check, deliberately: a member who switches a panel on
 * after the last pass should get what we already know rather than an empty box until the next one.
 */
export function pushOverlayData(data: OverlayData): void {
  lastData = data;
  if (windows === null || !windows.anyOpen) return;
  windows.broadcast('overlay:data', data);
}

export function stopOverlays(): void {
  if (displayTimer !== null) clearInterval(displayTimer);
  displayTimer = null;
  // Forgotten with the windows, so a new session resolves the foreground fresh rather than trusting
  // a PID that may since have been recycled by an unrelated process.
  // Reset to the same primed value, so a restart re-checks immediately rather than after 15s.
  ticks = DISPLAY_EVERY - 1;
  lastForegroundPid = 0;
  foregroundIsGame = null;
  gameRunning = null;
  // Dropped with the windows. Replaying a build from a previous session into a fresh one would be
  // the overlay's own version of stale data.
  lastData = null;
  windows?.closeAll();
  windows = null;
}
