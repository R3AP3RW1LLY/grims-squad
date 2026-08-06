/**
 * What the member has arranged: which overlays exist, where they sit, and how they look.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "make nice professional editable and lockable overlays for our modules etc", and, on how far the
 * editing should go: opacity, scale, colour accent and which fields show.
 *
 * ★ PURE, SO THE RULES ARE TESTABLE WITHOUT AN ELECTRON WINDOW ★
 *
 * Everything here is arithmetic on a saved layout. The window manager applies it; none of the
 * decisions about what is legal live inside a BrowserWindow, where they could only be checked by
 * launching the app and looking.
 */

/**
 * The panels. Four from the original brief, two added with the mining module.
 *
 * ★ MINING, 2026-08-06 ★
 *
 * The prospector panel is the one that makes this a mining tool rather than a scoreboard: a rock
 * drifts past in a couple of seconds and the whole skill is deciding, inside that window, whether
 * it is worth shooting. The refinery panel is the session — what came out, how fast, and what it is
 * worth on the board.
 */
export const OVERLAY_IDS = ['build', 'route', 'cargo', 'status', 'prospector', 'refinery'] as const;
export type OverlayId = (typeof OVERLAY_IDS)[number];

export const OVERLAY_LABELS: Record<OverlayId, string> = {
  build: 'Build tracker',
  route: 'Trade run',
  cargo: 'Cargo hold',
  status: 'Upload status',
  prospector: 'Prospector',
  refinery: 'Refinery',
};

/**
 * Which fields each overlay can show.
 *
 * Named here rather than in the renderer so that "which fields show" is part of the SAVED CONFIG
 * and can be validated — a field removed in a later version is dropped on load instead of leaving
 * a panel trying to render something that no longer exists.
 */
export const OVERLAY_FIELDS: Record<OverlayId, readonly string[]> = {
  // No 'eta': nothing computes one, so the checkbox was a promise the panel could never keep.
  // Saved configs that still carry it are cleaned on load by exactly the validation named above.
  build: ['title', 'needs', 'progress', 'haulers'],
  route: ['commodity', 'buy', 'sell', 'profit', 'cargo'],
  cargo: ['items', 'capacity', 'matched'],
  status: ['sending', 'queued', 'lastUpload', 'gameState'],
  /*
   * `materials` is the list with its percentage bars — the reason the panel exists, and the only
   * field here somebody would be mad to switch off. The rest are genuinely optional: a core miner
   * cares about `motherlode` and may not want `hitRate`; a laser miner is the other way round.
   */
  prospector: ['materials', 'motherlode', 'content', 'hitRate', 'best'],
  /*
   * `value` and `bestSale` are what no other mining tool can show, because none of them own a
   * market database. They are fields rather than fixtures because they need a position to be
   * useful, and a member mining somewhere unmapped would otherwise stare at two empty rows.
   */
  refinery: ['materials', 'session', 'rate', 'points', 'value', 'bestSale'],
};

export interface OverlayStyle {
  /** 0.2–1. Below 0.2 the panel is invisible and the member cannot find it to fix it. */
  opacity: number;
  /** 0.7–2. Text scale, for 4K screens and for people who want it out of the way. */
  scale: number;
  /** Accent colour, as `#rrggbb`. */
  accent: string;
  /** Which of `OVERLAY_FIELDS[id]` to draw, in order. */
  fields: string[];
}

export interface OverlayPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayState {
  enabled: boolean;
  /** Locked: click-through and immovable. Unlocked: draggable, resizable, and it takes the mouse. */
  locked: boolean;
  /** `auto` follows Elite's display mode. See `destinationFor` in display-mode.ts. */
  destination: 'auto' | 'over-game' | 'detached';
  placement: OverlayPlacement;
  style: OverlayStyle;
}

export type OverlayLayout = Record<OverlayId, OverlayState>;

/** The squadron's cyan, matching the site. */
const ACCENT = '#3fd0d4';

const MIN = { width: 180, height: 90 };

function defaultState(id: OverlayId, index: number): OverlayState {
  return {
    // Off until asked for. An overlay that appears over somebody's game because they installed an
    // update is the kind of surprise that gets an app uninstalled.
    enabled: false,
    // Locked by default: the FIRST thing that happens after enabling one should not be knocking it
    // out of place with a stray click. Unlocking is one button.
    locked: true,
    destination: 'auto',
    placement: {
      // Staggered down the left, so four overlays enabled at once do not land in one stack with
      // only the top one reachable.
      x: 24,
      y: 24 + index * 150,
      width: 320,
      height: 140,
    },
    style: {
      opacity: 0.9,
      scale: 1,
      accent: ACCENT,
      fields: [...OVERLAY_FIELDS[id]],
    },
  };
}

export function defaultLayout(): OverlayLayout {
  return Object.fromEntries(
    OVERLAY_IDS.map((id, i) => [id, defaultState(id, i)]),
  ) as OverlayLayout;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** `#rrggbb` only. Anything else falls back — a stray value here would be injected into CSS. */
function accentOf(raw: unknown): string {
  return typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw) ? raw : ACCENT;
}

/**
 * Takes whatever was on disk and returns something safe to render.
 *
 * ★ A SAVED LAYOUT IS UNTRUSTED INPUT ★
 *
 * It is a JSON file in the member's own profile: hand-edited, half-written by a crash, or produced
 * by a version that had different fields. Every value is clamped rather than believed — an opacity
 * of 0 or a scale of 40 does not crash anything, it produces a panel that cannot be seen or cannot
 * be escaped, and in both cases the member's only recovery is finding and deleting a file.
 */
