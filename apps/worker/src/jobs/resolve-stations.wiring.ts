import type { PrismaClient } from '@grims/db';
import type {
  PendingRow,
  ResolvedStation,
  StationSource,
  StationStore,
} from './resolve-stations.js';

/**
 * Where station details come from, and where they go.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "add the stations we do not hold" — looked up before being created, so they land complete rather
 * than as a name with no pad size.
 */

/** EDSM answers per system, which is why the job groups by system before it fetches. */
export const EDSM_STATIONS_URL = 'https://www.edsm.net/api-system-v1/stations';

/**
 * Large pads, derived from the station type.
 *
 * ★ DERIVED, BECAUSE EDSM DOES NOT PUBLISH IT ★
 *
 * Spansh's galaxy dump carries `landingPads` outright and EDSM's station list does not. The type is
 * the next best thing and is not a guess: the docking rules are a property of the station class in
 * the game, not of the individual station. Every Coriolis has large pads; no Outpost does.
 *
 * The number is what our own station records store, and it exists to answer one question — "can my
 * Cutter dock here". A count rather than a boolean because that is the shape `landingPads.large`
 * already has, and a station with pads reads as 4 there.
 *
 * An UNRECOGNISED type returns 0, which reads as "no large pads". That is the safe direction: a
 * member turned away from a station they were told they could not use has lost nothing, and one who
 * flies a Cutter somewhere it cannot dock has lost the trip.
 */
export function largePadsForType(type: string | null): number {
  if (type === null) return 0;

  const t = type.toLowerCase();

  /*
   * The classes where large pads are a HARD RULE of the station type, not a property of the
   * individual station. Every Coriolis has them; every fleet carrier has them.
   */
  if (t.includes('coriolis') || t.includes('orbis') || t.includes('ocellus')) return 4;
  if (t.includes('asteroid base')) return 4;
  if (t.includes('mega ship') || t.includes('megaship')) return 4;
  if (t.includes('fleet carrier')) return 4;

  // A large surface port. Unambiguous in the same way the orbitals are.
  if (t.includes('planetary port')) return 4;

  /*
   * ★ EVERYTHING ELSE IS 0, INCLUDING PLANETARY OUTPOSTS ★
   *
   * The first version returned 4 for "Planetary Outpost", which contradicted the rule stated above
   * it. Planetary outposts VARY — some take large ships and some do not — so the type alone cannot
   * answer the question, and this whole function exists to answer it from the type.
   *
   * Conservative, deliberately. A member turned away from a station they were told they could not
   * use has lost nothing; one who flies a Cutter somewhere it cannot dock has lost the trip. The
   * nightly Spansh dump carries the real `landingPads` and overwrites this the next time it covers
   * the station.
   */
  return 0;
}

/** EDSM's station list for one system. */
export class EdsmStationSource implements StationSource {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    /** EDSM asks for a courteous rate; one call per system already keeps this small. */
    private readonly timeoutMs = 20_000,
  ) {}

  async stationsIn(systemName: string): Promise<readonly ResolvedStation[] | null> {
    const url = `${EDSM_STATIONS_URL}?systemName=${encodeURIComponent(systemName)}`;

    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) return null;

    const body = (await res.json()) as { name?: unknown; stations?: unknown };

    /*
     * EDSM answers 200 with an EMPTY OBJECT for a system it does not know, rather than a 404. Read
     * as "unknown upstream" — null — rather than as "a system with no stations", because the second
     * would abandon every sighting in it after five tries when the truth is simply that EDSM has
     * not heard of it.
     */
    if (typeof body.name !== 'string') return null;
    if (!Array.isArray(body.stations)) return [];

    const out: ResolvedStation[] = [];
    for (const raw of body.stations) {
      const s = raw as {
        marketId?: unknown;
        name?: unknown;
        type?: unknown;
        distanceToArrival?: unknown;
      };

      if (typeof s.name !== 'string') continue;

      const type = typeof s.type === 'string' ? s.type : null;

      out.push({
        // 0 when EDSM has the station but not its market id, which is common for a new one. The
        // resolver falls back to matching by name.
        marketId: typeof s.marketId === 'number' ? s.marketId : 0,
        name: s.name,
        type,
        largePads: largePadsForType(type),
        distanceToArrival:
          typeof s.distanceToArrival === 'number' ? s.distanceToArrival : null,
      });
    }

    return out;
  }
}

