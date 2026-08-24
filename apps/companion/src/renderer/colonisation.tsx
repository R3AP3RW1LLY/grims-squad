import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type {
  AttachedCarrier,
  BuildTypeDetail,
  BuildTypeRow,
  CarrierMatch,
  ColonyPlan,
  DraftedLayout,
  RosterEntry,
  StationClaim,
  SystemAdvice,
  ColonyHauler,
  ColonyNeed,
  ColonyProject,
  ColonyRights,
  ColonyShoppingRow,
  BoardViewer,
  PurchaseStation,
  UnattachedHolding,
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
  CodeBoxes,
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
import { CALLSIGN_LENGTH, formatCallsign, normaliseCallsign } from '@grims/shared/carrier';
import type { MergedNeeds } from '@grims/shared/colony-all-needs';
import { needsFreshness, type FreshnessVerdict } from '@grims/shared/needs-freshness';
import { groupByCategory } from '@grims/shared/commodity-category';
import { rankOpportunities, type Opportunity } from '@grims/shared/colony-opportunity';
/*
 * SUBPATH, never the barrel: this module is browser code and the barrel reaches `node:crypto`.
 * `renderer-imports.spec.ts` fails the build if that rule is broken.
 *
 * The website filters its boards with these exact functions. Two implementations of "is this build
 * still wanting hauling" is how the app and the site start disagreeing about what a member sees.
 */
import {
  COLONY_STATUS_FILTERS,
  DEFAULT_COLONY_FILTER,
  colonyStatusOf,
  matchesColonyFilter,
  type ColonyStatusFilter,
} from '@grims/shared/colony-status';
import { SystemPicker } from './system-picker.js';

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
      projects(): Promise<
        Answer<{ projects: ColonyProject[]; can: ColonyRights; you?: BoardViewer | null }>
      >;
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
      /**
       * The shopping route — where to fly for what this build still needs.
       *
       * Carriers are excluded, materials already delivered or aboard are dropped, and each one is
       * named at exactly one stop. All of that is decided by the hub so this app and the website
       * cannot give two answers to the same question.
       */
      /*
       * Station ownership. Officer-only at the hub, on COLONY_MANAGE — the app shows the hub's own
       * refusal rather than deciding from a rights flag it may be holding a stale copy of.
       */
      stationClaims(): Promise<Answer<{ claims: StationClaim[] }>>;
      claimStation(body: {
        stationName: string;
        systemName: string;
        ownership: 'squadron' | 'member';
        note?: string;
      }): Promise<Answer<{ ok: true; stationKey: string }>>;
      withdrawStationClaim(key: string): Promise<Answer<{ ok: true }>>;
      purchases(
        id: string,
        order?: 'ours' | 'closest',
      ): Promise<
        Answer<{
          systemName: string | null;
          stations: PurchaseStation[];
          uncovered: string[];
        }>
      >;
      declarePurchase(
        id: string,
        body: {
          commodity: string;
          stationName: string;
          stationSystem: string;
          tonnes?: number;
          price?: number;
          note?: string;
        },
      ): Promise<Answer<{ ok: true }>>;

      roster(id: string): Promise<Answer<{ roster: RosterEntry[] }>>;
      join(id: string): Promise<Answer<{ ok: true }>>;
      leave(id: string): Promise<Answer<{ ok: true }>>;
      /**
       * Everything the member owes across every build they are on, merged by the hub.
       *
       * Squadron owner, 2026-08-23: "SrvSurvey will then show cargo items needed only for the
       * primary or all projects." The merge is the hub's — the same `mergeNeeds` the website calls —
       * so the app holds the shape and none of the arithmetic.
       */
      owed(): Promise<Answer<MergedNeeds>>;
      /**
       * Marking the build the member is hauling to RIGHT NOW. One per member, held by the hub —
       * it is what the build overlay follows wherever they fly.
       */
      setCurrent(id: string): Promise<Answer<{ ok: true }>>;
      clearCurrent(id: string): Promise<Answer<{ ok: true }>>;
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
      reportBuilt(id: string): Promise<Answer<{ ok: true }>>;
      reopen(id: string): Promise<Answer<{ ok: true }>>;
      remove(id: string): Promise<Answer<{ ok: true }>>;
      priority(id: string, on: boolean): Promise<Answer<{ ok: true }>>;
      /** Giving up on a build, or taking that back. Officers only — the hub decides, not this. */
      abandoned(id: string, on: boolean, note?: string): Promise<Answer<{ ok: true }>>;

      /** Fleet carriers helping with a build, and what each is holding. */
      carriers(id: string, q: string): Promise<Answer<{ carriers: CarrierMatch[] }>>;
      /*
       * One carrier's whole run. Takes a MARKET ID and no project, because a carrier holds one
       * hold and the point is to subtract it once across every build it serves rather than once
       * per build — which is what reading three project screens and adding them up does.
       */
      carrierManifest(
        marketId: string,
        opts?: { near?: string; withinLy?: number; largePad?: boolean; sort?: string },
      ): Promise<Answer<CarrierManifestData>>;
      carrierAdd(
        id: string,
        body: { marketId: string; isSquadron: boolean },
      ): Promise<Answer<{ marketId: string }>>;
      carrierRemove(id: string, marketId: string): Promise<Answer<{ ok: true }>>;
      /**
       * Sets or clears a MANUAL tonnage on an attached carrier — the crew's own hand, for whatever
       * the journals missed. `tonnes: null` clears; zero is a real figure ("none aboard").
       */
      carrierCargoSet(
        id: string,
        marketId: string,
        body: { commodity: string; tonnes: number | null },
      ): Promise<Answer<{ ok: true }>>;

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
      /** Asks the assistant what is wrong with a plan, from the simulation's own findings. */
      planReview(
        id: string,
      ): Promise<Answer<{ review: string; facts: string; unavailable: string | null }>>;
      /**
       * What a SYSTEM should be built as. Takes a name, not a plan id — a system can be advised on
       * before anybody has laid out a plan for it, which is the point on the scout page.
       */
      systemAdvice(systemName: string): Promise<Answer<SystemAdvice>>;
      /** A proposed layout, with the plan checker's verdict attached. POST — it spends a model call. */
      /**
       * Lays out a system, working around whatever is already built in it.
       *
       * Squadron owner, 2026-08-22: a partial build is asked about rather than drafted over. The
       * hub words the question; `mode` is the answer, and its absence is not a default.
       */
      draftLayout(
        systemName: string,
        planId?: string,
        mode?: 'keep' | 'override',
      ): Promise<Answer<DraftedLayout>>;
      planReorder(
        id: string,
        body: { version: number; siteIds: string[] },
      ): Promise<Answer<{ version: number }>>;
      planRemove(id: string): Promise<Answer<{ ok: true }>>;
    };
  }
}

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

/** The small tracked mono the rest of the app uses for a technical aside. */
const MONO_SMALL: JSX.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: C.faint,
};

/** One delivery, straight off the append-only ledger. */
export interface Delivery {
  readonly at: string;
  readonly commander: string;
  readonly commodity: string;
  readonly amount: number;
}

/** One carrier's combined run: every build it serves, added up once. */
export interface CarrierManifestData {
  carrier: { marketId: string; name: string; callsign: string | null };
  projects: Array<{ id: string; title: string; systemName: string }>;
  lines: Array<{
    commodity: string;
    category?: string | null;
    needed: number;
    aboard: number;
    toBuy: number;
  }>;
  shopping: ColonyShoppingRow[];
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
  can: { manage: boolean; isPoster: boolean; isCrew: boolean };
  /**
   * Fleet carriers on this build.
   *
   * Read from the market mirror rather than from anybody's journal — a carrier's market is public,
   * so this sees every squadron carrier rather than only the one whose owner has the app open.
   * `declared` on each carrier adds the two sources the mirror cannot see: the owner's journal and
   * a crew member's hand.
   */
  carriers: AttachedCarrier[];
  /**
   * Effective tonnes aboard the attached carriers per commodity — manual beats journal beats
   * mirror, summed by the hub. The yellow segment of every three-segment bar.
   */
  carrierCover: Record<string, number>;
  /**
   * THIS member's own carriers holding what the build wants, not attached to it.
   *
   * Optional and defaulted at the render site: an older hub does not send it, and a mismatched pair
   * is a normal condition here — see the chart-payload note in `ProjectDetail`.
   */
  canAttach?: UnattachedHolding[];
  needs: ColonyNeed[];
  haulers: ColonyHauler[];
  shopping: ColonyShoppingRow[];
  /** Echoed by the hub so the tab can say where it measured from. Null when the name was unknown. */
  shoppingFrom: string | null;
  shoppingSort: string;
  deliveries: Delivery[];
  chart: {
    bucket: 'hour' | 'day';
    /** The IANA zone the hub cut the buckets in — the member's stored one, never this machine's. */
    tz: string;
    byCommodity: DeliveryBucket[];
    byCommander: DeliveryBucket[];
    haulers: HaulerStack[];
  };
}

/**
 * How old the SITE reading is, in words.
 *
 * ★ A DIFFERENT QUESTION FROM THE ONE `Freshness` ANSWERS ★
 *
 * `Freshness` says when this app last spoke to the hub. This says when anybody last docked at the
 * construction site — which is what decides whether the needs list is worth planning an evening
 * around. Both can be true and far apart: the app can have synced a second ago and be showing a
 * fortnight-old depot reading.
 */
