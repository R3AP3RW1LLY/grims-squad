import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type {
  AttachedCarrier,
  BuildTypeDetail,
  BuildTypeRow,
  CarrierMatch,
  ColonyPlan,
  RosterEntry,
  ColonyHauler,
  ColonyNeed,
  ColonyProject,
  ColonyRights,
  ColonyShoppingRow,
} from '../hub-colony.js';
import { projectTitleFrom } from '../docked.js';
import { DEFAULT_SHOPPING, type ShoppingFilters } from '../hub-colony.js';
import {
  DeliveryChart,
  HaulerChart,
  type DeliveryBucket,
  type HaulerStack,
} from './delivery-chart.js';
import {
  Bar,
  Button,
  C,
  Card,
  Empty,
  Field,
  Problem,
  Section,
  Stat,
  credits,
  inputStyle,
  tonnes,
  Copy,
  Guard,
  Tabs,
} from './ui.js';

/**
 * Colonisation, in the companion app.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "we want the entire colonization module to be visible in the companion app! people should be able
 * to have full interaction with colonization either from the website or from the app."
 *
 * So this is not a summary of the website — it is the same thing: both boards, a project's needs,
 * who has hauled to it, and where to buy the rest. Everything comes from the same endpoints the
 * site's own pages use, so the two cannot disagree.
 */

declare global {
  interface Window {
    readonly colony: {
      projects(): Promise<Answer<{ projects: ColonyProject[]; can: ColonyRights }>>;
      project(id: string, filters?: ShoppingFilters): Promise<Answer<ProjectDetailData>>;
      at(marketId: string): Promise<Answer<{ project: ColonyProject | null; needs: ColonyNeed[] }>>;
      post(body: unknown): Promise<Answer<{ id: string }>>;
      /*
       * The build catalogue. Declared here with the rest of the bridge rather than beside the page
       * that uses it — `window.colony` is one object, and a second `declare global` for it is a
       * conflicting declaration rather than an addition.
       */
      buildTypes(): Promise<Answer<{ buildTypes: BuildTypeRow[] }>>;
      buildType(
        id: string,
        near: string,
      ): Promise<
        Answer<{
          buildType: BuildTypeDetail;
          origin: { system: string } | null;
          unknownSystem: string | null;
        }>
      >;
      roster(id: string): Promise<Answer<{ roster: RosterEntry[] }>>;
      join(id: string): Promise<Answer<{ ok: true }>>;
      leave(id: string): Promise<Answer<{ ok: true }>>;
      assign(
        id: string,
        body: { commodity: string; tonnes?: number; userId?: string },
      ): Promise<Answer<{ ok: true }>>;
      unassign(
        id: string,
        body: { commodity: string; userId?: string },
      ): Promise<Answer<{ ok: true }>>;

      /** Closing, reopening, deleting, and flagging the squadron's current effort. */
      close(id: string): Promise<Answer<{ ok: true }>>;
      reopen(id: string): Promise<Answer<{ ok: true }>>;
      remove(id: string): Promise<Answer<{ ok: true }>>;
      priority(id: string, on: boolean): Promise<Answer<{ ok: true }>>;

      /** Fleet carriers helping with a build, and what each is holding. */
      carriers(id: string, q: string): Promise<Answer<{ carriers: CarrierMatch[] }>>;
      carrierAdd(
        id: string,
        body: { marketId: string; isSquadron: boolean },
      ): Promise<Answer<{ marketId: string }>>;
      carrierRemove(id: string, marketId: string): Promise<Answer<{ ok: true }>>;

      /*
       * The planner. Declared here with the rest of the bridge for the reason stated above:
       * `window.colony` is one object, and a second `declare global` for it in planning.tsx would
       * be a CONFLICTING declaration rather than an addition — TypeScript merges interfaces but
       * refuses two different types for the same property.
       */
      plans(): Promise<Answer<{ plans: ColonyPlan[] }>>;
      plan(id: string): Promise<Answer<{ plan: ColonyPlan; can: { edit: boolean } }>>;
      planCreate(body: {
        owner: 'squadron' | 'personal';
        title: string;
        systemName: string;
      }): Promise<Answer<{ id: string }>>;
      planSlots(
        systemId64: string,
        bodyId: number,
        body: { orbital: number | null; surface: number | null },
      ): Promise<Answer<{ ok: true }>>;
      planAddSite(
        id: string,
        body: {
          version: number;
          bodyId: number | null;
          location: 'orbital' | 'surface';
          buildTypeId: string | null;
        },
      ): Promise<Answer<{ version: number }>>;
      planRemoveSite(
        id: string,
        siteId: string,
        version: number,
      ): Promise<Answer<{ version: number }>>;
      planReorder(
        id: string,
        body: { version: number; siteIds: string[] },
      ): Promise<Answer<{ version: number }>>;
      planRemove(id: string): Promise<Answer<{ ok: true }>>;
    };
  }
}

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

/** One delivery, straight off the append-only ledger. */
export interface Delivery {
  readonly at: string;
  readonly commander: string;
  readonly commodity: string;
  readonly amount: number;
}

export interface ProjectDetailData {
  project: ColonyProject;
  /**
   * What this reader may do. A rendering hint — every write re-checks in the service.
   *
   * The app had none, so it drew every control to everybody: "Take off" on a carrier somebody else
   * attached, "Add as squadron" to a member with no rank. A control that exists in order to be
   * refused teaches people to distrust the page.
   */
  can: { manage: boolean; isPoster: boolean };
  /**
   * Fleet carriers on this build.
   *
   * Read from the market mirror rather than from anybody's journal — a carrier's market is public,
   * so this sees every squadron carrier rather than only the one whose owner has the app open.
   */
  carriers: AttachedCarrier[];
  needs: ColonyNeed[];
  haulers: ColonyHauler[];
  shopping: ColonyShoppingRow[];
  /** Echoed by the hub so the tab can say where it measured from. Null when the name was unknown. */
  shoppingFrom: string | null;
  shoppingSort: string;
  deliveries: Delivery[];
  chart: {
    bucket: 'hour' | 'day';
    byCommodity: DeliveryBucket[];
    byCommander: DeliveryBucket[];
    haulers: HaulerStack[];
  };
}

/**
 * How old a price is, in words.
 *
 * ★ SHOWN, NOT HIDDEN — MEASURED 2026-08-03 ★
 *
 * Of the ten million rows in our market mirror, 6.4% were seen within a week and 46.6% are older
 * than three months; the oldest is from 2020. A price is a claim about STOCK, and stock is what
 * somebody is flying forty light years to collect.
 *
 * Filtering the old ones out would tell a member "nobody sells this" about commodities sitting on a
 * shelf right now, which is worse than an old number they can weigh for themselves. So the age goes
 * on the line, and the ranking already prefers a fresh reading within the same trip.
 */
export function seenAgo(at: string | null): string {
  if (at === null) return 'never dated';

  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  if (days <= 0) return 'seen today';
  if (days === 1) return 'seen yesterday';
  if (days < 30) return `seen ${days}d ago`;
  if (days < 365) return `seen ${Math.floor(days / 30)}mo ago`;
  return `seen ${Math.floor(days / 365)}y ago`;
}

/** Where the commander is docked, handed down from the app's state. */
export interface DockedAt {
  readonly marketId: string;
  readonly stationName: string;
  readonly systemName: string;
  /** Present when this dock is a construction site, straight from the depot heartbeat. */
  readonly site: {
    readonly progress: number;
    readonly complete: boolean;
    readonly failed: boolean;
    readonly resources: ReadonlyArray<{
      readonly commodity: string;
      readonly required: number;
      readonly provided: number;
    }>;
  } | null;
}

/**
 * One board — squadron or members — as its own page.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "lets break this up, create in the sidebar a colonization category, collapsable, New project
 * should be its own page please. then Member Projects and Squadron projects should be their own
 * pages too."
 *
 * The projects themselves are fetched once by the shell and handed down, because the sidebar needs
 * the counts anyway — a second fetch per page would be the same data arriving twice and two chances
 * for the badge and the list to disagree.
 */
