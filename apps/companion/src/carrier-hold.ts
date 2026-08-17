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
  readonly hold: Readonly<
    Record<
      string,
      {
        readonly commodity: string;
        readonly tonnes: number;
        /**
         * Whether this fold ever WATCHED any of this commodity arrive.
         *
         * ★ THE DIFFERENCE BETWEEN A ZERO AND AN ABSENCE — SQUADRON OWNER, 2026-08-17 ★
         *
         * "we did see carrier inventory in the overlay, but then it disappeared"
         *
         * This fold is a WITNESS: it knows what it watched move and nothing else. When a member
         * sells cargo it never saw loaded, `adjust` clamps at zero — its own comment calls that
         * "the fold's ignorance, not negative cargo" — and the snapshot then sent that zero to the
         * hub, which stored it as a statement of fact.
         *
         * Downstream nothing could tell the two apart. A journal zero outranks the market mirror
         * and, being the newest reading, outranks Frontier too. So one sale of cargo the app never
         * saw arrive silently emptied a commodity off every board: the project page, the carriers
         * tab and the overlay a member reads mid-flight.
         *
         * Measured on production the day this was written: 26 of 34 rows were zeros.
         *
         * A zero is only worth sending when we watched the cargo arrive AND watched it leave. That
         * is a real statement. Anything else is an absence, and an absence must stay silent so a
         * source that CAN see the whole hold — Frontier's manifest, the market mirror — is left to
         * answer.
         */
        readonly witnessed: boolean;
      }
    >
  >;
  /** The carrier pad the member is on right now, when the pad IS a carrier. Identity fuel only. */
  readonly dockedCarrierId: string | null;
  /**
   * Total tonnes aboard, from the game rather than from watching — `CarrierStats.SpaceUsage.Cargo`.
   *
   * The fold above is a witness statement and cannot know what moved before it was watching. This
   * is the whole truth about the SIZE of the hold, with no breakdown, and the difference between
   * the two is the honest measure of how much we have not seen. Null until the member opens carrier
   * management at least once.
   */
  readonly totalTonnes: number | null;
  /** When that total was read. A stale total is still worth more than none, and this says how stale. */
  readonly totalAt: number | null;
}

