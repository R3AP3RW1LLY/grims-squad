import type { HubCall } from './hub-colony.js';
import type { BgsStanding } from './bgs-session.js';

/**
 * The squadron's standing orders, read from the hub.
 *
 * ★ THE ONE THING THE APP CANNOT WORK OUT FOR ITSELF ★
 *
 * Everything else the BGS panel shows comes off the journal on this machine — which missions were
 * handed in, which factions moved, by how much. What it cannot know is which of those factions the
 * officers asked for. That is a squadron decision, made in the admin area, and it has to travel.
 *
 * Same shape the website reads, off the same device-token door, so the two surfaces cannot disagree
 * about what was ordered.
 */

/** The watchlist as the API sends it. */
interface WatchlistRow {
  readonly name: string;
  readonly isOurs: boolean;
  readonly orders: ReadonlyArray<{
    readonly stance: string;
    readonly systemName: string | null;
    readonly priority: number;
    readonly guidance: string | null;
    readonly activeUntil: string | null;
  }>;
}

/** A standing order with the flag the panel needs to mark our own faction. */
export interface CompanionStanding extends BgsStanding {
  readonly isOurs: boolean;
}

/**
 * Every order in force, flattened.
 *
 * The API returns factions each carrying their orders, which is the right shape for an officer
 * editing them. The panel wants the opposite — one flat list to filter by system — so the
 * flattening happens here rather than in the renderer, where it would run on every repaint.
 */
export async function fetchStandingOrders(call: HubCall): Promise<CompanionStanding[]> {
  if (call.deviceToken === '') return [];

  const doFetch = call.fetchImpl ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), call.timeoutMs ?? 15_000);

  let rows: WatchlistRow[];
  try {
    const res = await doFetch(
      `${call.apiBaseUrl.replace(/\/+$/, '')}/v1/companion/bgs/watchlist`,
      { method: 'GET', headers: { authorization: `Bearer ${call.deviceToken}` }, signal: ac.signal },
    );
    if (!res.ok) return [];
    rows = (await res.json()) as WatchlistRow[];
  } catch {
    /*
     * An empty list on failure, not a throw. This runs on a timer behind an overlay: a rejected
     * promise here would take out the whole refresh tick, and the panel keeps its last good orders
     * either way because the caller only replaces them on a successful pass.
     */
    return [];
  } finally {
    clearTimeout(timer);
  }

  if (!Array.isArray(rows)) return [];

  const out: CompanionStanding[] = [];

  for (const f of rows) {
    if (typeof f?.name !== 'string' || !Array.isArray(f.orders)) continue;

    for (const o of f.orders) {
      /*
       * Countermanded orders are dropped here rather than shown greyed out. An order an officer has
       * called off is not guidance any more, and a member glancing at a panel does not read state
       * chips — they read the list and act on it.
       */
      if (o.activeUntil !== null && new Date(o.activeUntil).getTime() <= Date.now()) continue;

      out.push({
        faction: f.name,
        isOurs: f.isOurs === true,
        stance: o.stance,
        systemName: o.systemName,
        priority: typeof o.priority === 'number' ? o.priority : 5,
        guidance: o.guidance,
      });
    }
  }

  return out;
}
