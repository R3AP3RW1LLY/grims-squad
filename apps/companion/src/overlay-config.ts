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
export const OVERLAY_IDS = [
  'build',
  'route',
  'cargo',
  'status',
  'prospector',
  'refinery',
  'bgs',
] as const;
export type OverlayId = (typeof OVERLAY_IDS)[number];

export const OVERLAY_LABELS: Record<OverlayId, string> = {
  build: 'Build tracker',
  route: 'Trade run',
  cargo: 'Cargo hold',
  status: 'Upload status',
  prospector: 'Prospector',
  refinery: 'Refinery',
  bgs: 'Faction orders',
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
  /*
   * ★ RENAMED WHEN THE PANEL STOPPED BEING ONE ROUTE — 2026-08-06 ★
   *
   * It drew a single buy/sell pair because that was all there was. It now draws the member's whole
   * picked manifest, so 'commodity' and 'buy' would be names for lines that no longer exist.
   *
   * Old configs simply drop the retired keys on load and pick up the new ones as additions — see
   * LEGACY_OFFERED, which still records the old list and must never be edited to match this one.
   */
  route: ['here', 'stops', 'profit', 'cargo'],
  /*
   * ★ SQUADRON OWNER, 2026-08-06 ★
   *
   * "the cargo overlay, rework this so it provides ritch information, but doesnt offer useless
   * information ... we want valiue information but its showing irrellevant sell information in it!"
   *
   * The panel used to answer "what did I pay" and "what did I last sell". The first is a sunk cost
   * and the second is a receipt for a trip already over — neither tells a member holding 700 tonnes
   * the thing they actually want, which is what it is worth and where to take it.
   *
   * `value`, `bestSale` and `profit` come from the squadron's own market table. No other tool can
   * show them, for the same reason the refinery overlay can: none of them own eighteen million
   * price rows.
   *
   * `lastSale` was rendered unconditionally and is now a field, so it can be switched off — see
   * LEGACY_OFFERED, which is what turns it off for everybody who already has a config.
   */
  cargo: ['items', 'capacity', 'matched', 'value', 'bestSale', 'profit', 'lastSale'],
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
  /*
   * ★ SQUADRON OWNER, 2026-08-06 ★
   *
   * "for the BGS system, create an overlay in the companion app with settings etc like the mining
   * overlay please!"
   *
   * `orders` is the reason the panel exists: which factions the officers asked for, in the system
   * the member is actually standing in, at the moment they are choosing what to take off a mission
   * board. Everything else is optional — `guidance` is the officer's own words, `session` and
   * `points` are the evening's tally, and `elsewhere` is what stops an empty panel reading as "the
   * squadron has no BGS work".
   */
  bgs: ['orders', 'guidance', 'elsewhere', 'session', 'points'],
};

/**
 * What each field is called in the settings.
 *
 * The checkboxes drew the raw key — `bestSale`, `lastUpload`, `hitRate` — which is the name a
 * programmer gave it, not a description of the line it controls. A member deciding what to show on
 * their screen should not have to switch a thing on to find out what it is.
 *
 * Keyed by field name across every overlay, since the same word means the same thing wherever it
 * appears; anything unlisted falls back to the key, so a new field is untidy rather than broken.
 */
export const FIELD_LABELS: Record<string, string> = {
  // build
  title: 'Project name',
  needs: 'What is still needed',
  progress: 'Progress bar',
  haulers: 'Haulers on it',
  // route
  here: 'What to do at this station',
  stops: 'The stops, in order',
  profit: 'Profit',
  cargo: 'Tonnes and distance',
  // cargo
  items: 'What you are carrying',
  capacity: 'Hold used',
  matched: 'Wanted by the build',
  value: 'What it is worth',
  bestSale: 'Best place to sell',
  lastSale: 'Last sale',
  // status
  sending: 'Sending light',
  queued: 'Queued events',
  lastUpload: 'Last upload',
  gameState: 'Whether Elite is running',
  // prospector
  materials: 'Materials',
  motherlode: 'Motherlode',
  content: 'Content level',
  hitRate: 'Hit rate',
  best: 'Best so far',
  // refinery
  session: 'This session',
  rate: 'Tonnes per hour',
  points: 'Points',
  // bgs
  orders: 'Orders for this system',
  guidance: "The officer's instructions",
  elsewhere: 'Orders elsewhere',
};

