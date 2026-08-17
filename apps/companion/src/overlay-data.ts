import type { DockedAt } from './docked.js';
import { isFresh, projectTitleFrom } from './docked.js';
import { unrealised } from './cargo-value.js';
import { markWanted, type Hold } from './cargo.js';
import type { CurrentBuild } from './hub-colony.js';
import type { TripLedger } from './trip-ledger.js';
/*
 * SUBPATH, not the barrel — this module is reachable from the overlay entry point and the barrel
 * reaches `node:crypto`. `renderer-imports.spec.ts` fails the build if that rule is broken.
 */
import { coverNeeds, type Holder } from '@grims/shared/colony-held-cargo';
import type { OverlayData } from './renderer/overlay.js';
import { hitRate, type ProspectingState } from './prospector.js';
import { refinedRate, sessionMinutes, type RefiningState } from './refinery.js';
import { standingFor, EMPTY_BGS, type BgsSessionState } from './bgs-session.js';
import { whereInPlan, type PickedRun } from './trade-plan.js';
import { planManifest } from '@grims/shared/manifest';
import type { CompanionStanding } from './hub-bgs.js';

/**
 * What the overlays actually draw.
 *
 * ★ THE CHANNEL EXISTED AND NOTHING EVER SENT ON IT ★
 *
 * `pushOverlayData` was written, exported, and never called — by anything, anywhere. The receiving
 * half was complete: the preload subscribed, the renderer registered its handler, the window
 * broadcaster was ready. So every panel sat on its null placeholder for the life of the app, and
 * "Waiting for your hold." was the only thing the cargo overlay could ever draw.
 *
 * Found by an adversarial review of an unrelated change, which is the only reason it is fixed here
 * rather than being reported by a member as "the overlays do not work".
 *
 * ★ PURE, SO THE MAPPING CAN BE TESTED ★
 *
 * No Electron import. `main.ts` is the part that cannot be unit tested, so as little as possible
 * lives there — the same rule watcher.ts and docked.ts already follow.
 *
 * ★ NULL IS A STATEMENT, NOT A GAP ★
 *
 * Each panel renders its own sentence when its slice is null, and those sentences are true. The
 * temptation is to send an empty object instead so the panel "has data" — but `cargo: { items: [],
 * used: 0 }` makes the overlay say "Hold empty.", which is a claim about the member's ship that we
 * have not earned. Null says "we do not know yet", and the panel says so.
 */

export interface OverlayInput {
  /** Where the commander is, already merged from the live pass and the startup seed. */
  readonly dock: DockedAt | null;
  /** True while a journal pass is uploading. Sub-tick, so the dot means something. */
  readonly sending: boolean;
  /** Epoch millis of the last successful upload; 0 when there has never been one. */
  readonly lastTransferAt: number;
  /** Whether Elite is actually running. */
  readonly gameRunning: boolean;
  /** What is in the hold, from Cargo.json. Null when we have not managed to read one. */
  readonly hold: Hold | null;
  /** Tonnes the ship can carry, from Loadout. Null until a Loadout has been seen. */
  readonly capacity: number | null;
  /**
   * What the hold is worth and where to take it, priced by the hub against the squadron's own
   * market table. Null until a valuation has come back — see `cargo-value.ts` for when one is
   * asked for, which is deliberately not "every time the cargo changes".
   */
  readonly holdValue?:
    | {
        readonly value: number;
        readonly bestSale: {
          readonly station: string;
          readonly system: string;
          readonly distanceLy: number | null;
          readonly total: number;
          readonly perTonne: number;
        } | null;
        readonly unpriced: readonly string[];
      }
    | null
    | undefined;
  /**
   * The member's current build, from the hub — whole-project needs with everyone's deliveries
   * folded in. Null when no current build is set, which is what makes the journal fallback below
   * reachable at all.
   */
  readonly currentProject: CurrentBuild | null;
  /** This trip's buying and selling, folded off the journal. Null before the watcher has run. */
  readonly trip: TripLedger | null;
  /** Now, injected so the freshness rule is testable. */
  readonly now: number;
  /**
   * The rock in front of the member, and the session it belongs to.
   *
   * Both null until the member has actually prospected or refined something, which keeps the two
   * panels honestly empty rather than showing a session of zeroes to somebody who is not mining.
   */
  /*
   * `| undefined` spelled out: `exactOptionalPropertyTypes` treats an optional property and one
   * that may be undefined as different types, and callers built before mining existed pass neither.
   */
  readonly prospecting?: ProspectingState | null | undefined;
  readonly refining?: RefiningState | null | undefined;
  /**
   * The squadron's standing orders. Null until the hub has answered once — see `bgsPanel`, where
   * that is deliberately different from an empty list.
   */
  readonly standingOrders?: readonly CompanionStanding[] | null | undefined;
  /** What this member has moved for the squadron since the app started. */
  readonly bgsSession?: BgsSessionState | null | undefined;
  /**
   * The runs the member picked in the Freight Office.
   *
   * The PICKS, not a finished manifest: capacity changes when somebody swaps ship, so the manifest
   * is planned here against the hold the app can currently see rather than baked at pick time.
   */
  readonly tradePicks?: readonly PickedRun[] | undefined;
  /**
   * Where the Freight Office measured that plan from.
   *
   * The journal names the station a member is docked at but never says where it is in space, so
   * the planner's own origin travels with the plan — without it the manifest can only GROUP the
   * stops by system rather than order them.
   */
  readonly tradeOrigin?: { readonly x: number; readonly y: number; readonly z: number } | null | undefined;
}

