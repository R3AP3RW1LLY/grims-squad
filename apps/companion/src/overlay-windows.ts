import { BrowserWindow, screen } from 'electron';
import {
  OVERLAY_IDS,
  ontoScreen,
  type OverlayId,
  type OverlayLayout,
  type OverlayPlacement,
  type OverlayState,
} from './overlay-config.js';
import { destinationFor, type DisplayMode, type OverlayDestination } from './display-mode.js';

/**
 * The overlay windows themselves.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "make nice professional editable and lockable overlays for our modules etc."
 *
 * ★ ONE WINDOW PER OVERLAY, NOT ONE FULL-SCREEN CANVAS ★
 *
 * The alternative is a single transparent window covering the whole screen with the panels drawn
 * inside it. It looks simpler and it is worse in the way that matters: a full-screen transparent
 * window has to be click-through EVERYWHERE or click-catching everywhere. Making one panel
 * draggable while the rest of the screen passes clicks to the game means hit-testing the mouse
 * against panel rectangles by hand, on every move, and getting it wrong means the member cannot
 * shoot anything.
 *
 * Separate windows hand that problem to the operating system, which already solves it. Each window
 * is exactly its panel, and `setIgnoreMouseEvents` is a per-window switch: locked panels pass
 * clicks through, the one being dragged does not, and nothing has to guess where the mouse is.
 *
 * ★ AND THEY ARE NOT PARENTED TO THE MAIN WINDOW ★
 *
 * A child window minimises with its parent. The main window lives in the tray and is minimised
 * almost always — which is precisely when the overlays need to be visible.
 */

/** How an overlay window is presented, which differs by destination. */
interface WindowShape {
  readonly transparent: boolean;
  readonly frame: boolean;
  readonly alwaysOnTop: boolean;
  readonly skipTaskbar: boolean;
  readonly resizable: boolean;
}

/**
 * Over the game: no frame, no background, above everything, invisible to the taskbar.
 *
 * Detached: an ordinary window a member can find in Alt-Tab and drop on a second screen. Still
 * always-on-top, because the point of a second-screen panel is that it stays visible.
 */
function shapeFor(destination: OverlayDestination): WindowShape {
  return destination === 'over-game'
    ? { transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: true }
    : { transparent: false, frame: true, alwaysOnTop: true, skipTaskbar: false, resizable: true };
}

export interface OverlayHost {
  /** Absolute path to the overlay HTML. */
  readonly htmlPath: string;
  readonly preloadPath: string;
  /** Called when a member drags or resizes a panel, so the layout can be saved. */
  readonly onMoved: (id: OverlayId, placement: OverlayPlacement) => void;
}

export class OverlayWindows {
  readonly #windows = new Map<OverlayId, BrowserWindow>();
  /*
   * ★ THE SHAPE IS TRACKED HERE, NOT READ BACK OFF THE WINDOW ★
   *
   * The first version stored it in the window TITLE and compared `getTitle()`. That cannot work,
   * and main.ts already documents why a few hundred lines away: `BrowserWindow({ title })` only
   * holds until the page loads, at which point Electron adopts the document's own <title>.
   *
   * So the comparison never matched, every `apply` decided the shape had changed, and every window
   * was destroyed and rebuilt. Each new window then sent `overlay:ready` on mount, which calls
   * `apply` again — an endless rebuild loop in which no overlay ever stayed on screen long enough
   * to be seen. Caught by launching it and finding no overlay windows at all.
   */
  readonly #shapes = new Map<OverlayId, OverlayDestination>();
  #layout: OverlayLayout | null = null;
  #mode: DisplayMode = 'unknown';

  constructor(private readonly host: OverlayHost) {}