export class PrismaStationStore implements StationStore {
  constructor(private readonly db: PrismaClient) {}

  async pending(limit: number): Promise<readonly PendingRow[]> {
    const rows = await this.db.pendingStation.findMany({
      where: { resolvedAt: null },
      // Never tried first, then least recently tried. A station that has just failed goes to the
      // back rather than being hammered on the next run.
      orderBy: [{ lastTriedAt: { sort: 'asc', nulls: 'first' } }],
      take: limit,
      select: { marketId: true, stationName: true, systemName: true, attempts: true },
    });

    return rows;
  }

  async systemId64(systemName: string): Promise<{ id64: string; name: string } | null> {
    /*
     * Our OWN galaxy data decides the id64, not EDSM. The key of a station row is
     * `<system id64>/<name>`, and using a different source's idea of that id would file stations
     * under a system nothing else in the database points at.
     */
    const rows = await this.db.$queryRawUnsafe<Array<{ id64: string; name: string }>>(
      `SELECT data->>'id64' AS id64, name
         FROM knowledge_items
        WHERE source = 'galaxy' AND kind = 'system' AND lower(name) = lower($1)
        LIMIT 1`,
      systemName,
    );

    const r = rows[0];
    return r === undefined || r.id64 === null ? null : { id64: r.id64, name: r.name };
  }

  async writeStation({
    id64,
    systemName,
    station,
  }: {
    id64: string;
    systemName: string;
    station: ResolvedStation;
  }): Promise<void> {
    /*
     * The SAME shape the galaxy ingest writes, so everything downstream — the market flattener, the
     * spatial search, the embedder — treats it as an ordinary station with no special case. A
     * different shape here would be a second kind of station that every reader had to learn about.
     *
     * `market` is deliberately absent: this row exists so the collector can attach live prices to
     * it, and inventing an empty market would claim the station trades nothing.
     */
    await this.db.knowledgeItem.upsert({
      where: { source_kind_extKey: { source: 'galaxy', kind: 'station', extKey: `${id64}/${station.name}` } },
      create: {
        source: 'galaxy',
        kind: 'station',
        extKey: `${id64}/${station.name}`,
        name: station.name,
        data: {
          system: systemName,
          systemId64: id64,
          marketId: String(station.marketId),
          type: station.type,
          landingPads: { large: station.largePads },
          distanceToArrival: station.distanceToArrival,
          /*
           * Recorded so anybody reading this row knows its pads were derived from the station type
           * rather than published, and that the nightly Spansh dump will overwrite it with better
           * data when it next covers this station.
           */
          resolvedFrom: 'edsm',
        },
      },
      // The dump is the better source. If it has already written this station, leave it alone.
      update: {},
    });
  }

  async markResolved(marketId: bigint): Promise<void> {
    await this.db.pendingStation.update({
      where: { marketId },
      data: { resolvedAt: new Date(), lastTriedAt: new Date(), lastError: null },
    });
  }

  async markTried(marketId: bigint, error: string | null): Promise<void> {
    await this.db.pendingStation.update({
      where: { marketId },
      data: { attempts: { increment: 1 }, lastTriedAt: new Date(), lastError: error },
    });
  }

  async abandon(marketId: bigint, reason: string): Promise<void> {
    /*
     * Marked resolved so it leaves the queue, with the reason kept. Deleting the row would let the
     * next sighting re-queue it immediately and the whole cycle would repeat for ever.
     */
    await this.db.pendingStation.update({
      where: { marketId },
      data: { resolvedAt: new Date(), lastError: `Given up: ${reason}` },
    });
  }
}
