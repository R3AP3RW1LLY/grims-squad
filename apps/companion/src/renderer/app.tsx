import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { OverlayLayout } from '../overlay-config.js';
import { Button, C, Card, Empty, Problem, Section, Stat, Tabs } from './ui.js';
import { ColonyBoardPage, ColonyNewPage } from './colonisation.js';
import { BountiesPage } from './bounties.js';
import { TradePage } from './trade.js';
import { CommoditiesPage } from './commodities.js';
import { PLATFORM_VERSION } from '@grims/shared/version';
import { OutfitterPage } from './shipyard-outfitter.js';
import { BuildBoardsPage } from './shipyard-boards.js';
import { PlanningPage } from './planning.js';
import { BuildTypesPage } from './build-types.js';
import { LeaderboardPage } from './leaderboards.js';
import { RecruitPage } from './recruit.js';
import { MiningPage } from './mining.js';
import { SupportPage } from './support.js';
import { HelpWidget } from './help-widget.js';
import { GroupIcon, PageIcon } from './icons.js';
import { MiningSettingsPanel } from './mining-settings-panel.js';
import { readMiningSettings } from '../mining-settings.js';
import { openProjectCounts } from '@grims/shared';
// The shapes come from the hub client, which is where they are defined — re-exporting them through
// the component file would be a second name for one type.
import type { ColonyProject, ColonyRights } from '../hub-colony.js';
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

interface CommanderLocation {
  readonly currentSystem: string | null;
  readonly systemSeenAt: string | null;
  readonly currentLocation: string | null;
  readonly locationSeenAt: string | null;
}

type LocationAnswer =
  | { ok: true; data: CommanderLocation }
  | { ok: false; error: string };

