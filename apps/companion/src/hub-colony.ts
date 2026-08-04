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
  readonly isPriority: boolean;
  readonly completedAt: string | null;
  readonly postedBy: string | null;
  readonly remaining: number;
  readonly required: number;
  readonly needCount: number;
}

export interface ColonyNeed {
  readonly commodity: string;
  readonly remaining: number;
  readonly required: number | null;
}

export interface ColonyHauler {
  readonly name: string;
  readonly tonnes: number;
}

export interface ColonyShoppingRow {
  readonly commodity: string;
  readonly remaining: number;
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

export interface PlanSimulation {
  steps: PlanSimStep[];
  tier2: number;
  tier3: number;
  problems: PlanProblem[];
  effects: PlanEffects;
  surchargedPorts: number;
}

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
  economies: PlanEconomies;
}

export const colonyProjects = (
  call: HubCall,
): Promise<Answer<{ projects: ColonyProject[]; can: ColonyRights }>> =>
  hubColony(call, '/projects');

export const colonyProject = (
  call: HubCall,
  id: string,
): Promise<
  Answer<{
    project: ColonyProject;
    needs: ColonyNeed[];
    haulers: ColonyHauler[];
    shopping: ColonyShoppingRow[];
  }>
> => hubColony(call, `/projects/${encodeURIComponent(id)}`);

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
 * Closing, reopening and deleting a build.
 *
 * The website has had these since the actions row shipped and the app had only `priority`, so a
 * member who posted a build from the app had to open a browser to close it. Same service, same
 * rules — the hub decides whether this member may, from whose build it is.
 */
export const colonyClose = (call: HubCall, id: string): Promise<Answer<{ ok: true }>> =>
  hubColony(call, `/projects/${encodeURIComponent(id)}/close`, { method: 'PATCH', body: {} });

export const colonyReopen = (call: HubCall, id: string): Promise<Answer<{ ok: true }>> =>
  hubColony(call, `/projects/${encodeURIComponent(id)}/reopen`, { method: 'PATCH', body: {} });

export const colonyRemove = (call: HubCall, id: string): Promise<Answer<{ ok: true }>> =>
  hubColony(call, `/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const colonyPriority = (
  call: HubCall,
  id: string,
  isPriority: boolean,
): Promise<Answer<{ ok: true }>> =>
  hubColony(call, `/projects/${encodeURIComponent(id)}/priority`, {
    method: 'PATCH',
    body: { isPriority },
  });
