/**
 * Colonisation, read from the hub.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "we want the entire colonization module to be visible in the companion app! people should be able
 * to have full interaction with colonization either from the website or from the app."
 *
 * ★ THE HUB IS THE RECORD, ALWAYS ★
 *
 * Nothing here is cached to disk and nothing is computed locally. A project's outstanding needs are
 * assembled from every member's journals, so this machine's view of them is always partial — and a
 * second copy that could disagree with the website is exactly the bug a member would report as "the
 * app says something different" and nobody could reproduce.
 *
 * The app is a window onto the hub. When the hub cannot be reached, it says so rather than showing
 * a stale answer with no date on it.
 */

export interface ColonyProject {
  readonly id: string;
  readonly owner: 'squadron' | 'personal';
  readonly title: string;
  readonly systemName: string;
  readonly stationName: string | null;
  readonly marketId: string;
  readonly notes: string | null;
  /**
   * What the site actually IS, worked out from what it asks for.
   *
   * Not the free-text `buildType` somebody typed — this is the catalogue row the requirement
   * fingerprints to, because a build's bill of materials is twenty-odd commodities at exact
   * tonnages and no two share one. Null until somebody has docked there, and null for a build type
   * we do not hold, which is information rather than a gap.
   *
   * Already on the wire from both doors; the app declared it nowhere and dropped it.
   */
  readonly identified: {
    readonly id: string;
    readonly displayName: string;
    readonly tier: number;
    readonly padSize: string;
    readonly location: string;
    readonly totalTonnes: number;
  } | null;
  readonly isPriority: boolean;
  readonly completedAt: string | null;
  /**
   * When an officer gave up on this build, or null.
   *
   * Separate from `completedAt` because both can be set — a build wrongly called finished and later
   * corrected. `colonyStatusOf` reads this one first so the correction wins.
   */
  readonly abandonedAt: string | null;
  /** Why. The member who posted it is owed a reason their build was closed out from under them. */
  readonly abandonedNote: string | null;
  readonly postedBy: string | null;
  readonly remaining: number;
  readonly required: number;
  readonly needCount: number;
  /**
   * When anybody last hauled here. Null when nobody ever has — which is NOT "stalled": a project
   * posted an hour ago has no deliveries and is perfectly healthy.
   *
   * Optional because an OLDER HUB does not send it; the ranking then treats every build as never
   * delivered to, which is exactly how the board behaved before this existed.
   */
  readonly lastDeliveryAt?: string | null;
  /** The build system's coordinates, for ranking by distance. Null when we cannot place it. */
  readonly coords?: { readonly x: number; readonly y: number; readonly z: number } | null;
}

/** Where the member was last seen, sent with the boards so they can be ranked by distance. */
export interface BoardViewer {
  readonly systemName: string;
  readonly coords: { readonly x: number; readonly y: number; readonly z: number } | null;
  readonly at: string;
  readonly source: string;
}

export interface ColonyNeed {
  readonly commodity: string;
  /**
   * The market's own category — Metals, Technology, Machinery. Null when no market anywhere has
   * ever listed it, which is true of two colonisation commodities.
   *
   * Optional because an OLDER HUB does not send it. The grouping treats a list with no categories
   * as ungroupable and renders flat, which is what the overlay did before this existed — so an app
   * pointed at a hub that predates the field behaves exactly as it used to rather than filing
   * everything under one wrong heading.
   */
  readonly category?: string | null;
  readonly remaining: number;
  readonly required: number | null;
  /**
   * When the site last reported this, which is the only thing that makes the number trustworthy.
   *
   * A needs list is only as current as the last time somebody docked there. Ten minutes old and it
   * is worth planning an evening around; a fortnight old and half of it may already be delivered.
   * Those two look identical without it — which is why storing it and never showing it was worse
   * than not storing it.
   */
  readonly observedAt: string | null;
}

export interface ColonyHauler {
  readonly name: string;
  readonly tonnes: number;
}

export interface ColonyShoppingRow {
  readonly commodity: string;
  /**
   * The market's own category — Metals, Technology, Machinery. Null when no market anywhere has
   * ever listed it, which is true of two colonisation commodities.
   *
   * Optional because an OLDER HUB does not send it. The grouping treats a list with no categories
   * as ungroupable and renders flat, which is what the overlay did before this existed — so an app
   * pointed at a hub that predates the field behaves exactly as it used to rather than filing
   * everything under one wrong heading.
   */
  readonly category?: string | null;

  readonly remaining: number;
  /** The site's total ask, when the journal has given it. What the three-segment bar divides by. */
  readonly required: number | null;
  /**
   * Effective tonnes already aboard the build's attached carriers, capped at `remaining`.
   * The hub computes it (manual beats journal beats mirror); the row's buy maths already
   * subtracts it — see `toBuy`.
   */
  readonly onCarriers: number;
  /** What actually needs buying: max(0, remaining − onCarriers). The quantity every quote uses. */
  readonly toBuy: number;
  readonly stationName: string | null;
  readonly systemName: string | null;
  readonly price: number | null;
  readonly supply: number | null;
  /**
   * When somebody last saw this price.
   *
   * Shown rather than filtered on. Half our market mirror is older than three months, and hiding
   * the stale rows would tell a member "nobody sells this" about commodities on a shelf right now.
   */
  readonly seenAt: string | null;
  readonly cost: number | null;
  /**
   * The nearest place selling this AT ALL, when nothing inside the radius does.
   *
   * "Nobody in range sells this" was true and useless — it said the search failed and nothing about
   * what to do next, on the one line where somebody most needs to be told where to go.
   */
  readonly nearestOutOfRange: {
    readonly stationName: string;
    readonly systemName: string;
    readonly price: number;
    readonly supply: number;
    readonly distance: number | null;
    readonly seenAt: string | null;
  } | null;
}