declare global {
  interface Window {
    readonly commander: {
      /** Where the hub says this commander is. Its answer, not ours — see hub-commander.ts. */
      location(): Promise<LocationAnswer>;
    };
    readonly companion: {
      getState(): Promise<AppState>;
      onState(handler: (state: AppState) => void): void;
      signIn(): Promise<unknown>;
      cancelSignIn(): Promise<unknown>;
      reopenLink(): Promise<unknown>;
      unpair(): Promise<unknown>;
      setEnabled(enabled: boolean): Promise<unknown>;
      setAutoStart(on: boolean): Promise<unknown>;
      setMiningSettings(json: string): Promise<unknown>;
      setTradePlan(json: string): Promise<unknown>;
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
  /** Epoch millis of the last successful upload. Moves the moment a delivery reaches the hub. */
  lastTransferAt?: number;
  error?: string | null;
  /** Where the commander is docked, when it is recent enough to trust. Null otherwise. */
  dockedAt: import('./colonisation.js').DockedAt | null;
  overlays: OverlayLayout;
  /** The prospector thresholds as stored JSON. Repaired on read — see mining-settings.ts. */
  miningSettings: string | null;
  overlayEditing: boolean;
  displayMode: string;
  displayNote: string | null;
}

type Page =
  | 'status'
  | 'colony-planning'
  | 'colony-build-types'
  | 'colony-new'
  | 'colony-squadron'
  | 'colony-members'
  | 'bounties'
  | 'lb-bounties'
  | 'lb-colony'
  | 'lb-trade'
  | 'lb-mining'
  | 'mining'
  | 'commodities'
  | 'trade'
  | 'outfitter'
  | 'builds-squadron'
  | 'builds-public'
  | 'recruit'
  | 'support'
  | 'settings'
  | 'overlays'
  | 'device';

/**
 * The sidebar.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "create in the sidebar a colonization category, collapsable, New project should be its own page
 * please. then Member Projects and Squadron projects should be their own pages too ... Squadron
 * should be on top of members and new project at the top please. include how many projects are in
 * each category on the sidebar too."
 *
 * A group with children rather than five flat entries: colonisation is one thing with three ways
 * in, and flattening it would put "New project" next to "This device" as though they were peers.
 */
interface NavItem {
  readonly id: Page;
  readonly label: string;
  readonly hint: string;
}

interface NavGroup {
  readonly group: 'colonisation' | 'logistics' | 'shipyard' | 'answer-the-call' | 'leaderboards';
  readonly label: string;
  readonly children: readonly NavItem[];
}

/**
 * Which groups are open, remembered across launches.
 *
 * ★ THE WEBSITE'S OWN RULES, MIRRORED ★
 *
 * Subcategories start CLOSED (the site's stored-preference default), a member's toggle is
 * remembered (the site uses localStorage for exactly this), and the group holding the current
 * page can never be closed — landing inside a collapsed group would show a sidebar that does not
 * contain the page on screen.
 */
const NAV_OPEN_KEY = 'gmsd.app.nav.open';

function readOpenGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(NAV_OPEN_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

const NAV: ReadonlyArray<NavItem | NavGroup> = [
  { id: 'status', label: 'Status', hint: 'What the app is doing' },
  {
    /*
     * ★ SQUADRON OWNER, 2026-08-04: "add the Shipyard and Logistics and Trade categories ...
     * full mirror with the website" ★ — the website's order puts the Shipyard block first.
     */
    group: 'shipyard',
    label: 'Shipyard',
    children: [
      { id: 'outfitter', label: 'Outfitter', hint: 'Outfit a ship, or let the assistant fit one' },
      { id: 'builds-squadron', label: 'Squadron builds', hint: 'What the squadron has published' },
      { id: 'builds-public', label: 'Public builds', hint: 'Builds shared with everybody' },
    ],
  },
  {
    /*
     * The website's order and the website's name: Commodities then the Freight Office, grouped
     * under Logistics & Trade, BEFORE colonisation. The app briefly called the planner "Trade
     * runs", which meant the two surfaces named the same destination differently — the exact
     * drift the mirror rule exists to stop.
     */
    group: 'logistics',
    label: 'Logistics & Trade',
    children: [
      { id: 'commodities', label: 'Commodities', hint: 'What everything is worth, near you' },
      { id: 'trade', label: 'Freight Office', hint: 'Pick the cargo and the range — get the run' },
    ],
  },
  {
    group: 'colonisation',
    label: 'Colonisation',
    children: [
      // The order the owner asked for: new project first, then squadron above members.
      /*
       * ★ THE CATALOGUE FIRST — SQUADRON OWNER, 2026-08-03 ★
       *
       * "move the build types link in the navbar to be above New Project", and the app mirrors the
       * website exactly. It is also the right order for how the feature is used: you look up what a
       * build costs BEFORE committing to posting one.
       */
      /*
       * ★ PLANNING FIRST, MIRRORING THE WEBSITE — SQUADRON OWNER, 2026-08-03 ★
       *
       * "ensure the Companion app matches and has all the same pages in colonization that the
       * website has please! must be a mirror!"
       *
       * The order is the website's order, not a second opinion about it. It is also the order the
       * work happens in: you plan a system, look up what the pieces cost, then post the one you
       * have started building.
       */
      { id: 'colony-planning', label: 'Planning', hint: 'Lay out a whole system before you build' },
      { id: 'colony-build-types', label: 'Build types', hint: 'What each kind of site costs' },
      // "Start New Project" here too, so the app and the website do not call the same destination
      // two different things. A verb says it is something you DO; a noun reads as a list of them.
      { id: 'colony-new', label: 'Start New Project', hint: 'Post the site you are docked at' },
      { id: 'colony-squadron', label: 'Squadron projects', hint: 'What the squadron is building' },
      { id: 'colony-members', label: 'Members’ projects', hint: 'What members have asked help with' },
    ],
  },
  {
    /*
     * ★ ANSWER THE CALL — SQUADRON OWNER, 2026-08-04 ★
     *
     * "Put the data bounties nav link under a new category called Answer the Call ... it should
     * be placed under the Colonization category. add this to the companion app too." One entry
     * today; the category exists because more calls to answer are coming.
     */
    group: 'answer-the-call',
    label: 'Answer the Call',
    children: [
      { id: 'bounties', label: 'Data Bounties', hint: 'Dark stations, and who lights them up' },
      /*
       * The second call, and the reason the category was written to expect one. Mining asks the
       * same thing of a member as Data Bounties does — go somewhere and come back with something
       * the squadron did not have — and the rings page is built entirely from members' own limpets.
       */
      { id: 'mining', label: 'Mining', hint: 'Which rings are actually paying' },
      /*
       * ★ SQUADRON OWNER, 2026-08-06 ★
       *
       * "build me a cool recruit tracking system"
       *
       * It belongs in this category rather than under Leaderboards because it asks the same thing
       * of a member as the other two calls do — go and bring something back the squadron did not
       * have. The board is where the score is read; this is where the work is done.
       */
      { id: 'recruit', label: 'Recruiting', hint: 'Your invite link, and who came through it' },
    ],
  },
  {
    /*
     * ★ SQUADRON OWNER, 2026-08-04 ★
     *
     * "make a new category called leaderboards ... gamify the colonization leaderboard, make
     * badges ect the same way were doing it for databounties ... then we also need to make a
     * leaderboard and gamify it for Trade routes" — mirrored from the website, directly under
     * Data Bounties, which is where the first of the three boards was born.
     */
    group: 'leaderboards',
    label: 'Leaderboards',
    children: [
      { id: 'lb-bounties', label: 'Data Runners', hint: 'Who is lighting up dark stations' },
      { id: 'lb-colony', label: 'Colony Builders', hint: 'Who is hauling the squadron’s builds' },
      { id: 'lb-trade', label: 'Trade Barons', hint: 'Who is banking real trading profit' },
      { id: 'lb-mining', label: 'Deep Core', hint: 'Who is refining the most out of the rings' },
    ],
  },
];

function App(): JSX.Element {
  const [state, setState] = useState<AppState | null>(null);
  const [page, setPage] = useState<Page>('status');
  const [openGroups, setOpenGroups] = useState<Set<string>>(readOpenGroups);

  const toggleGroup = (group: string): void => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      try {
        localStorage.setItem(NAV_OPEN_KEY, JSON.stringify([...next]));
      } catch {
        // A full or disabled localStorage costs persistence, never the toggle itself.
      }
      return next;
    });
  };

  /*
   * ★ THE PROJECTS LIVE HERE, NOT IN EACH PAGE ★
   *
   * The sidebar needs the counts whichever page is showing, so the shell has to hold them anyway.
   * Fetching per page as well would be the same data arriving twice and two chances for the badge
   * and the list to disagree — which is the kind of difference a member notices and nobody can
   * reproduce.
   */
  const [colony, setColony] = useState<{ projects: ColonyProject[]; can: ColonyRights } | null>(null);
  const [colonyError, setColonyError] = useState<string | null>(null);

  /*
   * ★ THE SUPPORT ENTRY IS THE HUB'S DECISION ★
   *
   * Most members do not hold SUPPORT_AGENT, and a sidebar entry whose every click is refused
   * teaches people the app is broken. So the shell asks the hub, on the same cadence as the
   * colony counts, and the entry exists only while the hub says yes. While the answer is
   * unknown — first seconds after launch, or the hub unreachable — the entry is absent, which
   * for a page most members never had is the honest default.
   */
  const [support, setSupport] = useState<{ agent: boolean; waiting: number } | null>(null);

  const loadColony = (): void => {
    void window.colony.projects().then((answer) => {
      if (answer.ok) {
        setColony(answer.data);
        setColonyError(null);
      } else {
        setColonyError(answer.error);
      }
    });
    void window.support.access().then((answer) => {
      if (!answer.ok || !answer.data.agent) {
        setSupport(answer.ok ? { agent: false, waiting: 0 } : null);
        return;
      }
      void window.support.badge().then((b) => {
        setSupport({ agent: true, waiting: b.ok ? b.data.waiting : 0 });
      });
    });
  };

  useEffect(() => {
    void window.companion.getState().then(setState);
    window.companion.onState(setState);
  }, []);

  useEffect(() => {
    if (state?.paired !== true) return;
    loadColony();
    // Needs and progress change when ANY member hauls, so a count that only moved on navigation
    // would be wrong for as long as somebody left the app open.
    const timer = setInterval(loadColony, 60_000);
    return () => clearInterval(timer);
  }, [state?.paired]);

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
          /*
           * Translucent, not opaque. An opaque sidebar would paint a solid slab over the starfield
           * for a fifth of the window — the blur is what lets the background read as one scene with
           * the app sitting in it rather than as a picture behind a wall.
           */
          background: 'rgba(11,15,20,0.92)',
          backdropFilter: 'blur(12px)',
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
            fontFamily: 'var(--font-display)',
            fontSize: '13px',
            letterSpacing: '0.2em',
            color: C.text,
          }}
        >
          GRIM&rsquo;S SQUAD
        </p>

        {NAV.map((entry) => {
          if (!('group' in entry)) {
            return (
              <NavButton
                key={entry.id}
                label={entry.label}
                hint={entry.hint}
                active={page === entry.id}
                onClick={() => setPage(entry.id)}
                icon={<PageIcon page={entry.id} />}
              />
            );
          }

          const counts: Record<string, number> = {
            /*
             * ★ FINISHED BUILDS DO NOT COUNT — SQUADRON OWNER, 2026-08-06 ★
             *
             * "when a colonization project is complete, we need to remove it from the badge ...
             * showing completed projects is confusing!"
             *
             * This counted every project regardless of state, so a build the squadron had already
             * finished went on advertising itself in the sidebar for ever. The rule lives in
             * @grims/shared because the website now shows the same badge, and two counts written
             * separately would drift.
             */
            'colony-squadron': openProjectCounts(colony?.projects ?? []).squadron,
            'colony-members': openProjectCounts(colony?.projects ?? []).personal,
          };
          const insideOpen = entry.children.some((c) => c.id === page);
          // The current page's group is always open, whatever the stored choice says.
          const groupOpen = openGroups.has(entry.group) || insideOpen;

          return (
            <div key={entry.group}>
              <button
                type="button"
                onClick={() => toggleGroup(entry.group)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  background: 'transparent',
                  color: insideOpen ? C.text : C.dim,
                  padding: '7px 12px',
                  fontSize: '12.5px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px',
                }}
                aria-expanded={groupOpen}
              >
                <span style={{ fontSize: '9px', color: C.faint, width: '8px' }}>
                  {groupOpen ? '▾' : '▸'}
                </span>
                {/*
                  ★ THE SAME ICON THE WEBSITE DRAWS — SQUADRON OWNER, 2026-08-03 ★

                  "ensure the icons match the web icons in the companion app please!"

                  Literally the same outline: the Heroicon path data is transcribed into icons.tsx
                  rather than the React library being pulled into a Preact app to render one shape.
                */}
                <GroupIcon label={entry.label} />
                {entry.label}
              </button>

              {groupOpen
                ? entry.children.map((child) => (
                    <NavButton
                      key={child.id}
                      label={child.label}
                      hint={child.hint}
                      /*
                       * ★ SQUADRON OWNER, 2026-08-06 ★
                       *
                       * "ensure every category and nav link in the website and companion app have
                       * appropriate icons please!"
                       *
                       * The children had none — only the group headings and the two top-level
                       * pages did — so an opened category was a wall of indented text. Same glyphs
                       * the website uses for the matching page, because the two surfaces are meant
                       * to be one picture and a member should not learn two vocabularies.
                       */
                      icon={<PageIcon page={child.id} />}
                      active={page === child.id}
                      indent
                      count={counts[child.id]}
                      onClick={() => setPage(child.id)}
                    />
                  ))
                : null}
            </div>
          );
        })}

        {/*
          ★ SUPPORT, FOR THE MEMBERS WHO ANSWER IT ★

          Rendered outside the NAV literal, like Settings below, because it is the one entry
          that is not for everybody: the shell asks the hub whether this member holds
          SUPPORT_AGENT, and the button exists only while the answer is yes. The count is the
          console badge — conversations no officer has seen yet — which is the only bell noise
          officers get.
        */}
        {support?.agent === true ? (
          <NavButton
            label="Support"
            hint="The help desk — answer members and guests as yourself"
            active={page === 'support'}
            count={support.waiting > 0 ? support.waiting : undefined}
            onClick={() => setPage('support')}
          />
        ) : null}

        {/*
          ★ SETTINGS AT THE VERY BOTTOM — SQUADRON OWNER, 2026-08-04 ★

          "create a settings nav link at the very bottom of the sidebar in the companion app right
          above the sending element ... this settings page is where we want all future settings for
          the companion app to live." Anchored with the uplink block rather than listed with the
          destinations, because it configures the app rather than being somewhere you go in it.
        */}
        <div style={{ marginTop: 'auto' }}>
          <NavButton
            label="Settings"
            hint="This device, overlays, and every future setting"
            active={page === 'settings'}
            onClick={() => setPage('settings')}
            icon={<PageIcon page="settings" />}
          />
        </div>

        <div style={{ paddingLeft: '8px', marginTop: '8px' }}>
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
          {/* The same PLATFORM_VERSION the website prints — one number, both surfaces. */}
          <p style={{ margin: '6px 0 0', fontSize: '10px', letterSpacing: '0.2em', color: C.faint }}>
            v{PLATFORM_VERSION}
          </p>
        </div>
      </nav>

      <main style={{ flex: 1, overflowY: 'auto', padding: '22px 26px' }}>
        {page === 'status' ? <Status state={state} /> : null}
        {page === 'colony-planning' ? <PlanningPage /> : null}
        {page === 'colony-build-types' ? (
          <BuildTypesPage dockedSystem={state.dockedAt?.systemName ?? null} />
        ) : null}

        {page === 'colony-new' ? (
          <ColonyNewPage
            dockedAt={state.dockedAt}
            can={colony?.can ?? null}
            projects={colony?.projects ?? []}
            onPosted={loadColony}
          />
        ) : null}
        {page === 'colony-squadron' ? (
          <ColonyBoardPage
            owner="squadron"
            projects={colony?.projects ?? []}
            error={colonyError}
            onReload={loadColony}
          />
        ) : null}
        {page === 'colony-members' ? (
          <ColonyBoardPage
            owner="personal"
            projects={colony?.projects ?? []}
            error={colonyError}
            onReload={loadColony}
          />
        ) : null}
        {page === 'bounties' ? <BountiesPage /> : null}
        {page === 'lb-bounties' ? <LeaderboardPage board="bounties" /> : null}
        {page === 'lb-colony' ? <LeaderboardPage board="colony" /> : null}
        {page === 'lb-trade' ? <LeaderboardPage board="trade" /> : null}
        {/*
          Nothing in `LeaderboardPage` needed changing for a fourth board — it reads the ladder and
          the badges off the shared catalogue, so Deep Core arrives looking exactly like the three
          boards members already know.
        */}
        {page === 'lb-mining' ? <LeaderboardPage board="mining" /> : null}
        {page === 'mining' ? <MiningPage /> : null}
        {page === 'recruit' ? <RecruitPage /> : null}
        {page === 'commodities' ? <CommoditiesPage /> : null}
        {page === 'outfitter' ? <OutfitterPage /> : null}
        {page === 'builds-squadron' ? <BuildBoardsPage scope="squadron" /> : null}
        {page === 'builds-public' ? <BuildBoardsPage scope="public" /> : null}
        {page === 'trade' ? <TradePage /> : null}
        {page === 'support' ? <SupportPage /> : null}
        {page === 'settings' ? <SettingsPage state={state} /> : null}
      </main>

      {/*
        ★ HELP, FOR EVERYBODY — SQUADRON OWNER, 2026-08-04 ★

        "we also need the chat widget included in the companion app too."

        The website's floating help chat, for the member behind this device. Deliberately NOT
        gated like the sidebar's Support entry above: that entry is the ANSWERING side and
        exists only for SUPPORT_AGENT holders; this launcher is the ASKING side, and asking is
        for every paired member. Fixed over the whole shell, so help is one press away on every
        page — which is where the website puts it too.
      */}
      <HelpWidget />
    </div>
  );
}