/**
 * The picked run, planned against the hold the member is actually flying.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "add an option to choose the trade route and display them in the overlay please so we can group
 * multiple routes together if there are several that are going to the same destination, and show
 * the optimized order"
 *
 * ★ THE SAME `planManifest` THE WEBSITE USES ★
 *
 * Grouping the shared stops and ordering them is a solved problem living in `@grims/shared`, and
 * the two surfaces have to agree: a member who plans on the site and flies with the app must not be
 * given a different order by each. Re-deriving it here would be a second implementation to keep in
 * step, and the one that drifted would be the one nobody was looking at.
 */
function routePanel(input: OverlayInput): OverlayData['route'] {
  const picks = input.tradePicks ?? [];
  if (picks.length === 0) return null;

  /*
   * Without a Loadout we do not know the hold. Planning against a guess would quote tonnages and
   * profits for a ship the member is not flying, so the manifest assumes the hold is whatever the
   * picks can supply and says `capacity: null` — the panel prints the caveat.
   */
  const capacity = input.capacity;
  const manifest = planManifest(picks, {
    capacity: capacity ?? picks.reduce((sum, p) => sum + p.supply, 0),
    budget: null,
    ...(input.tradeOrigin == null ? {} : { origin: input.tradeOrigin }),
  });

  const here = whereInPlan(picks, input.dock ?? null);

  /*
   * Tonnes come from the MANIFEST, not from the pick. A pick says what the station has; the
   * manifest says what actually fits once the hold, the supply and the demand have all had their
   * say — and that is the number a member loads.
   */
  const tonnesOf = (commodity: string): number =>
    manifest.lines.find((l) => l.commodity === commodity)?.tonnes ?? 0;

  return {
    stops: manifest.order.map((s) => ({
      commodity: s.commodity,
      station: s.station,
      system: s.system,
      tonnes: s.tonnes,
    })),
    loadHere: here.loadHere.map((p) => ({
      commodity: p.commodity,
      tonnes: tonnesOf(p.commodity),
    })),
    sellHere: here.sellHere.map((p) => ({
      commodity: p.commodity,
      tonnes: tonnesOf(p.commodity),
    })),
    tonnes: manifest.tonnes,
    capacity,
    outlay: manifest.outlay,
    profit: manifest.profit,
    spare: manifest.spare,
    routeLy: manifest.routeLy,
  };
}

/** Tonnes of one commodity in the member's own hold, by the need's spelling. */
function holdTonnesOf(hold: Hold | null, commodity: string): number {
  const key = commodity.trim().toLowerCase();
  let tonnes = 0;
  for (const line of hold?.items ?? []) {
    if (line.commodity.trim().toLowerCase() === key) tonnes += line.count;
  }
  return tonnes;
}