function siteFreshness(needs: readonly ColonyNeed[]): FreshnessVerdict {
  const stamps = needs
    .map((n) => (n.observedAt === null ? null : Date.parse(n.observedAt)))
    .filter((t): t is number => t !== null && Number.isFinite(t));

  // The NEWEST reading, because one commodity refreshed today makes the whole list that current.
  const newest = stamps.length === 0 ? null : new Date(Math.max(...stamps));
  return needsFreshness(newest, new Date());
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
const BOARD_SORTS = [
  { key: 'best', label: 'Best for you' },
  { key: 'nearest', label: 'Nearest' },
  { key: 'progress', label: 'Closest to done' },
  { key: 'stalled', label: 'Needs attention' },
] as const;

type BoardSort = (typeof BOARD_SORTS)[number]['key'];

/** The JSON board sends timestamps as strings; the shared rule works in Dates. */
const asDate = (raw: string | null | undefined): Date | null => {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
};

const FILTER_LABELS: Record<ColonyStatusFilter, string> = {
  'in-progress': 'In progress',
  complete: 'Complete',
  abandoned: 'Abandoned',
  all: 'All',
};

export function ColonyBoardPage({
  owner,
  projects,
  you,
  error,
  onReload,
}: {
  owner: 'squadron' | 'personal';
  /** Where the member was last seen, so the board can rank by distance. Null disables that term. */
  you?: BoardViewer | null;
  projects: readonly ColonyProject[];
  error: string | null;
  onReload: () => void;
}): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);
  const [sort, setSort] = useState<BoardSort>('best');
  /*
   * In progress by default, matching the website. The filter exists because the board fills with
   * finished builds — defaulting to "all" would leave the screen exactly as it is today and make
   * the filter something every member sets on every visit.
   */
  const [filter, setFilter] = useState<ColonyStatusFilter>(DEFAULT_COLONY_FILTER);

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

  /*
   * ★ RANKED BY THE SAME RULE THE WEBSITE USES ★
   *
   * `rankOpportunities` comes out of @grims/shared and the website calls it with the same inputs.
   * Two implementations of "which build wants me most" would drift, and the half that drifted would
   * be the one sending somebody nine hundred light years for a build the other surface knew was
   * finished.
   */
  const ranked = rankOpportunities(
    mine.map((p) => ({
      id: p.id,
      title: p.title,
      systemName: p.systemName,
      owner: p.owner,
      isPriority: p.isPriority,
      remaining: p.remaining,
      required: p.required,
      coords: p.coords ?? null,
      lastDeliveryAt:
        p.lastDeliveryAt === null || p.lastDeliveryAt === undefined
          ? null
          : new Date(p.lastDeliveryAt),
    })),
    { coords: you?.coords ?? null, now: Date.now() },
  );

  const notes = new Map<string, Opportunity>(ranked.map((o) => [o.id, o]));
  const byId = new Map(mine.map((p) => [p.id, p]));

  const sorted = [...ranked].sort((a, b) => {
    if (sort === 'nearest') {
      // Unknown distance sorts last: "we cannot place it" is not "it is here".
      const x = a.distanceLy ?? Number.POSITIVE_INFINITY;
      const y = b.distanceLy ?? Number.POSITIVE_INFINITY;
      return x !== y ? x - y : a.id.localeCompare(b.id);
    }
    if (sort === 'progress') {
      return (b.pctDone ?? -1) - (a.pctDone ?? -1) || a.id.localeCompare(b.id);
    }
    if (sort === 'stalled') {
      return (b.daysSinceDelivery ?? -1) - (a.daysSinceDelivery ?? -1) || a.id.localeCompare(b.id);
    }
    return b.score - a.score || a.id.localeCompare(b.id);
  });

  /*
   * Finished builds are NOT dropped. The ranking refuses to offer them — it answers "what could I
   * do tonight" — but the board is the record of what the squadron is doing, and a project
   * vanishing the moment it completes would read as deletion.
   */
  const ordered = [
    ...sorted.map((o) => byId.get(o.id)).filter((p): p is ColonyProject => p !== undefined),
    ...mine.filter((p) => !notes.has(p.id)),
  ];

  /*
   * ★ THE VIEW FILTER — SQUADRON OWNER, 2026-08-15 ★
   *
   * "we need to add view filters one for inprogress and one for complete"
   *
   * Counted over the WHOLE board and filtered afterwards. Counting the filtered list would make
   * every tab report the size of the tab already open, which looks right until somebody presses a
   * different one.
   */
  const statusOf = (p: ColonyProject) =>
    colonyStatusOf({ completedAt: asDate(p.completedAt), abandonedAt: asDate(p.abandonedAt) });

  const counts = ordered.reduce(
    (acc, p) => ({ ...acc, [statusOf(p)]: acc[statusOf(p)] + 1, all: acc.all + 1 }),
    { 'in-progress': 0, complete: 0, abandoned: 0, all: 0 } as Record<ColonyStatusFilter, number>,
  );

  const shown = ordered.filter((p) =>
    matchesColonyFilter(
      { completedAt: asDate(p.completedAt), abandonedAt: asDate(p.abandonedAt) },
      filter,
    ),
  );

  /*
   * An abandoned build reaches this app only when the member may see it — the hub decides that. A
   * tab that is permanently empty for most of the squadron teaches people the controls do not work,
   * so it is offered only to somebody who has one to look at.
   */
  const filterTabs = COLONY_STATUS_FILTERS.filter(
    (k) => k !== 'abandoned' || counts.abandoned > 0,
  ).map((key) => ({ key, label: FILTER_LABELS[key] + ' ' + String(counts[key]) }));

  return (
    <div>
      {error === null ? null : (
        <div style={{ marginBottom: '14px' }}>
          <Problem>{error}</Problem>
        </div>
      )}
      <Section title={owner === 'squadron' ? 'Squadron projects' : 'Members’ projects'}>
        {mine.length === 0 ? null : (
          <div style={{ marginBottom: '10px' }}>
            <Tabs
              tabs={filterTabs}
              current={filter}
              onChange={setFilter}
              label="Show which builds"
            />
            <div style={{ height: '6px' }} />
            <Tabs
              tabs={BOARD_SORTS}
              current={sort}
              onChange={setSort}
              label="Sort the board"
            />
            {(you?.coords ?? null) !== null ? null : (
              <p style={{ margin: '6px 0 0', fontSize: '11px', color: C.dim }}>
                {/* Said rather than silently degraded: without a position the ranking still works
                    on priority, progress and silence — it just cannot weigh distance. */}
                We do not know where you are yet, so distance is not counted.
              </p>
            )}
          </div>
        )}
        <Board
          projects={shown}
          notes={notes}
          onOpen={setOpenId}
          /*
           * The website's strings, verbatim. The app's said "New project" for a destination its own
           * sidebar calls "Start New Project", and dropped the members-board instruction entirely —
           * on the one screen where the instruction matters most, because an empty board that does
           * not say what to do next is a dead end.
           */
          empty={
            owner === 'squadron'
              ? 'No squadron projects yet. An officer can post one from Start New Project.'
              : 'Nobody has posted a project yet. Post yours from Start New Project and the squadron can see what you need.'
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
   * Rights UNKNOWN is not rights GRANTED. `can` is null when the read failed — hub unreachable,
   * usually — and the form used to render anyway, so the first anybody heard of the problem was
   * the server refusing their finished post. "Could not check" and "not allowed" are different
   * sentences, and this page has to know which one it is saying.
   */
  if (can === null) {
    return (
      <Section title="New project">
        <Empty>
          Could not reach the hub to check what your rank may post. This page fills in when the
          connection comes back.
        </Empty>
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

      {alreadyPosted ? null : (
        <Section
          title={dockedAt === null ? 'Post one by hand' : 'Post it'}
          aside={
            <Button tone={posting ? 'default' : 'primary'} onClick={() => setPosting((x) => !x)}>
              {posting ? 'Cancel' : 'New project'}
            </Button>
          }
        >
          {posting ? (
            <PostForm
              canPostSquadron={can.manage}
              dockedAt={dockedAt}
              onPosted={() => {
                setPosting(false);
                onPosted();
              }}
            />
          ) : dockedAt === null ? (
            /*
             * ★ THE HAND-FILL PATH — the website has always had it, the app refused ★
             *
             * A member posting from the sofa, with the market id copied out of Discord or a
             * screenshot, had a form on the website and a dead end in the app. Docking is the
             * BETTER path — everything fills itself in and the depot snapshot rides along — but
             * better is not the same as required.
             */
            <Empty>
              Docking at the site fills everything in for you — but a project posts fine by hand
              too. Press New project and type the system, station and market id.
            </Empty>
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
  notes,
}: {
  projects: readonly ColonyProject[];
  onOpen: (id: string) => void;
  empty: string;
  /** Per project — how far it is and whether it has gone quiet. Optional: no note draws as before. */
  notes?: ReadonlyMap<string, Opportunity>;
}): JSX.Element {
  if (projects.length === 0) return <Empty>{empty}</Empty>;

  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      {projects.map((p) => (
        <div
          key={p.id}
          onClick={() => onOpen(p.id)}
          /*
           * ★ REACHABLE WITHOUT A MOUSE ★
           *
           * This was a bare `<div onClick>`: no role, no tab stop, no key handler. It is the ONLY
           * way into a project in the app, so the entire colonisation feature was unreachable by
           * keyboard and announced to a screen reader as a meaningless group of text. The website's
           * equivalent has always been a real anchor.
           *
           * A div with button semantics rather than a real `<button>` because the row contains a
           * progress bar and a copy control, and a button may not contain interactive children —
           * nesting them is invalid markup that browsers resolve unpredictably.
           *
           * Space is prevented as well as handled: on a focused control it scrolls the page, so
           * without that the row would open AND jump.
           */
          role="button"
          tabIndex={0}
          aria-label={`Open ${p.title}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpen(p.id);
            }
          }}
          /*
           * The same glass as every other panel. These rows were left as opaque rounded boxes when
           * the theme landed, which put flat rectangles with invisible edges directly under a
           * chamfered translucent card — the one screen that is the main way into colonisation,
           * looking like it belonged to a different application.
           */
          class="panel row-open"
          style={{
            cursor: 'pointer',
            padding: '12px 14px',
            /*
             * ★ ABANDONED WINS THE EDGE — 2026-08-15 ★
             *
             * Read before priority, because a build that was the squadron's current effort and then
             * abandoned is exactly the row somebody must not mistake for live work. Both stamps can
             * be set; the more recent decision is the one that matters.
             */
            ...(p.abandonedAt !== null
              ? { borderColor: C.bad, opacity: 0.72 }
              : p.isPriority
                ? { borderColor: C.orange }
                : {}),
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
              {p.completedAt !== null && p.abandonedAt === null ? (
                <span style={{ marginLeft: '8px', fontSize: '9px', letterSpacing: '0.18em', color: C.good }}>
                  COMPLETE
                </span>
              ) : null}
              {/*
                Its own word, in red, rather than a shade of COMPLETE. "Finished" and "given up on"
                are opposite instructions about whether to load a hold, and a member scanning the
                board has to tell them apart at a glance.
              */}
              {p.abandonedAt !== null ? (
                <span style={{ marginLeft: '8px', fontSize: '9px', letterSpacing: '0.18em', color: C.bad }}>
                  ABANDONED
                </span>
              ) : null}
              {/*
                ★ HOW FAR, AND WHETHER IT HAS GONE QUIET ★

                The two facts that let somebody choose between nineteen rows, and neither was here.
                Distance is omitted rather than guessed when either end cannot be placed — people
                haul to systems our galaxy dump has never heard of.
              */}
              {notes?.get(p.id)?.distanceLy === null ||
              notes?.get(p.id)?.distanceLy === undefined ? null : (
                <span
                  style={{
                    marginLeft: '8px',
                    fontSize: '11px',
                    fontVariantNumeric: 'tabular-nums',
                    color: C.dim,
                  }}
                >
                  {notes.get(p.id)?.distanceLy} ly
                </span>
              )}
              {notes?.get(p.id)?.stalled !== true ? null : (
                <span
                  style={{ marginLeft: '8px', fontSize: '9px', letterSpacing: '0.16em', color: C.warn }}
                  title="A build nobody has hauled to in over a week looks exactly like a healthy one on a board."
                >
                  QUIET {notes.get(p.id)?.daysSinceDelivery} DAYS
                </span>
              )}
            </span>
            {/*
              System, site and who posted it — all three already on the wire and none of them
              rendered. The station is the only thing telling two builds in the same system apart,
              and the copy button is the owner's own ask: "so its easier to drop them into the
              galaxy / system maps".
            */}
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '11px',
                color: C.faint,
              }}
              /* The row is a button; a click on the copy control inside it must not also open it. */
              onClick={(e) => e.stopPropagation()}
            >
              {p.systemName}
              <Copy value={p.systemName} />
              {p.stationName === null ? '' : `· ${p.stationName}`}
              {p.postedBy === null ? '' : `· by ${p.postedBy}`}
            </span>
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
   * The carrier whose combined run is open, or null for this build's own screen. Held here rather
   * than inside CarrierPanel because the run REPLACES the project view — a panel cannot unmount the
   * screen containing it.
   */
  const [runMarketId, setRunMarketId] = useState<string | null>(null);
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
    // Kept so the cleanup below can let go of it. Without this the effect stacked a new listener on
    // every id or filter change and never dropped one.
    const stopListening = window.companion.onState((next) => {
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
      // The listener goes with the timer. Leaving it behind is what made the app fire one reload
      // per project page ever opened, on every upload.
      stopListening();
    };
    // Filters are a property of the request, so changing one re-runs the whole read rather than
    // filtering a list the hub already narrowed.
  }, [id, filters]);

  /*
   * The combined run REPLACES this screen, keyed so opening a second carrier resets its state
   * rather than showing the first one's numbers until the fetch lands — the same reasoning as the
   * key on ProjectDetail itself.
   */
  if (runMarketId !== null) {
    return (
      <CarrierRun
        key={runMarketId}
        marketId={runMarketId}
        onBack={() => setRunMarketId(null)}
      />
    );
  }

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
  /*
   * The same mismatched-pair defense, applied to the axis text: buckets from an older hub carry
   * an instant and no `label`, and mapping those straight onto the axis draws "undefined" per
   * bar. The key's own text is a legible clock until the hub deploy that authors real labels.
   */
  const labelled = (buckets: DeliveryBucket[]): DeliveryBucket[] =>
    buckets.map((b) => (typeof b.label === 'string' ? b : { ...b, label: b.at.slice(0, 16) }));

  const chart = {
    bucket: data.chart?.bucket ?? 'hour',
    // An older hub bucketed in UTC and sent no zone, so UTC is the one honest default here.
    tz: data.chart?.tz ?? 'UTC',
    byCommodity: labelled(data.chart?.byCommodity ?? []),
    byCommander: labelled(data.chart?.byCommander ?? []),
    haulers: data.chart?.haulers ?? [],
  };
  const outstanding = needs.filter((n) => n.remaining > 0);
  const done = needs.filter((n) => n.remaining <= 0);
  /*
   * The effective carrier cover, with the same mismatched-pair defense as the chart above it: an
   * older hub sends no `carrierCover` and no `toBuy`, and the honest reading of that is "no cover",
   * which is exactly what the old numbers meant.
   */
  const cover: Record<string, number> = data.carrierCover ?? {};
  const toBuyOf = (r: ColonyShoppingRow): number =>
    Number.isFinite(r.toBuy) ? r.toBuy : r.remaining;
  const total = shopping.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  /*
   * ★ THREE KINDS OF SHOPPING LINE, COUNTED APART ★
   *
   * `toBuy === 0` is a line the carriers already cover — good news, costing nothing — and lumping
   * it in with "nobody sells this" would turn the squadron's own cargo into a warning.
   */
  const covered = shopping.filter((r) => toBuyOf(r) === 0).length;
  const unsourced = shopping.filter((r) => toBuyOf(r) > 0 && r.price === null).length;
  const delivered = project.required - project.remaining;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <Button onClick={onBack}>← Back</Button>
        <span style={{ fontSize: '15px' }}>{project.title}</span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '11px',
            color: C.faint,
          }}
        >
          {project.systemName}
          {/* The system alone: the galaxy map searches systems, and a station name pasted into it
              finds nothing. The owner asked for this on the website for the same reason. */}
          <Copy value={project.systemName} />
          {project.stationName === null ? '' : ` · ${project.stationName}`}
        </span>
      </div>

      {/*
        ★ WHAT THE SITE ACTUALLY IS ★

        Worked out from what it asks for, not from anything anybody typed — a build's requirement is
        twenty-odd commodities at exact tonnages and no two share one, so the requirement identifies
        it. Absent until somebody has docked there, and absent for a build type we do not hold,
        which is information rather than a gap.
      */}
      {project.identified === null ? null : (
        <p style={{ margin: '0 0 14px', fontSize: '12px', color: C.dim }}>
          This is a <span style={{ color: C.cyan }}>{project.identified.displayName}</span>
          <span style={{ ...MONO_SMALL, marginLeft: '8px' }}>
            tier {project.identified.tier} · {project.identified.location}
            {project.identified.padSize === 'none' ? '' : ` · ${project.identified.padSize} pad`} ·{' '}
            {tonnes(project.identified.totalTonnes)} in total
          </span>
        </p>
      )}

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
              project.abandonedAt !== null
                ? 'Abandoned'
                : project.completedAt !== null
                  ? 'Complete'
                  : project.isPriority
                    ? 'Current effort'
                    : 'Live'
            }
            {...(project.abandonedAt !== null
              ? { tone: C.bad }
              : project.completedAt !== null
                ? { tone: C.cyan }
                : {})}
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
            {/*
              ★ A FINISHED COMMODITY KEEPS ITS ROW — SQUADRON OWNER, 2026-08-09 ★

              "OUR WEBSITE AND COMPANION APP ARE NOT UPDATING WHEN ITEMS ARE DELIVERED ... BLUE
              DENOTES WHAT IS DELIVERED! THIS IS NOT WORKING AS IT SHOULD"

              It was updating, and that was the problem: the list mapped `outstanding`, so the moment
              a commodity was finished its row LEFT. Hauling the last 730 t of Steel and watching the
              Steel row vanish is indistinguishable from the page ignoring the delivery — the bar
              never went blue because there was no bar left.

              This screen was the less bad of the two. It named the finished commodities in a line of
              small text underneath, which is a footnote where the owner asked for a full blue bar.
              Measured on production: 207 of 302 rows across the squadron, 584,108 tonnes of
              completed work, shown as a comma-separated list or not at all.

              Outstanding first, then the finished ones, each with its bar filled — the record of
              what the squadron has actually done, in the same place they watched it happen.
            */}
            {/*
              ★ GROUPED LIKE THE COMMODITY BOARD — SQUADRON OWNER, 2026-08-10 ★

              "break down all materials into their respective market categories ... so that its
              easier to search for these commodities". This screen is the one most often open beside
              the actual market, so it is the one the grouping matters most on.

              Same pure function as the website and the overlay — five surfaces a member reads side
              by side, grouped once so they cannot disagree.
            */}
            {groupByCategory([...outstanding, ...done]).map((group) => (
              <div key={group.category}>
                <p
                  style={{
                    margin: '12px 0 2px',
                    fontSize: '10px',
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: C.orange,
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>{group.category}</span>
                  <span style={{ color: C.faint, letterSpacing: 0 }}>
                    {group.complete ? 'complete' : `${tonnes(group.outstanding)} to go`}
                  </span>
                </p>
                {group.rows.map((n) => (
                  <CommodityRow key={n.commodity} need={n} aboard={cover[n.commodity] ?? 0} />
                ))}
              </div>
            ))}
            <BarLegendLine />
            {/*
              ★ WHEN THE SITE ITSELF LAST SAID SO ★

              Not when the app last synced — that is the `Freshness` line above, and it answers a
              different question. This one decides whether the list is worth planning an evening
              around: ten minutes old and it is, a fortnight old and half of it may already be
              delivered. Without it the two look identical.
            */}
            {(() => {
              /*
                ★ WHEN THE READING IS OLD THIS STOPS BEING A FOOTNOTE — 2026-08-12 ★

                "someone without the companion app completed a project and it did not update ...
                this causes our members to go buy materials for a project thats completed and not
                needed."

                A finished installation is not dockable, so nothing will ever report it again. The
                age of the reading is the only warning there can be, and at a fortnight it is the
                most important thing on this card.
              */
              const f = siteFreshness(needs);
              if (!f.warn) {
                return (
                  <p style={{ margin: '6px 0 0', fontSize: '11px', color: C.faint }}>{f.sentence}</p>
                );
              }
              return (
                <p
                  style={{
                    margin: '8px 0 0',
                    padding: '6px 10px',
                    border: `1px solid ${C.orangeBright}`,
                    borderRadius: '4px',
                    fontSize: '12px',
                    color: C.orangeBright,
                  }}
                >
                  {f.sentence}
                </p>
              );
            })()}
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
              tz={chart.tz}
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
                /*
                  This machine's zone, and SAID so. The device is on the member's own desk, so
                  its clock is the right one for "did my run land" — but an unlabelled local time
                  quoted to a squadmate abroad is a wrong time, so the zone name travels with it.
                */
                sub={`${d.commander} · ${new Date(d.at).toLocaleString(undefined, { timeZoneName: 'short' })}`}
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
      <>
      {/*
        Above the market suggestions, exactly as on the website. A station a squadmate actually
        filled up at beats a mirror row from four months ago, and half our market data is older
        than that.
      */}
      <PurchaseRoute projectId={project.id} />

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
            {/* Grouped like the needs list it serves, and like the board it is bought from. */}
            {groupByCategory(shopping.map((r) => ({ ...r, remaining: toBuyOf(r) }))).map((group) => (
              <div key={group.category}>
                <p
                  style={{
                    margin: '12px 0 2px',
                    fontSize: '10px',
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: C.orange,
                  }}
                >
                  {group.category}
                </p>
                {group.rows.map((r) => (
                  <ShoppingRow key={r.commodity} row={r} />
                ))}
              </div>
            ))}
            <BarLegendLine />
            <p style={{ margin: '10px 0 0', fontSize: '11px', color: C.dim }}>
              {/*
                Qualified whenever it is incomplete. A confident total that silently omits four
                commodities nobody sells is worse than no total — and a line the carriers cover is
                stated as covered, never counted against the total.
              */}
              {unsourced === 0
                ? `About ${credits(total)} in cargo to buy.`
                : `About ${credits(total)} for what can be bought — ${unsourced} not sold in range, so the real total is higher.`}
              {covered === 0 ? '' : ` ${covered} fully covered by the attached carriers.`}
            </p>
          </Card>
        )}
      </Section>
      </>
      )}

      {/*
        ★ ABOVE THE TABS, NOT INSIDE THE CARRIERS ONE — SQUADRON OWNER, 2026-08-16 ★

        The carriers tab is where somebody goes who already knows a carrier is involved. This is for
        the member who does not: their own app pushed a manifest and nothing has ever told them it
        could help here.

        `?? []` because an older hub sends no such field, and this app is expected to run against a
        hub it was not built against — the same defence the chart payload needed.
      */}
      <AttachPrompt
        projectId={data.project.id}
        holdings={data.canAttach ?? []}
        onChanged={() => void reloadDetail()}
      />

      {tab !== 'carriers' ? null : (
        <CarrierPanel
          projectId={data.project.id}
          carriers={data.carriers}
          needs={data.needs}
          carrierCover={cover}
          canManage={data.can.manage}
          isCrew={data.can.isCrew === true}
          onChanged={() => void reloadDetail()}
          onOpenRun={setRunMarketId}
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
function CommodityRow({ need, aboard = 0 }: { need: ColonyNeed; aboard?: number }): JSX.Element {
  const required = need.required ?? 0;
  const provided = Math.max(0, required - need.remaining);
  // Capped at what is still wanted: a carrier holding more than the build needs covers it, not more.
  const staged = Math.min(need.remaining, Math.max(0, aboard));

  return (
    <div style={{ padding: '6px 0', borderTop: `1px solid ${C.hairline}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
        {/*
          ★ STRUCK THROUGH WHEN IT IS DONE — SQUADRON OWNER ★

          The row is kept rather than filtered: deleting a line the moment it finished hid whole
          categories of completed work and made a build look barely started. But a kept row that
          looks like every other row is a line members keep hauling to.

          Struck through and green says "finished" at a glance without removing the evidence that it
          was ever needed. Same treatment as the website, because they are one board.
        */}
        <span
          style={{
            fontSize: '13px',
            ...(need.remaining <= 0 ? { color: C.good, textDecoration: 'line-through' } : {}),
          }}
        >
          {need.commodity}
        </span>
        <span style={{ fontSize: '13px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {/* "0 t left" is technically true and reads like a shortfall. Finished says finished. */}
          {need.remaining <= 0 ? (
            <span style={{ color: C.good }}>done</span>
          ) : (
            `${tonnes(need.remaining)} left`
          )}
          {staged > 0 ? (
            <span
              style={{ marginLeft: '7px', fontSize: '11px', color: C.warn }}
              title="Effective tonnes already aboard the build's attached carriers."
            >
              {tonnes(staged)} aboard
            </span>
          ) : null}
        </span>
      </div>
      {required <= 0 ? null : (
        <>
          <div style={{ marginTop: '4px' }}>
            <Bar done={provided} total={required} staged={staged} />
          </div>
          <p style={{ margin: '3px 0 0', fontSize: '11px', color: C.faint }}>
            {provided.toLocaleString()} of {required.toLocaleString()} delivered
            {staged > 0 ? ` · ${staged.toLocaleString()} aboard carriers` : ''}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * One carrier's whole run: every build it serves, added up once.
 *
 * ★ SQUADRON OWNER, 2026-08-09 ★
 *
 * "it can be active on many projects and it will give me an aggregated total of all materials needed
 * to get all the builds completed if i am buying and storing on a fleet carrier"
 *
 * ★ WHY THE APP NEEDS THIS MORE THAN THE WEBSITE DOES ★
 *
 * The website is where the run gets planned. This is what is open while it is being flown, beside
 * the commodity market somebody is standing in — which is the moment "how much of this do I actually
 * need" gets asked.
 *
 * ★ AND WHY THE NUMBER DIFFERS FROM THE PROJECT SCREENS ★
 *
 * A carrier holds ONE hold. Each build it serves reports the whole of that hold as its own cover,
 * correctly, because each is answering "what do the carriers attached to me hold". Opening three
 * builds and adding them counts the same cargo three times. This subtracts it once — on the hub, by
 * the same method the website calls, so the two cannot disagree.
 */
function CarrierRun({
  marketId,
  onBack,
}: {
  marketId: string;
  onBack: () => void;
}): JSX.Element {
  const [data, setData] = useState<CarrierManifestData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void window.colony.carrierManifest(marketId).then((a) => {
      if (!live) return;
      if (a.ok) {
        setData(a.data);
        setError(null);
      } else {
        setError(a.error);
      }
    });
    return () => {
      live = false;
    };
  }, [marketId]);

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

  const needed = data.lines.reduce((sum, l) => sum + l.needed, 0);
  const aboard = data.lines.reduce((sum, l) => sum + Math.min(l.needed, l.aboard), 0);
  const toBuy = data.lines.reduce((sum, l) => sum + l.toBuy, 0);

  return (
    <div>
      <Button onClick={onBack}>← Back</Button>

      <h2 style={{ margin: '14px 0 4px', fontSize: '17px' }}>
        {data.carrier.callsign === null
          ? data.carrier.name
          : `${data.carrier.name} · ${data.carrier.callsign}`}
      </h2>
      <p style={{ margin: '0 0 14px', fontSize: '12px', color: C.dim }}>
        {data.projects.length === 1
          ? 'Everything the build this carrier serves still needs'
          : `Everything the ${data.projects.length} builds this carrier serves still need, added up once`}
      </p>

      <Card>
        <Row left="Builds served" right={String(data.projects.length)} />
        <Row left="Still needed" right={tonnes(needed)} />
        <Row left="Aboard" right={tonnes(aboard)} />
        <Row left="Left to buy" right={tonnes(toBuy)} />
      </Card>

      <Section title="The builds this carrier is on">
        {data.projects.length === 0 ? (
          <Empty>
            This carrier is not attached to any build yet. Attach it from a project&rsquo;s carriers
            panel and its needs appear here.
          </Empty>
        ) : (
          <Card>
            {data.projects.map((p) => (
              <Row key={p.id} left={p.title} right={p.systemName} />
            ))}
          </Card>
        )}
      </Section>

      <Section title="Combined manifest">
        {data.lines.length === 0 ? (
          <Empty>Nothing outstanding. Every build this carrier serves has what it needs.</Empty>
        ) : (
          <Card>
            {groupByCategory(data.lines.map((l) => ({ ...l, remaining: l.toBuy }))).map((group) => (
              <div key={group.category}>
                <p
                  style={{
                    margin: '12px 0 2px',
                    fontSize: '10px',
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: C.orange,
                  }}
                >
                  {group.category}
                </p>
                {group.rows.map((l) => (
              <div key={l.commodity} style={{ padding: '6px 0', borderTop: `1px solid ${C.hairline}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                  <span style={{ fontSize: '13px' }}>{l.commodity}</span>
                  <span
                    style={{ fontSize: '13px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
                  >
                    {l.toBuy <= 0 ? (
                      <span style={{ color: C.good }}>covered</span>
                    ) : (
                      `${tonnes(l.toBuy)} to buy`
                    )}
                  </span>
                </div>
                <div style={{ marginTop: '4px' }}>
                  {/* Nothing is delivered from a carrier's point of view — the whole bar is the
                      yellow "aboard" segment against what the builds still want. */}
                  <Bar done={0} total={l.needed} staged={Math.min(l.needed, l.aboard)} />
                </div>
                <p style={{ margin: '3px 0 0', fontSize: '11px', color: C.faint }}>
                  {l.needed.toLocaleString()} wanted
                  {l.aboard > 0 ? ` · ${Math.min(l.needed, l.aboard).toLocaleString()} aboard` : ''}
                </p>
              </div>
                ))}
              </div>
            ))}
            <BarLegendLine />
          </Card>
        )}
      </Section>

      <Section title="Where to buy it">
        {data.shopping.length === 0 ? (
          <Empty>Set an origin on a build&rsquo;s shopping list to price this run.</Empty>
        ) : (
          <Card>
            {groupByCategory(
              data.shopping.map((r) => ({ ...r, remaining: Number.isFinite(r.toBuy) ? r.toBuy : r.remaining })),
            ).map((group) => (
              <div key={group.category}>
                <p
                  style={{
                    margin: '12px 0 2px',
                    fontSize: '10px',
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: C.orange,
                  }}
                >
                  {group.category}
                </p>
                {group.rows.map((r) => (
                  <ShoppingRow key={r.commodity} row={r} />
                ))}
              </div>
            ))}
          </Card>
        )}
      </Section>
    </div>
  );
}

/**
 * The shopping route — where to fly for what this build still needs.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * "from this section in both the website and the companion app: WHERE THE SQUADRON HAS BOUGHT IT --
 * do not show fleet carriers in here at all! ... should only show materials for the specific project
 * at hand ... only show the closet stations not every station ... dont show duplicate materials ...
 * so we dont have people buying duplicte materials etc and showing up and they already exist etc!"
 *
 * ★ THE HUB DECIDES, THE APP DRAWS ★
 *
 * Every one of those rules is applied server-side: carriers dropped, settled and carrier-held
 * materials removed, and a greedy set cover naming each remaining material at exactly ONE stop. Two
 * surfaces deciding independently which station covers most of a list is two answers to a question
 * that has one, and the owner asked for a mirror rather than a second opinion.
 *
 * So this fetches and draws. If two stops here both listed Steel it would be a fault in the hub, not
 * something to paper over in a renderer.
 */
function PurchaseRoute({ projectId }: { projectId: string }): JSX.Element | null {
  const [route, setRoute] = useState<{
    systemName: string | null;
    stations: readonly PurchaseStation[];
    uncovered: readonly string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /*
   * ★ THE OWNER CHOSE A TOGGLE RATHER THAN AN ANSWER — 2026-08-17 ★
   *
   * Asked whether a squadron station 200 ly away should outrank a neutral one 10 ly away, the
   * answer was to show both orderings and let the member decide — it genuinely depends on the trip.
   * Local state rather than a stored setting: it is a way of reading one list, not a preference
   * about the app, and it costs one tap to change back.
   */
  const [order, setOrder] = useState<'ours' | 'closest'>('ours');

  const load = async (): Promise<void> => {
    const answer = await window.colony.purchases(projectId, order);
    if (answer.ok) {
      setRoute(answer.data);
      setError(null);
    } else {
      setError(answer.error);
    }
  };

  // Re-reads when the ordering changes as well as when the project does: the hub decides the order,
  // so a toggle that only re-sorted what was already here would disagree with it the moment the
  // route had more stops than the cap shows.
  useEffect(() => {
    void load();
  }, [projectId, order]);

  /*
   * ★ A BUILD OUTSIDE THE GATE HAS NO PANEL, AND THAT IS NOT AN ERROR ★
   *
   * The catalogue exists for a system ONE commander is colonising. A system several people post into
   * gets `systemName: null` and the tab renders exactly as it did before this shipped. A refusal
   * sentence here would be describing a rule as a fault.
   */
  if (route !== null && route.systemName === null) return null;

  // A failed first load must not sit on "Loading…" for ever — the hub's own sentence is shown.
  if (error !== null) {
    return (
      <Section title="Where the squadron has bought it">
        <Problem>{error}</Problem>
      </Section>
    );
  }
  if (route === null) return null;

  const covered = route.stations.reduce((n, s) => n + s.lines.length, 0);

  return (
    <Section title="Where the squadron has bought it">
      {route.stations.length === 0 && route.uncovered.length === 0 ? (
        <Empty>
          Nothing bought for this system yet. Anything you buy with this app running appears here on
          its own.
        </Empty>
      ) : null}

      {route.stations.length === 0 ? null : (
        <p style={{ margin: '0 0 10px', fontSize: '11px', color: C.dim }}>
          {/* The point of the panel in one line: each material is named once, so two people reading
              this do not both fly for it. */}
          {covered} {covered === 1 ? 'material' : 'materials'} across {route.stations.length}{' '}
          {route.stations.length === 1 ? 'stop' : 'stops'}. Each is listed at a single station, so
          nobody buys the same thing twice.
        </p>
      )}

      {route.stations.length === 0 ? null : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            margin: '0 0 10px',
            fontSize: '10px',
          }}
        >
          <span style={{ letterSpacing: '0.16em', textTransform: 'uppercase', color: C.dim }}>
            Order
          </span>
          {([['ours', 'Ours first'], ['closest', 'Closest']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setOrder(value)}
              aria-pressed={order === value}
              style={{
                padding: '2px 7px',
                borderRadius: '3px',
                cursor: 'pointer',
                border: order === value ? '1px solid transparent' : `1px solid ${C.hairline}`,
                background: order === value ? C.orange : 'transparent',
                color: order === value ? C.onAccent : C.dim,
                font: 'inherit',
              }}
            >
              {label}
            </button>
          ))}
          <span style={{ color: C.faint }}>
            {order === 'ours'
              ? 'The build’s own system, then the squadron’s stations, then a member’s.'
              : 'Nearest first — ownership only breaks a tie.'}
          </span>
        </div>
      )}

      {route.stations.map((station) => (
        <Card key={`${station.systemName} ${station.stationName}`}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: '4px 16px',
            }}
          >
            <span style={{ fontSize: '13px', color: C.text }}>
              {station.stationName}
              <span style={{ marginLeft: '8px', fontSize: '11px', color: C.dim }}>
                {station.systemName}
              </span>
              {/* The navigable part, copiable for the same reason it is everywhere else: nobody
                  should retype a procedurally generated system name into the galaxy map. */}
              <Copy value={station.systemName} />
            </span>
            <span
              style={{
                fontSize: '10px',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: C.dim,
              }}
            >
              {/*
                Why this stop is where it is. The ordering puts the build's own system first, then
                the squadron's stations, then a member's — and without a word on screen a stop that
                moved to the top just looks like a broken sort. Ordinary stations carry no badge:
                marking every row says nothing, and the absence is what makes a mark worth reading.
              */}
              {station.bandLabel === null ? null : (
                <span
                  style={{
                    marginRight: '8px',
                    padding: '1px 5px',
                    borderRadius: '3px',
                    background: C.raised,
                    color: C.orange,
                  }}
                >
                  {station.bandLabel}
                </span>
              )}
              {/* Distance first: it is what decides whether the stop is worth the trip. Omitted
                  rather than guessed when we cannot place one end of it. */}
              {station.distanceLy === null ? '' : `${station.distanceLy.toFixed(1)} ly · `}
              {station.lines.length} {station.lines.length === 1 ? 'material' : 'materials'}
            </span>
          </div>

          {station.lines.map((line) => (
            <div
              key={line.commodity}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: '2px 16px',
                fontSize: '11px',
                color: C.dim,
                marginTop: '4px',
              }}
            >
              <span style={{ color: C.text }}>
                {line.commodity}
                {line.note === null ? null : (
                  <span style={{ marginLeft: '8px', color: C.dim }}>{line.note}</span>
                )}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {line.tonnes === null ? 'seen here' : `${line.tonnes.toLocaleString()} t`}
                {line.price === null ? '' : ` · ${credits(line.price)}`}
                {line.by === null ? '' : ` · ${line.by}`}
                {/*
                  Said out loud, because the two mean different things. A watched row is what an
                  app saw somebody actually buy; a declared row is somebody's word for it, which
                  can be newer than any purchase and is the only source that can say "it is gone".
                */}
                <span style={{ marginLeft: '8px', fontSize: '10px', color: C.faint }}>
                  {line.source === 'manual' ? 'DECLARED' : 'BOUGHT'}
                </span>
              </span>
            </div>
          ))}
        </Card>
      ))}

      {route.uncovered.length === 0 ? null : (
        <Card>
          {/*
            ★ SAID, NOT OMITTED ★

            A route that quietly leaves these off reads as "this trip gets you everything", and
            somebody flies the whole thing and comes home still needing them. The market suggestions
            below are where to look next, which is why the sentence points there.
          */}
          <p style={{ margin: 0, fontSize: '11px', color: C.dim }}>
            <span style={{ color: C.text }}>
              Nobody has bought{' '}
              {route.uncovered.length === 1 ? 'this one' : `these ${route.uncovered.length}`} yet
            </span>{' '}
            — the market suggestions below are the place to start, and adding the station afterwards
            puts it on this route for everybody else.
          </p>
          <p style={{ margin: '8px 0 0', fontSize: '11px', color: C.text }}>
            {route.uncovered.join(' · ')}
          </p>
        </Card>
      )}

      {adding ? (
        <DeclarePurchase
          projectId={projectId}
          onDone={() => {
            setAdding(false);
            void load();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div style={{ marginTop: '10px' }}>
          <Button onClick={() => setAdding(true)}>Add a station you bought from</Button>
        </div>
      )}
    </Section>
  );
}

/**
 * Telling the squadron where you found something.
 *
 * ★ WHY THIS EXISTS WHEN THE APP ALREADY WATCHES ★
 *
 * The automatic half covers whoever has this app open with trade telemetry on. This covers everybody
 * else, everything bought before they installed it, and the one thing no journal can ever say:
 * "there is thirty thousand tonnes sitting here RIGHT NOW". A purchase is proof somebody took some
 * away; a declaration is a claim about what is still there — the more useful statement, and the only
 * one a person can make.
 *
 * The system is a picker rather than a text box: station names repeat across the galaxy and system
 * names are procedurally generated, so a typo here sends somebody to the wrong side of the bubble.
 */
function DeclarePurchase({
  projectId,
  onDone,
  onCancel,
}: {
  projectId: string;
  onDone: () => void;
  onCancel: () => void;
}): JSX.Element {
  const [commodity, setCommodity] = useState('');
  const [stationName, setStationName] = useState('');
  const [stationSystem, setStationSystem] = useState('');
  const [tonnes_, setTonnes] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = (v: string): number | undefined => {
    const n = Number(v.replace(/[, ]/g, ''));
    return v.trim() === '' || !Number.isFinite(n) || n < 0 ? undefined : Math.trunc(n);
  };

  const ready =
    commodity.trim() !== '' && stationName.trim() !== '' && stationSystem.trim() !== '' && !busy;

  const submit = async (): Promise<void> => {
    setBusy(true);
    const answer = await window.colony.declarePurchase(projectId, {
      commodity,
      stationName,
      stationSystem,
      ...(num(tonnes_) === undefined ? {} : { tonnes: num(tonnes_) as number }),
      ...(num(price) === undefined ? {} : { price: num(price) as number }),
      ...(note.trim() === '' ? {} : { note }),
    });
    setBusy(false);

    // The hub refuses a fleet carrier by name. Its sentence says why, so it is shown rather than
    // replaced with a generic failure the member cannot act on.
    if (!answer.ok) {
      setError(answer.error);
      return;
    }
    onDone();
  };

  return (
    <Card>
      <p style={{ margin: '0 0 8px', fontSize: '11px', color: C.dim }}>
        Anyone building in this system will see it. Leave the tonnage out if you did not check —
        “it is here” is still worth saying.
      </p>

      <Field label="Commodity">
        <input
          style={inputStyle}
          value={commodity}
          placeholder="Steel"
          onInput={(e) => setCommodity((e.target as HTMLInputElement).value)}
        />
      </Field>
      <Field label="Station">
        <input
          style={inputStyle}
          value={stationName}
          placeholder="Armstrong Legacy"
          onInput={(e) => setStationName((e.target as HTMLInputElement).value)}
        />
      </Field>
      <Field label="System it is in">
        {/* Picked, not typed: a mistyped system is an entry that sends somebody to the wrong side
            of the bubble. */}
        <SystemPicker
          value={stationSystem}
          onValueChange={setStationSystem}
          placeholder="System the station is in"
        />
      </Field>
      <Field label="Tonnes seen (optional)">
        <input
          style={inputStyle}
          value={tonnes_}
          inputMode="numeric"
          onInput={(e) => setTonnes((e.target as HTMLInputElement).value)}
        />
      </Field>
      <Field label="Credits per tonne (optional)">
        <input
          style={inputStyle}
          value={price}
          inputMode="numeric"
          onInput={(e) => setPrice((e.target as HTMLInputElement).value)}
        />
      </Field>
      <Field label="Anything the next person should know (optional)">
        <input
          style={inputStyle}
          value={note}
          onInput={(e) => setNote((e.target as HTMLInputElement).value)}
        />
      </Field>

      {error === null ? null : <Problem>{error}</Problem>}

      <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
        <Button disabled={!ready} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Add it'}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}

/** The legend the segmented bars earn — once per list, not once per row. */
function BarLegendLine(): JSX.Element {
  const swatch = (color: string): JSX.CSSProperties => ({
    display: 'inline-block',
    width: '14px',
    height: '4px',
    borderRadius: '999px',
    background: color,
    marginRight: '5px',
    verticalAlign: 'middle',
  });
  return (
    <p style={{ margin: '10px 0 0', fontSize: '10px', color: C.faint, fontFamily: 'var(--font-mono)' }}>
      <span style={swatch(C.cyan)} />
      delivered
      <span style={{ ...swatch(C.warn), marginLeft: '14px' }} />
      aboard attached carriers
      <span style={{ ...swatch(C.subtle), marginLeft: '14px' }} />
      still to source
    </p>
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
  carrierCover,
  canManage,
  isCrew,
  onChanged,
  onOpenRun,
}: {
  projectId: string;
  carriers: readonly AttachedCarrier[];
  needs: readonly ColonyNeed[];
  /** The hub's effective cover per commodity — manual beats journal beats mirror. */
  carrierCover: Readonly<Record<string, number>>;
  canManage: boolean;
  /** Declaring a hold is crew work; the pen is drawn only for members on the roster. */
  isCrew: boolean;
  onChanged: () => void;
  /** Opens the carrier's combined run — see the button below. */
  onOpenRun: (marketId: string) => void;
}): JSX.Element {
  /** What is in the boxes. Six characters, no dash — the dash is drawn, never stored. */
  const [callsign, setCallsign] = useState('');
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
        setCallsign('');
        onChanged();
      } else {
        // The hub's own sentence. "Nobody has reported that carrier's market yet" tells somebody
        // what to do next; "something went wrong" does not.
        setError(a.error);
      }
    });
  };

  const look = (q: string): void => {
    setBusy(true);
    void window.colony.carriers(projectId, q).then((a) => {
      setBusy(false);
      if (a.ok) {
        setMatches(a.data.carriers);
        setError(null);
      } else {
        setError(a.error);
      }
    });
  };

  /*
   * ★ THE HUB'S EFFECTIVE COVER, NOT A LOCAL RE-DERIVATION ★
   *
   * This used to sum the mirror holds, which was two of three sources short: the mirror sees only
   * sell orders, and the declared rows are exactly the cargo that is not on sale. The merge —
   * manual beats journal beats mirror — lives on the hub with the shopping maths, and this
   * headline must agree with the shopping list to the tonne.
   */
  const outstanding = needs.filter((n) => n.remaining > 0);
  const aboard = outstanding.reduce(
    (sum, n) => sum + Math.min(n.remaining, Math.max(0, carrierCover[n.commodity] ?? 0)),
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
                  {/*
                    ★ THE RUN THIS CARRIER IS ACTUALLY ON — SQUADRON OWNER, 2026-08-09 ★

                    A carrier is rarely serving one build. This screen can only answer "what is
                    aboard for THIS one", and adding that answer up across the builds it serves
                    double-counts the hold — the cargo can only be delivered once.

                    One tap from here, rather than something a member has to know exists. The route
                    and the bridge shipped before this button did, which made it a feature nobody
                    could reach — the same shape as three others found in this codebase.
                  */}
                  <Button onClick={() => onOpenRun(c.marketId)}>Combined run</Button>
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
                    : 'Nothing on its market that this build still wants.'}
                </p>
              ) : (
                <div style={{ marginTop: '8px' }}>
                  {c.holds.map((h) => (
                    <Row key={h.commodity} left={h.commodity} right={tonnes(h.tonnes)} />
                  ))}
                </div>
              )}

              <CarrierDeclared
                projectId={projectId}
                carrier={c}
                needs={needs}
                isCrew={isCrew}
                busy={busy}
                act={act}
              />
            </Card>
          ))}
        </>
      )}

      {/*
        ★ FIND IT BY THE ONE NAME ITS OWNER CANNOT CHANGE — SQUADRON OWNER, 2026-08-04 ★

        "can we update this so the input is by the carrier id eg W8K-W1Y ... auto search on
        completion please! ... make this change on both companion app and web app please!"

        Two controls, because there are two questions and one box was answering them badly. The
        boxed callsign is "where is MY carrier"; the button underneath is "which carriers could help
        at all", which is the search that gets used most and is why the blank box existed. Copy and
        behaviour are the website's word for word — see `apps/web/.../carriers.tsx`.
      */}
      <div style={{ marginTop: '16px', borderTop: `1px solid ${C.subtle}`, paddingTop: '14px' }}>
        <CodeBoxes
          label="Carrier ID"
          hint="The six-character ID from the carrier’s contacts panel, like W8K-W1Y. The search runs the moment the sixth character lands."
          value={callsign}
          onChange={(next) => setCallsign(normaliseCallsign(next))}
          onComplete={() => look(formatCallsign(callsign))}
          length={CALLSIGN_LENGTH}
          groupsOf={3}
          disabled={busy}
        />

        <div
          style={{
            marginTop: '14px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <Button
            disabled={busy}
            onClick={() => {
              setCallsign('');
              look('');
            }}
          >
            {busy ? 'Looking…' : 'Show who is carrying most'}
          </Button>
          <span style={{ fontSize: '11px', color: C.faint }}>
            Ranks every carrier we hold a market for by how much of this build’s list is aboard.
          </span>
        </div>
      </div>

      {matches === null ? null : matches.length === 0 ? (
        <p style={{ margin: '10px 0 0', fontSize: '12px', color: C.dim }}>
          {/* Two different facts, and they were one sentence before. A callsign that matched nothing
              is "we have no such carrier"; a blank search that matched nothing is "nobody we can see
              is carrying any of this". */}
          {callsign === ''
            ? 'No carrier we hold a market for is carrying anything this build still wants. A hold can be declared by hand once a carrier is attached.'
            : `We hold no fleet carrier with the ID ${formatCallsign(callsign)}. Check it against the carrier’s contacts panel — a carrier reaches us once somebody has flown near it or docked at it.`}
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
 * "Your carrier is holding 800 t this build needs — attach it?"
 *
 * ★ SQUADRON OWNER, 2026-08-16 ★
 *
 * Asked who should see this and where, the answer was: the carrier's owner, on the project page.
 *
 * ★ WHY IT IS NOT ON THE CARRIERS TAB ★
 *
 * That tab is where somebody goes who already knows a carrier is involved. The whole point of this
 * prompt is the member who does NOT — whose app pushed a manifest days ago and who has never opened
 * that tab. So it sits above the tab content, on every tab, and is the first thing on screen when
 * the answer is yes.
 *
 * ★ AND IT IS ONLY EVER ABOUT THE READER'S OWN CARRIER ★
 *
 * The hub decides that and sends an empty list to everybody else. A carrier nobody has attached is
 * deliberately on no squadron board, so this must never become a way to see inside one.
 *
 * Deliberately the same sentence, the same figures and the same two buttons as the website, because
 * they are one feature on two screens — and the hub does the grouping and the clamping so neither
 * surface can drift into quoting its own number.
 */
function AttachPrompt({
  projectId,
  holdings,
  onChanged,
}: {
  projectId: string;
  holdings: readonly UnattachedHolding[];
  onChanged: () => void;
}): JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * Dismissal lasts as long as this screen is open and is not stored. "Not now" answers the question
   * for now; writing it down would need a table, and the prompt goes for good the moment they
   * attach — which is the resolution it is actually asking for.
   */
  const [hidden, setHidden] = useState<readonly string[]>([]);

  const showing = holdings.filter((h) => !hidden.includes(h.marketId));
  if (showing.length === 0) return null;

  const attach = (marketId: string): void => {
    setBusy(true);
    void window.colony.carrierAdd(projectId, { marketId, isSquadron: false }).then((a) => {
      setBusy(false);
      if (a.ok) {
        setError(null);
        onChanged();
      } else {
        // The hub's own sentence, which names the real condition and the real remedy.
        setError(a.error);
      }
    });
  };

  return (
    <div style={{ marginBottom: '16px' }}>
      {error === null ? null : (
        <div style={{ marginBottom: '8px' }}>
          <Problem>{error}</Problem>
        </div>
      )}

      {showing.map((h) => (
        <div
          key={h.marketId}
          style={{
            border: `1px solid ${C.orange}`,
            background: C.orangeTint,
            borderRadius: '4px',
            padding: '10px 12px',
            marginBottom: '8px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: '10px',
            }}
          >
            <div style={{ margin: 0 }}>
              <p style={{ margin: 0, fontSize: '13px', color: C.text }}>
                <span style={{ color: C.orangeBright }}>{h.name}</span> is holding{' '}
                {tonnes(h.tonnes)} this build needs.
              </p>
              {/*
                ★ "IS HOLDING" IS A CLAIM ABOUT NOW — AUDIT, 2026-08-18 ★

                The reading may be four minutes or a fortnight old and this sentence was identical
                either way. Dated through the same `needsFreshness` the website and the needs table
                use, so one member cannot be told two different things about the same staleness.
              */}
              {(() => {
                const verdict = needsFreshness(
                  h.seenAt === null ? null : new Date(h.seenAt),
                  new Date(),
                );
                return (
                  <p
                    style={{
                      margin: '2px 0 0',
                      fontSize: '11px',
                      color: verdict.warn ? C.warn : C.dim,
                    }}
                  >
                    {verdict.sentence}
                  </p>
                );
              })()}
            </div>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Button tone="primary" disabled={busy} onClick={() => attach(h.marketId)}>
                {busy ? 'Attaching…' : 'Attach it'}
              </Button>
              <Button
                disabled={busy}
                onClick={() => setHidden((prev) => [...prev, h.marketId])}
              >
                Not now
              </Button>
            </span>
          </div>

          {/*
            ★ THE BREAKDOWN, BECAUSE ONE NUMBER IS NOT ENOUGH TO DECIDE ON ★

            "800 t this build needs" could be one commodity the build is desperate for or eight it
            barely wants. A prompt that will not say what it is about is one members learn to dismiss
            without reading.

            Each figure is clamped by the hub to what is OUTSTANDING, so these add up to the headline
            and to what the carriers tab shows once it is attached.
          */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px 14px',
              marginTop: '6px',
            }}
          >
            {h.lines.map((l) => (
              <span key={l.commodity} style={{ fontSize: '11px', color: C.dim }}>
                {l.commodity} <span style={{ color: C.text }}>{tonnes(l.tonnes)}</span>
              </span>
            ))}
          </div>

          <p style={{ margin: '6px 0 0', fontSize: '11px', color: C.faint }}>
            Attaching puts it on this build&rsquo;s carriers tab and takes what is aboard off the
            shopping list. It stays yours, and you can take it off again at any time.
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * The declared hold: what the journals watched and what the crew has typed, per carrier.
 *
 * ★ THE COMPANION IS WHERE THE JOURNAL ROWS COME FROM ★
 *
 * This very app, running on the carrier owner's machine, folds their CargoTransfer events and
 * pushes the reading the `journal` rows show — so a member reading this panel next to the game is
 * often looking at their own wake. Journal rows are read-only with their age; the crew's `manual`
 * rows are the correction path, and a manual ZERO is a real statement that retires a stale figure.
 * The merge the shopping maths reads: manual beats journal beats mirror.
 */
function CarrierDeclared({
  projectId,
  carrier,
  needs,
  isCrew,
  busy,
  act,
}: {
  projectId: string;
  carrier: AttachedCarrier;
  needs: readonly ColonyNeed[];
  isCrew: boolean;
  busy: boolean;
  act: (fn: () => Promise<Answer<unknown>>) => void;
}): JSX.Element | null {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState('');
  const [addTonnes, setAddTonnes] = useState('');

  // Older-hub defense, like every panel here: no `declared` on the wire means none exist yet.
  const declared = carrier.declared ?? [];
  /*
   * ★ THE SAME OMISSION AS THE WEBSITE, AND IT HAD TO BE — 2026-08-17 ★
   *
   * `declared` gained a third source when the carrier poller landed and this split asked for two.
   * A Frontier manifest counted towards the cover — reducing the buy quantity and staging yellow on
   * the bars — while rendering nowhere a member could inspect it, and the "nothing declared yet"
   * fallback could not fire because the list was not empty.
   *
   * Both surfaces had it because both were written from the same two-source assumption, which is
   * the argument for the parity spec that now reads them together.
   */
  /*
   * ★ ONE ROW PER COMMODITY, THE ONE THAT WINS — SQUADRON OWNER, 2026-08-17 ★
   *
   * "its also listing both frontier and journal entries in the Declared hold section ... this should
   * only show the journal entries where possible"
   *
   * Listing both showed the same cargo twice under two labels and invited a member to add them up.
   * Only ONE is ever counted: the merge rule takes whichever spoke most recently, journal winning
   * ties. Frontier's row now appears only where the journal has nothing to say — a cloud player, or
   * cargo loaded before the app was running, which is the case it exists for.
   *
   * Same rule as the website, because they are one board.
   */
  const journal = (() => {
    const byCommodity = new Map<string, (typeof declared)[number]>();
    for (const d of declared) {
      if (d.source === 'manual') continue;
      const held = byCommodity.get(d.commodity);
      if (held === undefined) {
        byCommodity.set(d.commodity, d);
        continue;
      }
      const heldAt = new Date(held.updatedAt).getTime();
      const thisAt = new Date(d.updatedAt).getTime();
      if (thisAt > heldAt || (thisAt === heldAt && d.source === 'journal')) {
        byCommodity.set(d.commodity, d);
      }
    }
    return [...byCommodity.values()];
  })();
  const manual = declared.filter((d) => d.source === 'manual');
  const manualNames = new Set(manual.map((d) => d.commodity));

  const addable = needs
    .filter((n) => n.remaining > 0 && !manualNames.has(n.commodity))
    .map((n) => n.commodity);

  if (!isCrew && declared.length === 0) return null;

  const save = (commodity: string, value: number | null): void =>
    act(() => window.colony.carrierCargoSet(projectId, carrier.marketId, { commodity, tonnes: value }));

  const smallInput: JSX.CSSProperties = {
    ...inputStyle,
    width: '76px',
    padding: '3px 7px',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  };

  return (
    <div style={{ marginTop: '10px', borderTop: `1px solid ${C.hairline}`, paddingTop: '7px' }}>
      <p style={{ ...MONO_SMALL, margin: 0, fontSize: '9px', letterSpacing: '0.18em' }}>
        Declared hold
      </p>

      {declared.length === 0 ? (
        <p style={{ margin: '5px 0 0', fontSize: '11px', color: C.faint }}>
          Nothing declared yet. The owner&rsquo;s companion app fills this as it watches cargo move;
          anything it missed can be typed in below.
        </p>
      ) : (
        <div style={{ marginTop: '5px' }}>
          {journal.map((d) => {
            const overridden = manualNames.has(d.commodity);
            return (
              <div
                key={`${d.source}-${d.commodity}`}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: '8px',
                  padding: '3px 0',
                  fontSize: '12px',
                  color: C.dim,
                }}
              >
                <span>
                  {d.commodity}
                  {/* Named apart because they are not the same claim: Frontier's is the WHOLE
                      manifest and can prove a hold empty, the journal is a floor. */}
                  <span
                    style={{
                      ...MONO_SMALL,
                      marginLeft: '7px',
                      fontSize: '9px',
                      ...(d.source === 'capi' ? { color: C.cyan } : {}),
                    }}
                    title={
                      d.source === 'capi'
                        ? 'Frontier’s own manifest for this carrier — the whole hold, not just what an app watched.'
                        : 'What the owner’s app watched move. A floor: it misses whatever moved while the app was closed.'
                    }
                  >
                    {d.source === 'capi' ? 'frontier' : 'journal'}
                  </span>
                  <span style={{ marginLeft: '7px', fontSize: '10px', color: C.faint }}>
                    {seenAgo(d.updatedAt)}
                  </span>
                  {overridden ? (
                    <span
                      style={{ marginLeft: '7px', fontSize: '10px', color: C.faint }}
                      title="A crew member's figure below outranks this one."
                    >
                      overridden
                    </span>
                  ) : null}
                </span>
                {/* Read-only on purpose: the owner's app reporting what it watched is nobody
                    else's to edit. The correction path is a manual figure below. */}
                <span
                  style={{
                    fontVariantNumeric: 'tabular-nums',
                    ...(overridden ? { textDecoration: 'line-through', opacity: 0.5 } : {}),
                  }}
                >
                  {tonnes(d.tonnes)}
                </span>
              </div>
            );
          })}

          {manual.map((d) => (
            <div
              key={`manual-${d.commodity}`}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                padding: '3px 0',
                fontSize: '12px',
                color: C.dim,
              }}
            >
              <span>
                {d.commodity}
                <span
                  style={{ ...MONO_SMALL, marginLeft: '7px', fontSize: '9px', color: C.orange }}
                >
                  by hand
                </span>
                {d.updatedBy === null ? null : (
                  <span style={{ marginLeft: '7px', fontSize: '10px', color: C.faint }}>
                    {d.updatedBy} · {seenAgo(d.updatedAt)}
                  </span>
                )}
              </span>
              {isCrew ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <input
                    value={drafts[d.commodity] ?? String(d.tonnes)}
                    onInput={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [d.commodity]: (e.target as HTMLInputElement).value,
                      }))
                    }
                    inputMode="numeric"
                    aria-label={`Tonnes of ${d.commodity} aboard ${carrier.name}`}
                    style={smallInput}
                  />
                  <Button
                    disabled={
                      busy || !/^\d+$/.test((drafts[d.commodity] ?? String(d.tonnes)).trim())
                    }
                    onClick={() =>
                      save(d.commodity, Number((drafts[d.commodity] ?? String(d.tonnes)).trim()))
                    }
                  >
                    Save
                  </Button>
                  <Button disabled={busy} onClick={() => save(d.commodity, null)}>
                    Clear
                  </Button>
                </span>
              ) : (
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{tonnes(d.tonnes)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {isCrew ? (
        <div
          style={{
            marginTop: '7px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <select
            value={adding}
            onChange={(e) => setAdding((e.target as HTMLSelectElement).value)}
            aria-label={`Declare a commodity aboard ${carrier.name}`}
            style={{ ...inputStyle, width: 'auto', maxWidth: '210px', padding: '4px 7px' }}
          >
            <option value="">declare a commodity…</option>
            {addable.map((commodity) => (
              <option key={commodity} value={commodity}>
                {commodity}
              </option>
            ))}
          </select>
          <input
            value={addTonnes}
            onInput={(e) => setAddTonnes((e.target as HTMLInputElement).value)}
            inputMode="numeric"
            placeholder="tonnes"
            aria-label="Tonnes aboard"
            style={smallInput}
          />
          <Button
            tone="primary"
            disabled={busy || adding === '' || !/^\d+$/.test(addTonnes.trim())}
            onClick={() => {
              save(adding, Number(addTonnes.trim()));
              setAdding('');
              setAddTonnes('');
            }}
          >
            Declare
          </Button>
          <span style={{ fontSize: '10px', color: C.faint }}>
            zero is a real figure — it says the hold has none
          </span>
        </div>
      ) : declared.length > 0 ? (
        <p style={{ margin: '5px 0 0', fontSize: '10px', color: C.faint }}>
          Join the build&rsquo;s crew to declare or correct these figures.
        </p>
      ) : null}
    </div>
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
  const abandoned = project.abandonedAt !== null;

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

        {/*
          ★ ANY MEMBER, NOT JUST AN OFFICER — SQUADRON OWNER, 2026-08-12 ★

          "someone without the companion app completed a project and it did not update ... this
          causes our members to go buy materials for a project thats completed and not needed."

          `Close this build` below needs permission to DIRECT the project, which on a squadron
          build means an officer. The member who discovers a build is finished is almost never one
          — it is whoever arrived with a full hold and found nothing to deliver to.

          This button matters more in the app than on the website, because that discovery happens
          in the ship, at the pad, with no browser in reach. It closes rather than flags: reversible
          with Reopen, audited against the reporter by name, and announced at once.
        */}
        {closed ? null : (
          <Button
            disabled={busy}
            onClick={() => act(() => window.colony.reportBuilt(project.id))}
          >
            It&rsquo;s already built
          </Button>
        )}

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
          ★ GIVING UP ON A BUILD — SQUADRON OWNER, 2026-08-15 ★

          "we also need to allow admins to mark builds as abandoned and not always just as complete"

          The third ending, because the other two were both false for a build the squadron walked
          away from: left open it keeps asking for materials nobody will haul, and closed it writes
          a station that was never finished into the record the squadron measures itself by.

          `can.manage`, not `mayDirect` — abandoning takes the build off everybody else's board and
          stops work the squadron may have committed playing time to, which was never one member's
          call. The hub checks again; this only decides what to draw.
        */}
        {can.manage ? (
          <Button
            disabled={busy}
            onClick={() => {
              if (abandoned) {
                act(() => window.colony.abandoned(project.id, false));
                return;
              }
              const note = window.prompt(
                'Why is this build being abandoned? The member who posted it will see this.',
                '',
              );
              // Cancelling is the officer changing their mind, not an empty reason.
              if (note === null) return;
              act(() => window.colony.abandoned(project.id, true, note));
            }}
          >
            {abandoned ? 'Bring this build back' : 'Abandon this build'}
          </Button>
        ) : null}

        {/*
          ★ THE SAME QUESTION THE HUB ASKS, NOT A DIFFERENT ONE — AUDIT, 2026-08-18 ★

          The intent above is right — a button that exists in order to be refused teaches people to
          distrust the page — but it asked the wrong thing. The hub refuses when somebody has
          HAULED to the build: "People have already hauled to this build, and deleting it would
          erase their deliveries." This asked whether the site had ever reported a depot.

          Those are different builds. Post a duplicate, or one in the wrong system, wait for the
          site to report what it wants, and `required` stops being zero while `colony_contributions`
          is still empty. The hub would delete it happily; the app hid the button and left the
          member with a build they created, are allowed to remove, and cannot.

          `lastDeliveryAt` is null exactly when nobody has hauled — the hub's own question, asked
          with a fact the board already carries.
        */}
        {mayDirect && (project.lastDeliveryAt ?? null) === null ? (
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
          <SystemPicker
            value={draft.near}
            onValueChange={(next) => setDraft({ ...draft, near: next })}
            placeholder="the build’s own system"
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
  // Older-hub defense, same as the totals above: no `toBuy` on the wire means no cover existed.
  const toBuy = Number.isFinite(row.toBuy) ? row.toBuy : row.remaining;
  const aboard = Number.isFinite(row.onCarriers) ? row.onCarriers : 0;
  const fullyCovered = toBuy === 0;

  const place = fullyCovered
    ? /*
       * ★ FULLY COVERED SAYS SO — IT DOES NOT QUOTE A MARKET ★
       *
       * Naming a station here would send somebody to buy cargo the squadron already owns, which is
       * the exact trip this feature exists to prevent.
       */
      'already aboard the attached carriers — nothing to buy'
    : row.stationName === null
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
          {/* "to buy", not "needed": the carriers are already subtracted, and a figure that quietly
              changed meaning under its old word would be read as the old one. */}
          <span style={{ marginLeft: '8px', fontSize: '11px', color: C.dim }}>
            {tonnes(toBuy)} to buy
          </span>
          {aboard > 0 ? (
            <span
              style={{ marginLeft: '7px', fontSize: '11px', color: C.warn }}
              title="Effective tonnes already aboard the build's attached carriers, subtracted from the quantity to buy."
            >
              {tonnes(aboard)} aboard
            </span>
          ) : null}
        </span>
        <span style={{ fontSize: '12px', color: C.dim }}>
          {fullyCovered ? null : (
            <>
              {row.price === null ? '—' : `${row.price.toLocaleString()} cr/t`}
              {row.supply === null ? '' : ` · ${tonnes(row.supply)} in stock`}
            </>
          )}
          <span style={{ marginLeft: '8px', color: C.text }}>
            {row.cost === null ? '—' : credits(row.cost)}
          </span>
        </span>
      </div>
      {/* The three-segment picture, where the site has stated a total. */}
      {row.required !== null && row.required > 0 ? (
        <div style={{ marginTop: '4px' }}>
          <Bar
            done={Math.max(0, row.required - row.remaining)}
            total={row.required}
            staged={Math.min(row.remaining, aboard)}
          />
        </div>
      ) : null}
      <p
        style={{
          margin: '3px 0 0',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '5px',
          fontSize: '11px',
          color: fullyCovered ? C.good : row.stationName === null ? C.warn : C.faint,
        }}
      >
        <span>{place}</span>
        {/* The system alone, because the galaxy map searches systems — a station name finds nothing. */}
        {fullyCovered || system === undefined || system === null ? null : <Copy value={system} />}
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
                <span style={{ fontSize: '13px', display: 'inline-flex', alignItems: 'baseline', gap: '8px' }}>
                  {m.name}
                  {/*
                    Who is actually ON this build tonight, not merely signed up to it. Your own
                    row says it through the toggle below instead — a marker AND a control saying
                    the same thing would be the page telling you twice.
                  */}
                  {m.current && !m.you ? (
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '9px',
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        color: C.cyan,
                      }}
                    >
                      on this build
                    </span>
                  ) : null}
                </span>
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
        <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          {roster.some((m) => m.you) ? (
            <>
              <Button
                tone="danger"
                disabled={busy}
                onClick={() => void act(() => window.colony.leave(projectId))}
              >
                Leave this build
              </Button>
              {/*
                ★ THE CURRENT BUILD — SQUADRON OWNER, 2026-08-04 ★

                One build per member, held by the hub. This is what the build overlay follows
                wherever the member flies: mark it here and the tracker stays populated three
                systems away, moving as ANY member hauls. Ticking it on another build moves the
                mark — the hub keeps exactly one.
              */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '9px',
                  fontSize: '13px',
                  color: C.dim,
                }}
              >
                <input
                  type="checkbox"
                  checked={roster.some((m) => m.you && m.current)}
                  disabled={busy}
                  onChange={(e) =>
                    void act(() =>
                      (e.target as HTMLInputElement).checked
                        ? window.colony.setCurrent(projectId)
                        : window.colony.clearCurrent(projectId),
                    )
                  }
                />
                This is my current build
              </label>
            </>
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
    /*
     * Checked here, not just by the server: the fields are hand-typed on the manual path, and a
     * round trip to be told "market id required" is a slow way to say something this page already
     * knows. The market id rule is strict digits because a typo in it produces the worst failure
     * this feature has — a project that posts fine and then silently never updates.
     */
    const cleaned = {
      ...form,
      title: form.title.trim(),
      systemName: form.systemName.trim(),
      stationName: form.stationName.trim(),
      marketId: form.marketId.trim(),
      notes: form.notes.trim(),
    };
    if (cleaned.title === '' || cleaned.systemName === '' || cleaned.stationName === '') {
      setError('A project needs a title, a system and a station.');
      return;
    }
    if (!/^\d+$/.test(cleaned.marketId)) {
      setError('The market id is the long number the game reports for the site — digits only.');
      return;
    }

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
      ...cleaned,
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
