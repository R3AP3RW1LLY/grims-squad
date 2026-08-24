import { needsFreshness } from '@grims/shared/needs-freshness';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { OverlayId, OverlayState } from '../overlay-config.js';
import { overlayHeading } from '../overlay-config.js';
import { C } from './ui.js';
import { groupByCategory } from '@grims/shared/commodity-category';
import { ProspectorPanel, RefineryPanel } from './mining-panels.js';
import { BgsPanel } from './bgs-panel.js';

/**
 * What a single overlay panel draws.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "make nice professional editable and lockable overlays for our modules etc."
 *
 * ★ ONE BUNDLE, FOUR PANELS ★
 *
 * Each overlay window loads this same file and reads `?id=` to decide what it is. Four separate
 * bundles would each carry their own copy of Preact and the shared chrome, for four windows that
 * are open at the same time on the same machine.
 */

declare global {
  interface Window {
    readonly overlayBridge: {
      onState(fn: (payload: OverlayMessage) => void): void;
      onData(fn: (payload: OverlayData) => void): void;
      /** Asks the main process for the current state, for a window that loaded late. */
      ready(id: string): void;
      /** Reports this panel's content height so the window can grow to fit it. */
      measured(id: string, height: number): void;
    };
  }
}

interface OverlayMessage {
  readonly id: OverlayId;
  readonly state: OverlayState;
  readonly destination: 'over-game' | 'detached';
}

/**
 * One line of the build panel, as a grid.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "show What is actually remaining vs what is in player cargo holds vs what it actually in assigned
 * fleet carrier holds. turn this into a grid view please but keep it organized by category like it
 * currently is!"
 *
 * ★ THE COLUMNS ARE ORDERED THE WAY THE DECISION IS MADE ★
 *
 * A member reads this mid-flight to answer one question: how much do I still have to BUY. So the
 * outstanding figure comes first, what is already accounted for sits in the middle, and the number
 * they act on is last and in the accent colour — the owner's own choice that "remaining" means
 * still-to-buy.
 *
 * ★ AND A BLANK IS NOT A ZERO ★
 *
 * `knowsCarriers` is false on the journal path, which reads a depot off the pad and has never heard
 * of a carrier. Printing `0 t` there would assert that no carrier holds any, which we do not know.
 * The column goes blank instead — the same distinction `needsFreshness` draws between "none" and
 * "we have not looked".
 */
/**
 * The column headings for the grid.
 *
 * ★ SQUADRON OWNER, 2026-08-16 ★
 *
 * "we need headers and smaller font size i think so it all fits"
 *
 * Four bare numbers in a row mean nothing without them. The first version relied on `title`
 * tooltips, which do not exist on an overlay nobody hovers — it sits over a cockpit and is read at
 * a glance, so anything that needs a hover to be understood is not there at all.
 *
 * Abbreviated because the width is the constraint the owner is actually reporting: NEED / HOLD /
 * CARR / BUY reads at a glance and leaves the commodity name the room it needs.
 */
function NeedHeader({ accent }: { accent: string }): preact.JSX.Element {
  const cell = {
    fontSize: '0.62em',
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    color: C.dim,
    // Right-aligned like the figures beneath them, or the heading sits over the wrong edge of its
    // own column and the eye follows the heading rather than the number.
    textAlign: 'right' as const,
  };

  return (
    <div style={{ display: 'contents' }}>
      <span style={cell} />
      <span style={cell}>Need</span>
      <span style={cell}>Hold</span>
      <span style={cell}>Carr</span>
      <span style={{ ...cell, color: accent }}>Buy</span>
    </div>
  );
}

/** One shared template, so the header and every row cannot drift out of alignment. */
/**
 * ★ THE COLUMNS ARE FIXED, AND THE ROWS JOIN ONE GRID — SQUADRON OWNER, 2026-08-16 ★
 *
 * "the quantities layout is really weird, we need this formatted much better so its all in a
 * straight line up and down and easy to read"
 *
 * The first version gave every ROW its own grid with `auto` columns. `auto` sizes to content, and a
 * grid only aligns the things inside IT — so each row measured itself independently and the numbers
 * landed wherever that row's own digits put them. Nothing lined up vertically, which is the entire
 * job of a table of figures.
 *
 * Two changes fix it and both are needed. The numeric columns are a fixed character width instead of
 * `auto`, so 8 and 24,600 occupy the same space. And the rows use `display: contents`, which makes
 * their cells children of the ONE grid that wraps the whole list — so a column is a column down the
 * entire panel rather than per line.
 *
 * 7ch holds six digits and a separator, which covers every tonnage a colonisation build produces.
 */
const GRID_COLUMNS = 'minmax(0, 1fr) 7ch 7ch 7ch 7ch';

/**
 * Every figure, styled once.
 *
 * Right-aligned and tabular: digits share a width, so the columns stay still as tonnages change
 * rather than shuffling sideways on every poll — which on a panel over a cockpit reads as flicker.
 */
const FIG = {
  fontVariantNumeric: 'tabular-nums' as const,
  textAlign: 'right' as const,
  whiteSpace: 'nowrap' as const,
};

/**
 * The one grid the header and every row live in.
 *
 * `display: contents` on the children is what makes a column a column down the WHOLE panel. Without
 * this wrapper each row would measure itself, which is exactly the layout that was reported as
 * "really weird".
 */