/**
 * The build's outstanding lines, with what is already held against each.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "show What is actually remaining vs what is in player cargo holds vs what it actually in assigned
 * fleet carrier holds."
 *
 * ★ THE TWO HOLDERS COME FROM COMPLETELY DIFFERENT PLACES ★
 *
 * The member's own ship is read off THEIR machine — `Cargo.json`, already in `input.hold`, with no
 * network involved and no lag. The carriers only the hub knows, and they arrive with the build.
 *
 * Which is why this is computed here rather than server-side: nothing in the API tracks per-member
 * ship cargo at all, and the overlay is the one surface that does not need it to, because it is
 * running on the member's own PC.
 *
 * `coverNeeds` does the arithmetic, and the cap in it is the load-bearing part: three commanders
 * holding 500 t against a 900 t need is 900 t covered, not 1,500 t.
 */
function coveredNeeds(
  current: CurrentBuild,
  hold: Hold | null,
): ReturnType<typeof coverNeeds> {
  const holders: Holder[] = [];

  for (const line of hold?.items ?? []) {
    holders.push({
      kind: 'ship',
      commodity: line.commodity,
      tonnes: line.count,
      userId: 'me',
      commander: 'You',
      carrierCallsign: null,
    });
  }

  for (const h of current.carrierHolds ?? []) {
    holders.push({
      kind: 'carrier',
      commodity: h.commodity,
      tonnes: h.tonnes,
      userId: `carrier:${h.carrier}`,
      commander: h.carrier,
      carrierCallsign: h.carrier,
    });
  }

  return coverNeeds(
    current.needs.map((n) => ({ commodity: n.commodity, remaining: Math.max(0, n.remaining) })),
    holders,
  );
}

export function buildOverlayData(input: OverlayInput): OverlayData {
  return {
    build: buildPanel(input),
    prospector: prospectorPanel(input),
    refinery: refineryPanel(input),
    route: routePanel(input),
    cargo: cargoPanel(input),
    status: {
      sending: input.sending,
      /*
       * Always zero, honestly. There is no queue: a pass batches within itself and keeps nothing
       * between passes — durability is the un-advanced file offset, which is a byte position rather
       * than a count of anything. The panel hides this row at zero, so it costs nothing to be
       * truthful about.
       */
      queued: 0,
      lastUploadAt:
        input.lastTransferAt === 0 ? null : new Date(input.lastTransferAt).toISOString(),
      gameRunning: input.gameRunning,
    },
    bgs: bgsPanel(input),
  };
}

/**
 * The standing orders where the member is, and what they have moved this session.
 *
 * ★ null UNTIL THE ORDERS HAVE ARRIVED, NOT UNTIL THERE ARE SOME ★
 *
 * An empty array is a real answer — "the officers have not ordered anything" — and the panel says
 * so. `null` means we have not managed to ask the hub yet, and the panel says THAT instead. Merging
 * the two would have a member on a broken connection reading "no standing orders" and believing it.
 */
function bgsPanel(input: OverlayInput): OverlayData['bgs'] {
  const orders = input.standingOrders ?? null;
  if (orders === null) return null;

  const split = standingFor(orders, input.dock?.systemName ?? null);
  const session = input.bgsSession ?? EMPTY_BGS;

  return {
    here: split.here.map((o) => ({
      faction: o.faction,
      stance: o.stance,
      priority: o.priority,
      guidance: o.guidance,
      // `standingFor` works on the shared shape, which has no `isOurs`; the companion's rows carry
      // it, so it is read back off the original rather than threaded through the split.
      isOurs: orders.find((x) => x.faction === o.faction)?.isOurs === true,
    })),
    elsewhere: split.elsewhere,
    system: input.dock?.systemName ?? null,
    missions: session.missions,
    pips: session.pips,
    points: session.points,
  };
}