/**
 * ★ THE SETTINGS PAGE — every companion setting's home from here on ★
 *
 * Two tabs today (the former This device and Overlays pages, unchanged inside); the next setting
 * this app grows belongs on a new tab here rather than a new sidebar destination — that is the
 * whole reason this page exists.
 */
function SettingsPage({ state }: { state: AppState }): JSX.Element {
  const [tab, setTab] = useState<'device' | 'overlays' | 'mining'>('device');

  return (
    <div>
      <Tabs
        current={tab}
        onChange={setTab}
        label="Settings sections"
        tabs={[
          { key: 'device', label: 'This device' },
          { key: 'overlays', label: 'Overlays' },
          { key: 'mining', label: 'Mining' },
        ]}
      />
      <div style={{ marginTop: '16px' }}>
        {tab === 'device' ? <Device state={state} /> : null}
        {tab === 'mining' ? (
          <MiningSettingsPanel
            settings={readMiningSettings(state.miningSettings)}
            /*
             * Written straight through on every change. The model returns a NEW object each time,
             * so a save cannot race a re-render into disagreeing about what is set — and the file
             * is repaired on read regardless of what lands.
             */
            onChange={(next) => void window.companion.setMiningSettings(JSON.stringify(next))}
          />
        ) : null}
        {tab === 'overlays' ? (
          <OverlaysPanel
            layout={state.overlays}
            editing={state.overlayEditing}
            displayNote={state.displayNote}
            displayMode={state.displayMode}
          />
        ) : null}
      </div>
    </div>
  );
}

