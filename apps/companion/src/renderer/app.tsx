import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { OverlayLayout } from '../overlay-config.js';
import { Button, C, Card, Empty, Problem, Section, Stat } from './ui.js';
import { Colonisation } from './colonisation.js';
import { OverlaysPanel } from './overlays-panel.js';

/**
 * The companion app's window.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "we need the companion app to have a nice Navigation UI ... its time to really take the companion
 * app to the next level."
 *
 * ★ A SIDEBAR, NOT TABS ★
 *
 * There are five destinations now and more coming — trade runs, and whatever the squadron asks for
 * next. Tabs across the top run out of room and start truncating; a sidebar grows down a window
 * that is already taller than it is wide, and it leaves the section names readable at full length.
 * The website's own navigation is a sidebar for the same reason.
 */

declare global {
  interface Window {
    readonly companion: {
      getState(): Promise<AppState>;
      onState(handler: (state: AppState) => void): void;
      signIn(): Promise<unknown>;
      cancelSignIn(): Promise<unknown>;
      reopenLink(): Promise<unknown>;
      unpair(): Promise<unknown>;
      setEnabled(enabled: boolean): Promise<unknown>;
      setAutoStart(on: boolean): Promise<unknown>;
      openHub(): Promise<unknown>;
      rescan(): Promise<unknown>;
    };
  }
}

/** Only the parts of the main process's state this UI reads. */
interface AppState {
  paired: boolean;
  linking: boolean;
  linkCode: string | null;
  tokenHint: string;
  enabled: boolean;
  autoStart: boolean;
  activity?: Array<{ at: string; text: string }>;
  totals?: { sent: number; duplicates: number; journalsRead: number; since: string | null };
  gameRunning?: boolean;
  error?: string | null;
  /** Where the commander is docked, when it is recent enough to trust. Null otherwise. */
  dockedAt: { marketId: string; stationName: string; systemName: string } | null;
  overlays: OverlayLayout;
  overlayEditing: boolean;
  displayMode: string;
  displayNote: string | null;
}

type Page = 'status' | 'colonisation' | 'trade' | 'overlays' | 'device';

const PAGES: ReadonlyArray<{ id: Page; label: string; hint: string }> = [
  { id: 'status', label: 'Status', hint: 'What the app is doing' },
  { id: 'colonisation', label: 'Colonisation', hint: 'Projects and what they need' },
  { id: 'trade', label: 'Trade runs', hint: 'Routes from the Freight Office' },
  { id: 'overlays', label: 'Overlays', hint: 'Panels drawn over the game' },
  { id: 'device', label: 'This device', hint: 'Pairing and privacy' },
];

function App(): JSX.Element {
  const [state, setState] = useState<AppState | null>(null);
  const [page, setPage] = useState<Page>('status');

  useEffect(() => {
    void window.companion.getState().then(setState);
    window.companion.onState(setState);
  }, []);

  if (state === null) {
    return (
      <div style={{ padding: '40px', color: C.dim }}>
        <Empty>Starting…</Empty>
      </div>
    );
  }

  /*
   * ★ PAIRING TAKES THE WHOLE WINDOW ★
   *
   * Nothing else here works without it, so offering a sidebar full of destinations that would all
   * say "pair this device first" is five ways to be told the same thing. One screen, one action.
   */
  if (!state.paired) return <SignIn state={state} />;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <nav
        style={{
          width: '212px',
          flexShrink: 0,
          borderRight: `1px solid ${C.hairline}`,
          background: C.panel,
          padding: '18px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
        aria-label="Sections"
      >
        <p
          style={{
            margin: '0 0 16px 8px',
            fontFamily: 'Orbitron, sans-serif',
            fontSize: '11px',
            letterSpacing: '0.2em',
            color: C.cyan,
          }}
        >
          GRIM&rsquo;S SQUAD
        </p>

        {PAGES.map((p) => {
          const active = page === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPage(p.id)}
              title={p.hint}
              style={{
                textAlign: 'left',
                border: 'none',
                borderLeft: `2px solid ${active ? C.cyan : 'transparent'}`,
                background: active ? C.raised : 'transparent',
                color: active ? C.text : C.dim,
                padding: '9px 12px',
                borderRadius: '0 7px 7px 0',
                fontSize: '13px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {p.label}
            </button>
          );
        })}

        <div style={{ marginTop: 'auto', paddingLeft: '8px' }}>
          {/*
            The uplink state, always visible whichever section is open. It is the one thing somebody
            opens this app to check, and making them navigate to it would be the wrong default.
          */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: state.enabled ? C.good : C.faint,
              }}
            />
            <span style={{ fontSize: '11px', color: C.dim }}>
              {state.enabled ? 'Sending' : 'Paused'}
            </span>
          </div>
        </div>
      </nav>

      <main style={{ flex: 1, overflowY: 'auto', padding: '22px 26px' }}>
        {page === 'status' ? <Status state={state} /> : null}
        {page === 'colonisation' ? <Colonisation dockedAt={state.dockedAt} /> : null}
        {page === 'trade' ? <TradeRuns /> : null}
        {page === 'overlays' ? (
          <OverlaysPanel
            layout={state.overlays}
            editing={state.overlayEditing}
            displayNote={state.displayNote}
            displayMode={state.displayMode}
          />
        ) : null}
        {page === 'device' ? <Device state={state} /> : null}
      </main>
    </div>
  );
}