/**
 * What is in the hold, and how much of it the site in front of you wants.
 *
 * ★ SQUADRON OWNER, 2026-08-03 ★
 *
 * "i have a full hold and it is not showing what i am carrying, its value, nothing at all!"
 *
 * ★ null AND AN EMPTY HOLD ARE DIFFERENT ANSWERS ★
 *
 * Null renders "Waiting for your hold" and means we could not read one. An empty list renders
 * "Hold empty" and is a claim about the member's ship. Sending the second when we mean the first is
 * how a member with 1,040 tonnes aboard gets told they are carrying nothing — so the distinction is
 * kept all the way down from the file read.
 *
 * ★ `wanted` IS THE POINT ★
 *
 * A list of what is in the hold is something the game already shows. What it cannot show is which
 * of it the site you are docked at is actually asking for, so a member hauling a mixed load knows
 * what to hand over and what they are carrying for nothing.
 */
function cargoPanel(input: OverlayInput): OverlayData['cargo'] {
  if (input.hold === null) return null;

  /*
   * Matched against the site's REMAINING requirement, not its total: a commodity the build has
   * already had enough of is not wanted, however much of it somebody is carrying.
   *
   * The docked depot reading wins when there is one; away from the site, the member's CURRENT
   * build supplies the list — so a hold being loaded three systems away still shows which of it
   * the build is actually waiting for.
   */
  const site = input.dock !== null && isFresh(input.dock, input.now) ? input.dock.site : null;
  const wanted =
    site !== null
      ? new Set(
          site.resources.filter((r) => r.required - r.provided > 0).map((r) => r.commodity),
        )
      : new Set(
          (input.currentProject?.needs ?? [])
            .filter((n) => n.remaining > 0)
            .map((n) => n.commodity),
        );

  const marked = markWanted(input.hold, wanted);

  /*
   * ★ WHAT WAS PAID, PER LINE — SQUADRON OWNER, 2026-08-04 ★
   *
   * "just only show what the value was paid for the cargo please!" Each hold line carries the
   * cost of the units the ledger watched being bought, matched by display name. Mined and
   * mission cargo has no watched buy, so its paid figure is honestly null — the panel omits the
   * figure entirely, never a fake zero.
   */
  const lots = input.trip?.lots ?? {};
  const items = marked.items.map((item) => {
    const lot = lots[item.commodity.toLowerCase()];
    return {
      ...item,
      paid: lot === undefined || lot.units <= 0 ? null : lot.paid,
    };
  });
  const totalPaid = items.reduce((sum, i) => sum + (i.paid ?? 0), 0);

  return {
    items,
    used: marked.used,
    capacity: input.capacity,
    /** Total watched spend aboard. Zero hides the line — nothing to say. */
    totalPaid,
    /*
     * The till receipt: the most recent completed sale, persisting across undocks until the next
     * one replaces it — the exact behaviour the owner asked for.
     */
    lastSale: input.trip?.lastSale ?? null,
    /*
     * ★ SQUADRON OWNER, 2026-08-06 ★
     *
     * "we want valiue information but its showing irrellevant sell information in it!"
     *
     * What it is worth NOW and where to take it, rather than what was paid for it and what was
     * last sold. Null until the hub has priced this hold; the panel omits the lines rather than
     * drawing a zero, because a hold worth nothing and a hold not yet priced are different states
     * and only one of them is bad news.
     */
    value: input.holdValue?.value ?? null,
    bestSale: input.holdValue?.bestSale ?? null,
    profit: unrealised(input.holdValue?.value ?? null, totalPaid),
  };
}

/**
 * The build tracker: the member's current build wherever they fly, the depot heartbeat when they
 * are standing at it.
 *
 * ★ SQUADRON OWNER, 2026-08-04: THE OVERLAY MUST NOT GO DARK WHEN THEY LEAVE ★
 *
 * This used to render from the journal's docked heartbeat alone, so it emptied the moment the
 * member undocked and stayed empty everywhere else — which is most of a hauling loop. The hub's
 * `current` answer is the fix: whole-project needs with EVERY member's deliveries folded in,
 * refreshed every minute in the main process, so the numbers move while the member is three
 * systems away buying the next load.
 *
 * ★ BUT THE DEPOT READING WINS AT THE SITE ITSELF ★
 *
 * `ColonisationConstructionDepot` fires every fifteen seconds while docked and carries the whole
 * requirement — it is seconds fresher than the hub's copy, needs no network, and works at a site
 * nobody has posted. So when the member is physically docked at their current build, the panel
 * prefers the reading coming off the pad in front of them; the hub still supplies the project's
 * TITLE and hauler count, which no heartbeat carries.
 *
 * The journal-only view stays as the fallback for a member with no current build set, docked at a
 * construction site: same behaviour this panel has always had.
 */