function NeedGrid({ children }: { children: preact.ComponentChildren }): preact.JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: GRID_COLUMNS,
        gap: '1px 8px',
        alignItems: 'baseline',
        fontSize: '0.82em',
      }}
    >
      {children}
    </div>
  );
}

function NeedRow({
  need,
  accent,
}: {
  need: NonNullable<OverlayData['build']>['needs'][number];
  accent: string;
}): preact.JSX.Element {
  const num = (n: number | undefined): string => (n ?? 0).toLocaleString();

  return (
    <div style={{ display: 'contents' }}>
      {/*
        ★ STRUCK THROUGH WHEN IT IS DONE — SQUADRON OWNER ★

        The same treatment as the website and the desktop screens, and it matters most here: this
        panel is read mid-flight, in the seconds before opening a commodity market. A finished line
        that looks like every other line is the one somebody buys again.
      */}
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          ...((need.remaining ?? 0) <= 0 ? { color: C.good, textDecoration: 'line-through' } : {}),
        }}
      >
        {need.commodity}
      </span>
      <span style={{ ...FIG, color: C.dim }} title="Still outstanding">{num(need.remaining)}</span>
      {/*
        ★ COLOURED, BECAUSE THEY ANSWER DIFFERENT QUESTIONS — SQUADRON OWNER, 2026-08-16 ★

        "Hold and Carrier quantities need to be colored"

        Four grey numbers in a row are read as one number four times. Your own hold is cyan and the
        carriers are orange, so a glance says "I am carrying some of this" or "the squadron has it
        parked" without reading a heading. Zero stays dim: a coloured zero draws the eye to the one
        row that has nothing to say.
      */}
      <span
        style={{ ...FIG, color: (need.inHold ?? 0) > 0 ? C.cyan : C.dim }}
        title="In your hold"
      >
        {need.inHold === undefined ? '' : num(need.inHold)}
      </span>
      <span
        style={{ ...FIG, color: (need.onCarriers ?? 0) > 0 ? C.orange : C.dim }}
        title="On fleet carriers"
      >
        {need.knowsCarriers === false ? '·' : num(need.onCarriers)}
      </span>
      <span style={{ ...FIG, color: accent }} title="Still to buy">
        {num(need.stillToBuy ?? need.remaining)}
      </span>
    </div>
  );
}

/** Everything any panel might draw. Sent whole; each panel takes the part it needs. */
/**
 * One shopping list across every build the member is on.
 *
 * ★ THE BREAKDOWN TRAVELS WITH THE TOTAL, ON PURPOSE ★
 *
 * Two builds wanting 500 t of steel each is 1,000 t to BUY and not 1,000 t to deliver anywhere: the
 * cargo splits on arrival, and that split is the member's decision. Sending only the sum would have
 * somebody fill a hold for one site and find half of it unwanted when they land.
 */
export interface OwedAcross {
  readonly rows: ReadonlyArray<{
    readonly commodity: string;
    /** Summed across builds. What to buy — not what to hand to any one of them. */
    readonly tonnes: number;
    /** True when more than one build wants it: buy in bulk, split on arrival. */
    readonly shared: boolean;
    /** Biggest share first, so the row leads with where most of it is going. */
    readonly wantedBy: ReadonlyArray<{ readonly title: string; readonly tonnes: number }>;
  }>;
  readonly projects: number;
  readonly totalTonnes: number;
}

