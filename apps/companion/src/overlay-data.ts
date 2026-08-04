import type { DockedAt } from './docked.js';
import { isFresh, projectTitleFrom } from './docked.js';
import { markWanted, type Hold } from './cargo.js';
import type { CurrentBuild } from './hub-colony.js';
import type { TripLedger } from './trip-ledger.js';
import type { OverlayData } from './renderer/overlay.js';

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
   * The member's current build, from the hub — whole-project needs with everyone's deliveries
   * folded in. Null when no current build is set, which is what makes the journal fallback below
   * reachable at all.
   */
  readonly currentProject: CurrentBuild | null;
  /** This trip's buying and selling, folded off the journal. Null before the watcher has run. */
  readonly trip: TripLedger | null;
  /** Now, injected so the freshness rule is testable. */
  readonly now: number;
}

export function buildOverlayData(input: OverlayInput): OverlayData {
  return {
    build: buildPanel(input),
    /*
     * ★ ROUTE: NOTHING TO SEND, AND NOTHING FETCHABLE ★
     *
     * There is no record anywhere of the run a member picked. The Freight Office is a PLANNER — it
     * computes candidates from an origin and some parameters — and `TRADE_SAVE_ROUTE` exists as a
     * permission with nothing that writes it. Unblocking this is an API feature (save a chosen run,
     * read it back on the companion), not overlay wiring.
     *
     * So the panel keeps saying "Pick a run in the Freight Office", which is exactly right and is
     * what the app's own Trade runs page already says.
     */
    route: null,
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
        ...fromDepot(dock, site),
        // The project's own name and crew, which the heartbeat cannot supply.
        title: current.title,
        haulers: current.haulers.length,
        fromHub: false,
      };
    }

    return {
      title: current.title,
      needs: current.needs
        .map((n) => ({
          commodity: n.commodity,
          // Floored for the same reason as the depot path: an over-delivered line can report a
          // negative remainder, and "-40 t still needed" is worse than saying nothing.
          remaining: Math.max(0, n.remaining),
          required: n.required,
        }))
        .filter((n) => n.remaining > 0),
      delivered: current.progress.delivered,
      required: current.progress.required,
      haulers: current.haulers.length,
      // The footer says "live from the squadron", because that is what these numbers are.
      fromHub: true,
    };
  }

  // No current build set: the journal-docked behaviour this panel has always had.
  if (site === null || dock === null) return null;
  return { ...fromDepot(dock, site), fromHub: false };
}

/** The panel's numbers, straight off a depot heartbeat. Shared by both docked paths above. */
function fromDepot(
  dock: DockedAt,
  site: NonNullable<DockedAt['site']>,
): Omit<NonNullable<OverlayData['build']>, 'fromHub'> {
  const title = projectTitleFrom(dock.stationName);

  return {
    // Empty rather than the raw station name: `projectTitleFrom` strips Frontier's
    // "Planetary Construction Site:" prefix, and an empty result means we have no name yet.
    title: title === '' ? null : title,
    needs: site.resources
      .map((r) => ({
        commodity: r.commodity,
        // Floored: an over-delivered site reports a negative remainder, and "-40 t still needed"
        // on an overlay is worse than saying nothing.
        remaining: Math.max(0, r.required - r.provided),
        required: r.required,
      }))
      // Finished commodities are dropped. The overlay is small and it exists to answer "what do I
      // still need to bring" — a completed line is a row of noise on a panel over a cockpit.
      .filter((n) => n.remaining > 0),
    delivered: site.resources.reduce((sum, r) => sum + r.provided, 0),
    required: site.resources.reduce((sum, r) => sum + r.required, 0),
    /*
     * Zero at an unposted site, and the panel hides the row at zero. Only the hub knows how many
     * people have hauled to a POSTED build, and both hub-aware paths above supply it.
     */
    haulers: 0,
  };
}
