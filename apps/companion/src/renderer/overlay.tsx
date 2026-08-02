import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { OverlayId, OverlayState } from '../overlay-config.js';
import { C } from './ui.js';

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
    readonly items: ReadonlyArray<{ commodity: string; count: number; wanted: boolean }>;
    readonly used: number;
    readonly capacity: number | null;
  } | null;
  readonly status: {
    readonly sending: boolean;
    readonly queued: number;
    readonly lastUploadAt: string | null;
    readonly gameRunning: boolean;
  } | null;
}

const EMPTY: OverlayData = { build: null, route: null, cargo: null, status: null };

const ID = (new URLSearchParams(location.search).get('id') ?? 'status') as OverlayId;

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
      <div style={{ padding: '8px 10px 10px', overflow: 'hidden', flex: 1 }}>
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
  if (data === null) return <Waiting what="Dock at a posted construction site." />;

  const pct = data.required > 0 ? Math.round((data.delivered / data.required) * 100) : null;
  // The four biggest shortfalls. A construction site wants around thirty commodities and an overlay
  // is 140px tall — showing all of them makes every line unreadable.
  const needs = [...data.needs].sort((a, b) => b.remaining - a.remaining).slice(0, 4);

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
  if (data.items.length === 0) return <Waiting what="Hold empty." />;

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
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{c.count.toLocaleString()}</span>
              </div>
            ))
        : null}

      {show('capacity') ? (
        <p style={{ margin: '4px 0 0', fontSize: '0.8em', color: C.dim }}>
          {data.used.toLocaleString()}
          {data.capacity === null ? '' : ` / ${data.capacity.toLocaleString()}`} t
        </p>
      ) : null}
    </div>
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