/** What one carrier is holding of the things a build still wants. */
export interface CarrierHold {
  readonly commodity: string;
  readonly tonnes: number;
  readonly seenAt: string | null;
}

/**
 * What a carrier's hold DECLARES, per commodity — from the owner's journal or a crew member's
 * hand. The mirror sees only sell orders; these rows are the cargo staged for the build.
 */
export interface DeclaredCargo {
  readonly commodity: string;
  readonly tonnes: number;
  /** `journal` rows are the owner's app reporting what it watched; `manual` rows are typed. */
  readonly source: 'journal' | 'manual';
  /** Who typed a manual row. Null for journal rows. */
  readonly updatedBy: string | null;
  readonly updatedAt: string;
}

export interface AttachedCarrier {
  readonly marketId: string;
  readonly name: string;
  readonly callsign: string | null;
  readonly isSquadron: boolean;
  readonly addedBy: string | null;
  /** Where it was when somebody last looked. Null when the mirror has never seen it. */
  readonly systemName: string | null;
  readonly seenAt: string | null;
  readonly holds: readonly CarrierHold[];
  readonly totalTonnes: number;
  /** Journal-watched and hand-declared cargo. The merge rule lives on the hub; see carrierCover. */
  readonly declared: readonly DeclaredCargo[];
}

/** A carrier somebody could attach, ranked by how much of THIS build's list it is carrying. */
export interface CarrierMatch {
  readonly marketId: string;
  readonly name: string;
  readonly systemName: string;
  readonly seenAt: string | null;
  readonly matchingCommodities: number;
  readonly matchingTonnes: number;
}

export interface ColonyRights {
  readonly post: boolean;
  readonly manage: boolean;
  readonly publish: boolean;
}

export interface HubCall {
  readonly apiBaseUrl: string;
  readonly deviceToken: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * GETs currently in flight, keyed by their full URL.
 *
 * ★ THE APP'S OWN SHARE OF THE OUTAGE OF 2026-08-06 ★
 *
 * The hub's log showed NINE GETs for the same colonisation project inside three hundred
 * milliseconds, sustained, from this app. Each made the hub price every commodity in the build.
 * Response times went 667ms → 14,646ms, the hub's whole database connection pool went to that one
 * route, and the squadron owner reported the companion would not connect at all.
 *
 * It would not connect because it was the thing preventing it. Every timeout produced another
 * attempt and every attempt made the next timeout likelier — the app was its own denial of
 * service.
 *
 * The hub now coalesces and sheds load, so this can no longer hurt anybody else. This is the other
 * half: not asking nine times to begin with.
 *
 * Module scope rather than per-call: the whole point is that callers who do not know about each
 * other still share one request.
 */
const inFlight = new Map<string, Promise<Answer<unknown>>>();

/**
 * One request to the companion's colonisation surface.
 *
 * ★ EVERY FAILURE BECOMES A SENTENCE, NOT AN EXCEPTION ★
 *
 * The renderer draws whatever this returns. A thrown error there is a blank panel with no
 * explanation — the member sees an empty screen and cannot tell "you are not allowed" from "your
 * internet is down", which are the two things they most need told apart.
 */
export async function hubColony<T>(
  call: HubCall,
  path: string,
  /*
   * A DELETE carries no body, and that is not a detail — Fastify REFUSES a request that declares
   * `content-type: application/json` and then sends nothing, with a 400 that reads like a server
   * fault. So the header is attached to the body, not to the method.
   */
  init?: { method: 'POST' | 'PATCH' | 'DELETE'; body?: unknown },
): Promise<Answer<T>> {
  if (call.deviceToken === '') return { ok: false, error: 'Pair this device first.' };

  const url = `${call.apiBaseUrl.replace(/\/+$/, '')}/v1/companion/colony${path}`;

  /*
   * ★ READS ARE SHARED; WRITES NEVER ARE ★
   *
   * Two members joining a project, or one member pressing a button twice, are two events. Sharing
   * a POST would silently drop one — and unlike a slow read, a dropped write is invisible until
   * somebody notices the delivery they logged is missing.
   */
  const method = init?.method ?? 'GET';
  if (method === 'GET') {
    const joined = inFlight.get(url);
    if (joined !== undefined) return joined as Promise<Answer<T>>;
  }

  const run = async (): Promise<Answer<T>> => {
  const doFetch = call.fetchImpl ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), call.timeoutMs ?? 15_000);