export interface OverlayData {
  readonly build: {
    readonly title: string | null;
    readonly needs: ReadonlyArray<{
      commodity: string;
      category?: string | null;
      remaining: number;
      required: number | null;
      /** Tonnes of it in the member's OWN hold, read off their machine. */
      inHold?: number | undefined;
      /** Tonnes of it parked on the build's attached carriers. */
      onCarriers?: number | undefined;
      /** `remaining` less everything already held. The number read immediately before buying. */
      stillToBuy?: number | undefined;
      /**
       * Whether the carrier figure is a fact or an absence.
       *
       * False on the journal path, which reads a depot off the pad and has never heard of a
       * carrier. A `0 t` there would be a CLAIM — "no carrier has any" — where a blank says the
       * true thing: we did not ask.
       */
      knowsCarriers?: boolean | undefined;
    }>;
    /**
     * How many of the build's commodities are FINISHED, and how many there are in total.
     *
     * ★ A SHORT LIST MUST NOT READ AS A TRUNCATED ONE — SQUADRON OWNER, 2026-08-17 ★
     *
     * "the build tracker is also not showing all remaining commodities, one member is only showing
     * 2 commodities remaining when they have more"
     *
     * It was showing two because two were outstanding; the other seventeen were finished and
     * filtered out. The panel was correct and looked broken — and a list that silently drops rows is
     * indistinguishable from one that has been cut short.
     *
     * The filter stays: this is a strip over a cockpit, and a finished line is not what anybody is
     * deciding from. The count is what says the rest exist.
     */
    readonly finished: number;
    readonly total: number;
    readonly delivered: number;
    readonly required: number;
    readonly haulers: number;
    /**
     * True when these numbers are the hub's whole-project answer — everyone's deliveries, moving
     * while ANY member hauls. False when they come off the depot pad in front of the member.
     */
    readonly fromHub: boolean;
    /**
     * When the site last reported what it wanted, or null if nobody has docked there.
     *
     * * "LIVE FROM THE SQUADRON" IS A CLAIM, AND IT WAS UNCONDITIONAL - AUDIT, 2026-08-18 *
     *
     * The footer said it whatever the age of the reading, so a needs list from a site nobody had
     * docked at in a fortnight was captioned identically to one read four minutes ago. A member
     * hauling against the stale one had no way to tell, and the caption actively said it was fine.
     *
     * The hub has always sent `observedAt` on every need. The overlay simply dropped it.
     */
    readonly observedAt: string | null;
    /**
     * Why THIS project and not another.
     *
     * ★ SQUADRON OWNER, 2026-08-23 ★
     *
     * The panel follows the pad a member is docked at, and falls back to the primary they chose
     * everywhere else. Both are right, and a panel that switches between them silently is one
     * nobody trusts — somebody who set a primary and then sees a different project must be able to
     * tell "you are docked at this one" from "your setting was lost".
     *
     * Optional so an older main process, which sends no such field, still renders everything else.
     */
    readonly because?: string | undefined;
    /**
     * Everything owed across every build the member is on.
     *
     * ★ SQUADRON OWNER, 2026-08-23 ★
     *
     * "SrvSurvey will then show cargo items needed only for the primary or all projects."
     *
     * Absent — not empty — when the member is on a single build, when the hub has not answered, or
     * when nothing is outstanding anywhere. A second list is an extra rather than a claim, so the
     * panel simply omits the section rather than asserting anything about it.
     */
    readonly allProjects?: OwedAcross | undefined;
  } | null;
  /**
   * The run the member picked in the Freight Office.
   *
   * ★ WHAT TO DO AT THIS STATION COMES FIRST ★
   *
   * A member reads this while docked, deciding what to buy or sell before undocking. So `loadHere`
   * and `sellHere` lead — they are an instruction — and the rest of the manifest is context behind
   * them.
   */
  readonly route: {
    /** The whole manifest, in the order to fly it. */
    readonly stops: ReadonlyArray<{
      readonly commodity: string;
      readonly station: string;
      readonly system: string;
      readonly tonnes: number;
    }>;
    /** What to load at the station the member is docked at right now. */
    readonly loadHere: ReadonlyArray<{ readonly commodity: string; readonly tonnes: number }>;
    /** What to sell here. Both can be non-empty: a chain sells and reloads at one station. */
    readonly sellHere: ReadonlyArray<{ readonly commodity: string; readonly tonnes: number }>;
    readonly tonnes: number;
    readonly capacity: number | null;
    readonly outlay: number;
    readonly profit: number;
    /** Hold left empty — "you could carry 700 and are carrying 44" explains itself. */
    readonly spare: number;
    /** Light years for the whole run. Null when a stop could not be placed, so it is grouped. */
    readonly routeLy: number | null;
  } | null;
  readonly cargo: {
    readonly items: ReadonlyArray<{
      commodity: string;
      count: number;
      wanted: boolean;
      /** What the watched buys paid for this line. Null: mined/mission cargo, no watched buy. */
      paid: number | null;
    }>;
    readonly used: number;
    readonly capacity: number | null;
    /** Total watched spend aboard. Zero when nothing was bought under the app's eye. */
    readonly totalPaid: number;
    /** What the hold is worth at the best price in range. Null until the hub has priced it. */
    readonly value: number | null;
    /** Where to take the whole hold, and what that one landing pays. */
    readonly bestSale: {
      readonly station: string;
      readonly system: string;
      readonly distanceLy: number | null;
      readonly total: number;
      readonly perTonne: number;
    } | null;
    /** Worth now less what was paid. Null for mined or mission cargo, which has no basis. */
    readonly profit: number | null;
    /** The till receipt — persists across undocks until the next sale replaces it. */
    readonly lastSale: {
      readonly commodity: string;
      readonly units: number;
      readonly sale: number;
      readonly paid: number | null;
    } | null;
  } | null;
  readonly status: {
    readonly sending: boolean;
    readonly queued: number;
    readonly lastUploadAt: string | null;
    readonly gameRunning: boolean;
  } | null;
  /**
   * The rock in front of the member, right now.
   *
   * The panel that makes this a mining tool rather than a scoreboard: a prospected rock drifts past
   * in a couple of seconds and the whole skill is deciding, inside that window, whether it is worth
   * shooting.
   */
  readonly prospector: {
    readonly materials: ReadonlyArray<{ name: string; percent: number }>;
    /** True when the best material beat the member's own bar for THAT material. */
    readonly isHit: boolean;
    readonly motherlode: string | null;
    readonly content: string | null;
    readonly prospected: number;
    /** Percent, or null before the first rock — a rate over zero rocks is not zero. */
    readonly hitRate: number | null;
    readonly bestPercent: number;
    readonly bestMaterial: string | null;
  } | null;
  /** The session: what came out, how fast, what it scores, and what it is worth. */
  readonly refinery: {
    readonly materials: ReadonlyArray<{ name: string; tonnes: number }>;
    readonly tonnes: number;
    readonly minutes: number | null;
    readonly rate: number | null;
    readonly points: number;
    /** What the hold is worth at the best price we know within range. Null when unknown. */
    readonly value: number | null;
    readonly bestSale: { readonly station: string; readonly distanceLy: number | null; readonly perTonne: number } | null;
  } | null;
  /**
   * The standing orders where the member is, and what they have moved this session.
   *
   * ★ THE ONE THING THE GAME WILL NOT TELL THEM ★
   *
   * A mission board shows every faction equally. Only the squadron knows which of them the officers
   * asked for — so this panel puts that in front of the member at the moment they are choosing what
   * to take, rather than in a Discord message they read yesterday.
   */
  readonly bgs: {
    /** Orders that apply in this system, most important first. */
    readonly here: ReadonlyArray<{
      readonly faction: string;
      readonly stance: string;
      readonly priority: number;
      readonly guidance: string | null;
      /** The squadron's own faction, as opposed to an ally worth supporting. */
      readonly isOurs: boolean;
    }>;
    /** How many orders apply somewhere else — what stops an empty panel reading as "no work". */
    readonly elsewhere: number;
    /** Where the member is, so the panel can name the system it is talking about. */
    readonly system: string | null;
    readonly missions: number;
    readonly pips: number;
    readonly points: number;
  } | null;
}

