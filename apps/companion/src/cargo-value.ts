/**
 * What the hold is worth, and when it is worth asking.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "the cargo overlay, rework this so it provides ritch information, but doesnt offer useless
 * information please. what we have now is confusing, we want valiue information but its showing
 * irrellevant sell information in it!"
 *
 * The panel answered two questions nobody was asking: what was paid for the hold (a sunk cost) and
 * what was last sold (a receipt for a trip already over). What a member carrying seven hundred
 * tonnes actually wants is what it is worth and where to take it — and that needs the squadron's
 * market table, which is why no other tool shows it.
 *
 * ★ THE RATE LIMIT IS THE HARD PART ★
 *
 * Valuing a hold costs one indexed query per distinct commodity against eighteen million rows. A
 * laser miner's cargo changes every few seconds for an hour; asking on every change would be
 * several hundred fan-outs to watch one number creep upward. So the decision of WHEN to ask lives
 * here, tested, rather than being a timer buried in the main process.
 */

/** One line of the hold, as the cargo fold reports it. */
export interface HoldLine {
  readonly commodity: string;
  readonly count: number;
  readonly wanted: boolean;
  readonly paid: number | null;
}

/**
 * Drones. They sit in the hold and are consumed rather than sold.
 *
 * Asking the market what a member's limpets are worth wastes a query on every mining session and
 * puts a line on the panel implying the hold is fuller of value than it is.
 */
const NOT_CARGO = new Set(['limpet', 'limpets', 'drones', 'drone']);

/** The hold as the hub's valuation wants it: commodity name to tonnes. */
export function holdOf(items: readonly HoldLine[]): Record<string, number> {
  const hold: Record<string, number> = {};
  for (const line of items) {
    if (NOT_CARGO.has(line.commodity.trim().toLowerCase())) continue;
    if (!Number.isFinite(line.count) || line.count <= 0) continue;
    hold[line.commodity] = line.count;
  }
  return hold;
}

/**
 * Worth now, less what was paid.
 *
 * ★ NULL RATHER THAN THE WHOLE HOLD ★
 *
 * Mined and mission cargo were never bought, so `totalPaid` is zero and a naive subtraction would
 * report the entire value of the hold as profit. A miner would be shown a gain they never made, in
 * the same typeface as a real one. No basis, no number, and the line does not render.
 */
export function unrealised(value: number | null, totalPaid: number): number | null {
  if (value === null) return null;
  if (!Number.isFinite(totalPaid) || totalPaid <= 0) return null;
  return Math.round(value - totalPaid);
}

/**
 * How long before a small change is worth re-pricing.
 *
 * Five minutes: long enough that a mining session does not hammer the hub, short enough that a
 * hauler who topped up at a second station sees it before they jump.
 */
const COOLDOWN_MS = 5 * 60_000;

/**
 * A change small enough to wait.
 *
 * Ten tonnes is roughly a scoop or two. Below that the answer to "what is it worth" moves by less
 * than the price staleness already in the data.
 */
const SMALL_CHANGE = 10;

export interface AskQuestion {
  readonly hold: Readonly<Record<string, number>>;
  /** When the last valuation was requested. Null if never. */
  readonly askedAt: number | null;
  /** The hold that valuation was for. Null if never. */
  readonly askedFor: Readonly<Record<string, number>> | null;
  readonly now: number;
}

/** Should the hub be asked to price this hold? */
export function worthAsking({ hold, askedAt, askedFor, now }: AskQuestion): boolean {
  const names = Object.keys(hold);
  // Nothing to value, and the answer is known without a query.
  if (names.length === 0) return false;

  // Never asked, and there is something aboard.
  if (askedAt === null || askedFor === null) return true;

  /*
   * A commodity we have not priced changes the answer to "where do I sell this" completely, where
   * one more tonne of something already aboard does not. So a new name is asked immediately,
   * however few tonnes of it there are.
   */
  for (const name of names) {
    if (!(name in askedFor)) return true;
  }
  // And a line that has gone entirely — sold off — is just as much a change.
  for (const name of Object.keys(askedFor)) {
    if (!(name in hold)) return true;
  }

  if (now - askedAt >= COOLDOWN_MS) return true;

  /*
   * Inside the cooldown, only a substantial move is worth re-pricing. This is what stops a laser
   * miner's tonne-every-few-seconds from becoming hundreds of fan-outs an hour.
   */
  let moved = 0;
  for (const name of names) {
    moved += Math.abs((hold[name] ?? 0) - (askedFor[name] ?? 0));
  }
  return moved >= SMALL_CHANGE;
}