  try {
    const res = await doFetch(`${call.apiBaseUrl.replace(/\/+$/, '')}/v1/companion/colony${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        authorization: `Bearer ${call.deviceToken}`,
        ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: ac.signal,
    });

    if (res.status === 401) return { ok: false, error: 'This device is no longer paired.' };
    if (res.status === 403) {
      /*
       * Distinguished from 401 on purpose. "Not paired" is fixed by pairing; "not allowed" is fixed
       * by an officer granting a permission. Telling a member to re-pair when the real answer is
       * that their rank cannot post projects sends them round a loop that cannot help.
       */
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return {
        ok: false,
        error: body?.error?.message ?? 'Your rank does not have access to colonisation.',
      };
    }

    if (!res.ok) {
      // The hub's own message when it sent one — it is written for a member and is better than
      // anything this layer could invent from a status code.
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, error: body?.error?.message ?? `The hub answered ${res.status}.` };
    }

    const data = (await res.json().catch(() => null)) as T | null;
    if (data === null) return { ok: false, error: 'The hub sent something we could not read.' };

    return { ok: true, data };
  } catch (error) {
    /*
     * Abort is the timeout, and it is worth naming: "the hub did not answer" tells a member to
     * check their connection, where a generic failure tells them nothing at all.
     */
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? 'The hub did not answer in time.'
        : 'Could not reach the hub. Check your connection.',
    };
  } finally {
    clearTimeout(timer);
  }
  };

  if (method !== 'GET') return run();

  /*
   * Cleared as soon as it settles, so this is DEDUPE and not a cache. Holding the entry after the
   * answer arrived would mean a member pressing refresh sees the same numbers for ever, which
   * trades one bug report for a worse one.
   */
  const flight = run().finally(() => {
    inFlight.delete(url);
  }) as Promise<Answer<unknown>>;
  inFlight.set(url, flight);
  return flight as Promise<Answer<T>>;
}


/**
 * ★ THE PLANNER, IN THE APP — SQUADRON OWNER, 2026-08-03 ★
 *
 * "ensure the Companion app matches and has all the same pages in colonization that the website
 * has please! must be a mirror!"
 *
 * Same shapes the website reads, because they come off the same routes. Declared here rather than
 * imported from the web app: the two do not share a package, and a copy that the compiler checks
 * against real responses is safer than a dependency edge between two apps that ship separately.
 */
export interface PlanBody {
  bodyId: number;
  name: string;
  kind: string;
  subType: string | null;
  isLandable: boolean;
  gravity: number | null;
  temperature: number | null;
  distanceLs: number | null;
  hasRings: boolean;
  terraformable: boolean;
  hasVolcanism: boolean;
  hasAtmosphere: boolean;
  /** What this orbits, so a moon draws under its planet. Null for the primary star. */
  parentBodyId: number | null;
  orbitalSlots: number | null;
  surfaceSlots: number | null;
  slotsBy: string | null;
}

/** One intended build, in one slot, on one body. */
export interface PlanSite {
  id: string;
  bodyId: number | null;
  location: 'orbital' | 'surface';
  buildTypeId: string | null;
  buildTypeName: string | null;
  tier: number | null;
  totalTonnes: number | null;
  /** What this feeds into the port that receives it. `none` when it feeds nothing. */
  economyInfluence: string | null;
  position: number;
  /** The system's first station. The game charges nothing for it. */
  isPrimary: boolean;
  projectId: string | null;
  /**
   * What the project this site became actually reports. Null until it has been placed and posted.
   *
   * The plan's own `totalTonnes` is a catalogue ESTIMATE; these are MEASURED off a commander's
   * journal. Optional because an older hub does not send it, in which case every site reads as
   * planned — exactly how the page behaved before this existed.
   */
  project?: { required: number; remaining: number; completedAt: string | null } | null;
}

/**
 * What the construction-point rules say about a plan.
 *
 * Computed on the SERVER, by the same module the website's answer comes from. Two implementations
 * of a rule this fiddly would drift, and the half that drifted would be the one deciding whether a
 * fortnight of hauling is legal.
 */
export interface PlanSimStep {
  siteId: string;
  buildTypeId: string | null;
  spend: { tier: number; points: number } | null;
  /** How much of the spend is the surcharge on extra starports. Zero when untaxed. */
  surcharge: number;
  earn: { tier: number; points: number } | null;
  /** The balance AFTER this step. Negative means the plan cannot reach here. */
  tier2: number;
  tier3: number;
  isPrimary: boolean;
  problems: PlanProblem[];
}

export interface PlanProblem {
  kind: 'points' | 'prerequisite' | 'unchosen';
  message: string;
}

export interface PlanEffects {
  population: number;
  maxPopulation: number;
  security: number;
  technology: number;
  wealth: number;
  standardOfLiving: number;
  development: number;
}

/** One adjustment the economy model made, and why. */
export interface EconAudit {
  economy: string;
  delta: number;
  reason: string;
}

export interface SiteEconomy {
  siteId: string;
  buildTypeId: string | null;
  /** Only starports and outposts trade. Everything else FEEDS one. */
  receivesLinks: boolean;
  isReceiver: boolean;
  scores: Record<string, number>;
  leading: string | null;
  audit: EconAudit[];
  strongLinks: string[];
  weakLinks: string[];
}

export interface PlanEconomies {
  sites: SiteEconomy[];
  /** Inputs the game uses that we do not hold. Printed, never hidden. */
  blindSpots: string[];
}

/**
 * What the system BECOMES if the order is built — the result the build books lead with and the
 * planner did not show. Mirrors `PlanEconomy` in @grims/shared; the server computes it.
 */
export interface PlanEconomyView {
  /** Every economy the order votes for, and how many builds vote for it. Ranked, highest first. */
  counts: Record<string, number>;
  /** What the system becomes. Null when nothing in the order carries an economy. */
  primary: string | null;
  /** The runner-up. Null when only one economy votes, or when the economy is locked. */
  secondary: string | null;
  /** True when the OPENING build fixed the economy permanently. */
  locked: boolean;
  /** Which build did the locking, so the warning can name it. */
  lockedBy: string | null;
}

export interface PlanSimulation {
  steps: PlanSimStep[];
  tier2: number;
  tier3: number;
  problems: PlanProblem[];
  effects: PlanEffects;
  economy: PlanEconomyView;
  surchargedPorts: number;
}

/** One line of a predicted market: what the station would trade, and which economy put it there. */
export interface PredictedCommodityLine {
  commodity: string;
  side: 'exports' | 'imports';
  /** Bold on the page: the driving economy is at least half the leading score. */
  strength: 'major' | 'minor';
  fromEconomy: string;
}

/**
 * What a planned station's market would buy and sell — the step past the economy adjective.
 * Computed on the SERVER by the shared predictMarket, exactly like the simulation, so the website
 * and this app cannot show two different shops for one plan.
 */
export interface PredictedSiteMarket {
  exports: PredictedCommodityLine[];
  imports: PredictedCommodityLine[];
  /** The honest epistemics, in one sentence, rendered once per page. */
  note: string;
}

export interface PlanSiteMarket {
  siteId: string;
  market: PredictedSiteMarket;
}

/*
 * ★ SUBPATH, NOT THE BARREL ★
 *
 * `@grims/shared` resolves to a barrel that reaches `node:crypto`, which cannot be bundled into the
 * renderer. The economy view is exported on its own path for exactly this.
 */
import type { SystemTrade, SelfSufficiency } from '@grims/shared/colony-economy-view';

export interface ColonyPlan {
  id: string;
  owner: 'squadron' | 'personal';
  title: string;
  systemName: string;
  systemId64: string | null;
  notes: string | null;
  /** Optimistic concurrency. Every write carries the version it started from. */
  version: number;
  postedBy: string | null;
  postedById: string;
  updatedAt: string;
  bodies: PlanBody[];
  bodiesFetchedAt: string | null;
  sites: PlanSite[];
  simulation: PlanSimulation;
  /**
   * A better build order and what it saves, when there is one worth showing.
   *
   * Decided by the hub, exactly like the simulation beside it — the website and this app both draw
   * it, and two implementations of the rule would drift. Optional so an app built before this
   * shipped keeps working against a newer hub.
   */
  suggestion?: OrderSuggestion;
  economies: PlanEconomies;
  /** Per chosen site, what its market would trade. Empty on the board — bodies are not loaded there. */
  markets: PlanSiteMarket[];
  /**
   * What the WHOLE system would trade, rolled up from the per-site markets above.
   *
   * ★ THE HUB HAS ALWAYS SENT THESE — SQUADRON OWNER, 2026-08-11 ★
   *
   * "ensure the Companion app matches and has all the same pages in colonization that the website
   * has please! must be a mirror!"
   *
   * The device route is the website's route with the door changed: same `ColonyPlanService`, same
   * `byId`, same payload. These three fields were in it from the day the economy tab shipped and
   * this interface simply never named them, so the app quietly dropped them on the floor and the
   * tab rendered two of its five sections.
   *
   * Optional because an app is not redeployed the instant the hub is — a companion built before
   * this must keep working against a newer hub, and a newer app must survive an older one.
   */
  trade?: SystemTrade;
  /** How much of its own outstanding bill the system would cover. Tonnage, not commodity count. */
  selfSufficiency?: SelfSufficiency;
  /** What the GALAXY pays for the traded commodities — never a claim about these stations. */
  prices?: CommodityPrice[];
}

/**
 * What the galaxy currently pays for one commodity, across the markets we hold.
 *
 * Deliberately not a prediction about the member's own station: what a station pays moves with its
 * supply, demand and economy strength, none of which the simulation models. Showing the galaxy's
 * figure is honest and useful; inventing this station's would be a guess wearing a figure's
 * clothes, and a wrong price sends somebody on a worthless run.
 */
export interface CommodityPrice {
  readonly commodity: string;
  readonly avgSell: number | null;
  readonly avgBuy: number | null;
  readonly sellMarkets: number;
}

/** A proposed build order, the tonnage it saves, and whether it is worth reading. */
export interface OrderSuggestion {
  /** Site ids, always a permutation of the plan's own. Sent verbatim to the reorder call. */
  readonly order: string[];
  /** Step index where an economy build first lands, in each order. Null when there is none. */
  readonly firstEconomyAt: { current: number | null; suggested: number | null };
  /** Tonnage hauled before that step, in each order — the number that makes the case. */
  readonly tonnesBefore: { current: number; suggested: number };
  readonly worthIt: boolean;
}

export const colonyProjects = (
  call: HubCall,
): Promise<Answer<{ projects: ColonyProject[]; can: ColonyRights; you?: BoardViewer | null }>> =>
  hubColony(call, '/projects');

/**
 * One project, with its shopping list answered the way the member asked.
 *
 * ★ THE APP COULD ONLY EVER SEE THE DEFAULT ANSWER ★
 *
 * The device route has accepted `near`, `withinLy`, `sort` and `largePad` since the day the website
 * got those controls, and this function sent none of them — so the app's Where-to-buy tab was
 * permanently pinned to "local, 100 ly, any pad, measured from the build". A member in the app
 * could not ask the question the website answers, and had no way to tell that they could not.
 */
export interface ShoppingFilters {
  /** Measure from here instead of the build's own system. Empty means the build. */
  readonly near: string;
  readonly withinLy: number;
  readonly sort: 'local' | 'cheapest' | 'closest';
  readonly largePadOnly: boolean;
}

export const DEFAULT_SHOPPING: ShoppingFilters = {
  near: '',
  withinLy: 100,
  sort: 'local',
  largePadOnly: false,
};

export const colonyProject = (
  call: HubCall,
  id: string,
  filters: ShoppingFilters = DEFAULT_SHOPPING,
): Promise<
  Answer<{
    project: ColonyProject;
    needs: ColonyNeed[];
    haulers: ColonyHauler[];
    shopping: ColonyShoppingRow[];
    carriers: AttachedCarrier[];
    /**
     * Effective tonnes aboard the attached carriers per commodity — manual beats journal beats
     * mirror, summed across carriers. What the three-segment bars stage in yellow.
     */
    carrierCover: Record<string, number>;
    /** Echoed so the tab can say where it measured from — a distance with no origin is uncheckable. */
    shoppingFrom: string | null;
    shoppingSort: string;
    can: { manage: boolean; isPoster: boolean; isCrew: boolean };
  }>
> => {
  const q = new URLSearchParams({
    withinLy: String(filters.withinLy),
    sort: filters.sort,
    ...(filters.near.trim() === '' ? {} : { near: filters.near.trim() }),
    ...(filters.largePadOnly ? { largePad: '1' } : {}),
  });
  return hubColony(call, `/projects/${encodeURIComponent(id)}?${q.toString()}`);
};

/**
 * The shopping ROUTE — where to fly for what this build still needs.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * "the stations shown where weve bought it from should only show materials for the specific project
 * at hand ... only show the closet stations not every station ... dont show duplicate materials ...
 * so we dont have people buying duplicte materials etc and showing up and they already exist etc!"
 *
 * Every one of those rules is applied by the hub, so this app and the website cannot disagree about
 * where nineteen people should fly. Two surfaces deciding independently which stop covers most of a
 * list is two answers to a question that has one.
 *
 * `systemName` is null when this build's system has more than one commander posting into it — that
 * is not an error, it is a build with no private catalogue, and the tab simply omits the panel.
 */
export interface PurchaseLine {
  readonly commodity: string;
  readonly category: string | null;
  readonly tonnes: number | null;
  readonly price: number | null;
  readonly source: 'journal' | 'manual';
  readonly by: string | null;
  readonly at: string;
  readonly note: string | null;
}

export interface PurchaseStation {
  readonly stationName: string;
  /** The STATION's own system — what a member pastes into the galaxy map. Never the build's. */
  readonly systemName: string;
  /** Light years from the build. Null when we cannot place one end of it. */
  readonly distanceLy: number | null;
  readonly lines: readonly PurchaseLine[];
  readonly lastSeen: string;
}

/**
 * "Read my plan and tell me what is wrong with it."
 *
 * The model is handed only what the simulation worked out and told to invent nothing. `facts` is
 * exactly what it was given, so a review that looks wrong can be traced to bad data or a bad
 * sentence — and `unavailable` is set when there was nothing to review or the AI could not be
 * reached, in which case the facts are still worth reading.
 */
export const colonyPlanReview = (
  call: HubCall,
  id: string,
): Promise<Answer<{ review: string; facts: string; unavailable: string | null }>> =>
  hubColony(call, `/plans/${encodeURIComponent(id)}/review`, { method: 'POST', body: {} });

export const colonyPurchases = (
  call: HubCall,
  id: string,
): Promise<
  Answer<{
    systemName: string | null;
    stations: PurchaseStation[];
    /** Still needed, and on no stop of the route. Shown rather than quietly left off. */
    uncovered: string[];
  }>
> => hubColony(call, `/projects/${encodeURIComponent(id)}/purchases`);

/** Recording a station somebody actually bought at. Refused for fleet carriers, which move. */
export const colonyDeclarePurchase = (
  call: HubCall,
  id: string,
  body: {
    commodity: string;
    stationName: string;
    stationSystem: string;
    tonnes?: number;
    price?: number;
    note?: string;
  },
): Promise<Answer<{ ok: true }>> =>
  hubColony(call, `/projects/${encodeURIComponent(id)}/purchases`, { method: 'POST', body });

/** The project for the site the member is docked at, if the squadron holds one. */
export const colonyAtMarket = (
  call: HubCall,
  marketId: string,
): Promise<Answer<{ project: ColonyProject | null; needs: ColonyNeed[] }>> =>
  hubColony(call, `/at/${encodeURIComponent(marketId)}`);

/** Somebody on a build, with what they have taken on and what they have actually delivered. */
export interface RosterEntry {
  readonly userId: string;
  readonly name: string;
  readonly joinedAt: string;
  readonly assignments: ReadonlyArray<{
    readonly id: string;
    readonly commodity: string;
    readonly tonnes: number | null;
    /** True when somebody else put this on them, rather than them claiming it. */
    readonly assigned: boolean;
  }>;
  readonly delivered: number;
  /** True for your own row. Decided by the hub — the app holds a device token, not a user id. */
  readonly you: boolean;
  /**
   * True when this build is the one the member has marked as their current effort.
   *
   * One per member, held by the hub — it is what keeps the build overlay populated wherever they
   * fly, and the roster shows it so a crew can see who is actually ON this build tonight rather
   * than merely signed up to it.
   */
  readonly current: boolean;
}

export const colonyRoster = (
  call: HubCall,
  id: string,
): Promise<Answer<{ roster: RosterEntry[] }>> =>
  hubColony(call, `/projects/${encodeURIComponent(id)}/roster`);

export const colonyJoin = (call: HubCall, id: string): Promise<Answer<{ ok: true }>> =>
  hubColony(call, `/projects/${encodeURIComponent(id)}/join`, { method: 'POST', body: {} });

export const colonyLeave = (call: HubCall, id: string): Promise<Answer<{ ok: true }>> =>
  hubColony(call, `/projects/${encodeURIComponent(id)}/leave`, { method: 'POST', body: {} });

/**
 * Marking and clearing the member's CURRENT build — the one the overlay follows everywhere.
 *
 * The hub holds the choice, not this machine: a member who marks a build on their desktop and
 * flies on their laptop should find the overlay already following it, and only a server-side
 * record can make that true.
 */
export const colonySetCurrent = (call: HubCall, id: string): Promise<Answer<{ ok: true }>> =>
  hubColony(call, `/projects/${encodeURIComponent(id)}/current`, { method: 'POST', body: {} });

export const colonyClearCurrent = (call: HubCall, id: string): Promise<Answer<{ ok: true }>> =>
  hubColony(call, `/projects/${encodeURIComponent(id)}/current`, { method: 'DELETE' });

/**
 * The member's current build, with the WHOLE project's state.
 *
 * This is what the build overlay draws when the member is away from the site: everyone's
 * deliveries folded in by the hub, not just this machine's own journal — so the numbers move as
 * ANY member hauls.
 */
export interface CurrentBuild {
  readonly projectId: string;
  readonly title: string;
  readonly systemName: string;
  readonly stationName: string | null;
  readonly marketId: string;
  readonly isPriority: boolean;
  readonly progress: { readonly delivered: number; readonly required: number };
  readonly needs: readonly ColonyNeed[];
  readonly haulers: readonly ColonyHauler[];
  /**
   * What the attached fleet carriers are holding of this build's materials.
   *
   * Squadron owner, 2026-08-15: the overlay must show "what is in player cargo holds vs what it
   * actually in assigned fleet carrier holds". The member's own hold the app reads from Cargo.json
   * on their own machine; the carriers only the hub knows.
   *
   * Optional because an older hub does not send it, and a required field would make the overlay
   * fail to parse a payload it could otherwise use most of.
   */
  readonly carrierHolds?:
    | ReadonlyArray<{ commodity: string; tonnes: number; carrier: string }>
    | undefined;
}

export const colonyCurrent = (
  call: HubCall,
): Promise<Answer<{ current: CurrentBuild | null }>> => hubColony(call, '/current');

/** Claim a commodity, or — with `userId` — put one on somebody else. */
export const colonyAssign = (
  call: HubCall,
  id: string,
  body: { commodity: string; tonnes?: number; userId?: string },
): Promise<Answer<{ ok: true }>> =>
  hubColony(call, `/projects/${encodeURIComponent(id)}/assign`, { method: 'POST', body });

export const colonyUnassign = (
  call: HubCall,
  id: string,
  body: { commodity: string; userId?: string },
): Promise<Answer<{ ok: true }>> =>
  hubColony(call, `/projects/${encodeURIComponent(id)}/unassign`, { method: 'POST', body });

/** What a completed build of this kind does to its system — the seven Raven-style scalars. */
export interface BuildTypeEffects {
  readonly population: number;
  readonly maxPopulation: number;
  readonly security: number;
  readonly technology: number;
  readonly wealth: number;
  readonly standardOfLiving: number;
  readonly development: number;
}

/** One kind of construction site, and what it costs to build. */
export interface BuildTypeRow {
  readonly id: string;
  readonly displayName: string;
  readonly category: string;
  readonly tier: number;
  readonly location: 'orbital' | 'surface';
  readonly padSize: 'none' | 'small' | 'medium' | 'large';
  readonly totalTonnes: number;
  readonly commodities: number;
  /**
   * `community` or `observed`.
   *
   * Frontier publishes none of these figures. Every one is either somebody's gathered number or a
   * measurement from one of our own builds, and a member deciding whether to commit a fortnight of
   * hauling deserves to know which.
   */
  readonly source: 'community' | 'observed';
  readonly confirmations: number;
  /** What finishing one does to the system. Community-measured, like everything here. */
  readonly effects: BuildTypeEffects;
  /** What it feeds the port that receives it. `none` for the many that feed nothing. */
  readonly economyInfluence: string;
  /** Set when the build's OWN economy is locked regardless of surroundings. */
  readonly economyFixed: string | null;
}

export interface BuildCostLine {
  readonly commodity: string;
  readonly tonnes: number;
  readonly price: number | null;
  readonly stationName: string | null;
  readonly systemName: string | null;
  readonly distance: number | null;
  readonly cost: number | null;
}

export interface BuildTypeDetail extends BuildTypeRow {
  readonly layouts: readonly string[];
  readonly costs: readonly BuildCostLine[];
  readonly total: number;
  readonly unsourced: number;
}

export const colonyBuildTypes = (
  call: HubCall,
): Promise<Answer<{ buildTypes: BuildTypeRow[] }>> => hubColony(call, '/build-types');

export const colonyBuildType = (
  call: HubCall,
  id: string,
  near: string,
): Promise<
  Answer<{
    buildType: BuildTypeDetail;
    origin: { system: string } | null;
    unknownSystem: string | null;
  }>
> =>
  hubColony(
    call,
    `/build-types/${encodeURIComponent(id)}${near === '' ? '' : `?near=${encodeURIComponent(near)}`}`,
  );

export const postColonyProject = (
  call: HubCall,
  body: {
    owner: 'squadron' | 'personal';
    marketId: string;
    systemName: string;
    stationName: string;
    title: string;
    notes: string;
    /** The depot reading the member can already see, so the project lands with its progress known. */
    snapshot?: {
      resources: ReadonlyArray<{ commodity: string; required: number; provided: number }>;
    };
  },
): Promise<Answer<{ id: string }>> =>
  hubColony(call, '/projects', { method: 'POST', body });

/** Every plan the member may see, squadron and personal together. */
export const colonyPlans = (call: HubCall): Promise<Answer<{ plans: ColonyPlan[] }>> =>
  hubColony(call, '/plans');

export const colonyPlan = (
  call: HubCall,
  id: string,
): Promise<Answer<{ plan: ColonyPlan; can: { edit: boolean } }>> =>
  hubColony(call, `/plans/${encodeURIComponent(id)}`);

export const createColonyPlan = (
  call: HubCall,
  body: { owner: 'squadron' | 'personal'; title: string; systemName: string },
): Promise<Answer<{ id: string }>> => hubColony(call, '/plans', { method: 'POST', body });

/**
 * Slot counts, read off the in-game architect view.
 *
 * Keyed on the SYSTEM and the BODY rather than on the plan, because that is what it is: a fact
 * about the galaxy. Two plans for the same system see the same numbers, and the second person to
 * fly there does not have to type them again.
 */
export const setPlanSlots = (
  call: HubCall,
  systemId64: string,
  bodyId: number,
  body: { orbital: number | null; surface: number | null },
): Promise<Answer<{ ok: true }>> =>
  hubColony(call, `/plans/bodies/${encodeURIComponent(systemId64)}/${bodyId}`, {
    method: 'PATCH',
    body,
  });

export const addPlanSite = (
  call: HubCall,
  id: string,
  body: {
    version: number;
    bodyId: number | null;
    location: 'orbital' | 'surface';
    buildTypeId: string | null;
  },
): Promise<Answer<{ version: number }>> =>
  hubColony(call, `/plans/${encodeURIComponent(id)}/sites`, { method: 'POST', body });

export const removePlanSite = (
  call: HubCall,
  id: string,
  siteId: string,
  version: number,
): Promise<Answer<{ version: number }>> =>
  hubColony(
    call,
    `/plans/${encodeURIComponent(id)}/sites/${encodeURIComponent(siteId)}?version=${version}`,
    { method: 'DELETE' },
  );

/** The whole build order at once, which is what the up and down buttons send. */
export const reorderPlan = (
  call: HubCall,
  id: string,
  body: { version: number; siteIds: string[] },
): Promise<Answer<{ version: number }>> =>
  hubColony(call, `/plans/${encodeURIComponent(id)}/order`, { method: 'PATCH', body });

export const removeColonyPlan = (call: HubCall, id: string): Promise<Answer<{ ok: true }>> =>
  hubColony(call, `/plans/${encodeURIComponent(id)}`, { method: 'DELETE' });

/**
 * Fleet carriers on a build.
 *
 * The hold is read from the market mirror rather than from anybody's journal — a carrier's market
 * is public, so this sees every squadron carrier rather than only the one whose owner has the app
 * open. See the note at the top of the API's carrier service.
 */
export const colonyCarrierSearch = (
  call: HubCall,
  id: string,
  q: string,
): Promise<Answer<{ carriers: CarrierMatch[] }>> =>
  hubColony(call, `/projects/${encodeURIComponent(id)}/carriers?q=${encodeURIComponent(q)}`);

/**
 * One carrier's whole run: every build it serves, added up once.
 *
 * ★ SQUADRON OWNER, 2026-08-09 ★
 *
 * "an aggregated total of all materials needed to get all the builds completed if i am buying and
 * storing on a fleet carrier"
 *
 * ★ WHY THE APP NEEDS THIS MORE THAN THE WEBSITE DOES ★
 *
 * The website is where the run gets planned. The app is what is open while it is being flown, beside
 * the commodity market somebody is standing in — which is the moment the question "how much of this
 * do I actually need" gets asked.
 *
 * ★ AND WHY THE NUMBER DIFFERS FROM THE PROJECT SCREENS ★
 *
 * A carrier holds ONE hold. Each build it serves reports the whole of that hold as its own cover,
 * correctly, because each is answering "what do the carriers attached to me hold". Opening three
 * builds and adding them counts the same cargo three times. This subtracts it once. Same server
 * method the website calls, so the two surfaces cannot disagree.
 */
export interface CarrierManifestLine {
  commodity: string;
  /** Summed across every build this carrier serves. */
  needed: number;
  /** Aboard this carrier — counted once, however many builds want it. */
  aboard: number;
  toBuy: number;
}

export const colonyCarrierManifest = (
  call: HubCall,
  marketId: string,
  opts: { near?: string; withinLy?: number; largePad?: boolean; sort?: string } = {},
): Promise<
  Answer<{
    carrier: { marketId: string; name: string; callsign: string | null };
    projects: Array<{ id: string; title: string; systemName: string }>;
    lines: CarrierManifestLine[];
    shopping: ColonyShoppingRow[];
  }>
> => {
  const q = new URLSearchParams();
  if (opts.near !== undefined && opts.near.trim() !== '') q.set('near', opts.near.trim());
  if (opts.withinLy !== undefined) q.set('withinLy', String(opts.withinLy));
  if (opts.largePad === true) q.set('largePad', '1');
  if (opts.sort !== undefined) q.set('sort', opts.sort);

  const qs = q.toString();
  return hubColony(
    call,
    `/carriers/${encodeURIComponent(marketId)}/manifest${qs === '' ? '' : `?${qs}`}`,
  );
};

export const attachCarrier = (
  call: HubCall,
  id: string,
  body: { marketId: string; isSquadron: boolean },
): Promise<Answer<{ marketId: string }>> =>
  hubColony(call, `/projects/${encodeURIComponent(id)}/carriers`, { method: 'POST', body });

export const detachCarrier = (
  call: HubCall,
  id: string,
  marketId: string,
): Promise<Answer<{ ok: true }>> =>
  hubColony(
    call,
    `/projects/${encodeURIComponent(id)}/carriers/${encodeURIComponent(marketId)}`,
    { method: 'DELETE' },
  );

/**
 * The app's own reading of the member's carrier hold, pushed whenever it changes.
 *
 * Not tied to any project: the hub knows which builds the carrier is attached to, and quietly
 * ignores one that is attached to none. The app's only job is to say what it watched.
 */
export const pushCarrierCargo = (
  call: HubCall,
  body: {
    marketId: string;
    commodities: ReadonlyArray<{ commodity: string; tonnes: number }>;
    /**
     * The game's own total tonnage aboard, when the member has opened carrier management.
     *
     * Sent beside the witnessed commodities rather than folded into them: the hub needs both to
     * say "watched this much of that much", and a total mixed into the list would be one more
     * commodity called Everything.
     */
    totalTonnes?: number | null;
    totalAt?: string | null;
  },
): Promise<Answer<{ stored: boolean }>> =>
  hubColony(call, '/carrier-cargo', { method: 'POST', body });

/**
 * Sets or clears a MANUAL tonnage on an attached carrier — the crew's own hand, for whatever the
 * journals missed. `tonnes: null` clears the override; zero is a real figure ("none aboard").
 * Crew members only; the hub is where that is decided.
 */
export const setCarrierCargo = (
  call: HubCall,
  id: string,
  marketId: string,
  body: { commodity: string; tonnes: number | null },
): Promise<Answer<{ ok: true }>> =>
  hubColony(
    call,
    `/projects/${encodeURIComponent(id)}/carriers/${encodeURIComponent(marketId)}/cargo`,
    { method: 'PATCH', body },
  );

/**
 * Closing, reopening and deleting a build.
 *
 * The website has had these since the actions row shipped and the app had only `priority`, so a
 * member who posted a build from the app had to open a browser to close it. Same service, same
 * rules — the hub decides whether this member may, from whose build it is.
 */
export const colonyClose = (call: HubCall, id: string): Promise<Answer<{ ok: true }>> =>
  hubColony(call, `/projects/${encodeURIComponent(id)}/close`, { method: 'PATCH', body: {} });

/**
 * "I flew out and it is already built."
 *
 * ★ ANY MEMBER, NOT JUST AN OFFICER — SQUADRON OWNER, 2026-08-12 ★
 *
 * `colonyClose` above needs permission to DIRECT the build, which on a squadron project
 * means an officer. The member who discovers a build is finished is almost never one — it is
 * whoever arrived with a full hold and found nothing to deliver to, and until now they had no way
 * to tell anybody, so the next member repeated the trip.
 *
 * It matters more here than on the website: that discovery happens in the ship, at the pad, with
 * this app open and no browser in reach.
 */
export const colonyReportBuilt = (
  call: HubCall,
  id: string,
): Promise<Answer<{ ok: true }>> =>
  hubColony(call, `/projects/${encodeURIComponent(id)}/report-built`, { method: 'PATCH', body: {} });

export const colonyReopen = (call: HubCall, id: string): Promise<Answer<{ ok: true }>> =>
  hubColony(call, `/projects/${encodeURIComponent(id)}/reopen`, { method: 'PATCH', body: {} });

export const colonyRemove = (call: HubCall, id: string): Promise<Answer<{ ok: true }>> =>
  hubColony(call, `/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });

/**
 * Giving up on a build, or taking that back. Officers only — the hub checks.
 *
 * Squadron owner, 2026-08-15: "we also need to allow admins to mark builds as abandoned and not
 * always just as complete."
 *
 * It belongs in the app at least as much as on the site: the officer who realises the squadron has
 * walked away from a build is usually the one flying past it.
 */
export const colonyAbandoned = (
  call: HubCall,
  id: string,
  abandoned: boolean,
  note?: string | undefined,
): Promise<Answer<{ ok: true }>> =>
  hubColony(call, `/projects/${encodeURIComponent(id)}/abandoned`, {
    method: 'PATCH',
    body: { abandoned, ...(note === undefined ? {} : { note }) },
  });

export const colonyPriority = (
  call: HubCall,
  id: string,
  isPriority: boolean,
): Promise<Answer<{ ok: true }>> =>
  hubColony(call, `/projects/${encodeURIComponent(id)}/priority`, {
    method: 'PATCH',
    body: { isPriority },
  });