const EMPTY: OverlayData = {
  build: null,
  route: null,
  cargo: null,
  status: null,
  prospector: null,
  refinery: null,
  bgs: null,
};

const ID = (new URLSearchParams(location.search).get('id') ?? 'status') as OverlayId;

/** The panel's own border and padding, which sit outside the measured content box. */
const PANEL_CHROME_PX = 22;

function App(): preact.JSX.Element | null {
  const [message, setMessage] = useState<OverlayMessage | null>(null);
  const [data, setData] = useState<OverlayData>(EMPTY);

  useEffect(() => {
    window.overlayBridge.onState(setMessage);
    window.overlayBridge.onData((d) => setData({ ...EMPTY, ...d }));
    // A window can finish loading after the main process has already sent its state. Asking on
    // mount closes that race rather than leaving a panel permanently blank.
    window.overlayBridge.ready(ID);
  }, []);

  /*
   * ★ MEASURING THE PANEL SO THE WINDOW CAN FIT IT — SQUADRON OWNER, 2026-08-06 ★
   *
   * "update the build tracker overlay to expand and collapse automatically so we can show the full
   * list"
   *
   * The renderer is the only thing that CAN know this height: it depends on how many commodities a
   * build wants and how the text wrapped, neither of which the main process can see.
   *
   * A ResizeObserver rather than a measurement per render, because the height changes for reasons
   * a render does not — a font settling, a scrollbar arriving. The main process applies a dead band
   * (`nextOverlayHeight`), which is what stops resize→repaint→measure→resize running away.
   */
  const body = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = body.current;
    if (node === null) return;

    const report = (): void => {
      // scrollHeight, not clientHeight: clientHeight is what the window already allows, which would
      // measure the panel as exactly the size it is and never grow.
      window.overlayBridge.measured(ID, node.scrollHeight + PANEL_CHROME_PX);
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  });

  if (message === null) return null;

  const { state, destination } = message;
  const arranging = !state.locked && destination === 'over-game';

  return (
    <div
      style={{
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        fontSize: `${13 * state.style.scale}px`,
        color: C.text,
        /*
          Opacity is on the PANEL, not the window. `BrowserWindow.setOpacity` fades the whole window
          including its own compositing, which on Windows disables click-through — so a member who
          dimmed a locked overlay would find it started catching their clicks.
        */
        opacity: state.style.opacity,
        background: C.panelGlass,
        border: `1px solid ${arranging ? state.style.accent : C.hairline}`,
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      {/*
        The build tracker names its project up here rather than spending a row of the list on it —
        "Build tracker - Parazynski Prospect". The decision lives in `overlayHeading` so it can be
        tested; this hands the result to a bar that draws what it is given.
      */}
      <Header
        heading={overlayHeading(ID, data.build?.title ?? null, state.style.fields)}
        state={state}
        arranging={arranging}
      />
      {/*
        `overflow: auto` rather than hidden: the window grows to fit its content up to a cap, and
        past that cap the list has to remain reachable rather than being silently clipped — which is
        the fault this change exists to fix.
      */}
      <div ref={body} style={{ padding: '8px 10px 10px', overflow: 'auto', flex: 1 }}>
        <Panel id={ID} state={state} data={data} />
      </div>
    </div>
  );
}

function Header({
  heading,
  state,
  arranging,
}: {
  /** Already assembled — see `overlayHeading`. This draws it and makes no decisions of its own. */
  heading: string;
  state: OverlayState;
  arranging: boolean;
}): preact.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        padding: '6px 10px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: arranging ? `${state.style.accent}22` : 'transparent',
        /*
          ★ THE WHOLE DRAG IMPLEMENTATION ★

          `app-region: drag` hands dragging to the operating system. The alternative is listening for
          mousedown, tracking mousemove, and calling setPosition over IPC for every pixel — which
          lags behind the cursor, fights the compositor, and has to be undone if the window is
          click-through. This is one CSS property and it is exact.

          Only while ARRANGING. A locked overlay is click-through anyway, and leaving the region
          draggable would mean a click that happened to land on the header while the panel was
          briefly focusable would move it.
        */
        ...(arranging ? { WebkitAppRegion: 'drag' } : {}),
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '9px',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: state.style.accent,
          /*
            ★ ONE LINE, ALWAYS ★

            A project name is arbitrary length and the bar is a few hundred pixels wide. Wrapping it
            would push the header taller — and the window's height is measured from the BODY only,
            with the chrome allowed for by a constant, so a two-line bar does not make the window
            grow. It eats a row of the needs list instead, silently, on the panel somebody is
            reading mid-flight.

            `minWidth: 0` because a flex child will not shrink below its content without it, which
            is what makes the ellipsis actually happen rather than the text simply overflowing.
          */
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {heading}
      </span>
      {/*
        Shown only while arranging, and it is the only affordance that has to be there: a member who
        has just switched an overlay on and unlocked it needs to know the bar is the handle.
      */}
      {arranging ? (
        // `flexShrink: 0` so the hint keeps its width and the heading is what gives — the heading
        // can say less and still be useful; "drag · resize edges" cut in half cannot.
        <span style={{ fontSize: '9px', color: C.dim, flexShrink: 0 }}>drag · resize edges</span>
      ) : null}
    </div>
  );
}

