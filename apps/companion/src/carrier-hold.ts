import type { ParsedLike } from './docked.js';

/**
 * What is sitting in the member's OWN carrier's hold, as far as this app has watched.
 *
 * ★ WHY THE HUB CANNOT WORK THIS OUT WITHOUT US ★
 *
 * A carrier staged for a build holds exactly the cargo its owner has NOT put up for sale — and the
 * public market mirror the hub reads sees only sell orders. The one record that staged cargo exists
 * at all is the owner's own journal: `CargoTransfer` when cargo is lifted between ship and carrier,
 * and buys/sells AT the carrier's own market. So this fold runs where those journals are, and the
 * app pushes its reading to the hub whenever it changes.
 *
 * ★ A WITNESS STATEMENT, NOT AN INVENTORY ★
 *
 * The fold starts empty on app launch — nothing is seeded, for the same reason as trip-ledger.ts: a
 * ledger rebuilt from half a session shows figures whose starting point nobody can name. That means
 * what it holds is only what the app WATCHED move, clamped at zero. The hub treats it exactly that
 * way: journal rows overwrite the commodities this fold touched and stay silent about the rest, a
 * crew member's manual figure outranks them, and the merge rule is written on the table
 * (ssot/03-data/schema.prisma, ColonyCarrierCargo).
 *
 * Zero-tonne entries are KEPT rather than deleted, because "we watched this empty out" is a real
 * statement the hub needs — dropping the key would leave a stale figure standing on the server.
 *
 * ★ WHOSE CARRIER, AND HOW WE KNOW ★
 *
 * `CarrierStats` names the member's own carrier outright (CarrierID is its market id). It only
 * fires when they open carrier management, so it may never appear in a session — but `CargoTransfer`
 * is something ONLY an owner can do, so a transfer while docked at a carrier pad identifies that
 * pad as theirs. Both roads lead to one identity; a transfer with no identity at all is skipped
 * rather than guessed at.
 *
 * ★ STILL A PURE FOLD ★
 *
 * Events in, state out, threaded through the watcher pass like trackDocked and foldTrip — this is
 * the only place the journal is parsed, and a second reader would be a second set of offsets that
 * drift.
 */

export interface OwnCarrier {
  /** The carrier's market id, as a string — ids exceed 2^53. */
  readonly marketId: string;
  readonly callsign: string | null;
  readonly name: string | null;
}

export interface CarrierHoldState {
  /** The member's own carrier, once anything has identified it. */
  readonly carrier: OwnCarrier | null;
  /**
   * Tonnes aboard per commodity, keyed by lower-cased display name; the value keeps the display
   * casing the journal gave, because that is what the hub's tables join on.
   */
  readonly hold: Readonly<Record<string, { readonly commodity: string; readonly tonnes: number }>>;
  /** The carrier pad the member is on right now, when the pad IS a carrier. Identity fuel only. */
  readonly dockedCarrierId: string | null;
}

export const EMPTY_CARRIER_HOLD: CarrierHoldState = {
  carrier: null,
  hold: {},
  dockedCarrierId: null,
};