function SignIn({ state }: { state: AppState }): JSX.Element {
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '18px',
        padding: '40px',
      }}
    >
      <p style={{ margin: 0, fontFamily: 'Orbitron, sans-serif', fontSize: '15px', letterSpacing: '0.2em', color: C.cyan }}>
        COMPANION
      </p>
      <p style={{ margin: 0, maxWidth: '42ch', textAlign: 'center', fontSize: '13px', color: C.dim }}>
        Sign in with your squadron account to pair this machine. Your browser will open and ask you
        to approve it.
      </p>

      {state.linking ? (
        <>
          {/*
            The code, shown here as well as in the URL. Every path except the happy one — the browser
            failing to open, the tab being closed, approving from a phone — leaves the approval page
            asking for a code that nothing on screen could supply.
          */}
          {state.linkCode === null ? null : (
            <p style={{ margin: 0, fontFamily: 'Orbitron, sans-serif', fontSize: '26px', letterSpacing: '0.3em', color: C.text }}>
              {state.linkCode}
            </p>
          )}
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button onClick={() => void window.companion.reopenLink()}>Open the page again</Button>
            <Button onClick={() => void window.companion.cancelSignIn()}>Cancel</Button>
          </div>
        </>
      ) : (
        <Button tone="primary" onClick={() => void window.companion.signIn()}>
          Sign in
        </Button>
      )}
    </div>
  );
}

function Status({ state }: { state: AppState }): JSX.Element {
  const totals = state.totals ?? { sent: 0, duplicates: 0, journalsRead: 0, since: null };

  return (
    <div>
      {state.error === null || state.error === undefined ? null : (
        <div style={{ marginBottom: '16px' }}>
          <Problem>{state.error}</Problem>
        </div>
      )}

      <Section
        title="Uplink"
        aside={
          <Button onClick={() => void window.companion.setEnabled(!state.enabled)}>
            {state.enabled ? 'Pause sending' : 'Start sending'}
          </Button>
        }
      >
        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
            <Stat label="Events sent" value={totals.sent.toLocaleString()} />
            <Stat label="Already held" value={totals.duplicates.toLocaleString()} />
            <Stat label="Journals read" value={totals.journalsRead.toLocaleString()} />
          </div>
          <p style={{ margin: '12px 0 0', fontSize: '12px', color: C.dim }}>
            {state.gameRunning === true ? 'Elite is running.' : 'Elite is not running.'}
            {totals.since === null ? '' : ` Sending since ${new Date(totals.since).toLocaleDateString()}.`}
          </p>
        </Card>
      </Section>

      <Section title="Recent activity">
        {(state.activity ?? []).length === 0 ? (
          <Empty>Nothing yet. Lines appear here as the app reads your journals.</Empty>
        ) : (
          <Card>
            {[...(state.activity ?? [])]
              .slice(-12)
              .reverse()
              .map((line, i) => (
                <p
                  key={`${line.at}-${i}`}
                  style={{ margin: 0, padding: '3px 0', fontSize: '12px', color: C.dim }}
                >
                  <span style={{ color: C.faint, marginRight: '8px', fontVariantNumeric: 'tabular-nums' }}>
                    {new Date(line.at).toLocaleTimeString()}
                  </span>
                  {line.text}
                </p>
              ))}
          </Card>
        )}
      </Section>
    </div>
  );
}

/**
 * Trade runs.
 *
 * ★ HONESTLY EMPTY, RATHER THAN FAKED ★
 *
 * The Freight Office plans routes on the website and there is no endpoint yet for saving one to
 * come back to — `TRADE_SAVE_ROUTE` exists as a permission and nothing writes it. A panel that
 * invented a route here would be showing a member something the squadron does not actually hold.
 *
 * So it says what it is for and offers the door to the thing that works today.
 */
function TradeRuns(): JSX.Element {
  return (
    <Section title="Trade runs">
      <Card>
        <p style={{ margin: 0, fontSize: '13px', color: C.dim }}>
          Plan a run in the Freight Office on the website and it will appear here, with the next hop
          on an overlay while you fly it.
        </p>
        <p style={{ margin: '10px 0 0', fontSize: '12px', color: C.faint }}>
          Saving a run to come back to is not built yet — the planner works, but nothing keeps your
          choice. This panel fills in when it does.
        </p>
        <div style={{ marginTop: '14px' }}>
          <Button onClick={() => void window.companion.openHub()}>Open the Freight Office</Button>
        </div>
      </Card>
    </Section>
  );
}

function Device({ state }: { state: AppState }): JSX.Element {
  return (
    <div>
      <Section title="This device">
        <Card>
          <p style={{ margin: 0, fontSize: '13px', color: C.dim }}>
            Paired as <span style={{ color: C.text }}>{state.tokenHint}</span>
          </p>
          <div style={{ marginTop: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <Button onClick={() => void window.companion.openHub()}>Open the hub</Button>
            <Button onClick={() => void window.companion.rescan()}>Find my journals again</Button>
            <Button tone="danger" onClick={() => void window.companion.unpair()}>
              Unpair this device
            </Button>
          </div>
        </Card>
      </Section>

      <Section title="Starting up">
        <Card>
          <label style={{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '13px', color: C.dim }}>
            <input
              type="checkbox"
              checked={state.autoStart}
              onChange={(e) =>
                void window.companion.setAutoStart((e.target as HTMLInputElement).checked)
              }
            />
            Start with Windows, minimised to the tray
          </label>
        </Card>
      </Section>

      <Section title="What the squadron keeps">
        <Card>
          <p style={{ margin: 0, fontSize: '13px', color: C.dim }}>
            Every category the app collects — including colonisation — can be switched off
            individually on the hub, and it says exactly what each one reveals.
          </p>
          <div style={{ marginTop: '14px' }}>
            <Button onClick={() => void window.companion.openHub()}>Manage on the hub</Button>
          </div>
        </Card>
      </Section>
    </div>
  );
}

const root = document.getElementById('root');
if (root !== null) render(<App />, root);