  /** Every screen, as the layout module wants them. */
  #screens(): Array<{ x: number; y: number; width: number; height: number }> {
    /*
     * `workArea`, not `bounds`. A panel rescued to y=0 on Windows sits under nothing, but one
     * rescued to the bottom edge of `bounds` sits BEHIND the taskbar — visible only as a sliver and
     * impossible to grab, which is the exact failure the rescue exists to prevent.
     */
    return screen.getAllDisplays().map((d) => ({ ...d.workArea }));
  }

  /**
   * Applies a layout: opens what should be open, closes what should not, moves the rest.
   *
   * Idempotent on purpose. It is called on startup, whenever the member changes anything, and
   * whenever Elite's display mode changes — and it has to be safe to call with a layout identical
   * to the one already applied, because most of those calls are.
   */
  apply(layout: OverlayLayout, mode: DisplayMode): void {
    this.#layout = layout;
    this.#mode = mode;

    for (const id of OVERLAY_IDS) {
      const state = layout[id];
      const existing = this.#windows.get(id);

      if (!state.enabled) {
        existing?.destroy();
        this.#windows.delete(id);
        continue;
      }

      const destination = destinationFor({ mode, preference: state.destination });

      /*
       * ★ THE SHAPE CANNOT BE CHANGED ON A LIVE WINDOW ★
       *
       * `transparent` and `frame` are constructor-only in Electron: there is no setter, and there
       * never has been. A member switching Elite from Borderless to Fullscreen changes the
       * destination, which changes the shape — so the window is rebuilt rather than adjusted.
       *
       * Cheap, and invisible: it happens when the display mode changes, which is not something that
       * happens mid-firefight.
       */
      if (existing !== undefined && this.#shapes.get(id) !== destination) {
        existing.destroy();
        this.#windows.delete(id);
        this.#shapes.delete(id);
      }

      const window = this.#windows.get(id) ?? this.#open(id, state, destination);
      this.#position(window, state);
      this.#applyLock(window, state, destination);
      this.#send(window, id, state, destination);
    }
  }

  #open(id: OverlayId, state: OverlayState, destination: OverlayDestination): BrowserWindow {
    const shape = shapeFor(destination);
    const placement = ontoScreen(state.placement, this.#screens());

    const window = new BrowserWindow({
      ...placement,
      ...shape,
      title: titleFor(id, destination),
      // No shadow: a transparent window's shadow draws a rectangle around a panel that is meant to
      // have soft edges, and it is the single most obvious tell that something is "an overlay".
      hasShadow: destination === 'detached',
      // Nothing here should steal focus from the game. A panel that grabs focus mid-flight is worse
      // than no panel.
      focusable: destination === 'detached',
      minWidth: 180,
      minHeight: 90,
      show: false,
      webPreferences: {
        preload: this.host.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    /*
     * ★ ABOVE FULLSCREEN-ISH WINDOWS ★
     *
     * Plain `alwaysOnTop` sits above normal windows and below a borderless game that has taken the
     * foreground. `screen-saver` is the level that stays above it — the name is historical and it
     * is the documented way to draw over a game.
     */
    if (destination === 'over-game') {
      window.setAlwaysOnTop(true, 'screen-saver');
      // Follows the member onto whichever virtual desktop the game is on, rather than being left
      // behind on the one where the app was launched.
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    void window.loadFile(this.host.htmlPath, { query: { id } });

    // Shown only once the page has painted. Otherwise a transparent window flashes its background
    // colour over the game for a frame, which reads as a glitch in the game rather than in us.
    window.once('ready-to-show', () => window.show());

    /*
     * Saved on the way out of a drag, not during it. `move` fires continuously while a window is
     * being dragged, and writing the config file on every one of those would be hundreds of disk
     * writes to record one intention.
     */
    const remember = (): void => {
      if (window.isDestroyed()) return;
      // `getBounds()` rather than getPosition/getSize: one call, one consistent snapshot, and a
      // typed object instead of two arrays that have to be destructured and null-checked.
      const { x, y, width, height } = window.getBounds();
      this.host.onMoved(id, { x, y, width, height });
    };
    window.on('moved', remember);
    window.on('resized', remember);

    window.on('closed', () => {
      this.#windows.delete(id);
      this.#shapes.delete(id);
    });

    this.#windows.set(id, window);
    this.#shapes.set(id, destination);
    return window;
  }

  #position(window: BrowserWindow, state: OverlayState): void {
    const placement = ontoScreen(state.placement, this.#screens());
    const now = window.getBounds();

    // Only when it actually differs. Setting bounds to their current value still emits `moved` on
    // some platforms, and `moved` writes the config — which would be an endless loop of disk
    // writes for a window nobody touched.
    if (
      now.x !== placement.x ||
      now.y !== placement.y ||
      now.width !== placement.width ||
      now.height !== placement.height
    ) {
      window.setBounds(placement);
    }
  }

  /**
   * Locked means the mouse goes to the game.
   *
   * `forward: true` matters: without it the window stops receiving mouse events entirely, including
   * the ones the renderer needs to show a hover state when arrange mode is entered. With it, clicks
   * pass through to whatever is underneath while the page still knows where the pointer is.
   */
  #applyLock(window: BrowserWindow, state: OverlayState, destination: OverlayDestination): void {
    // A detached window is an ordinary window on somebody's second screen. Making it click-through
    // would mean a panel they cannot interact with and cannot move, for no benefit — there is no
    // game underneath it to pass clicks to.
    const clickThrough = destination === 'over-game' && state.locked;
    window.setIgnoreMouseEvents(clickThrough, { forward: true });
    window.setResizable(!state.locked);
  }

  #send(
    window: BrowserWindow,
    id: OverlayId,
    state: OverlayState,
    destination: OverlayDestination,
  ): void {
    const payload = { id, state, destination, mode: this.#mode };
    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', () => {
        if (!window.isDestroyed()) window.webContents.send('overlay:state', payload);
      });
      return;
    }
    window.webContents.send('overlay:state', payload);
  }

  /** Pushes live data — needs, route, cargo — to whichever overlays are open. */
  broadcast(channel: string, payload: unknown): void {
    for (const window of this.#windows.values()) {
      if (!window.isDestroyed() && !window.webContents.isLoading()) {
        window.webContents.send(channel, payload);
      }
    }
  }

  /** True when at least one overlay is open. Lets the caller skip building data nobody will see. */
  get anyOpen(): boolean {
    return this.#windows.size > 0;
  }

  closeAll(): void {
    for (const window of this.#windows.values()) window.destroy();
    this.#windows.clear();
    this.#shapes.clear();
  }

  /** Re-applies the current layout — used when displays change or the game's mode does. */
  refresh(mode: DisplayMode): void {
    if (this.#layout !== null) this.apply(this.#layout, mode);
  }
}

/**
 * The window's initial title.
 *
 * Only ever seen in a debugger or a window list: the page sets its own <title> the moment it loads
 * and Electron adopts it. It is NOT used to decide anything — see the note on `#shapes`, which is
 * the bug that taught us.
 */
function titleFor(id: OverlayId, destination: OverlayDestination): string {
  return `gs-overlay:${id}:${destination}`;
}