/** One sidebar destination. A count is shown only when there is something to count. */
function NavButton({
  label,
  hint,
  active,
  onClick,
  indent,
  count,
  icon,
}: {
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
  indent?: boolean | undefined;
  /*
   * The two top-level destinations carry one; the grouped children do not, because their group
   * header already shows the picture and repeating it down a column is noise rather than
   * navigation.
   */
  icon?: JSX.Element | null | undefined;
  // `| undefined` explicitly: `exactOptionalPropertyTypes` treats an optional property and one
  // that may be undefined as different types, and the caller reads it out of a lookup table.
  count?: number | undefined;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      class={indent === true ? 'nav-item nav-item-sub' : 'nav-item'}
      /*
       * ★ `aria-current` IS THE STATE, NOT A DECORATION ★
       *
       * Both the active style and the hover rule key off it in theme.css, so the state a screen
       * reader is told and the state that is drawn cannot disagree — and the destination you are
       * already on does not light up under the cursor as though clicking it went somewhere.
       *
       * Nothing here is styled inline. An inline `background` or `color` would outrank the
       * stylesheet and freeze the hover, which is exactly the bug this file shipped with once.
       */
      aria-current={active ? 'page' : undefined}
    >
      {/*
        Wrapped so the icon and the label travel together, leaving the count free to sit at the far
        end of the row exactly as it did before.
      */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
        {icon ?? null}
        <span>{label}</span>
      </span>
      {/*
        Zero is deliberately NOT drawn. A badge reading 0 is a thing to read and dismiss on every
        glance; its absence says the same and costs nothing.
      */}
      {count === undefined || count === 0 ? null : (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            fontVariantNumeric: 'tabular-nums',
            color: C.dim,
            background: C.raised,
            borderRadius: '999px',
            padding: '1px 6px',
          }}
        >
          {count}
        </span>
      )}
    </button>
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
      <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '15px', letterSpacing: '0.2em', color: C.cyan }}>
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
            <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '26px', letterSpacing: '0.3em', color: C.text }}>
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