function buildPanel(input: OverlayInput): OverlayData['build'] {
  const dock = input.dock;
  const current = input.currentProject;

  /*
   * Twelve hours is the freshness rule, shared with the rest of the app. A dock from a session two
   * days ago is not where the member is now, and an overlay confidently reporting a build they left
   * on Tuesday is worse than one that admits it does not know.
   */
  const site = dock !== null && isFresh(dock, input.now) ? dock.site : null;

  if (current !== null) {
    // Physically at the current build, with a live depot reading: prefer it — see the header.
    if (site !== null && dock !== null && dock.marketId === current.marketId) {
      return {
        ...fromDepot(dock, site, input.hold),
        // The project's own name and crew, which the heartbeat cannot supply.
        title: current.title,
        haulers: current.haulers.length,
        fromHub: false,
      };
    }

    return {
      title: current.title,
      needs: coveredNeeds(current, input.hold)
        .map((n) => {
          // `CoveredNeed` is only about tonnage. Category and the original requirement come from the
          // need it was computed from, matched by the need's own spelling which `coverNeeds` keeps.
          const source = current.needs.find((x) => x.commodity === n.commodity);
          return {
          commodity: n.commodity,
          /*
           * Only the HUB path knows the category — it comes down with the needs. The journal path
           * below reads a depot directly and has no market data at all, which is why the overlay
           * groups only when it actually has categories to group by.
           */
          category: source?.category ?? null,
          // Floored for the same reason as the depot path: an over-delivered line can report a
          // negative remainder, and "-40 t still needed" is worse than saying nothing.
          remaining: Math.max(0, n.remaining),
          required: source?.required ?? null,
          inHold: n.shipTonnes,
          onCarriers: n.carrierTonnes,
          stillToBuy: n.stillToBuy,
          /*
           * Whether the carrier figure is a FACT or an absence. The hub path knows; the journal
           * path below reads a depot off the pad and knows nothing about carriers, and a `0 t`
           * there would be a claim rather than a gap. The renderer leaves it blank instead.
           */
          knowsCarriers: true,
          };
        })
        .filter((n) => n.remaining > 0),
      /*
       * ★ HOW MANY ARE DONE, SAID OUT LOUD — SQUADRON OWNER, 2026-08-17 ★
       *
       * "the build tracker is also not showing all remaining commodities, one member is only showing
       * 2 commodities remaining when they have more"
       *
       * It was showing two because two were outstanding — the other seventeen were finished and
       * filtered away. The panel was right and looked broken, which is its own kind of wrong: a list
       * that silently drops rows is indistinguishable from a list that is truncated.
       *
       * Asked which to show, the answer was outstanding plus a count. So the filter stays — this is
       * a strip over a cockpit and finished rows are not what somebody is deciding from — and the
       * count says the rest exist.
       */
      finished: current.needs.filter((n) => n.remaining <= 0).length,
      total: current.needs.length,
      delivered: current.progress.delivered,
      required: current.progress.required,
      haulers: current.haulers.length,
      // The footer says "live from the squadron", because that is what these numbers are.
      fromHub: true,
    };
  }

  // No current build set: the journal-docked behaviour this panel has always had.
  if (site === null || dock === null) return null;
  return { ...fromDepot(dock, site, input.hold), fromHub: false };
}