function Panel({
  id,
  state,
  data,
}: {
  id: OverlayId;
  state: OverlayState;
  data: OverlayData;
}): preact.JSX.Element {
  const show = (field: string): boolean => state.style.fields.includes(field);

  switch (id) {
    case 'build':
      return <BuildPanel data={data.build} accent={state.style.accent} show={show} />;
    case 'route':
      return <RoutePanel data={data.route} accent={state.style.accent} show={show} />;
    case 'cargo':
      return <CargoPanel data={data.cargo} accent={state.style.accent} show={show} />;
    case 'status':
      return <StatusPanel data={data.status} accent={state.style.accent} show={show} />;
    case 'prospector':
      return <ProspectorPanel data={data.prospector} accent={state.style.accent} show={show} />;
    case 'refinery':
      return <RefineryPanel data={data.refinery} accent={state.style.accent} show={show} />;
    case 'bgs':
      return <BgsPanel data={data.bgs} accent={state.style.accent} show={show} />;
  }
}

/** Every panel says this rather than drawing an empty frame that reads as broken. */
function Waiting({ what }: { what: string }): preact.JSX.Element {
  /*
   * C.dim, not C.faint. This sentence is the ONLY thing an empty panel draws — it is what tells a
   * member why there are no numbers — and `faint` is the token the design SSOT marks decorative and
   * disabled only. Over a bright part of the game it fell to about 2.3:1 and vanished at exactly
   * the moment somebody needed to read it.
   */
  return <p style={{ margin: 0, fontSize: '0.85em', color: C.dim }}>{what}</p>;
}

const ROW: preact.JSX.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '10px',
  padding: '1px 0',
};

