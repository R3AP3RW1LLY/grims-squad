import type { ParsedLike } from './docked.js';

/**
 * What the cargo aboard actually cost, and how the last sale went.
 *
 * ★ SQUADRON OWNER, 2026-08-04 — THE SECOND SHAPE OF THIS FILE ★
 *
 * The first shape was a whole-trip P&L: bought, sold, net, reset on undock. The owner's verdict
 * on seeing it fly: "just only show what the value was paid for the cargo ... the rest of the
 * displayed info aside from the quantity of material is useless as it does not track sold,
 * unless we can make that all persistent ... keep it on screen as the last transaction". So:
 *
 *   lots      — per commodity, how many units aboard were bought while the app watched, and what
 *               was paid for them. Depleted by sales and by construction contributions; NOT reset
 *               on undock, because the hold does not empty itself at the pad — cargo persists
 *               until it actually leaves the ship.
 *   lastSale  — the most recent completed sale, held on screen across undocks until the next one
 *               replaces it. Standard till-receipt behaviour: the last transaction stays visible.
 *
 * ★ COST BASIS PREFERS FRONTIER'S OWN NUMBER ★
 *
 * MarketSell carries AvgPricePaid — the game's average over every buy the member ever made,
 * including ones this app never saw. When present it prices the sale's basis; the lots ledger is
 * the fallback (and always the per-commodity display, since Frontier publishes no per-hold cost).
 * Mined and mission cargo was never bought: its paid figure is honestly absent, never zero.
 *
 * ★ STILL A PURE FOLD, STILL UNSEEDED ★
 *
 * Events in, state out, threaded through the watcher pass like trackDocked. A fresh app start
 * begins empty: a ledger rebuilt from half a session would show costs whose starting point nobody
 * can name. `since` says which kind of empty this was.
 */

export interface CargoLot {
  readonly units: number;
  /** Credits paid for those units at the buy screens the app watched. */
  readonly paid: number;
}

export interface LastSale {
  /** Display name, lower-cased — the overlay title-cases as it pleases. */
  readonly commodity: string;
  readonly units: number;
  /** Credits received. */
  readonly sale: number;
  /**
   * Cost basis for the sold units — AvgPricePaid when the journal gave it, the lots ledger
   * otherwise. Null when neither could price it (mined cargo sold before any watched buy),
   * because a fake zero would print a fake profit.
   */
  readonly paid: number | null;
}

export interface TripLedger {
  /** Keyed by lower-cased display name, matching how the cargo panel names the hold. */
  readonly lots: Readonly<Record<string, CargoLot>>;
  readonly lastSale: LastSale | null;
  readonly since: 'dock' | 'start';
}

export const EMPTY_TRIP: TripLedger = { lots: {}, lastSale: null, since: 'start' };

/** A journal amount, taken only when it is a real finite number — never NaN into a running sum. */
function amount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The display name a journal market event carries, in the panel's matching key form. */
function nameOf(data: Record<string, unknown>): string | null {
  const localised = data['Type_Localised'];
  const raw = data['Type'];
  const name =
    typeof localised === 'string' && localised !== ''
      ? localised
      : typeof raw === 'string' && raw !== ''
        ? raw
        : null;
  return name === null ? null : name.toLowerCase();
}

function consume(
  lots: Readonly<Record<string, CargoLot>>,
  key: string,
  units: number,
): { lots: Record<string, CargoLot>; consumedPaid: number; consumedUnits: number } {
  const next: Record<string, CargoLot> = { ...lots };
  const held = next[key];
  if (held === undefined || held.units <= 0 || units <= 0) {
    return { lots: next, consumedPaid: 0, consumedUnits: 0 };
  }

  const consumedUnits = Math.min(units, held.units);
  // Proportional: selling half the lot spends half its cost. Whole-lot sales clear it exactly.
  const consumedPaid = Math.round((held.paid * consumedUnits) / held.units);
  const remaining = held.units - consumedUnits;

  if (remaining <= 0) delete next[key];
  else next[key] = { units: remaining, paid: held.paid - consumedPaid };

  return { lots: next, consumedPaid, consumedUnits };
}

/**
 * Folds a batch of events over the running ledger. Takes the previous value so it works across
 * passes — a member buys in one twenty-second window and sells three windows later.
 */
export function foldTrip(previous: TripLedger, events: readonly ParsedLike[]): TripLedger {
  let current = previous;

  for (const event of events) {
    switch (event.name) {
      case 'MarketBuy': {
        const key = nameOf(event.data);
        const units = amount(event.data['Count']);
        const paid = amount(event.data['TotalCost']);
        if (key === null || units === 0) break;
        const held = current.lots[key] ?? { units: 0, paid: 0 };
        current = {
          ...current,
          lots: {
            ...current.lots,
            [key]: { units: held.units + units, paid: held.paid + paid },
          },
        };
        break;
      }

      case 'MarketSell': {
        const key = nameOf(event.data);
        const units = amount(event.data['Count']);
        const sale = amount(event.data['TotalSale']);
        if (key === null || units === 0) break;

        const consumed = consume(current.lots, key, units);

        const avg = Number(event.data['AvgPricePaid']);
        const paid =
          Number.isFinite(avg) && avg > 0
            ? Math.round(avg * units)
            : consumed.consumedUnits > 0
              ? consumed.consumedPaid
              : null;

        current = {
          ...current,
          lots: consumed.lots,
          lastSale: { commodity: key, units, sale, paid },
        };
        break;
      }

      /*
       * Handing cargo to a construction site empties the hold without a sale: the lots deplete so
       * the paid-for display keeps matching what is actually aboard, and lastSale is untouched —
       * a donation is not a transaction the till-receipt line should overwrite.
       */
      case 'ColonisationContribution': {
        const contributions = event.data['Contributions'];
        if (!Array.isArray(contributions)) break;
        let lots = current.lots;
        for (const raw of contributions) {
          if (typeof raw !== 'object' || raw === null) continue;
          const c = raw as Record<string, unknown>;
          const name =
            typeof c['Type_Localised'] === 'string' && c['Type_Localised'] !== ''
              ? c['Type_Localised']
              : typeof c['Type'] === 'string' && c['Type'] !== ''
                ? c['Type']
                : null;
          if (name === null) continue;
          lots = consume(lots, name.toLowerCase(), amount(c['Amount'])).lots;
        }
        current = { ...current, lots };
        break;
      }

      /*
       * ★ UNDOCKING NO LONGER RESETS ANYTHING ★
       *
       * The first shape zeroed a trip here. But the hold persists across an undock, so its costs
       * must too — and the last sale is exactly the thing the owner asked to KEEP on screen while
       * flying. The only thing departure changes is the honesty marker: from here on, the ledger
       * has watched a full dock cycle.
       */
      case 'Undocked':
        current = current.since === 'dock' ? current : { ...current, since: 'dock' };
        break;

      default:
        break;
    }
  }

  return current;
}