export function ColonyBoardPage({
  owner,
  projects,
  error,
  onReload,
}: {
  owner: 'squadron' | 'personal';
  projects: readonly ColonyProject[];
  error: string | null;
  onReload: () => void;
}): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);

  if (openId !== null) {
    /*
     * ★ KEYED, AND IT MATTERS MORE THAN IT LOOKS ★
     *
     * Without a key, opening project B while A's instance is alive re-runs the effect but keeps A's
     * state on screen until the fetch lands — A's needs, A's chart stacking, A's open tab. Worse,
     * `error` is never cleared inside the effect, so one failed load leaves a permanent error
     * banner on every project opened afterwards. The key makes the identity change, which resets
     * data, error, stacking and tab together.
     */
    return (
      <ProjectDetail key={openId} id={openId} onBack={() => { setOpenId(null); onReload(); }} />
    );
  }

  const mine = projects.filter((p) => p.owner === owner);

  return (
    <div>
      {error === null ? null : (
        <div style={{ marginBottom: '14px' }}>
          <Problem>{error}</Problem>
        </div>
      )}
      <Section title={owner === 'squadron' ? 'Squadron projects' : 'Members’ projects'}>
        <Board
          projects={mine}
          onOpen={setOpenId}
          empty={
            owner === 'squadron'
              ? 'No squadron projects yet. An officer can post one from New project.'
              : 'Nobody has posted a project yet.'
          }
        />
      </Section>
    </div>
  );
}

/** Posting a project, as its own page. */
export function ColonyNewPage({
  dockedAt,
  can,
  projects,
  onPosted,
}: {
  dockedAt: DockedAt | null;
  can: ColonyRights | null;
  projects: readonly ColonyProject[];
  onPosted: () => void;
}): JSX.Element {
  const [posting, setPosting] = useState(false);

  if (can !== null && !can.post) {
    return (
      <Section title="New project">
        <Empty>Your rank cannot post colonisation projects.</Empty>
      </Section>
    );
  }

  /*
   * Already on the board: the member is looking at it, not creating it. Offering the form would end
   * in the server answering "already posted as X", which is a worse way to find out.
   *
   * The PROJECT is held, not just a boolean, because its title is what somebody named this build —
   * which is not necessarily what the station is called. Squadron owner, 2026-08-02: "after a
   * project is started add the project name to the left of (Market 4359491587) please so this make
   * sense."
   */
  const posted =
    dockedAt === null ? undefined : projects.find((p) => p.marketId === dockedAt.marketId);
  const alreadyPosted = posted !== undefined;

  return (
    <div>
      {/*
        ★ HOW TO START ONE — SQUADRON OWNER, 2026-08-02 ★

        "add a how to start a new project box to this page on both the website and app page for new
        projects please."

        The page assumed you already knew that posting a project means flying to the site first.
        Somebody arriving with no idea saw an empty panel saying "Dock at a construction site" and
        no explanation of why, what happens next, or what the app then does on its own — which is
        the genuinely useful part and the least obvious.

        Written as what the app does FOR you rather than as a list of steps to perform, because
        three of the four steps are things it handles without being asked.
      */}
      <Section title="How to start a project">
        <Card hud>
          <ol style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', lineHeight: 1.65 }}>
            <li>
              Fly to your construction site and dock. The app reads the depot the game reports and
              fills this page in — name, system, station and market id, all of it.
            </li>
            <li>
              Press <strong>New project</strong>, check the details, and choose whether it is the
              squadron&rsquo;s build or your own.
            </li>
            <li>
              From then on it keeps itself current. Every time anyone with the app docks there, what
              the site still needs is updated, and every delivery is recorded against the commander
              who made it.
            </li>
            <li>
              Members join the build and take on commodities, and the shopping list works out where
              to buy what is left.
            </li>
          </ol>
        </Card>
      </Section>

      <Section title="Where you are">
        {dockedAt === null ? (
          <Empty>Dock at a construction site and everything about it appears here.</Empty>
        ) : alreadyPosted ? (
          <Card accent={C.cyan}>
            <p style={{ margin: 0, fontSize: '14px' }}>
              {/*
                The project's OWN name, falling back to the station's. Somebody who renamed their
                build when they posted it should see the name they chose here — a market id beside a
                station name they did not pick is two identifiers and no answer to "which of my
                projects is this".
              */}
              {posted?.title ?? projectTitleFrom(dockedAt.stationName)}{' '}
              <span style={{ fontSize: '11px', color: C.faint }}>(Market {dockedAt.marketId})</span>
            </p>
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: C.dim }}>
              This site is already posted as{' '}
              {posted?.owner === 'squadron' ? 'a squadron project' : 'a member’s project'}. Open it
              from {posted?.owner === 'squadron' ? 'Squadron' : 'Members’'} projects.
            </p>
          </Card>
        ) : (
          <HereNow dockedAt={dockedAt} />
        )}
      </Section>

      {dockedAt === null || alreadyPosted ? null : (
        <Section
          title="Post it"
          aside={
            <Button tone={posting ? 'default' : 'primary'} onClick={() => setPosting((x) => !x)}>
              {posting ? 'Cancel' : 'New project'}
            </Button>
          }
        >
          {posting ? (
            <PostForm
              canPostSquadron={can?.manage === true}
              dockedAt={dockedAt}
              onPosted={() => {
                setPosting(false);
                onPosted();
              }}
            />
          ) : (
            <Empty>Everything is filled in already — press New project to check it and post.</Empty>
          )}
        </Section>
      )}
    </div>
  );
}

/**
 * What we already know about the site the member is standing on.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "it should read all data about the site and populate the new project window."
 *
 * So this is not a hint that the form will be pre-filled — it is the site itself, read from the
 * depot heartbeat the game emits every fifteen seconds. Progress, and every commodity still
 * outstanding, before anything has been posted to the squadron at all.
 */
function HereNow({ dockedAt }: { dockedAt: DockedAt }): JSX.Element {
  const site = dockedAt.site;
  const outstanding =
    site === null
      ? []
      : site.resources
          .filter((r) => r.required > r.provided)
          .sort((a, b) => b.required - b.provided - (a.required - a.provided));

  const totalNeeded = outstanding.reduce((sum, r) => sum + (r.required - r.provided), 0);
  // Across EVERY commodity, including the ones already finished — otherwise a site whose remaining
  // work is one commodity would report a delivery total that shrank as it neared completion.
  const totalDelivered =
    site === null ? 0 : site.resources.reduce((sum, r) => sum + r.provided, 0);
  const totalRequired =
    site === null ? 0 : site.resources.reduce((sum, r) => sum + r.required, 0);

  return (
    <Card accent={C.cyan}>
      {/*
        ★ THE SITE NAME, WITH THE MARKET ID IN BRACKETS — SQUADRON OWNER, 2026-08-02 ★

        "this should also give the name of the site docked at with the Market xxx in brackets".

        The id is shown alongside rather than instead of the name, because it is the thing a member
        can check against the game and against a project already on the board. It was standing in
        for the name only when we did not have one, which was itself the bug.
      */}
      <p style={{ margin: 0, fontSize: '14px' }}>
        {dockedAt.stationName === ''
          ? 'The construction site you are docked at'
          : projectTitleFrom(dockedAt.stationName)}{' '}
        <span style={{ fontSize: '11px', color: C.faint, fontVariantNumeric: 'tabular-nums' }}>
          (Market {dockedAt.marketId})
        </span>
      </p>
      <p style={{ margin: '3px 0 0', fontSize: '11px', color: C.faint }}>
        {dockedAt.systemName === '' ? 'System not known yet' : dockedAt.systemName} · docked now
      </p>

      {site === null ? (
        /*
         * Docked, but no depot heartbeat — so this is an ordinary station, not a build site. Said
         * plainly rather than offering a form that would create a project pointing at a shipyard.
         */
        <p style={{ margin: '10px 0 0', fontSize: '12px', color: C.dim }}>
          This is not a construction site. Dock at one and its needs appear here.
        </p>
      ) : (
        <div style={{ marginTop: '12px' }}>
          <Bar done={Math.round(site.progress * 1000)} total={1000} />
          <p style={{ margin: '6px 0 0', fontSize: '12px', color: C.dim }}>
            {(site.progress * 100).toFixed(1)}% built · {tonnes(totalDelivered)} of{' '}
            {totalRequired.toLocaleString()} already delivered
          </p>
          <p style={{ margin: '2px 0 0', fontSize: '12px', color: C.dim }}>
            {outstanding.length === 0
              ? 'Everything this site asked for has been delivered.'
              : `${tonnes(totalNeeded)} still needed across ${outstanding.length} commodit${outstanding.length === 1 ? 'y' : 'ies'}`}
          </p>

          {outstanding.length === 0 ? null : (
            <div style={{ marginTop: '10px' }}>
              {/*
                ★ WHAT HAS ALREADY BEEN DELIVERED, TOO — SQUADRON OWNER, 2026-08-02 ★

                "if we can see the historical data on all materials that have been delivered, can we
                please include that when we create the new project, so we have full data visibilty."

                We can, and it costs nothing: the depot event carries `ProvidedAmount` for every
                commodity, which is the site's ENTIRE delivery history — everyone's, not just this
                commander's. A site half built by strangers shows as half built.
              */}
              {outstanding.slice(0, 6).map((r) => (
                <div key={r.commodity} style={{ padding: '4px 0', fontSize: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                    <span>{r.commodity}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: C.dim }}>
                      {(r.required - r.provided).toLocaleString()} still needed
                    </span>
                  </div>
                  <div style={{ marginTop: '3px' }}>
                    <Bar done={r.provided} total={r.required} />
                  </div>
                  <p style={{ margin: '2px 0 0', fontSize: '10px', color: C.faint }}>
                    {r.provided.toLocaleString()} of {r.required.toLocaleString()} delivered
                  </p>
                </div>
              ))}
              {outstanding.length > 6 ? (
                <p style={{ margin: '5px 0 0', fontSize: '11px', color: C.faint }}>
                  and {outstanding.length - 6} more
                </p>
              ) : null}
            </div>
          )}
        </div>
      )}

      <p style={{ margin: '12px 0 0', fontSize: '11px', color: C.faint }}>
        Press New project — the name, system, station and market id are already filled in, and
        everything delivered so far is posted with it.
      </p>
    </Card>
  );
}