function BuildPanel({
  data,
  accent,
  show,
}: {
  data: OverlayData['build'];
  accent: string;
  show: (f: string) => boolean;
}): preact.JSX.Element {
  // Both ways the panel fills, said out loud: the hub path follows a marked build everywhere, the
  // journal path lights up the moment the member docks at any construction site.
  if (data === null) return <Waiting what="Mark a current build, or dock at a construction site." />;

  const pct = data.required > 0 ? Math.round((data.delivered / data.required) * 100) : null;
  // The four biggest shortfalls. A construction site wants around thirty commodities and an overlay
  // is 140px tall — showing all of them makes every line unreadable.
  /*
   * ★ THE WHOLE LIST — SQUADRON OWNER, 2026-08-06 ★
   *
   * "update the build tracker overlay to expand and collapse automatically so we can show the full
   * list"
   *
   * This was `slice(0, 4)`, because four rows is what fits a fixed 140px window. For a hauler
   * deciding what to load, four of eleven with nothing to say the other seven exist is the wrong
   * four about as often as not.
   *
   * The window now measures itself and grows (see `overlay-autosize.ts`), so the cap can go. Past
   * the height cap the panel scrolls rather than clipping.
   */
  const needs = [...data.needs].sort((a, b) => b.remaining - a.remaining);
  /*
   * Null means "this list has no categories", which is the journal path — see the render below.
   * A single categorised row is enough to group by, because the hub sends the field for every row
   * or for none.
   */
  const grouped = needs.some((n) => (n.category ?? null) !== null) ? groupByCategory(needs) : null;

  /*
   * ★ SAID ONLY WHEN SOMETHING IS HIDDEN ★
   *
   * On a build where nothing is finished this line would be noise, and on a strip this size noise
   * costs a row somebody needed. It appears exactly when the list is shorter than the bill.
   */
  const hidden = Math.max(0, (data.finished ?? 0));
  const total = data.total ?? needs.length + hidden;

  return (
    <div>
      {/*
        ★ THE PROJECT NAME IS ON THE TITLE BAR NOW — SQUADRON OWNER, 2026-08-10 ★

        "can we move the project name out of the build tracker overlay and onto the overlay title
        bar so it would look like Build Tracker - Project Name?"

        It used to be this row. The bar was already drawn and already had the room, and the row was
        costing a line of the list underneath — which is the part somebody reads mid-flight. The
        `title` field toggle still governs it; see `overlayHeading`.
      */}
      {/*
        ★ WHY THIS PROJECT — SQUADRON OWNER, 2026-08-23 ★

        The panel follows the pad the member is docked at and falls back to the primary they chose
        everywhere else. Silently switching between the two is how a member concludes the setting
        broke, so the surprising cases say which is happening.

        Only the surprising ones: `because` is absent unless the shared rule judged it worth a row,
        because a row spent on "you are docked where you are docked" is a row off the needs list.
      */}
      {data.because === undefined ? null : (
        <p
          style={{
            margin: '0 0 4px',
            fontSize: '10px',
            letterSpacing: '0.08em',
            color: C.warn,
          }}
        >
          {data.because}
        </p>
      )}
      {show('needs') && hidden > 0 ? (
        <p
          style={{
            margin: '0 0 4px',
            fontSize: '10px',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: C.good,
          }}
        >
          {hidden} of {total} complete
        </p>
      ) : null}
      {/*
        `needs.length > 0` rather than `show('needs')` alone: with nothing focused the panel still
        draws for the combined list below, and an empty grid showing only its column headings is the
        "empty table nobody generated" problem — indistinguishable on screen from one that failed.
      */}
      {show('needs') && needs.length > 0 ? (
        grouped === null ? (
          /*
           * ★ FLAT WHEN THERE IS NOTHING TO GROUP BY ★
           *
           * The overlay fills two ways. Following a marked build brings the categories down with the
           * needs; docking at a construction site reads the depot straight out of the journal, which
           * carries no market data at all.
           *
           * Grouping that second list would file EVERY commodity under "Not sold on any market" —
           * a heading that is false about all of them, on the surface a member trusts most because
           * it is the one in front of them mid-flight. So the grouping appears exactly when it is
           * real, and the panel looks the way it always did when it is not.
           */
          <NeedGrid>
            <NeedHeader accent={accent} />
            {needs.map((n) => (
              <NeedRow key={n.commodity} need={n} accent={accent} />
            ))}
          </NeedGrid>
        ) : (
          grouped.map((group) => (
            <div key={group.category}>
              <p
                style={{
                  margin: '5px 0 1px',
                  fontSize: '0.75em',
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: C.dim,
                }}
              >
                {group.category}
              </p>
              {/*
                Repeated per category rather than once at the top: the panel scrolls, and a heading
                that has scrolled away is a heading that is not doing its job.
              */}
              <NeedGrid>
                <NeedHeader accent={accent} />
                {group.rows.map((n) => (
                  <NeedRow key={n.commodity} need={n} accent={accent} />
                ))}
              </NeedGrid>
            </div>
          ))
        )
      ) : null}

      {show('progress') && pct !== null ? (
        <div style={{ marginTop: '6px' }}>
          <div style={{ height: '3px', background: C.subtle, borderRadius: '2px' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: accent, borderRadius: '2px' }} />
          </div>
          <p style={{ margin: '3px 0 0', fontSize: '0.8em', color: C.dim }}>
            {data.delivered.toLocaleString()} of {data.required.toLocaleString()} t · {pct}%
            {show('haulers') && data.haulers > 0 ? ` · ${data.haulers} hauling` : ''}
            {/*
              Where the numbers come from AND how old they are. "Live from the squadron" was said
              unconditionally, so a fortnight-old reading was captioned exactly like a fresh one.

              The age is what a member actually needs here: a strip over a cockpit has room for a
              few words, and "read 12 days ago" changes a decision in a way "live" never could.
            */}
            {data.fromHub ? ` · ${sourceLine(data.observedAt)}` : ''}
          </p>
        </div>
      ) : null}

      {show('allProjects') && data.allProjects !== undefined ? (
        <AllProjects owed={data.allProjects} accent={accent} />
      ) : null}
    </div>
  );
}

/**
 * Everything owed everywhere — the list a member reads standing in a commodity market.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "SrvSurvey will then show cargo items needed only for the primary or all projects."
 *
 * ★ THE SHARED ROWS ARE THE POINT ★
 *
 * A commodity two builds want is one to buy in bulk and split on arrival, and that is the single
 * most useful thing this list can say. It is marked rather than sorted to the top: the order that
 * fills a hold is still biggest-first, and a member scanning for what to buy should not have to
 * re-learn the ordering because a row happens to be shared.
 *
 * ★ AND THE SPLIT IS NAMED, NOT JUST COUNTED ★
 *
 * "1,000 t" across two builds is 1,000 t to BUY and not 1,000 t to hand to either of them. Showing
 * the total alone would have somebody fill a hold for one site and find half of it unwanted on
 * arrival, which is a wasted trip the panel caused.
 */