export function normaliseLayout(raw: unknown): OverlayLayout {
  const source = (raw ?? {}) as Partial<Record<OverlayId, Partial<OverlayState>>>;
  const out = defaultLayout();

  for (const [i, id] of OVERLAY_IDS.entries()) {
    const given = source[id];
    if (given === undefined || given === null || typeof given !== 'object') continue;

    const base = defaultState(id, i);
    const placement = (given.placement ?? {}) as Partial<OverlayPlacement>;
    const style = (given.style ?? {}) as Partial<OverlayStyle>;

    /*
     * Fields are INTERSECTED with what this version knows, not taken as given. A field removed in a
     * later release would otherwise sit in the saved list for ever, and the renderer would be asked
     * to draw something that no longer exists. Order is the member's; membership is ours.
     */
    const known = new Set(OVERLAY_FIELDS[id]);
    const fields = Array.isArray(style.fields)
      ? style.fields.filter((f): f is string => typeof f === 'string' && known.has(f))
      : base.style.fields;

    out[id] = {
      enabled: given.enabled === true,
      // Anything that is not explicitly `false` locks. An overlay that arrives unlocked because a
      // value was missing is one a stray click drags away.
      locked: given.locked !== false,
      destination:
        given.destination === 'over-game' || given.destination === 'detached'
          ? given.destination
          : 'auto',
      placement: {
        x: Number.isFinite(placement.x) ? Number(placement.x) : base.placement.x,
        y: Number.isFinite(placement.y) ? Number(placement.y) : base.placement.y,
        width: clamp(Number(placement.width ?? base.placement.width), MIN.width, 1600),
        height: clamp(Number(placement.height ?? base.placement.height), MIN.height, 1200),
      },
      style: {
        opacity: clamp(Number(style.opacity ?? base.style.opacity), 0.2, 1),
        scale: clamp(Number(style.scale ?? base.style.scale), 0.7, 2),
        accent: accentOf(style.accent),
        // An empty list is a panel showing nothing, which reads as broken. Fall back to everything.
        fields: fields.length > 0 ? fields : base.style.fields,
      },
    };
  }

  return out;
}

export interface ScreenArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Drags a placement back onto a screen that exists.
 *
 * ★ THE UNPLUGGED-MONITOR BUG, HANDLED BEFORE IT HAPPENS ★
 *
 * Somebody positions an overlay on their second monitor, then plays on the laptop at a coffee shop.
 * The saved x is 2,400 and no screen extends that far, so the window opens somewhere nothing is
 * drawn: invisible, unreachable, and unrecoverable except by finding a JSON file. The same thing
 * happens on a resolution change, and on a monitor that comes back in a different order.
 *
 * A visible sliver is not enough — a panel one pixel on screen is a panel nobody can grab. The rule
 * is that a usable amount has to be reachable, so the window is nudged fully inside the nearest
 * screen rather than merely touched by it.
 */
export function ontoScreen(placement: OverlayPlacement, screens: readonly ScreenArea[]): OverlayPlacement {
  if (screens.length === 0) return placement;

  const overlapOf = (s: ScreenArea): number => {
    const w = Math.min(placement.x + placement.width, s.x + s.width) - Math.max(placement.x, s.x);
    const h = Math.min(placement.y + placement.height, s.y + s.height) - Math.max(placement.y, s.y);
    return Math.max(0, w) * Math.max(0, h);
  };

  // The screen it already overlaps most, so a panel that has merely drifted a little comes back to
  // where the member put it rather than jumping to the primary display.
  let best = screens[0] as ScreenArea;
  let bestOverlap = overlapOf(best);
  for (const s of screens) {
    const o = overlapOf(s);
    if (o > bestOverlap) {
      best = s;
      bestOverlap = o;
    }
  }

  // A quarter of the panel visible is enough to grab and drag. Anything less is rescued.
  const enough = placement.width * placement.height * 0.25;
  if (bestOverlap >= enough) return placement;

  const width = Math.min(placement.width, best.width);
  const height = Math.min(placement.height, best.height);

  return {
    width,
    height,
    x: clamp(placement.x, best.x, best.x + best.width - width),
    y: clamp(placement.y, best.y, best.y + best.height - height),
  };
}

/** Every overlay the member has switched on. */
export function activeOverlays(layout: OverlayLayout): OverlayId[] {
  return OVERLAY_IDS.filter((id) => layout[id].enabled);
}

/**
 * Unlocking one overlay unlocks the lot.
 *
 * ★ WHY EDIT MODE IS GLOBAL EVEN THOUGH LOCKS ARE PER-OVERLAY ★
 *
 * A locked overlay is click-through, so it cannot be clicked to unlock it — the click goes to the
 * game. If lock were purely per-panel, the only way to move one would be through the main window,
 * and the member would be alt-tabbing between the app and the game to nudge a panel by ten pixels.
 *
 * So there is one "arrange overlays" mode that takes the mouse for all of them at once, and the
 * per-overlay lock is what survives leaving it — an overlay the member wants pinned stays pinned
 * the next time they arrange the others.
 */
export function withEditMode(layout: OverlayLayout, editing: boolean): OverlayLayout {
  const out = { ...layout };
  for (const id of OVERLAY_IDS) {
    out[id] = { ...layout[id], locked: editing ? false : true };
  }
  return out;
}