export const EMPTY_CARRIER_HOLD: CarrierHoldState = {
  carrier: null,
  hold: {},
  dockedCarrierId: null,
  totalTonnes: null,
  totalAt: null,
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

/**
 * The display name a journal cargo entry carries. Localised when present, symbol otherwise.
 *
 * ★ THE SYMBOL FALLBACK WAS SHIPPING LOWER-CASE NAMES — 2026-08-09 ★
 *
 * Frontier omits `Type_Localised` for exactly the commodities whose symbol is already the word:
 * `steel`, `aluminium`, `tritium`, `bertrandite`. It supplies it when the display name differs
 * materially — `Low Temp. Diamonds`, `CMM Composite`.
 *
 * So the fallback fired precisely for the plain ones and stored `steel`, while every other table in
 * the platform calls it `Steel`. `colony_needs.commodity` is a display name, so the carrier-cover
 * join found nothing and the yellow "already aboard" segment never appeared for those commodities.
 * Measured on production: 1,298 t of Steel and 1,186 t of Aluminium invisible across four builds.
 *
 * Title-casing the fallback is sound rather than a guess BECAUSE of when it fires: the game gives
 * us the symbol alone only when the symbol is the plain word, so capitalising it reproduces the
 * display name. Anything harder than that arrives localised and never reaches this branch.
 *
 * The server normalises too, against the commodity names it actually holds — that is the fix that
 * covers members running an older build of this app. This one keeps the data right at the source.
 */
function nameOf(
  entry: Record<string, unknown>,
  /*
   * Journal CARGO entries key on `Type`; `Market.json` items key on `Name`. Same commodity, same
   * localisation rule, two spellings — so the keys are a parameter rather than a second copy of the
   * title-casing below, which is the part that took a production bug to get right.
   */
  keys: readonly [string, string] = ['Type_Localised', 'Type'],
): string | null {
  const localised = text(entry[keys[0]]);
  if (localised !== '') return localised;

  const wrapped = text(entry[keys[1]]);
  if (wrapped === '') return null;

  /*
   * ★ MARKET.JSON WRAPS ITS SYMBOLS AND THE JOURNAL DOES NOT ★
   *
   * A cargo entry carries `Type: "aluminium"`. A Market.json item carries
   * `Name: "$aluminium_name;"` — the game's localisation key. Title-casing that verbatim produces
   * `$aluminium_name;`, which joins to nothing on the hub and would have put a carrier's whole
   * manifest under names no board has ever heard of.
   *
   * Unwrapped before the same title-casing runs, so both spellings land on the display name every
   * other table in the platform uses.
   */
  const raw = wrapped.replace(/^\$/, '').replace(/_name;?$/i, '');
  if (raw === '') return null;

  // Per word, so `low_temp_diamond`-style symbols would not become one run-on capital either.
  return raw
    .split(/([\s_-]+)/)
    .map((part) => (/^[a-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join('');
}

function adjust(
  hold: CarrierHoldState['hold'],
  commodity: string,
  delta: number,
): CarrierHoldState['hold'] {
  const key = commodity.toLowerCase();
  const existing = hold[key];
  const held = existing?.tonnes ?? 0;
  // Clamped at zero, never negative: a withdrawal we never saw the deposit for is the fold's
  // ignorance, not negative cargo.
  const tonnes = Math.max(0, held + delta);

  /*
   * An ARRIVAL is what earns the right to report a zero later. Watching cargo come aboard and then
   * go again is a real account of the hold; watching only the going is ignorance, and `witnessed`
   * is what keeps those two apart all the way to the hub. See the field's own note.
   */
  const witnessed = (existing?.witnessed ?? false) || delta > 0;

  return {
    ...hold,
    [key]: { commodity: existing?.commodity ?? commodity, tonnes, witnessed },
  };
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

        /*
         * ★ THE ONE TRUE NUMBER THIS EVENT CARRIES — REPORTED 2026-08-05 ★
         *
         * "carrier hold info is not updating properly ... we need this to be way more accurate"
         *
         * The fold below is a WITNESS: it knows what it watched move and nothing else, so a
         * carrier holding twenty commodities shows however many the app happened to see. In
         * production that was literally one row. Nothing said so, and one commodity presented
         * without comment reads as the whole hold.
         *
         * `SpaceUsage.Cargo` is the game's own total tonnage aboard — no breakdown, but a true
         * figure. Keeping it is what lets the app and the site say "watched 6,600 t of the
         * 12,400 t aboard" instead of implying the two are the same. An honest gap is far more
         * useful than a confident wrong total, and it also tells a member when it is worth
         * opening carrier management to resync.
         */
        const usage = event.data['SpaceUsage'];
        const totalTonnes =
          typeof usage === 'object' && usage !== null
            ? count((usage as Record<string, unknown>)['Cargo'])
            : null;

        const switched = current.carrier !== null && current.carrier.marketId !== marketId;
        current = {
          ...current,
          carrier: { marketId, callsign, name },
          hold: switched ? {} : current.hold,
          // Belongs to THIS carrier. Switching carriers must not carry the old one's total over.
          totalTonnes: totalTonnes === 0 && switched ? 0 : totalTonnes,
          /*
           * The JOURNAL's timestamp, not the clock. The pass may be replaying a file written
           * hours ago, and stamping "now" would present an old reading as a fresh one — which is
           * the same lie the total exists to stop telling.
           */
          totalAt: totalTonnes === null ? current.totalAt : Date.parse(event.occurredAt) || null,
        };
        break;
      }

      /*
       * ★ REFUELLING TAKES TRITIUM OUT OF THE HOLD, AND NOTHING WAS SUBTRACTING IT ★
       *
       * `CarrierDepositFuel` moves tritium from the carrier's CARGO into its fuel tank. It is the
       * single most common thing an owner does to a carrier, and it was not handled at all — so
       * every tonne of tritium ever transferred aboard stayed on the books for ever, and the
       * figure only ever climbed. A carrier that had jumped its tritium away still reported
       * carrying it.
       *
       * Clamped at zero by `adjust`, like every other movement: a member who transferred tritium
       * aboard before the app was watching can deposit more than we ever saw arrive, and a
       * negative hold is not a thing.
       */
      case 'CarrierDepositFuel': {
        if (current.carrier === null) break;
        if (marketIdOf(event.data['CarrierID']) !== current.carrier.marketId) break;
        const amount = count(event.data['Amount']);
        if (amount === 0) break;
        current = { ...current, hold: adjust(current.hold, 'Tritium', -amount) };
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
      /*
       * ★ THE WHOLE HOLD, FROM THE JOURNAL — SQUADRON OWNER, 2026-08-17 ★
       *
       * "why can we not see this from journal logs? we should!"
       *
       * We can, and nothing was looking. Every other case here is a DELTA — what moved while the app
       * watched — so a carrier loaded before the app was running stayed invisible, and cAPI was the
       * only thing that could ever have filled that in.
       *
       * `Market.json` is rewritten every time a market screen opens, and for a fleet carrier it
       * lists the carrier's whole stock per commodity. The watcher ALREADY reads it and merges
       * `Items` into this event for the price path — the data has been arriving here all along.
       *
       * ★ A COMPLETE READING, SO IT REPLACES ★
       *
       * This is the one source in this fold that can speak for the whole hold, so it REPLACES rather
       * than adjusts: a commodity absent from the manifest is genuinely absent, and every entry is
       * marked `witnessed` because we have now seen the hold itself rather than a movement across
       * its edge. That is what lets a real zero be reported without the guesswork the witness rule
       * exists to prevent.
       *
       * Only for the member's OWN carrier: docking at somebody else's writes their manifest to the
       * same file, and storing that under our carrier's id would be the identity confusion the
       * `Docked` case above is careful to avoid.
       */
      case 'Market': {
        if (current.carrier === null) break;
        if (marketIdOf(event.data['MarketID']) !== current.carrier.marketId) break;

        const items = event.data['Items'];
        if (!Array.isArray(items)) break;

        const hold: Record<string, { commodity: string; tonnes: number; witnessed: boolean }> = {};
        for (const raw of items) {
          if (typeof raw !== 'object' || raw === null) continue;
          const entry = raw as Record<string, unknown>;

          const commodity = nameOf(entry, ['Name_Localised', 'Name']);
          if (commodity === null) continue;

          // `Stock` is what the carrier HOLDS. `Demand` is what it is asking to buy and is somebody
          // else's cargo until it arrives.
          const tonnes = count(entry['Stock']);
          if (tonnes === 0) continue;

          hold[commodity.toLowerCase()] = { commodity, tonnes, witnessed: true };
        }

        current = { ...current, hold };
        break;
      }

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
  /**
   * Tonnes aboard IN TOTAL, from `CarrierStats` rather than from watching.
   *
   * ★ THE HALF THAT WAS CAPTURED AND NEVER SENT ★
   *
   * The fold learned this and the snapshot dropped it, so the hub went on receiving a list of
   * witnessed commodities with nothing to weigh it against — and a carrier the app had seen one
   * commodity move on looked, on screen, like a carrier holding one commodity.
   *
   * Null until the member opens carrier management at least once. Absent rather than guessed: a
   * total invented from the sum of what we watched would be the exact false confidence this
   * exists to remove.
   */
  readonly totalTonnes: number | null;
  /** The journal timestamp of that reading, so a page can say how old the figure is. */
  readonly totalAt: string | null;
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
    /*
     * ★ A ZERO WE CANNOT VOUCH FOR IS NOT SENT ★
     *
     * See `witnessed`. A commodity clamped to zero by a withdrawal this fold never saw arrive is an
     * absence, not a statement — and sending it as a statement is what emptied real cargo off the
     * overlay, the carriers tab and the project page at once.
     *
     * Positive figures always go, whether witnessed or not: "I have seen at least this much" is
     * useful even when incomplete, because every consumer treats the journal as a FLOOR.
     */
    .filter((h) => h.tonnes > 0 || h.witnessed)
    .map((h) => ({ commodity: h.commodity, tonnes: h.tonnes }))
    .sort((a, b) => (a.commodity < b.commodity ? -1 : a.commodity > b.commodity ? 1 : 0));
  /*
   * ★ A TOTAL ALONE IS WORTH SENDING ★
   *
   * This returned null unless something had been WATCHED move, which is right for a list of
   * commodities and wrong for the total: a member who opens carrier management on a full hold the
   * app has never seen load has the most useful reading of all, and it was being discarded.
   */
  if (commodities.length === 0 && state.totalTonnes === null) return null;

  return {
    marketId: state.carrier.marketId,
    commodities,
    totalTonnes: state.totalTonnes,
    totalAt: state.totalAt === null ? null : new Date(state.totalAt).toISOString(),
  };
}
