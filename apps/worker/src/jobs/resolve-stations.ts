/**
 * Turning a station EDDN reported into a station we hold.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "add the stations we do not hold" — and, asked what one should become given EDDN carries only a
 * name, a system and a market id: "Look each one up before creating it", so it lands complete with
 * pad size and type rather than as a stub.
 *
 * ★ WHY THE SYSTEM IS THE UNIT OF WORK ★
 *
 * Every source that knows about stations answers per SYSTEM, not per station — EDSM's
 * `api-system-v1/stations` returns every station in one call. Unknown stations cluster: a system
 * Spansh has not indexed yet contributes all of its stations at once, so resolving by system turns
 * eleven lookups into one and is the difference between keeping up and not.
 *
 * ★ AND WHY NOTHING IS WRITTEN HALF-KNOWN ★
 *
 * A record with a name and no pad size answers "where can I sell Painite" and then lies to the next
 * question, "can my Cutter dock there". The owner chose no stubs, so a station that cannot be
 * resolved stays in the queue and is retried — and a station nobody upstream has heard of stops
 * being retried rather than being invented.
 */

/** One station, as the upstream describes it. */
export interface ResolvedStation {
  readonly marketId: number;
  readonly name: string;
  readonly type: string | null;
  readonly largePads: number;
  readonly distanceToArrival: number | null;
}

export interface StationSource {
  /**
   * Every station in a system, or null when the system itself is unknown upstream.
   *
   * Null and an empty array mean different things: an empty system is a real answer that will not
   * improve on retry, and an unknown one may simply not be indexed yet.
   */
  stationsIn(systemName: string): Promise<readonly ResolvedStation[] | null>;
}

export interface PendingRow {
  readonly marketId: bigint;
  readonly stationName: string;
  readonly systemName: string;
  readonly attempts: number;
}

export interface StationStore {
  /** Unresolved sightings, least recently tried first. */
  pending(limit: number): Promise<readonly PendingRow[]>;
  /** The system's id64, or null when we do not hold the system either. */
  systemId64(systemName: string): Promise<{ id64: string; name: string } | null>;
  /** Writes a complete station record. */
  writeStation(input: {
    id64: string;
    systemName: string;
    station: ResolvedStation;
  }): Promise<void>;
  markResolved(marketId: bigint): Promise<void>;
  markTried(marketId: bigint, error: string | null): Promise<void>;
  /** Stops retrying a sighting nobody upstream has ever heard of. */
  abandon(marketId: bigint, reason: string): Promise<void>;
}

/**
 * How many times to try before giving up.
 *
 * Stations genuinely appear before any third party indexes them — a construction site laid down
 * this morning is real and unknown everywhere. Five attempts across five runs is a day or so of
 * patience, after which retrying it every run for ever costs a request and learns nothing.
 */
export const MAX_ATTEMPTS = 5;

export interface ResolveReport {
  readonly considered: number;
  readonly resolved: number;
  readonly stillUnknown: number;
  readonly abandoned: number;
  /** Systems we could not place at all, so nothing in them could be written. */
  readonly unknownSystems: number;
}

export async function resolveStations(
  store: StationStore,
  source: StationSource,
  limit = 200,
): Promise<ResolveReport> {
  const rows = await store.pending(limit);

  let resolved = 0;
  let stillUnknown = 0;
  let abandoned = 0;
  let unknownSystems = 0;

  /*
   * Grouped by system before anything is fetched. This is the whole reason the job is affordable:
   * unknown stations arrive in clusters from the same unindexed systems, and one call answers for
   * all of them.
   */
  const bySystem = new Map<string, PendingRow[]>();
  for (const row of rows) {
    const key = row.systemName.toLowerCase();
    bySystem.set(key, [...(bySystem.get(key) ?? []), row]);
  }

  for (const group of bySystem.values()) {
    const first = group[0];
    if (first === undefined) continue;

    /*
     * Our own system record first. A station's key is `<system id64>/<name>` and its coordinates
     * ARE its system's, so without the system there is nowhere to put it — and inventing an id64
     * would produce a station no spatial query could ever find.
     */
    const system = await store.systemId64(first.systemName);
    if (system === null) {
      unknownSystems += 1;
      for (const row of group) {
        await store.markTried(row.marketId, 'We do not hold that system yet.');
        if (row.attempts + 1 >= MAX_ATTEMPTS) {
          await store.abandon(row.marketId, 'The system is not in our galaxy data.');
          abandoned += 1;
        } else {
          stillUnknown += 1;
        }
      }
      continue;
    }

    const upstream = await source.stationsIn(system.name).catch(() => null);

    if (upstream === null) {
      // Unreachable or rate limited. Not the station's fault and not a reason to give up on it, so
      // the attempt is not even counted against it.
      for (const row of group) await store.markTried(row.marketId, 'The station source did not answer.');
      stillUnknown += group.length;
      continue;
    }

    const byMarketId = new Map(upstream.map((s) => [s.marketId, s]));
    const byName = new Map(upstream.map((s) => [s.name.toLowerCase(), s]));

    for (const row of group) {
      /*
       * Market id first, name second. The id is the identity; the name is what a carrier owner
       * changes on a whim, and matching on it alone would eventually attach one carrier's market to
       * another's record.
       */
      const found =
        byMarketId.get(Number(row.marketId)) ?? byName.get(row.stationName.toLowerCase()) ?? null;

      if (found === null) {
        await store.markTried(row.marketId, 'Upstream does not list that station yet.');
        if (row.attempts + 1 >= MAX_ATTEMPTS) {
          await store.abandon(row.marketId, 'No source has heard of it after several tries.');
          abandoned += 1;
        } else {
          stillUnknown += 1;
        }
        continue;
      }

      await store.writeStation({ id64: system.id64, systemName: system.name, station: found });
      await store.markResolved(row.marketId);
      resolved += 1;
    }
  }

  return { considered: rows.length, resolved, stillUnknown, abandoned, unknownSystems };
}