function Board({
  projects,
  onOpen,
  empty,
}: {
  projects: readonly ColonyProject[];
  onOpen: (id: string) => void;
  empty: string;
}): JSX.Element {
  if (projects.length === 0) return <Empty>{empty}</Empty>;

  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      {projects.map((p) => (
        <div
          key={p.id}
          onClick={() => onOpen(p.id)}
          /*
           * The same glass as every other panel. These rows were left as opaque rounded boxes when
           * the theme landed, which put flat rectangles with invisible edges directly under a
           * chamfered translucent card — the one screen that is the main way into colonisation,
           * looking like it belonged to a different application.
           */
          class="panel"
          style={{
            cursor: 'pointer',
            padding: '12px 14px',
            // Priority builds keep their brighter edge. It is the only thing distinguishing them.
            ...(p.isPriority ? { borderColor: C.orange } : {}),
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '10px',
              alignItems: 'baseline',
            }}
          >
            <span style={{ fontSize: '14px' }}>
              {p.title}
              {p.isPriority ? (
                <span style={{ marginLeft: '8px', fontSize: '9px', letterSpacing: '0.18em', color: C.orange }}>
                  CURRENT EFFORT
                </span>
              ) : null}
              {p.completedAt !== null ? (
                <span style={{ marginLeft: '8px', fontSize: '9px', letterSpacing: '0.18em', color: C.good }}>
                  COMPLETE
                </span>
              ) : null}
            </span>
            <span style={{ fontSize: '11px', color: C.faint }}>{p.systemName}</span>
          </div>

          <div style={{ marginTop: '8px' }}>
            {/*
              A project nobody has docked at holds no needs — which is NOT the same as needing
              nothing, and a full bar would say exactly the wrong thing.
            */}
            {p.needCount === 0 ? (
              <p style={{ margin: 0, fontSize: '11px', color: C.faint }}>
                Waiting for somebody to dock there.
              </p>
            ) : (
              <>
                <Bar done={p.required - p.remaining} total={p.required} />
                <p style={{ margin: '5px 0 0', fontSize: '11px', color: C.dim }}>
                  {tonnes(p.remaining)} still needed
                  {p.required > 0 ? ` of ${p.required.toLocaleString()}` : ''} · {p.needCount}{' '}
                  commodit{p.needCount === 1 ? 'y' : 'ies'}
                </p>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The five tabs of a project page.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "tab this out please so the project pages are nice and clean and crisp and clear."
 *
 * It was seven sections in one column, two of which are twenty-to-forty-row tables. Grouped by the
 * QUESTION each answers rather than by what kind of thing it is:
 *
 *   NEEDS       what is left to haul. The reason anybody opens the page, so it is the default.
 *   WHERE TO BUY where to get it — a different task, answered at a market rather than at the site.
 *   CREW        who is on this and what they have taken on. The only interactive part.
 *   DELIVERIES  what went in, as a shape and then as a ledger. Same question at two resolutions.
 *   HAULERS     who put it in. A question about people rather than about cargo.
 *
 * The two Chart.js canvases are deliberately in different tabs: only one exists at a time, so the
 * app never holds two live charts it is animating in the background.
 */
const PROJECT_TABS = [
  { key: 'needs', label: 'Needs' },
  { key: 'buy', label: 'Where to buy' },
  { key: 'crew', label: 'Crew' },
  // After Crew and before Deliveries: who is helping, then what is already aboard, then what has
  // landed. That is the order somebody reads a build in.
  { key: 'carriers', label: 'Carriers' },
  { key: 'deliveries', label: 'Deliveries' },
  { key: 'haulers', label: 'Haulers' },
] as const;

type ProjectTab = (typeof PROJECT_TABS)[number]['key'];

/**
 * How the delivery chart is cut.
 *
 *   commodity     time on the x-axis, stacked by what went in
 *   commander     the same bars, stacked by who put it in
 *   perCommander  one bar per person, stacked by what they brought
 *
 * The third used to be its own chart on its own tab. Same data, adjacent tab, two stacked bar
 * charts with commander names in both — which reads as duplication however different the axes are.
 */
type StackBy = 'commodity' | 'commander' | 'perCommander';

function ProjectDetail({ id, onBack }: { id: string; onBack: () => void }): JSX.Element {
  const [data, setData] = useState<ProjectDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
   * ★ WHICH WAY THE TIME CHART IS STACKED — SQUADRON OWNER, 2026-08-02 ★
   *
   * Both cuts of the same bars, and they answer different questions. By commodity: what went in on
   * Tuesday. By commander: who was flying on Tuesday. Held in state and switched locally rather
   * than refetched, because both stackings arrive in the same payload — a toggle that waits on the
   * network to redraw bars it already has reads as broken.
   */
  const [stackBy, setStackBy] = useState<StackBy>('commodity');
  /*
   * The shopping filters live here rather than inside the tab, because changing one refetches the
   * WHOLE project — the hub answers the shopping list as part of the detail read, so a filter is a
   * property of the request, not of the panel.
   */
  const [filters, setFilters] = useState<ShoppingFilters>(DEFAULT_SHOPPING);
  /*
   * True while a read is in flight. Without it the Update button looks inert on a query that can
   * take a moment against eighteen million rows, and a member presses it again.
   */
  const [refreshing, setRefreshing] = useState(false);
  /*
   * ★ THE TAB LIVES HERE, NOT IN A ROUTER AND NOT IN THE PARENT ★
   *
   * `data`, `error`, `stackBy` and the 60-second poll all belong to this component and the effect
   * is keyed on `[id]`. If a tab change swapped which COMPONENT was mounted, every click would tear
   * down that interval and refetch the whole project. Tabs swap this component's children; they
   * never remount the component, so switching tabs costs no IPC at all and every tab is current the
   * instant it opens.
   */
  const [tab, setTab] = useState<ProjectTab>('needs');

  /*
   * Re-read after a roster change, so the delivered totals and the needs the roster is offering
   * stay in step with what was just claimed. Deliberately silent on failure: the roster has already
   * reported its own error, and a second message about the same action reads as two problems.
   */
  const reloadDetail = async (): Promise<void> => {
    const answer = await window.colony.project(id, filters);
    if (answer.ok) setData(answer.data);
  };

  /** When the page last had an answer from the hub, so staleness is never invisible. */
  const [readAt, setReadAt] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    const load = async (): Promise<void> => {
      setRefreshing(true);
      const answer = await window.colony.project(id, filters);
      if (!live) return;
      setRefreshing(false);
      if (answer.ok) {
        setData(answer.data);
        setReadAt(Date.now());
      } else {
        setError(answer.error);
      }
    };
    void load();

    /*
     * ★ REFRESHED WHEN A DELIVERY IS UPLOADED, NOT ONLY ON A TIMER ★
     *
     * ★ SQUADRON OWNER, 2026-08-03 ★
     *
     * "we made a delivery of aluminum, it shows in the every delivery, but its not showing on the
     * Deliveries over time charts ... we need these to be working beyond reliably as this can cause
     * someone to buy materials when they may not be needed!"
     *
     * That last sentence is the whole argument. A stale needs list does not merely look wrong — it
     * sends somebody to buy forty thousand tonnes of something already delivered.
     *
     * The app knows the exact moment it uploads: `lastTransferAt` moves on every successful send.
     * So the page listens for that rather than waiting out a poll — a member who has just handed
     * cargo over sees it while they are still on the pad.
     *
     * The interval stays as the backstop, at twenty seconds rather than sixty. It covers deliveries
     * made by OTHER members, which this app never observes and cannot be told about any other way.
     */
    let lastSeenTransfer = 0;
    window.companion.onState((next) => {
      const at = typeof next.lastTransferAt === 'number' ? next.lastTransferAt : 0;
      if (at > lastSeenTransfer) {
        lastSeenTransfer = at;
        void load();
      }
    });

    const timer = setInterval(() => void load(), 20_000);
    // Cleared on unmount AND guarded with `live`: a slow request that resolves after the member has
    // gone back would otherwise set state on a component that is no longer there.
    return () => {
      live = false;
      clearInterval(timer);
    };
    // Filters are a property of the request, so changing one re-runs the whole read rather than
    // filtering a list the hub already narrowed.
  }, [id, filters]);

  if (error !== null) {
    return (
      <div>
        <Button onClick={onBack}>← Back</Button>
        <div style={{ marginTop: '14px' }}>
          <Problem>{error}</Problem>
        </div>
      </div>
    );
  }

  /*
   * A way out of the loading state. It had none: a member who opened a project and hit a slow or
   * hung IPC call was stuck on the word "Loading" with no Back button and no other navigation on
   * screen — the app looked frozen when it was merely waiting.
   */
  if (data === null) {
    return (
      <div>
        <Button onClick={onBack}>← Back</Button>
        <div style={{ marginTop: '14px' }}>
          <Empty>Loading…</Empty>
        </div>
      </div>
    );
  }

  const { project, needs, haulers, shopping, deliveries } = data;

  /*
   * ★ THE CHART PAYLOAD, DEFENDED — SQUADRON OWNER, 2026-08-02 ★
   *
   * "Deliveries and Haulers tabs are 100% empty."
   *
   * They were the only two tabs that read `chart`, and the hub was serving an older shape in which
   * `byCommodity` did not exist. `undefined.length` threw during render and Preact unmounted the
   * whole panel — no message, no error on screen, just a blank rectangle in two of five tabs.
   *
   * An app talking to a hub it was not built against is a NORMAL condition, not an exceptional one:
   * the hub deploys without asking anybody to update, so every member runs a mismatched pair for
   * some window. Missing arrays therefore become empty ones and the panel says "nothing yet", which
   * is honest and legible. The <Guard> below catches whatever this does not anticipate.
   */
  const chart = {
    bucket: data.chart?.bucket ?? 'hour',
    byCommodity: data.chart?.byCommodity ?? [],
    byCommander: data.chart?.byCommander ?? [],
    haulers: data.chart?.haulers ?? [],
  };
  const outstanding = needs.filter((n) => n.remaining > 0);
  const done = needs.filter((n) => n.remaining <= 0);
  const total = shopping.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  const unsourced = shopping.filter((r) => r.price === null).length;
  const delivered = project.required - project.remaining;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <Button onClick={onBack}>← Back</Button>
        <span style={{ fontSize: '15px' }}>{project.title}</span>
        <span style={{ fontSize: '11px', color: C.faint }}>
          {project.systemName}
          {project.stationName === null ? '' : ` · ${project.stationName}`}
        </span>
      </div>

      {/*
        The summary strip stays OUTSIDE the tabs, because it is true whichever tab is open. Putting
        "Still needed" inside a tab would make it vanish on the tab where somebody is deciding what
        to buy — which is the one moment they most want to see it.
      */}
      <Card hud>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
          <Stat
            label="Still needed"
            value={project.needCount === 0 ? '—' : tonnes(project.remaining)}
            tone={project.remaining > 0 ? C.warn : C.good}
          />
          <Stat
            label="Delivered"
            value={project.required > 0 ? tonnes(delivered) : '—'}
            tone={C.good}
          />
          <Stat label="Commodities" value={String(project.needCount)} />
          {/* The website's fourth tile, missing here — so nothing in the app ever said a build was
              closed, or that it was the squadron's current effort. */}
          <Stat
            label="Status"
            value={
              project.completedAt !== null
                ? 'Complete'
                : project.isPriority
                  ? 'Current effort'
                  : 'Live'
            }
            {...(project.completedAt !== null ? { tone: C.cyan } : {})}
          />
        </div>
      </Card>

      <div style={{ marginTop: '16px' }}>
        <ProjectActions
          project={project}
          can={data.can}
          onChanged={() => void reloadDetail()}
          onGone={onBack}
        />
      </div>

      <div style={{ margin: '20px 0 0' }}>
        <Tabs tabs={PROJECT_TABS} current={tab} onChange={setTab} label="Project sections" />
      </div>
      {/*
        ★ WHEN THIS WAS LAST TRUE ★
        Every number on this page is a snapshot, and a page that cannot say how old it is asks
        somebody to trust it blindly — which is exactly what leads to buying what has already been
        delivered.
      */}
      {readAt === null ? null : <Freshness at={readAt} />}
      {/* The rule under the strip is what makes it read as a strip rather than as five buttons. */}
      <div class="rule-glow" style={{ margin: '0 0 22px' }} />

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0}>
        {/*
          Keyed on the tab so a panel that failed once does not stay failed after switching away and
          back — the boundary's state resets with its identity, and the next tab genuinely is a
          fresh attempt.
        */}
        <Guard key={tab} what="This section">

      {/*
        ★ EVERY COMMODITY, WITH WHAT HAS BEEN DELIVERED — SQUADRON OWNER, 2026-08-02 ★

        "this should show me all comodites required for the build incluiding everythign delivered".

        Outstanding first, because that is what somebody is about to go and haul. The finished ones
        are kept below rather than dropped: a build's shopping list is not the same as its
        specification, and a member checking whether the titanium is done needs to find it.
      */}
      {tab !== 'needs' ? null : (
        <>
        {/*
          The note, which the app has never shown. `PostForm` writes it and nothing rendered it
          back — somebody could describe their own build and then never see the description again.
        */}
        {project.notes === null || project.notes.trim() === '' ? null : (
          <Section title="Notes">
            <Card>
              <p style={{ margin: 0, fontSize: '13px', color: C.dim, whiteSpace: 'pre-wrap' }}>
                {project.notes}
              </p>
            </Card>
          </Section>
        )}

      <Section title="What it still needs">
        {needs.length === 0 ? (
          <Empty>
            Nothing recorded yet. The needs appear the first time somebody with the companion app
            docks at the site.
          </Empty>
        ) : (
          <Card>
            {outstanding.map((n) => (
              <CommodityRow key={n.commodity} need={n} />
            ))}
            {done.length === 0 ? null : (
              <p style={{ margin: '10px 0 0', fontSize: '11px', color: C.faint }}>
                {done.length} commodit{done.length === 1 ? 'y' : 'ies'} fully delivered:{' '}
                {done.map((n) => n.commodity).join(', ')}
              </p>
            )}
          </Card>
        )}
      </Section>
        </>
      )}

      {tab !== 'deliveries' ? null : (
        <>
      {/* "a stacked bar chart that shows commoditied selivered per hour per day like raven colonial" */}
      <Section
        title="Deliveries over time"
        aside={<Toggle value={stackBy} onChange={setStackBy} />}
      >
        <Card>
          {/*
            ★ THREE VIEWS OF ONE CHART — SQUADRON OWNER, 2026-08-03 ★

            "it looks like we're giving duplicate charts in the Deliveries and in the Haulers tabs."

            They were not the same picture — one had time on the x-axis and the other had people —
            but they were two stacked bar charts with commander names in both, on adjacent tabs, and
            that reads as duplication whatever the axes say.

            So all three cuts live here on one toggle, and the Haulers tab keeps the ranked list,
            which a chart cannot replace: "am I third or fourth" is a question a bar does not answer.
          */}
          {stackBy === 'perCommander' ? (
            <HaulerChart haulers={chart.haulers} />
          ) : (
            <DeliveryChart
              buckets={stackBy === 'commodity' ? chart.byCommodity : chart.byCommander}
              bucket={chart.bucket}
              by={stackBy}
            />
          )}
        </Card>
      </Section>

      {/* "whos delivered what and when" — the literal ledger, newest first. */}
      <Section title="Every delivery">
        {deliveries.length === 0 ? (
          <Empty>No deliveries recorded yet.</Empty>
        ) : (
          <Card>
            {deliveries.slice(0, 25).map((d, i) => (
              <Row
                key={`${d.at}-${d.commodity}-${i}`}
                left={d.commodity}
                sub={`${d.commander} · ${new Date(d.at).toLocaleString()}`}
                right={tonnes(d.amount)}
              />
            ))}
            {deliveries.length > 25 ? (
              <p style={{ margin: '10px 0 0', fontSize: '11px', color: C.faint }}>
                Showing the 25 most recent of {deliveries.length}.
              </p>
            ) : null}
          </Card>
        )}
      </Section>
        </>
      )}

      {tab !== 'buy' ? null : (
      <Section title="Where to buy it">
        <ShoppingControls value={filters} busy={refreshing} onApply={setFilters} />

        {/*
          ★ WHERE THE PRICES ARE MEASURED FROM, SAID OUT LOUD ★

          The tab printed distances with no stated origin, which is a number nobody can check. The
          hub has been echoing `shoppingFrom` all along and the app parsed it and threw it away.
        */}
        {data.shoppingFrom === null ? (
          <p style={{ margin: '0 0 10px', fontSize: '11px', color: C.warn }}>
            We hold no system called “{filters.near}”, so these are the best prices anywhere rather
            than the best near you.
          </p>
        ) : (
          <p style={{ margin: '0 0 10px', fontSize: '11px', color: C.dim }}>
            {data.shoppingSort === 'cheapest'
              ? 'Cheapest anywhere in range of '
              : data.shoppingSort === 'closest'
                ? 'Closest to '
                : 'Local first, within range of '}
            <span style={{ color: C.text }}>{data.shoppingFrom}</span>.
          </p>
        )}

        {shopping.length === 0 ? (
          <Empty>Nothing to buy.</Empty>
        ) : (
          <Card>
            {shopping.map((r) => (
              <ShoppingRow key={r.commodity} row={r} />
            ))}
            <p style={{ margin: '10px 0 0', fontSize: '11px', color: C.dim }}>
              {/*
                Qualified whenever it is incomplete. A confident total that silently omits four
                commodities nobody sells is worse than no total.
              */}
              {unsourced === 0
                ? `About ${credits(total)} in cargo to finish.`
                : `About ${credits(total)} for what can be bought — ${unsourced} not sold in range, so the real total is higher.`}
            </p>
          </Card>
        )}
      </Section>
      )}

      {tab !== 'carriers' ? null : (
        <CarrierPanel
          projectId={data.project.id}
          carriers={data.carriers}
          needs={data.needs}
          canManage={data.can.manage}
          onChanged={() => void reloadDetail()}
        />
      )}

      {tab !== 'crew' ? null : (
      <>
      {/*
        ★ WHO IS ON THIS, AND WHO IS COVERING WHAT — SQUADRON OWNER, 2026-08-02 ★

        "a way for people to join the project ahead of time, and a way that we can assign people who
        do join what materials we want them to haul."

        Above the delivery history on purpose: this is what is GOING to happen and the history is
        what already did. Somebody opening a build in order to help wants the first.
      */}
      <Section title="Who is on this build">
        <Roster projectId={project.id} needs={needs} onChanged={() => void reloadDetail()} />
      </Section>
      </>
      )}

      {/*
        ★ THE CHART AND THE LIST, BOTH — SQUADRON OWNER, 2026-08-02 ★

        "we want the who has hauled to be a stacked bar chart."

        The chart is what was asked for and it is the better picture: it says whether somebody's
        forty thousand tonnes was all steel or a share of everything. The ranked list stays under
        it because a chart cannot be read to the tonne, and "am I third or fourth" is a question
        people genuinely have about their own name.
      */}
      {tab !== 'haulers' ? null : (
      <Section title="Who has hauled">
        {haulers.length === 0 ? (
          <Empty>No deliveries recorded yet.</Empty>
        ) : (
          <Card>
            {haulers.map((h, i) => (
              <Row key={`${h.name}-${i}`} left={`${i + 1}. ${h.name}`} right={tonnes(h.tonnes)} />
            ))}
          </Card>
        )}
      </Section>
      )}
        </Guard>
      </div>
    </div>
  );
}

/**
 * How long ago the page last heard from the hub.
 *
 * Its own component with its own ticking clock, so the whole project page does not re-render once a
 * second to move one line of text — which would rebuild both Chart.js canvases every tick.
 */
function Freshness({ at }: { at: number }): JSX.Element {
  const [, tick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 5_000);
    return () => clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  const said =
    seconds < 10
      ? 'just now'
      : seconds < 90
        ? `${seconds} seconds ago`
        : `${Math.round(seconds / 60)} minutes ago`;

  return (
    <p style={{ margin: '6px 0 0', fontSize: '10px', color: C.faint, fontFamily: 'var(--font-mono)' }}>
      Updated {said} · refreshes the moment you hand cargo over
    </p>
  );
}

/**
 * The stacking switch above the time chart.
 *
 * Two words rather than a dropdown: there are exactly two answers, and a select box that has to be
 * opened to find out what the alternative is hides half the feature.
 */
function Toggle({
  value,
  onChange,
}: {
  value: StackBy;
  onChange: (next: StackBy) => void;
}): JSX.Element {
  const options: readonly StackBy[] = ['commodity', 'commander', 'perCommander'];

  return (
    <div style={{ display: 'flex', gap: '4px' }}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          style={{
            border: `1px solid ${value === option ? C.active : 'transparent'}`,
            background: value === option ? C.raised : 'transparent',
            color: value === option ? C.text : C.faint,
            borderRadius: '6px',
            padding: '3px 9px',
            fontSize: '11px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {/* "per commander" rather than "perCommander" — the key is code, the label is English. */}
          {option === 'perCommander' ? 'per commander' : `by ${option}`}
        </button>
      ))}
    </div>
  );
}

/**
 * One commodity: what is left, what has gone in, and how far along it is.
 *
 * The bar matters more than the numbers for scanning a list of twenty-three — a member looking for
 * what to haul next wants the short one, and finding it by reading pairs of five-digit numbers is
 * slower than seeing it.
 */
function CommodityRow({ need }: { need: ColonyNeed }): JSX.Element {
  const required = need.required ?? 0;
  const provided = Math.max(0, required - need.remaining);

  return (
    <div style={{ padding: '6px 0', borderTop: `1px solid ${C.hairline}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
        <span style={{ fontSize: '13px' }}>{need.commodity}</span>
        <span style={{ fontSize: '13px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {tonnes(need.remaining)} left
        </span>
      </div>
      {required <= 0 ? null : (
        <>
          <div style={{ marginTop: '4px' }}>
            <Bar done={provided} total={required} />
          </div>
          <p style={{ margin: '3px 0 0', fontSize: '11px', color: C.faint }}>
            {provided.toLocaleString()} of {required.toLocaleString()} delivered
          </p>
        </>
      )}
    </div>
  );
}

/**
 * How much of a commodity somebody is taking on.
 *
 * Quarter, half or all of what is left. Three is the right number: two is not a choice and five is
 * a decision. Every button prints the tonnes it works out to, so agreeing to a share never means
 * doing the sum yourself.
 */
const SHARES = [
  { label: '¼', of: 0.25 },
  { label: '½', of: 0.5 },
  { label: 'All', of: 1 },
] as const;

function ClaimRow({
  need,
  busy,
  onClaim,
}: {
  need: ColonyNeed;
  busy: boolean;
  onClaim: (tonnes: number) => void;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
        padding: '5px 0',
        borderTop: `1px solid ${C.hairline}`,
      }}
    >
      <span style={{ fontSize: '12px' }}>
        {need.commodity}
        <span style={{ color: C.faint, marginLeft: '8px', fontVariantNumeric: 'tabular-nums' }}>
          {tonnes(need.remaining)} left
        </span>
      </span>

      <span style={{ display: 'flex', gap: '4px' }}>
        {SHARES.map((share) => {
          /*
           * Rounded UP, and never past what is left. A quarter of 4,001 tonnes is 1,000.25, and a
           * claim in fractions of a tonne is not a thing the game can carry — rounding up also
           * means three quarter-shares cover the pile rather than leaving one tonne behind.
           */
          const amount = Math.min(need.remaining, Math.ceil(need.remaining * share.of));
          return (
            <button
              key={share.label}
              type="button"
              class="chip"
              disabled={busy}
              title={`Take ${tonnes(amount)} of ${need.commodity}`}
              style={{ padding: '3px 9px', fontSize: '11px' }}
              onClick={() => onClaim(amount)}
            >
              {share.label}
              <span style={{ color: C.faint, marginLeft: '6px' }}>{amount.toLocaleString()}</span>
            </button>
          );
        })}
      </span>
    </div>
  );
}

/**
 * Fleet carriers helping with a build.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "we also need a way to add fleet carriers to the project like raven colonial does", and
 * "squadron carriers too".
 *
 * ★ WHAT IS IN A HOLD CHANGES WHAT "REMAINING" MEANS ★
 *
 * Twenty thousand tonnes sitting on a carrier parked at the site is not the same build as twenty
 * thousand tonnes nobody has bought yet. The headline is therefore how much of what is still wanted
 * is already aboard — the one number that answers "do we need another shopping trip".
 *
 * ★ AND THE READING HAS AN AGE ★
 *
 * A carrier is the one station that can be somewhere else tomorrow, so a stale reading of its hold
 * is worth far less than a stale reading of a starport's. The date is on every row.
 */
function CarrierPanel({
  projectId,
  carriers,
  needs,
  canManage,
  onChanged,
}: {
  projectId: string;
  carriers: readonly AttachedCarrier[];
  needs: readonly ColonyNeed[];
  canManage: boolean;
  onChanged: () => void;
}): JSX.Element {
  const [term, setTerm] = useState('');
  const [matches, setMatches] = useState<readonly CarrierMatch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = (fn: () => Promise<Answer<unknown>>): void => {
    setBusy(true);
    void fn().then((a) => {
      setBusy(false);
      if (a.ok) {
        setError(null);
        setMatches(null);
        setTerm('');
        onChanged();
      } else {
        // The hub's own sentence. "Nobody has reported that carrier's market yet" tells somebody
        // what to do next; "something went wrong" does not.
        setError(a.error);
      }
    });
  };

  const look = (): void => {
    setBusy(true);
    void window.colony.carriers(projectId, term).then((a) => {
      setBusy(false);
      if (a.ok) {
        setMatches(a.data.carriers);
        setError(null);
      } else {
        setError(a.error);
      }
    });
  };

  const covered = new Map<string, number>();
  for (const c of carriers)
    for (const h of c.holds) covered.set(h.commodity, (covered.get(h.commodity) ?? 0) + h.tonnes);

  const outstanding = needs.filter((n) => n.remaining > 0);
  const aboard = outstanding.reduce(
    (sum, n) => sum + Math.min(n.remaining, covered.get(n.commodity) ?? 0),
    0,
  );
  const wanted = outstanding.reduce((sum, n) => sum + n.remaining, 0);

  return (
    <Section title="Fleet carriers on this build">
      {error === null ? null : (
        <div style={{ marginBottom: '12px' }}>
          <Problem>{error}</Problem>
        </div>
      )}

      {carriers.length === 0 ? (
        <Empty>
          No carriers on this build yet. Anything a squadron carrier is already holding counts
          towards what is still needed.
        </Empty>
      ) : (
        <>
          <p style={{ margin: '0 0 10px', fontSize: '12px', color: C.dim }}>
            {tonnes(aboard)} of the {tonnes(wanted)} still wanted is already in a hold.
          </p>
          {carriers.map((c) => (
            <Card key={c.marketId}>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: '10px',
                }}
              >
                <span style={{ fontSize: '14px' }}>
                  {c.name}
                  {c.isSquadron ? (
                    <span
                      style={{
                        marginLeft: '8px',
                        fontSize: '9px',
                        letterSpacing: '0.18em',
                        color: C.orange,
                      }}
                    >
                      SQUADRON
                    </span>
                  ) : null}
                  <span style={{ marginLeft: '8px', fontSize: '11px', color: C.faint }}>
                    {c.systemName ?? 'somewhere we have not seen'} · {seenAgo(c.seenAt)}
                  </span>
                  {c.systemName === null ? null : <Copy value={c.systemName} />}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '12px', color: C.dim }}>{tonnes(c.totalTonnes)}</span>
                  {/* Whoever attached it, or an officer. Anybody being able to detach anybody's
                      carrier would let one member quietly remove twenty thousand tonnes another
                      was counting on. */}
                  {canManage || c.addedBy !== null ? (
                    <Button
                      tone="danger"
                      disabled={busy}
                      onClick={() => act(() => window.colony.carrierRemove(projectId, c.marketId))}
                    >
                      Take off
                    </Button>
                  ) : null}
                </span>
              </div>

              {c.holds.length === 0 ? (
                <p style={{ margin: '6px 0 0', fontSize: '11px', color: C.faint }}>
                  {/* Distinguished on purpose: "holding nothing this build wants" is a fact about
                      the carrier; "we have never seen its market" is our own gap. */}
                  {c.seenAt === null
                    ? 'Nobody has reported its market, so we cannot say what is aboard.'
                    : 'Nothing aboard that this build still wants.'}
                </p>
              ) : (
                <div style={{ marginTop: '8px' }}>
                  {c.holds.map((h) => (
                    <Row key={h.commodity} left={h.commodity} right={tonnes(h.tonnes)} />
                  ))}
                </div>
              )}
            </Card>
          ))}
        </>
      )}

      <div
        style={{
          marginTop: '14px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <input
          value={term}
          onInput={(e) => setTerm((e.target as HTMLInputElement).value)}
          placeholder="callsign, or leave blank for whoever is carrying most"
          style={{ ...inputStyle, maxWidth: '320px' }}
        />
        <Button disabled={busy} onClick={look}>
          {busy ? 'Looking…' : 'Find carriers'}
        </Button>
      </div>

      {matches === null ? null : matches.length === 0 ? (
        <p style={{ margin: '10px 0 0', fontSize: '12px', color: C.dim }}>
          No carrier we have seen is holding anything this build still wants.
        </p>
      ) : (
        <div style={{ marginTop: '10px' }}>
          {matches.map((m) => (
            <div
              key={m.marketId}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: '10px',
                borderTop: `1px solid ${C.subtle}`,
                padding: '8px 0',
              }}
            >
              <span style={{ fontSize: '13px' }}>
                {m.name}
                <span style={{ marginLeft: '8px', fontSize: '11px', color: C.faint }}>
                  {m.systemName} · {seenAgo(m.seenAt)}
                </span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: C.dim }}>
                  {tonnes(m.matchingTonnes)} across {m.matchingCommodities}
                </span>
                <Button
                  disabled={busy}
                  onClick={() =>
                    act(() =>
                      window.colony.carrierAdd(projectId, {
                        marketId: m.marketId,
                        isSquadron: false,
                      }),
                    )
                  }
                >
                  Add
                </Button>
                {/* Marking a carrier as the squadron's is a claim about whose it is, so it is an
                    officer's call — the hub refuses it either way. */}
                {canManage ? (
                  <Button
                    tone="primary"
                    disabled={busy}
                    onClick={() =>
                      act(() =>
                        window.colony.carrierAdd(projectId, {
                          marketId: m.marketId,
                          isSquadron: true,
                        }),
                      )
                    }
                  >
                    Add as squadron
                  </Button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}


/**
 * Closing, reopening, deleting, and flagging the squadron's current effort.
 *
 * ★ THE WEBSITE HAD THESE AND THE APP HAD NOTHING ★
 *
 * A member who posted a build from the app had to open a browser to close it. The draw rules are
 * the website's, deliberately identical — a rule that differs between two surfaces is a rule
 * somebody will eventually be surprised by.
 */
function ProjectActions({
  project,
  can,
  onChanged,
  onGone,
}: {
  project: ColonyProject;
  can: { manage: boolean; isPoster: boolean };
  onChanged: () => void;
  onGone: () => void;
}): JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Whose build this is decides everything below. A squadron build is the squadron's, so an officer
  // directs it; a member's own is theirs.
  const mayDirect = project.owner === 'squadron' ? can.manage : can.isPoster;
  if (!mayDirect && !can.manage) return null;

  const closed = project.completedAt !== null;

  const act = (fn: () => Promise<Answer<unknown>>, gone = false): void => {
    setBusy(true);
    void fn().then((a) => {
      setBusy(false);
      if (!a.ok) {
        /*
         * The hub's own sentence. The refusals here are the interesting part — "people have already
         * hauled to this build, close it instead" is a real explanation, and replacing it with
         * "something went wrong" throws away the only useful thing said.
         */
        setError(a.error);
        return;
      }
      setError(null);
      setConfirming(false);
      if (gone) onGone();
      else onChanged();
    });
  };

  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {/* Squadron-only. A member marking their own build as the squadron's priority would be
            pointing the whole squadron at it, which is not theirs to do. */}
        {project.owner === 'squadron' && can.manage ? (
          <Button
            tone={project.isPriority ? 'primary' : 'default'}
            disabled={busy}
            onClick={() => act(() => window.colony.priority(project.id, !project.isPriority))}
          >
            {project.isPriority ? 'Current effort' : 'Make current effort'}
          </Button>
        ) : null}

        {mayDirect ? (
          <Button
            disabled={busy}
            onClick={() =>
              act(() =>
                closed ? window.colony.reopen(project.id) : window.colony.close(project.id),
              )
            }
          >
            {closed ? 'Reopen' : 'Close this build'}
          </Button>
        ) : null}

        {/*
          Delete is drawn only while nothing has been hauled. The hub refuses either way, but a
          button that exists in order to be refused teaches people to distrust the page — and
          `required` is zero exactly when the site has never reported a depot, which is the
          mistyped-market-id case delete is for.
        */}
        {mayDirect && project.required === 0 ? (
          confirming ? (
            <>
              <Button
                tone="danger"
                disabled={busy}
                onClick={() => act(() => window.colony.remove(project.id), true)}
              >
                Delete for good
              </Button>
              <Button disabled={busy} onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </>
          ) : (
            /*
             * Two presses, unlike the website's one. There is no browser confirm dialog here and no
             * undo behind it, and the app is the surface somebody is using with a joystick in the
             * other hand.
             */
            <Button tone="danger" disabled={busy} onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )
        ) : null}
      </div>

      {error === null ? null : (
        <div style={{ marginTop: '10px' }}>
          <Problem>{error}</Problem>
        </div>
      )}
    </div>
  );
}

/**
 * The filters the app could not set.
 *
 * ★ SQUADRON OWNER, 2026-08-04: "full feature parridy" ★
 *
 * The device route has accepted these four since the website got them, and the app sent none — so
 * its Where-to-buy tab was pinned to "local, 100 ly, any pad, measured from the build", and nothing
 * on screen said that was a choice somebody had made rather than the only answer.
 *
 * Applied on a button rather than on every keystroke: each change is a fresh query against an
 * 18-million-row table, and a member typing a system name would otherwise fire one per letter.
 */
function ShoppingControls({
  value,
  busy,
  onApply,
}: {
  value: ShoppingFilters;
  busy: boolean;
  onApply: (next: ShoppingFilters) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(value);

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        gap: '8px',
        marginBottom: '12px',
      }}
    >
      <div style={{ minWidth: '150px' }}>
        <Field label="Buying from">
          <input
            value={draft.near}
            onInput={(e) => setDraft({ ...draft, near: (e.target as HTMLInputElement).value })}
            placeholder="the build’s own system"
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Prefer">
        <select
          value={draft.sort}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            setDraft({ ...draft, sort: v === 'cheapest' || v === 'closest' ? v : 'local' });
          }}
          style={inputStyle}
        >
          <option value="local">Local first</option>
          <option value="cheapest">Cheapest anywhere</option>
          <option value="closest">Closest anywhere</option>
        </select>
      </Field>

      <Field label="Within">
        <select
          value={String(draft.withinLy)}
          onChange={(e) =>
            setDraft({ ...draft, withinLy: Number((e.target as HTMLSelectElement).value) })
          }
          style={inputStyle}
        >
          {[50, 100, 200, 500].map((ly) => (
            <option key={ly} value={String(ly)}>
              {ly} ly
            </option>
          ))}
        </select>
      </Field>

      <label
        style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: C.dim }}
      >
        <input
          type="checkbox"
          checked={draft.largePadOnly}
          onChange={(e) => setDraft({ ...draft, largePadOnly: (e.target as HTMLInputElement).checked })}
        />
        Large pad only
      </label>

      <Button tone="primary" disabled={busy} onClick={() => onApply(draft)}>
        {busy ? 'Looking…' : 'Update'}
      </Button>
    </div>
  );
}

/**
 * One line of the shopping list.
 *
 * ★ THREE COLUMNS THE APP WAS DROPPING ★
 *
 * It showed the commodity, where to get it and the total cost. It did NOT show how much is needed,
 * what a tonne costs, or how much is on the shelf — and the last of those is the number that decides
 * how many trips this is. All three were already on the wire and unused.
 */
function ShoppingRow({ row }: { row: ColonyShoppingRow }): JSX.Element {
  const place =
    row.stationName === null
      ? row.nearestOutOfRange === null
        ? 'nobody anywhere we know of sells this'
        : `none in range · nearest ${row.nearestOutOfRange.stationName} · ${row.nearestOutOfRange.systemName}` +
          (row.nearestOutOfRange.distance === null
            ? ''
            : ` · ${Math.round(row.nearestOutOfRange.distance)} ly`) +
          ` · ${seenAgo(row.nearestOutOfRange.seenAt)}`
      : `${row.stationName} · ${row.systemName} · ${seenAgo(row.seenAt)}`;

  const system = row.stationName === null ? row.nearestOutOfRange?.systemName : row.systemName;

  return (
    <div style={{ borderTop: `1px solid ${C.subtle}`, padding: '8px 0' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '10px',
        }}
      >
        <span style={{ fontSize: '13px', color: C.text }}>
          {row.commodity}
          <span style={{ marginLeft: '8px', fontSize: '11px', color: C.dim }}>
            {tonnes(row.remaining)} needed
          </span>
        </span>
        <span style={{ fontSize: '12px', color: C.dim }}>
          {row.price === null ? '—' : `${row.price.toLocaleString()} cr/t`}
          {row.supply === null ? '' : ` · ${tonnes(row.supply)} in stock`}
          <span style={{ marginLeft: '8px', color: C.text }}>
            {row.cost === null ? '—' : credits(row.cost)}
          </span>
        </span>
      </div>
      <p
        style={{
          margin: '3px 0 0',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '5px',
          fontSize: '11px',
          color: row.stationName === null ? C.warn : C.faint,
        }}
      >
        <span>{place}</span>
        {/* The system alone, because the galaxy map searches systems — a station name finds nothing. */}
        {system === undefined || system === null ? null : <Copy value={system} />}
      </p>
    </div>
  );
}

/**
 * The roster: who has joined, what they have taken on, and what nobody is covering.
 *
 * ★ THE UNCOVERED LIST IS THE POINT ★
 *
 * A roster that only shows who has claimed something answers "who is helping" and leaves the more
 * useful question — what is nobody bringing — to be worked out by comparing two lists by eye. The
 * gap is computed here and named, because it is what somebody arriving to help actually needs.
 */
function Roster({
  projectId,
  needs,
  onChanged,
}: {
  projectId: string;
  needs: readonly ColonyNeed[];
  onChanged: () => void;
}): JSX.Element {
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    const answer = await window.colony.roster(projectId);
    if (answer.ok) {
      setRoster(answer.data.roster);
      setError(null);
    } else {
      setError(answer.error);
    }
  };

  /*
   * ★ RE-READ ON EVERY VISIT, ON PURPOSE ★
   *
   * The tab strip unmounts the panel it is not showing, so coming back here refetches. That is the
   * behaviour worth having: a roster is the one thing on this page that changes because of somebody
   * ELSE, and showing a member a claim list from ten minutes ago is how two people end up hauling
   * the same commodity. The cost is one small request; the alternative is a wrong answer.
   */
  useEffect(() => {
    void load();
  }, [projectId]);

  /*
   * Every action goes through here so the failure path is one path. The hub is where the rules
   * live — whether this member may assign to that one — so a refusal is a SENTENCE to show rather
   * than something the app should have predicted and hidden.
   */
  const act = async (fn: () => Promise<Answer<unknown>>): Promise<void> => {
    setBusy(true);
    const answer = await fn();
    setBusy(false);
    if (!answer.ok) {
      setError(answer.error);
      return;
    }
    setError(null);
    await load();
    onChanged();
  };

  /*
   * ★ A FAILED FIRST LOAD IS NOT "LOADING" ★
   *
   * This used to return the loading placeholder whenever `roster` was null, which is exactly the
   * state a FAILED first load leaves it in. So a member whose device had been unpaired, or whose
   * rank did not reach the roster, sat looking at "Loading…" for ever — the error was captured in
   * state and then thrown away by the line that rendered before it.
   *
   * The banner already exists and already carries the hub's own sentence. It just has to be
   * reached, and there has to be a way back from it.
   */
  if (roster === null) {
    if (error === null) return <Empty>Loading…</Empty>;
    return (
      <div>
        <Problem>{error}</Problem>
        <div style={{ marginTop: '10px' }}>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void load().finally(() => setBusy(false));
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const claimed = new Set(roster.flatMap((m) => m.assignments.map((a) => a.commodity)));
  const uncovered = needs.filter((n) => n.remaining > 0 && !claimed.has(n.commodity));

  return (
    <div>
      {error === null ? null : (
        <div style={{ marginBottom: '12px' }}>
          <Problem>{error}</Problem>
        </div>
      )}

      <Card>
        {roster.length === 0 ? (
          <Empty>Nobody has joined yet.</Empty>
        ) : (
          roster.map((m) => (
            <div key={m.userId} style={{ padding: '7px 0', borderTop: `1px solid ${C.hairline}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                <span style={{ fontSize: '13px' }}>{m.name}</span>
                <span style={{ fontSize: '12px', color: C.dim, fontVariantNumeric: 'tabular-nums' }}>
                  {m.delivered > 0 ? `${tonnes(m.delivered)} delivered` : 'nothing yet'}
                </span>
              </div>
              {m.assignments.length === 0 ? (
                <p style={{ margin: '3px 0 0', fontSize: '11px', color: C.faint }}>
                  not carrying anything in particular
                </p>
              ) : (
                /*
                 * ★ ROWS, NOT A SENTENCE — SQUADRON OWNER, 2026-08-02 ★
                 *
                 * "when we assign materials for a crew member to haul, we need a way to remove
                 * those materials too please so we can update."
                 *
                 * They were joined into one line of text, which read fine and could not be undone.
                 * A plan somebody cannot change is a plan that goes stale the first time anybody's
                 * evening turns out differently.
                 */
                <div style={{ marginTop: '4px', display: 'grid', gap: '3px' }}>
                  {m.assignments.map((a) => (
                    <div
                      key={a.id}
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        gap: '8px',
                        fontSize: '11px',
                        color: C.dim,
                      }}
                    >
                      <span>
                        {a.commodity}
                        {a.tonnes === null ? '' : ` · ${a.tonnes.toLocaleString()} t`}
                        {/* Said out loud: "you took this on" and "somebody asked you to" are
                            different things to read about yourself. */}
                        {a.assigned ? ' (assigned)' : ''}
                      </span>
                      <button
                        type="button"
                        class="chip"
                        disabled={busy}
                        title={`Drop ${a.commodity}`}
                        style={{ padding: '1px 7px', fontSize: '10px', color: C.faint }}
                        onClick={() =>
                          void act(() =>
                            window.colony.unassign(projectId, {
                              commodity: a.commodity,
                              // Sent explicitly: dropping somebody ELSE's assignment is a different
                              // permission from dropping your own, and the hub checks it. Omitting
                              // this would silently drop the caller's instead.
                              userId: m.userId,
                            }),
                          )
                        }
                      >
                        Drop
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}

        {/*
          ★ ONE BUTTON, AND IT IS THE ONE THAT APPLIES — SQUADRON OWNER, 2026-08-02 ★

          "when a crew member joins a build the join this build button needs to be replaced with a
          red leave this build button."

          Both were drawn at once before, so a member who had already joined still saw Join and had
          no way to know whether they were on the build. Which button is showing IS the answer to
          "am I on this", and two buttons could not say it.

          The hub decides who you are — `you` comes back on the roster row — because the app holds a
          device token rather than a user id and should not be guessing at its own identity.
        */}
        <div style={{ marginTop: '12px' }}>
          {roster.some((m) => m.you) ? (
            <Button
              tone="danger"
              disabled={busy}
              onClick={() => void act(() => window.colony.leave(projectId))}
            >
              Leave this build
            </Button>
          ) : (
            <Button
              tone="primary"
              disabled={busy}
              onClick={() => void act(() => window.colony.join(projectId))}
            >
              Join this build
            </Button>
          )}
        </div>
      </Card>

      {uncovered.length === 0 ? null : (
        <div style={{ marginTop: '12px' }}>
          {/*
            ★ TAKE A SHARE, NOT ALL OR NOTHING — SQUADRON OWNER, 2026-08-02 ★

            "perhaps allowing us to assign them a qty of materials to haul or a percentage would be
            a cool feature too."

            It was one button that claimed the entire outstanding amount, which is the wrong default
            for the case it matters most in: forty thousand tonnes of steel is nobody's evening, and
            a member who could only claim all of it either claimed a promise they could not keep or
            claimed nothing.

            Percentages rather than a number box, because the question somebody actually has is
            "how much of this am I taking on", and they answer it in fractions of the pile in front
            of them. The tonnage each button works out to is printed on it, so nobody is doing
            arithmetic to find out what they just agreed to.
          */}
          <p style={{ margin: '0 0 6px', fontSize: '11px', color: C.faint }}>
            Nobody is covering these yet — take a share and it shows against your name.
          </p>
          <div style={{ display: 'grid', gap: '6px' }}>
            {uncovered.slice(0, 12).map((n) => (
              <ClaimRow
                key={n.commodity}
                need={n}
                busy={busy}
                onClaim={(amount) =>
                  void act(() =>
                    window.colony.assign(projectId, { commodity: n.commodity, tonnes: amount }),
                  )
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  left,
  right,
  sub,
  subTone,
}: {
  left: string;
  right: string;
  sub?: string;
  subTone?: string;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '5px 0',
        borderTop: `1px solid ${C.hairline}`,
      }}
    >
      <span style={{ fontSize: '13px', minWidth: 0 }}>
        {left}
        {sub === undefined ? null : (
          <span style={{ display: 'block', fontSize: '11px', color: subTone ?? C.faint }}>{sub}</span>
        )}
      </span>
      <span style={{ fontSize: '13px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {right}
      </span>
    </div>
  );
}

function PostForm({
  canPostSquadron,
  dockedAt,
  onPosted,
}: {
  canPostSquadron: boolean;
  dockedAt: DockedAt | null;
  onPosted: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * ★ FILLED IN FROM THE JOURNAL — SQUADRON OWNER, 2026-08-02 ★
   *
   * "it should appear automatically in the companion app on the new project page if it is not being
   * used please!"
   *
   * The form used to ask for a market id and point at a Status screen that did not show one. The
   * app is already reading the journal that contains the answer, so asking a member to find and
   * retype a ten-digit number was asking them to redo work the machine had done — and a typo in it
   * produces a project that silently never updates.
   *
   * The station name seeds the title too, because "Ambrose Dock" is what almost everybody would
   * type. It is an ordinary editable field, not a locked one: a member naming their build something
   * else is the point of having a title at all.
   */
  const [form, setForm] = useState({
    /*
     * The cleaned name, not the raw one. Frontier prefixes every site with its class — "Planetary
     * Construction Site: " — which is noise on a board where every entry is a construction site.
     */
    title: projectTitleFrom(dockedAt?.stationName ?? ''),
    systemName: dockedAt?.systemName ?? '',
    stationName: dockedAt?.stationName ?? '',
    marketId: dockedAt?.marketId ?? '',
    notes: '',
    owner: 'personal' as 'personal' | 'squadron',
  });

  const set = (k: keyof typeof form) => (e: Event) => {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    setForm((f) => ({ ...f, [k]: target.value }));
  };

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    /*
     * ★ THE SNAPSHOT GOES WITH IT ★
     *
     * Without this a newly posted project sits on the board reading "waiting for somebody to dock
     * there" — while the member who posted it is standing on the pad, looking at the needs. The
     * depot reading they can already see is the same one the sync would fetch later, so sending it
     * now removes a wait that exists for no reason.
     *
     * The hub still treats it as one reading among many: the next sync REPLACES it wholesale from
     * whatever the newest journal says, so a stale or hand-edited snapshot cannot poison anything.
     */
    const answer = await window.colony.post({
      ...form,
      ...(dockedAt?.site == null
        ? {}
        : {
            snapshot: {
              progress: dockedAt.site.progress,
              complete: dockedAt.site.complete,
              failed: dockedAt.site.failed,
              resources: dockedAt.site.resources,
            },
          }),
    });
    setBusy(false);
    if (answer.ok) onPosted();
    else setError(answer.error);
  }

  return (
    <Card>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <Field label="What to call it">
          <input style={inputStyle} value={form.title} onInput={set('title')} placeholder="Ambrose Dock" />
        </Field>
        <Field label="System">
          <input style={inputStyle} value={form.systemName} onInput={set('systemName')} placeholder="HIP 58832" />
        </Field>
        <Field label="Station">
          <input style={inputStyle} value={form.stationName} onInput={set('stationName')} placeholder="Construction Site" />
        </Field>
        <Field
          label="Market id"
          hint={
            dockedAt === null
              ? 'Dock at the construction site and this fills itself in.'
              : 'Read from your journal — you are docked there now.'
          }
        >
          <input style={inputStyle} value={form.marketId} onInput={set('marketId')} placeholder="3706117632" />
        </Field>
      </div>

      <div style={{ marginTop: '12px' }}>
        <Field label="Anything the squadron should know">
          <textarea style={{ ...inputStyle, resize: 'vertical' }} rows={2} value={form.notes} onInput={set('notes')} />
        </Field>
      </div>

      {canPostSquadron ? (
        <label
          style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', fontSize: '13px', color: C.dim }}
        >
          <input
            type="checkbox"
            checked={form.owner === 'squadron'}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                owner: (e.target as HTMLInputElement).checked ? 'squadron' : 'personal',
              }))
            }
          />
          Post as a squadron project — the whole squadron hauls for it
        </label>
      ) : null}

      {error === null ? null : (
        <div style={{ marginTop: '12px' }}>
          <Problem>{error}</Problem>
        </div>
      )}

      <div style={{ marginTop: '14px' }}>
        <Button tone="primary" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Posting…' : 'Post the project'}
        </Button>
      </div>
    </Card>
  );
}