/** The panel's numbers, straight off a depot heartbeat. Shared by both docked paths above. */
function fromDepot(
  dock: DockedAt,
  site: NonNullable<DockedAt['site']>,
  /** The member's own cargo. Read off their machine, so it is true even at a site the hub never saw. */
  hold: Hold | null,
): Omit<NonNullable<OverlayData['build']>, 'fromHub'> {
  const title = projectTitleFrom(dock.stationName);

  return {
    // Empty rather than the raw station name: `projectTitleFrom` strips Frontier's
    // "Planetary Construction Site:" prefix, and an empty result means we have no name yet.
    title: title === '' ? null : title,
    needs: site.resources
      .map((r) => {
        const remaining = Math.max(0, r.required - r.provided);
        /*
         * The member's OWN hold still counts here — it is read off their machine and is true at a
         * depot the hub has never heard of. What is missing is the carriers, which only the hub
         * knows, and `knowsCarriers: false` is how the grid says so rather than printing a zero.
         *
         * A `0 t` in the carrier column is a CLAIM — "no carrier has any" — where a blank is the
         * truth: we did not ask. The same distinction `needsFreshness` draws elsewhere.
         */
        const inHold = holdTonnesOf(hold, r.commodity);
        return {
          commodity: r.commodity,
          // Floored: an over-delivered site reports a negative remainder, and "-40 t still needed"
          // on an overlay is worse than saying nothing.
          remaining,
          required: r.required,
          inHold,
          onCarriers: 0,
          stillToBuy: Math.max(0, remaining - inHold),
          knowsCarriers: false,
        };
      })
      // Finished commodities are dropped. The overlay is small and it exists to answer "what do I
      // still need to bring" — a completed line is a row of noise on a panel over a cockpit.
      // The COUNT of them is kept below, so a short list never reads as a truncated one.
      .filter((n) => n.remaining > 0),
    finished: site.resources.filter((r) => r.required - r.provided <= 0).length,
    total: site.resources.length,
    delivered: site.resources.reduce((sum, r) => sum + r.provided, 0),
    required: site.resources.reduce((sum, r) => sum + r.required, 0),
    /*
     * Zero at an unposted site, and the panel hides the row at zero. Only the hub knows how many
     * people have hauled to a POSTED build, and both hub-aware paths above supply it.
     */
    haulers: 0,
  };
}


/**
 * The prospector panel: the rock in front of the member.
 *
 * Null until one has been prospected — an empty panel says "waiting for a limpet", which is true,
 * where a panel of zeroes would say they are mining badly.
 */
function prospectorPanel(input: OverlayInput): OverlayData['prospector'] {
  /*
   * Nullish rather than `=== null`: this arrives from a long-lived main process and from callers
   * built before these fields existed, so undefined is a real state and not a type violation worth
   * throwing over.
   */
  const p = input.prospecting ?? null;
  if (p === null || p.current === null) return null;

  return {
    materials: p.current.materials.map((m) => ({ name: m.name, percent: m.percent })),
    isHit: p.currentIsHit,
    motherlode: p.current.motherlode,
    content: p.current.content,
    prospected: p.prospected,
    hitRate: hitRate(p),
    bestPercent: p.bestPercent,
    bestMaterial: p.bestMaterial,
  };
}

/**
 * The refinery panel: the session.
 *
 * ★ `value` AND `bestSale` ARE NOT COMPUTED HERE, DELIBERATELY ★
 *
 * They need the market table, which lives on the hub — eighteen million rows the app has no copy
 * of and should not. They arrive with the current-project data the panel already receives, and are
 * null until they do. Null renders as an absent row rather than a wrong number, which is the right
 * behaviour for a member mining somewhere the squadron has no prices for.
 */
function refineryPanel(input: OverlayInput): OverlayData['refinery'] {
  const r = input.refining ?? null;
  if (r === null || r.tonnes === 0) return null;

  // Biggest first: mid-session the useful question is "what am I actually getting".
  const materials = Object.entries(r.byMaterial)
    .map(([name, tonnes]) => ({ name, tonnes }))
    .sort((a, b) => b.tonnes - a.tonnes);

  return {
    materials,
    tonnes: r.tonnes,
    minutes: sessionMinutes(r, input.now),
    rate: refinedRate(r, input.now),
    points: r.points,
    value: null,
    bestSale: null,
  };
}
