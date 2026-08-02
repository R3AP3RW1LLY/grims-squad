import type { DockedAt } from './docked.js';
import { isFresh, projectTitleFrom } from './docked.js';
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
    /*
     * ★ CARGO: NOT AVAILABLE IN-PROCESS ★
     *
     * The journal's routine `Cargo` lines carry a vessel and a count, not the inventory; Frontier
     * writes the live hold to `Cargo.json` beside the journals, and nothing here reads it. Capacity
     * comes from `Loadout.CargoCapacity`, which the watcher passes over.
     *
     * Sending an empty hold would be worse than sending nothing: the panel reads `items: []` as
     * "Hold empty." and would tell a member with a full hold that it was empty.
     */
    cargo: null,
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
 * The build tracker, from the depot heartbeat alone.
 *
 * ★ THE SITE'S OWN TRUTH, NOT THE HUB'S COPY OF IT ★
 *
 * `ColonisationConstructionDepot` fires every fifteen seconds while docked and carries the whole
 * requirement, so this needs no network, is never stale by more than a heartbeat, and works for a
 * construction site nobody has posted a project for. Asking the hub instead would be slower, would
 * fail offline, and would show nothing at an unposted site — for the same numbers.
 */
function buildPanel(input: OverlayInput): OverlayData['build'] {
  const dock = input.dock;

  /*
   * Twelve hours is the freshness rule, shared with the rest of the app. A dock from a session two
   * days ago is not where the member is now, and an overlay confidently reporting a build they left
   * on Tuesday is worse than one that admits it does not know.
   */
  const site = dock !== null && isFresh(dock, input.now) ? dock.site : null;
  if (site === null || dock === null) return null;

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
     * Zero, and the panel hides the row at zero.
     *
     * Only the hub knows how many people have hauled here, and asking would be the main process's
     * first unprompted colony call — one request per member every twenty seconds, for ever, for a
     * number that changes hourly. Worth doing behind a TTL cache later; not worth the traffic now.
     */
    haulers: 0,
  };
}
