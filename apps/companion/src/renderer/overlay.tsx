import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { OverlayId, OverlayState } from '../overlay-config.js';
import { C } from './ui.js';
import { ProspectorPanel, RefineryPanel } from './mining-panels.js';

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

/** Everything any panel might draw. Sent whole; each panel takes the part it needs. */
export interface OverlayData {
  readonly build: {
    readonly title: string | null;
    readonly needs: ReadonlyArray<{ commodity: string; remaining: number; required: number | null }>;
    readonly delivered: number;
    readonly required: number;
    readonly haulers: number;
    /**
     * True when these numbers are the hub's whole-project answer — everyone's deliveries, moving
     * while ANY member hauls. False when they come off the depot pad in front of the member.
     */
    readonly fromHub: boolean;
  } | null;
  readonly route: {
    readonly commodity: string;
    readonly buyAt: string;
    readonly buyPrice: number;
    readonly sellAt: string;
    readonly sellPrice: number;
    readonly profitPerTonne: number;
    readonly tonnes: number;
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
}

const EMPTY: OverlayData = {
  build: null,
  route: null,
  cargo: null,
  status: null,
  prospector: null,
  refinery: null,
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
      <Header id={ID} state={state} arranging={arranging} />
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
  id,
  state,
  arranging,
}: {
  id: OverlayId;
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
        }}
      >
        {TITLES[id]}
      </span>
      {/*
        Shown only while arranging, and it is the only affordance that has to be there: a member who
        has just switched an overlay on and unlocked it needs to know the bar is the handle.
      */}
      {arranging ? (
        <span style={{ fontSize: '9px', color: C.dim }}>drag · resize edges</span>
      ) : null}
    </div>
  );
}

const TITLES: Record<OverlayId, string> = {
  build: 'Build tracker',
  route: 'Trade run',
  cargo: 'Cargo',
  status: 'Uplink',
  prospector: 'Prospector',
  refinery: 'Refinery',
};

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

  return (
    <div>
      {show('title') && data.title !== null ? (
        <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{data.title}</p>
      ) : null}

      {show('needs')
        ? needs.map((n) => (
            <div key={n.commodity} style={ROW}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {n.commodity}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: accent }}>
                {n.remaining.toLocaleString()} t
              </span>
            </div>
          ))
        : null}

      {show('progress') && pct !== null ? (
        <div style={{ marginTop: '6px' }}>
          <div style={{ height: '3px', background: C.subtle, borderRadius: '2px' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: accent, borderRadius: '2px' }} />
          </div>
          <p style={{ margin: '3px 0 0', fontSize: '0.8em', color: C.dim }}>
            {data.delivered.toLocaleString()} of {data.required.toLocaleString()} t · {pct}%
            {show('haulers') && data.haulers > 0 ? ` · ${data.haulers} hauling` : ''}
            {/* Says where these numbers come from: the whole squadron's deliveries, not just
                this machine's journal — which is why they move while the member is elsewhere. */}
            {data.fromHub ? ' · live from the squadron' : ''}
          </p>
        </div>
      ) : null}
    </div>
  );
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
    <div>
      {show('commodity') ? (
        <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{data.commodity}</p>
      ) : null}
      {show('buy') ? (
        <div style={ROW}>
          <span>Buy · {data.buyAt}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{data.buyPrice.toLocaleString()}</span>
        </div>
      ) : null}
      {show('sell') ? (
        <div style={ROW}>
          <span>Sell · {data.sellAt}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{data.sellPrice.toLocaleString()}</span>
        </div>
      ) : null}
      {show('profit') ? (
        <div style={{ ...ROW, marginTop: '4px', color: accent }}>
          <span>Per tonne</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            +{data.profitPerTonne.toLocaleString()}
          </span>
        </div>
      ) : null}
      {show('cargo') ? (
        <p style={{ margin: '3px 0 0', fontSize: '0.8em', color: C.dim }}>
          {data.tonnes.toLocaleString()} t · {(data.profitPerTonne * data.tonnes).toLocaleString()} cr
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