function AllProjects({ owed, accent }: { owed: OwedAcross; accent: string }): preact.JSX.Element {
  return (
    <div style={{ marginTop: '6px', borderTop: `1px solid ${C.subtle}`, paddingTop: '5px' }}>
      <p
        style={{
          margin: '0 0 3px',
          fontSize: '10px',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: C.dim,
        }}
      >
        All builds · {owed.projects} projects · {owed.totalTonnes.toLocaleString()} t to buy
      </p>
      {owed.rows.map((row) => (
        <div
          key={row.commodity}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: '6px',
            fontSize: '0.85em',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span style={{ color: row.shared ? accent : C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.commodity}
            {/*
              Named, not just flagged: which builds want it is what decides how the hold splits.
              Only on shared rows — on a single-build row the name is the heading repeated.
            */}
            {row.shared ? (
              <span style={{ color: C.faint }}>
                {' '}
                · {row.wantedBy.map((w) => `${w.title} ${w.tonnes.toLocaleString()}`).join(' + ')}
              </span>
            ) : null}
          </span>
          <span style={{ color: C.text }}>{row.tonnes.toLocaleString()} t</span>
        </div>
      ))}
    </div>
  );
}


/**
 * How the build panel describes where its numbers came from, and when.
 *
 * Deliberately terse: this is a strip over a cockpit, not a page. `needsFreshness` produces a full
 * sentence for the website, which would wrap three times here — so the state it decides is reused
 * and the words are the overlay's own.
 *
 * Null is NOT "very old". A build nobody has docked at yet has no reading at all, and its figures
 * are the catalogue's estimate; reporting that as stale would be alarming and wrong.
 */
function sourceLine(observedAt: string | null): string {
  if (observedAt === null) return 'squadron · not yet read';

  const verdict = needsFreshness(new Date(observedAt), new Date());
  if (verdict.state === 'fresh') return 'live from the squadron';

  const days = verdict.days ?? 0;
  if (days <= 0) return 'squadron · read today';
  return `squadron · read ${days}d ago`;
}

function RoutePanel({
  data,
  accent,
  show,
}: {
  data: OverlayData['route'];
  accent: string;
  show: (f: string) => boolean;
}): preact.JSX.Element {
  if (data === null) return <Waiting what="Pick a run in the Freight Office." />;

  return (
    <div style={{ display: 'grid', gap: '2px' }}>
      {/*
        ★ WHAT TO DO HERE COMES FIRST — SQUADRON OWNER, 2026-08-06 ★

        "add an option to choose the trade route and display them in the overlay"

        This panel is read while docked, in the seconds before opening the commodity market. An
        instruction for the station the member is standing at is worth more than the whole manifest,
        so it sits at the top and the plan is context behind it.

        Both lists can be non-empty at once: a chain sells here and loads the next leg here, and a
        panel that showed only one would have somebody undock having done half the job.
      */}
      {show('here') && data.sellHere.length > 0 ? (
        <div style={{ ...ROW, color: C.good, fontWeight: 600 }}>
          <span>SELL HERE</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {data.sellHere.map((l) => `${l.commodity} ${l.tonnes}t`).join(' · ')}
          </span>
        </div>
      ) : null}

      {show('here') && data.loadHere.length > 0 ? (
        <div style={{ ...ROW, color: accent, fontWeight: 600 }}>
          <span>LOAD HERE</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {data.loadHere.map((l) => `${l.commodity} ${l.tonnes}t`).join(' · ')}
          </span>
        </div>
      ) : null}

      {/*
        The stops in the order to fly them. Numbered because the ORDER is the thing the planner
        worked out — an unnumbered list reads as a set of options rather than a sequence.
      */}
      {show('stops')
        ? data.stops.map((stop, i) => (
            <div key={`${stop.station}:${stop.commodity}`} style={ROW}>
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ color: C.faint }}>{i + 1}. </span>
                {stop.commodity}
                <span style={{ color: C.dim }}> · {stop.station}</span>
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: C.dim }}>
                {stop.tonnes.toLocaleString()} t
              </span>
            </div>
          ))
        : null}

      {show('profit') ? (
        <div style={{ ...ROW, marginTop: '4px', color: accent }}>
          <span>Profit</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            +{data.profit.toLocaleString()} cr
          </span>
        </div>
      ) : null}

      {show('cargo') ? (
        <p style={{ margin: '3px 0 0', fontSize: '0.8em', color: C.dim }}>
          {data.tonnes.toLocaleString()} t
          {/*
            The hold is stated only when a Loadout has been seen. Without one the manifest was
            planned against what the stations can supply, and quoting a capacity we are guessing at
            would be the one number on this panel nobody would think to doubt.
          */}
          {data.capacity === null
            ? ' loaded · hold unknown until a Loadout is seen'
            : ` of ${data.capacity.toLocaleString()} t${data.spare > 0 ? ` · ${data.spare.toLocaleString()} t spare` : ''}`}
          {data.routeLy === null
            ? // Said plainly: the stops are grouped by system, not routed. A member comparing this
              // against their own galaxy map should know which of the two they are looking at.
              ' · grouped, not routed'
            : ` · ${Math.round(data.routeLy)} ly`}
        </p>
      ) : null}
    </div>
  );
}