/**
 * Where you are, exactly as the website says it.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "can we also add the location to the companion app status page, and show it like it is shown in
 * the web app please."
 *
 * So this is the website's panel, in this app's chrome: the same title, the same two facts side by
 * side, the same "In open space" for a commander who is not anywhere in particular. The hub works
 * it out — one implementation, two surfaces, no way for them to disagree.
 *
 * ★ TWO TIMESTAMPS, NOT ONE ★
 *
 * The system and the sublocation age at different rates: somebody can sit docked for an hour after
 * a jump. The website carries a timestamp on each for that reason and so does this — sharing one
 * would date the docking from the jump.
 */
function WhereYouAre(): JSX.Element {
  const [answer, setAnswer] = useState<LocationAnswer | null>(null);

  useEffect(() => {
    let live = true;
    const read = () => {
      void window.commander.location().then((a) => {
        if (live) setAnswer(a);
      });
    };

    read();
    /*
     * Every thirty seconds. Frequent enough that a jump shows up while somebody is looking at the
     * page, rare enough to be nothing next to what the app already sends — and it stops entirely
     * when the page is unmounted, which is what the cleanup is for.
     */
    const timer = setInterval(read, 30_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <Section title="Where you are">
      {answer === null ? (
        <Empty>Asking the hub.</Empty>
      ) : !answer.ok ? (
        <Empty>{answer.error}</Empty>
      ) : answer.data.currentSystem === null ? (
        <Empty>
          No position reported yet. This arrives the next time you jump or load in.
        </Empty>
      ) : (
        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <Stat label="System" value={answer.data.currentSystem} />
            {/*
              "In open space" rather than "Unknown", the website's own wording. The journal names a
              station or a body when there is one to name; its absence is not missing DATA, it is a
              commander in supercruise or between stars, and "unknown" would read as a fault.
            */}
            <Stat label="Location" value={answer.data.currentLocation ?? 'In open space'} />
          </div>
        </Card>
      )}
    </Section>
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

      <WhereYouAre />

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