/** A market id as a string. Same reasoning as docked.ts: `String()` on 2^53+ rounds. */
function marketIdOf(value: unknown): string {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value.toFixed(0);
  return '';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** The display name a journal cargo entry carries. Localised when present, symbol otherwise. */
function nameOf(entry: Record<string, unknown>): string | null {
  const localised = text(entry['Type_Localised']);
  if (localised !== '') return localised;
  const raw = text(entry['Type']);
  return raw === '' ? null : raw;
}

function adjust(
  hold: CarrierHoldState['hold'],
  commodity: string,
  delta: number,
): CarrierHoldState['hold'] {
  const key = commodity.toLowerCase();
  const held = hold[key]?.tonnes ?? 0;
  // Clamped at zero, never negative: a withdrawal we never saw the deposit for is the fold's
  // ignorance, not negative cargo. The zero row stays — see the header.
  const tonnes = Math.max(0, held + delta);
  return { ...hold, [key]: { commodity: hold[key]?.commodity ?? commodity, tonnes } };
}

/**
 * Folds a batch of events over the running state. Takes the previous value so it works across
 * passes — a member transfers in one twenty-second window and sells off the carrier an hour later.
 */
export function foldCarrierHold(
  previous: CarrierHoldState,
  events: readonly ParsedLike[],
): CarrierHoldState {
  let current = previous;

  for (const event of events) {
    switch (event.name) {
      /*
       * The direct identification: CarrierStats only ever describes the member's own carrier, and
       * CarrierID is its market id. A DIFFERENT id than the one we knew means the old carrier is
       * gone (sold, decommissioned) — its watched hold with it.
       */
      case 'CarrierStats': {
        const marketId = marketIdOf(event.data['CarrierID']);
        if (marketId === '') break;
        const callsign = text(event.data['Callsign']) || null;
        const name = text(event.data['Name']) || null;
        current = {
          ...current,
          carrier: { marketId, callsign, name },
          hold: current.carrier !== null && current.carrier.marketId !== marketId ? {} : current.hold,
        };
        break;
      }

      /*
       * Docking remembers WHERE, not WHOSE: any commander can dock at any carrier. The pad becomes
       * identity only when a CargoTransfer proves ownership below.
       */
      case 'Docked': {
        const marketId = marketIdOf(event.data['MarketID']);
        current = {
          ...current,
          dockedCarrierId:
            text(event.data['StationType']) === 'FleetCarrier' && marketId !== '' ? marketId : null,
        };
        break;
      }

      /*
       * ★ UNDOCKING CHANGES NOTHING ABOUT THE HOLD ★
       *
       * The carrier keeps its cargo when the member flies off — that is the entire point of
       * staging on one. Only the "which pad am I on" breadcrumb is cleared.
       */
      case 'Undocked':
      case 'FSDJump':
        if (current.dockedCarrierId !== null) current = { ...current, dockedCarrierId: null };
        break;

      /*
       * The event this fold exists for. `tocarrier` puts cargo aboard, `toship` takes it off;
       * `tosrv` never involves the carrier and is ignored. Only an OWNER can transfer, so a
       * transfer while docked at a carrier pad identifies that pad as the member's own — which is
       * how sessions that never open carrier management still get an identity.
       */
      case 'CargoTransfer': {
        let carrier = current.carrier;
        if (carrier === null && current.dockedCarrierId !== null) {
          carrier = { marketId: current.dockedCarrierId, callsign: null, name: null };
        }
        // No identity at all: skipped rather than guessed. Attributing cargo to an unknown
        // carrier would be a figure filed under nothing.
        if (carrier === null) break;

        const transfers = event.data['Transfers'];
        if (!Array.isArray(transfers)) break;

        let hold = current.hold;
        for (const raw of transfers) {
          if (typeof raw !== 'object' || raw === null) continue;
          const t = raw as Record<string, unknown>;
          const commodity = nameOf(t);
          const units = count(t['Count']);
          const direction = text(t['Direction']).toLowerCase();
          if (commodity === null || units === 0) continue;
          if (direction === 'tocarrier') hold = adjust(hold, commodity, units);
          else if (direction === 'toship') hold = adjust(hold, commodity, -units);
        }
        current = { ...current, carrier, hold };
        break;
      }

      /*
       * Trading AT the member's own carrier moves cargo without a CargoTransfer: buying from its
       * sell orders takes stock off, selling to its buy orders puts stock aboard. Identified by
       * MarketID — trades anywhere else are somebody else's shop and none of this fold's business.
       */
      case 'MarketBuy':
      case 'MarketSell': {
        if (current.carrier === null) break;
        if (marketIdOf(event.data['MarketID']) !== current.carrier.marketId) break;
        const commodity = nameOf(event.data);
        const units = count(event.data['Count']);
        if (commodity === null || units === 0) break;
        current = {
          ...current,
          hold: adjust(current.hold, commodity, event.name === 'MarketBuy' ? -units : units),
        };
        break;
      }

      default:
        break;
    }
  }

  return current;
}

/** What one upload to the hub says. */
export interface CarrierCargoSnapshot {
  readonly marketId: string;
  readonly commodities: ReadonlyArray<{ readonly commodity: string; readonly tonnes: number }>;
}

/**
 * The snapshot worth sending, or null when there is nothing honest to say.
 *
 * Null until the fold has BOTH an identity and at least one witnessed movement — an empty push
 * from a fresh app start would tell the hub nothing and cost nothing, so it is not made. Sorted by
 * commodity so two identical states serialise identically, which is what the caller's
 * changed-since-last-push comparison rests on.
 */
export function carrierSnapshot(state: CarrierHoldState): CarrierCargoSnapshot | null {
  if (state.carrier === null) return null;
  const commodities = Object.values(state.hold)
    .map((h) => ({ commodity: h.commodity, tonnes: h.tonnes }))
    .sort((a, b) => (a.commodity < b.commodity ? -1 : a.commodity > b.commodity ? 1 : 0));
  if (commodities.length === 0) return null;
  return { marketId: state.carrier.marketId, commodities };
}