function CargoPanel({
  data,
  accent,
  show,
}: {
  data: OverlayData['cargo'];
  accent: string;
  show: (f: string) => boolean;
}): preact.JSX.Element {
  if (data === null) return <Waiting what="Waiting for your hold." />;

  /*
   * ★ THE TRIP P&L SURVIVES AN EMPTY HOLD ★
   *
   * An empty hold plus a P&L line is the state a hauler is in seconds after selling everything —
   * which is exactly when the net is the number they want. The early "Hold empty." return used to
   * end the panel; now the ledger line rides below it. It is null — and completely hidden — until
   * something has actually been bought or sold this trip.
   */
  if (data.items.length === 0) {
    /*
     * ★ THE LAST SALE SURVIVES AN EMPTY HOLD ★
     *
     * Seconds after selling everything is exactly when the receipt matters most — the owner's
     * words: "keep it on screen as the last transaction until they reload and sell".
     */
    return (
      <div>
        <Waiting what="Hold empty." />
        {show('lastSale') ? <LastSaleLine sale={data.lastSale} /> : null}
      </div>
    );
  }

  return (
    <div>
      {show('items')
        ? [...data.items]
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
            .map((c) => (
              <div key={c.commodity} style={ROW}>
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    // Highlighted when the current project or run actually wants it, which is the
                    // whole reason to show a hold you can already see in game.
                    color: show('matched') && c.wanted ? accent : 'inherit',
                  }}
                >
                  {c.commodity}
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {c.count.toLocaleString()}
                  {/* What was paid for this line, when the app watched it bought. A dash would be
                      noise on every mined stack; absence says the same thing quietly. */}
                  {c.paid === null ? '' : (
                    <span style={{ color: C.dim }}> · {c.paid.toLocaleString()} cr</span>
                  )}
                </span>
              </div>
            ))
        : null}

      {show('capacity') ? (
        <p style={{ margin: '4px 0 0', fontSize: '0.8em', color: C.dim }}>
          {data.used.toLocaleString()}
          {data.capacity === null ? '' : ` / ${data.capacity.toLocaleString()}`} t
        </p>
      ) : null}

      {/*
        ★ SQUADRON OWNER, 2026-08-06 ★

        "we want valiue information but its showing irrellevant sell information in it!"

        What the hold is WORTH, and where to take it. The two lines below are the reason this panel
        is worth having over the game's own cargo screen, and neither is available to any other
        tool — they need eighteen million price rows to answer.
      */}
      {show('value') && data.value !== null ? (
        <p style={{ margin: '4px 0 0', fontSize: '0.8em' }}>
          <span style={{ color: C.dim }}>Worth </span>
          <span style={{ color: accent, fontVariantNumeric: 'tabular-nums' }}>
            {data.value.toLocaleString()} cr
          </span>
          {/* The unrealised gain, and only when there is an honest basis to subtract. */}
          {show('profit') && data.profit !== null ? (
            <span
              style={{
                fontVariantNumeric: 'tabular-nums',
                color: data.profit > 0 ? C.good : data.profit < 0 ? C.bad : C.dim,
              }}
            >
              {' '}
              ({data.profit < 0 ? '−' : '+'}
              {Math.abs(data.profit).toLocaleString()})
            </span>
          ) : null}
        </p>
      ) : null}

      {show('bestSale') && data.bestSale !== null ? (
        <p style={{ margin: '3px 0 0', fontSize: '0.8em', color: C.dim }}>
          Best {data.bestSale.station}
          {data.bestSale.distanceLy === null ? '' : ` · ${data.bestSale.distanceLy.toFixed(0)} ly`}
          {' · '}
          {data.bestSale.perTonne.toLocaleString()}/t
        </p>
      ) : null}

      {/*
        The receipt for the last trip. Rendered unconditionally until 2026-08-06, when the owner
        called it out as the irrelevant part — it is now a field, and off by default for anybody who
        already had a config. Kept rather than deleted because they asked for it in the first place.
      */}
      {show('lastSale') ? <LastSaleLine sale={data.lastSale} /> : null}
    </div>
  );
}

/**
 * The till receipt: the most recent completed sale, held on screen across undocks until the next
 * one replaces it. Hidden entirely until a first sale has happened — a receipt for nothing says
 * nothing.
 */
function LastSaleLine({
  sale,
}: {
  sale: NonNullable<OverlayData['cargo']>['lastSale'];
}): preact.JSX.Element | null {
  if (sale === null) return null;

  const profit = sale.paid === null ? null : sale.sale - sale.paid;
  return (
    <p style={{ margin: '4px 0 0', fontSize: '0.8em', color: C.dim }}>
      Sold {sale.units.toLocaleString()} {sale.commodity} · {sale.sale.toLocaleString()} cr
      {profit === null ? null : (
        <span
          style={{
            fontVariantNumeric: 'tabular-nums',
            // Green in profit, red in the hole, and the resting dim at exactly break-even.
            color: profit > 0 ? C.good : profit < 0 ? C.bad : C.dim,
          }}
        >
          {' '}
          ({profit < 0 ? '−' : '+'}
          {Math.abs(profit).toLocaleString()} cr)
        </span>
      )}
    </p>
  );
}

function StatusPanel({
  data,
  accent,
  show,
}: {
  data: OverlayData['status'];
  accent: string;
  show: (f: string) => boolean;
}): preact.JSX.Element {
  if (data === null) return <Waiting what="Starting up." />;

  return (
    <div>
      {show('sending') ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              // Green only when it is genuinely sending. A dot that is always green is a dot nobody
              // believes, and this panel exists so somebody can check without alt-tabbing.
              background: data.sending ? accent : C.faint,
            }}
          />
          <span>{data.sending ? 'Sending' : 'Idle'}</span>
        </div>
      ) : null}

      {show('queued') && data.queued > 0 ? (
        <div style={ROW}>
          <span>Queued</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{data.queued.toLocaleString()}</span>
        </div>
      ) : null}

      {/* Hidden until the first upload lands rather than showing "never" — a fresh install's
          panel should not open with a word that reads like a fault. */}
      {show('lastUpload') && data.lastUploadAt !== null ? (
        <div style={ROW}>
          <span>Last upload</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {new Date(data.lastUploadAt).toLocaleTimeString()}
          </span>
        </div>
      ) : null}

      {show('gameState') ? (
        <p style={{ margin: '4px 0 0', fontSize: '0.8em', color: C.dim }}>
          {data.gameRunning ? 'Elite is running' : 'Elite is not running'}
        </p>
      ) : null}
    </div>
  );
}

const root = document.getElementById('root');
if (root !== null) render(<App />, root);