/**
 * The field lists as they stood before `offered` was recorded (release 0.5.2).
 *
 * ★ FROZEN, AND NEVER UPDATED AGAIN ★
 *
 * This is not a copy of `OVERLAY_FIELDS` to be kept in step — it is a snapshot of history, used
 * only for configs written before the app recorded what it offered. Updating it would tell those
 * members that fields added since were on offer at the time, which is precisely the lie that would
 * hide the new lines from them.
 *
 * Every config saved from now on carries its own `offered`, so nothing new should ever need adding
 * here.
 */
const LEGACY_OFFERED: Record<OverlayId, readonly string[]> = {
  build: ['title', 'needs', 'progress', 'haulers'],
  route: ['commodity', 'buy', 'sell', 'profit', 'cargo'],
  /*
   * `lastSale` is listed here even though it was never a checkbox: it was DRAWN unconditionally, so
   * it was on offer in every sense that matters to a member looking at the panel. Recording it as
   * legacy is what makes it default OFF now that it is switchable — which is the point of the
   * change, since it is the line the owner called irrelevant.
   */
  cargo: ['items', 'capacity', 'matched', 'lastSale'],
  status: ['sending', 'queued', 'lastUpload', 'gameState'],
  prospector: ['materials', 'motherlode', 'content', 'hitRate', 'best'],
  refinery: ['materials', 'session', 'rate', 'points', 'value', 'bestSale'],
  /*
   * Empty, and correct: this overlay did not exist when any legacy config was written, so it
   * offered nothing. Every field therefore reads as newly added and switches itself on — which is
   * exactly right for a panel a member has never seen a settings row for.
   */
  bgs: [],
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
  /**
   * Every field this overlay OFFERED when the config was written.
   *
   * ★ WHAT MAKES A NEW FIELD REACH AN EXISTING MEMBER ★
   *
   * `fields` alone cannot tell "I turned that off" from "that did not exist yet", and the
   * intersection below treats both as off. Without this record, every field added in a later
   * release ships invisible to everybody who has ever opened the overlay settings.
   */
  offered: string[];
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
      offered: [...OVERLAY_FIELDS[id]],
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
    const chosen = Array.isArray(style.fields)
      ? style.fields.filter((f): f is string => typeof f === 'string' && known.has(f))
      : base.style.fields;

    /*
     * ★ THE MEMBER'S CHOICES, PLUS ANYTHING THEY COULD NOT HAVE CHOSEN ★
     *
     * "Absent from the saved list" means "switched off" only for fields that were on offer at the
     * time. A field added since cannot have been declined, so it arrives on — otherwise a new line
     * ships invisible to every member who has ever opened these settings, which is the failure this
     * whole mechanism exists to prevent.
     *
     * A config written before `offered` existed falls back to LEGACY_OFFERED: the field lists as
     * they stood at that point. Without it, everybody using the app today would be exactly the
     * group the next feature stays hidden from.
     */
    const offered = new Set(
      Array.isArray(style.offered)
        ? style.offered.filter((f): f is string => typeof f === 'string')
        : LEGACY_OFFERED[id],
    );
    const added = OVERLAY_FIELDS[id].filter((f) => !offered.has(f));
    const fields = [...chosen, ...added.filter((f) => !chosen.includes(f))];

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
        // Recorded so the NEXT release can tell a declined field from one that did not exist.
        offered: [...OVERLAY_FIELDS[id]],
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
