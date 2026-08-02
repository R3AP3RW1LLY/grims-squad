import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app, ipcMain, screen } from 'electron';
import {
  parseDisplaySettings,
  UNKNOWN_DISPLAY,
  type DisplayMode,
  type DisplaySettings,
} from './display-mode.js';
import {
  normaliseLayout,
  withEditMode,
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
let displayTimer: NodeJS.Timeout | null = null;

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
  }, DISPLAY_POLL_MS);

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
  // Dropped with the windows. Replaying a build from a previous session into a fresh one would be
  // the overlay's own version of stale data.
  lastData = null;
  windows?.closeAll();
  windows = null;
}
