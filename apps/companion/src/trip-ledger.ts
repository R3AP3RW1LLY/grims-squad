import type { ParsedLike } from './docked.js';

/**
 * What this trip has cost and earned, folded straight off the journal.
 *
 * ★ SQUADRON OWNER'S CHOICE, 2026-08-04: FULL TRIP P&L ★
 *
 * The cargo overlay shows what is aboard; this is the other half of the question a hauler actually
 * has — "is this run making money". Bought, sold, and the net between them, reset every time the
 * ship leaves a pad, because a trip is what happens between leaving one dock and leaving the next.
 *
 * ★ A PURE FOLD, LIKE trackDocked, FOR THE SAME REASON ★
 *
 * No Electron, no filesystem — events in, state out. Every rule here is a decision worth a test,
 * and the watcher threads it through its pass exactly the way the dock tracker is threaded.
 *
 * ★ NOTHING IS SEEDED AT STARTUP, DELIBERATELY ★
 *
 * A fresh app start begins an EMPTY trip. The journal tail could be replayed to reconstruct one,
 * but a ledger rebuilt from half a session would show a number whose starting point nobody can
 * name — and a P&L that cannot say what it is measuring from is worse than one that honestly
 * starts at zero. `since` says which kind of zero this is.
 */

export interface TripLedger {
  /** Credits paid at market buy screens since the trip began. */
  readonly spent: number;
  /** Credits received from sales since the trip began. */
  readonly earned: number;
  /**
   * What the zero point is: `dock` after we have watched a departure, `start` when the app was
   * launched mid-flight and the trip simply began where our knowledge does.
   */
  readonly since: 'dock' | 'start';
}

export const EMPTY_TRIP: TripLedger = { spent: 0, earned: 0, since: 'start' };

/** A journal amount, taken only when it is a real finite number — never NaN into a running sum. */
function amount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Folds a batch of events over the running trip.
 *
 * Takes the previous value so it works across passes, exactly like `trackDocked` — a member buys
 * in one twenty-second window and sells three windows later.
 */
export function foldTrip(previous: TripLedger, events: readonly ParsedLike[]): TripLedger {
  let current = previous;

  for (const event of events) {
    switch (event.name) {
      case 'MarketBuy':
        current = { ...current, spent: current.spent + amount(event.data['TotalCost']) };
        break;

      case 'MarketSell':
        current = { ...current, earned: current.earned + amount(event.data['TotalSale']) };
        break;

      /*
       * Handing cargo to a construction site. The journal event carries no credit figure today —
       * the game pays nothing at the depot — so this adds whatever credit the event reports,
       * which is usually zero, and that is honest: a contribution is spend already counted at the
       * buy screen, not income.
       */
      case 'ColonisationContribution':
        current = { ...current, earned: current.earned + amount(event.data['Credit']) };
        break;

      /*
       * ★ LEAVING THE PAD IS THE TRIP BOUNDARY ★
       *
       * Reset on `Undocked` rather than on `Docked`: a member sitting at a station buying, selling
       * and re-planning is still on the business of THIS visit, and blanking the ledger the moment
       * they landed would erase the sale they came to make. The trip ends when the ship leaves.
       */
      case 'Undocked':
        current = { spent: 0, earned: 0, since: 'dock' };
        break;

      default:
        break;
    }
  }

  return current;
}
