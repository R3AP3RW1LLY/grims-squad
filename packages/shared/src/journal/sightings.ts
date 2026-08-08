/**
 * Reading a journal event for what it says about the galaxy.
 *
 * ★ PURE, AND IN SHARED, ON PURPOSE ★
 *
 * The ingest service takes its collaborators by injection so a unit test of ingestion needs no
 * database — the market updater, the loadout importer and the colony applier are all optional for
 * that reason. Parsing belongs on the same side of that line: deciding whether an event carries
 * usable coordinates is a rule worth testing on its own, and it must not drag @grims/db into a
 * service that deliberately avoids it.
 *
 * The WRITERS live in @grims/db (`recordSystemSighting`, `enrichStationFromDock`). These are the
 * readers.
 */

/** What an FSDJump, Location or CarrierJump teaches us about a system. */
export interface SystemSighting {
  readonly systemAddress: string;
  readonly systemName: string;
  /** Galactic coordinates from `StarPos`. Null when the event did not carry them. */
  readonly coords: readonly [number, number, number] | null;
  readonly allegiance?: string | null | undefined;
  readonly economy?: string | null | undefined;
  readonly secondEconomy?: string | null | undefined;
  readonly government?: string | null | undefined;
  readonly security?: string | null | undefined;
  readonly population?: number | null | undefined;
}

/** What a Docked event teaches us about a station. Matches `DockFacts` in @grims/db. */
export interface DockSighting {
  readonly marketId: number;
  readonly stationName: string;
  readonly systemName: string;
  readonly systemAddress: number | null;
  readonly stationType: string | null;
  /** Large pads when the event carries LandingPads, null when it does not — never 0 for unknown. */
  readonly largePads: number | null;
  readonly distFromStarLs: number | null;
}

const str = (p: Record<string, unknown>, key: string): string | null =>
  typeof p[key] === 'string' && p[key] !== '' ? (p[key] as string) : null;

const num = (p: Record<string, unknown>, key: string): number | null =>
  typeof p[key] === 'number' && Number.isFinite(p[key]) ? (p[key] as number) : null;

/**
 * A system address arrives as a number from the journal and sometimes as a string once it has been
 * through JSON storage. Both are accepted; it is kept as a string because it is a 64-bit id and
 * INV-006 says those never become numbers.
 */
function addressOf(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
  return null;
}

/**
 * Read a system sighting, or null when the event cannot place a system at all.
 *
 * Null is only for the genuinely useless. A name and an address with no coordinates is still worth
 * recording — it is enough to stop the scout telling somebody to check the spelling of a system
 * they are standing in.
 */
export function readSystemSighting(payload: Record<string, unknown>): SystemSighting | null {
  const systemName = str(payload, 'StarSystem');
  const systemAddress = addressOf(payload['SystemAddress']);
  if (systemName === null || systemAddress === null) return null;

  /*
   * `StarPos` is [x, y, z]. One non-finite entry makes the whole triple useless: a cube() carrying
   * a NaN would place the system somewhere no distance query could return sensibly, which is worse
   * than having no coordinates at all.
   */
  const pos = payload['StarPos'];
  const coords =
    Array.isArray(pos) &&
    pos.length === 3 &&
    pos.every((n) => typeof n === 'number' && Number.isFinite(n))
      ? ([pos[0], pos[1], pos[2]] as [number, number, number])
      : null;

  return {
    systemAddress,
    systemName,
    coords,
    allegiance: str(payload, 'SystemAllegiance'),
    economy: str(payload, 'SystemEconomy'),
    secondEconomy: str(payload, 'SystemSecondEconomy'),
    government: str(payload, 'SystemGovernment'),
    security: str(payload, 'SystemSecurity'),
    population: num(payload, 'Population'),
  };
}

/**
 * Read a dock sighting, or null without a market id.
 *
 * The market id is not optional the way coordinates are: it is the station's identity, the one key
 * every source shares and no station ever changes. Without it a sighting cannot be tied to the
 * station's market rows and would create a second identity for the same place.
 */
export function readDockSighting(payload: Record<string, unknown>): DockSighting | null {
  const marketId = num(payload, 'MarketID');
  const stationName = str(payload, 'StationName');
  const systemName = str(payload, 'StarSystem');
  if (marketId === null || stationName === null || systemName === null) return null;

  const address = addressOf(payload['SystemAddress']);

  /*
   * ★ UNKNOWN PADS ARE NULL, NEVER ZERO ★
   *
   * The same rule `ensureLiveStation` states: a pad count we cannot vouch for must stay
   * distinguishable from a genuine zero, so a page can say "pads unknown" rather than lie in
   * either direction, and the large-pad filter excludes it either way.
   */
  const pads = payload['LandingPads'];
  const largePads =
    typeof pads === 'object' && pads !== null && 'Large' in pads
      ? num(pads as Record<string, unknown>, 'Large')
      : null;

  return {
    marketId,
    stationName,
    systemName,
    systemAddress: address === null ? null : Number(address),
    stationType: str(payload, 'StationType'),
    largePads,
    distFromStarLs: num(payload, 'DistFromStarLS'),
  };
}
