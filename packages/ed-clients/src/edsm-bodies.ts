/**
 * A system's bodies, from EDSM.
 *
 * ★ SQUADRON OWNER, 2026-08-03 ★
 *
 * "ideally what we would like is the same interface that raven gives us, a layout of the system,
 * with spots on each planet that we can settle etc."
 *
 * ★ WHY EDSM AND NOT THE OTHER THREE ★
 *
 * We held no body data anywhere. Four sources could supply it and only one answers the question a
 * planner actually asks, which is "give me the bodies of system X, right now":
 *
 *   EDSM     one call, NO PAGING — a 173-body system came back in a single response — every field
 *            a planner needs, and a measured 720-per-hour token bucket. This one.
 *   Spansh   works, but ships 1.4 MB for Sol because the dump embeds every station's full commodity
 *            market. Its bodies search is leaner and has two silent-failure traps: a filter value
 *            that is not an array is IGNORED, and a page size over ~500 silently reverts to 25.
 *   EDDN     the live firehose. `Scan` events are 34.7% of it, but they only cover systems somebody
 *            is actively scanning right now — useless for "the system I want to plan".
 *   Journals our members'. Sparse by construction, and only for systems they have personally visited.
 *
 * ★ RATE LIMIT, MEASURED RATHER THAN READ ★
 *
 * Every secondary source disagrees — the EDMarketConnector issue tracker says 360/hour, forum posts
 * say 700/minute. The live headers say neither: `x-rate-limit-limit: 720` with a refill of one token
 * per five seconds, so 720/hour sustained and burstable to 720. Caching is what keeps us nowhere
 * near it: a squadron plans a handful of systems, not the galaxy.
 */

export interface EdsmBody {
  readonly bodyId: number;
  readonly name: string;
  /** `Star`, `Planet` or `Belt`. */
  readonly kind: string;
  /** "High metal content world", "Class I gas giant" — the thing that decides what can be built. */
  readonly subType: string | null;
  readonly isLandable: boolean;
  readonly gravity: number | null;
  readonly temperature: number | null;
  readonly distanceLs: number | null;
  readonly radiusKm: number | null;
  readonly hasRings: boolean;
  readonly terraformable: boolean;
  readonly hasAtmosphere: boolean;
  readonly hasVolcanism: boolean;
  /** The body this orbits, so a moon draws under its planet. Null for the primary star. */
  readonly parentBodyId: number | null;
}

export interface EdsmSystemBodies {
  readonly id64: number;
  readonly name: string;
  /** What EDSM believes the system holds, so a partial scan can say so. */
  readonly bodyCount: number | null;
  readonly bodies: readonly EdsmBody[];
}

/** Injected so the client is testable without a network. */
export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const ENDPOINT = 'https://www.edsm.net/api-system-v1/bodies';

interface RawBody {
  bodyId?: unknown;
  id64?: unknown;
  name?: unknown;
  type?: unknown;
  subType?: unknown;
  isLandable?: unknown;
  gravity?: unknown;
  surfaceTemperature?: unknown;
  distanceToArrival?: unknown;
  radius?: unknown;
  rings?: unknown;
  terraformingState?: unknown;
  atmosphereType?: unknown;
  volcanismType?: unknown;
  parents?: unknown;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Which body this one orbits.
 *
 * EDSM gives `parents` as an ordered list from nearest outwards — `[{Planet: 3}, {Star: 0}]` means
 * "a moon of body 3, which orbits body 0". The FIRST entry is the immediate parent, which is the
 * one a tree needs.
 *
 * `Null` appears as a parent type for barycentres, and it is a real entry rather than a missing one:
 * two stars orbiting each other have a barycentre with no body of its own. Skipped, so the child
 * attaches to the nearest thing that can actually be drawn.
 */
export function parentOf(parents: unknown): number | null {
  if (!Array.isArray(parents)) return null;

  for (const entry of parents) {
    if (entry === null || typeof entry !== 'object') continue;
    for (const [kind, id] of Object.entries(entry as Record<string, unknown>)) {
      if (kind === 'Null') continue;
      const n = Number(id);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** Turns one EDSM body into ours. Exported for the spec — the mapping is where the bugs live. */
export function mapBody(raw: RawBody): EdsmBody | null {
  const bodyId = num(raw.bodyId);
  const name = typeof raw.name === 'string' ? raw.name : '';
  if (bodyId === null || name === '') return null;

  const rings = Array.isArray(raw.rings) ? raw.rings : [];
  const atmosphere = typeof raw.atmosphereType === 'string' ? raw.atmosphereType : '';
  const volcanism = typeof raw.volcanismType === 'string' ? raw.volcanismType : '';
  const terraforming = typeof raw.terraformingState === 'string' ? raw.terraformingState : '';

  return {
    bodyId,
    name,
    kind: typeof raw.type === 'string' ? raw.type : 'Unknown',
    subType: typeof raw.subType === 'string' ? raw.subType : null,
    isLandable: raw.isLandable === true,
    gravity: num(raw.gravity),
    temperature: num(raw.surfaceTemperature),
    distanceLs: num(raw.distanceToArrival),
    // EDSM reports radius in kilometres already.
    radiusKm: num(raw.radius),
    hasRings: rings.length > 0,
    /*
     * "Candidate for terraforming" and "Terraformed" both count; "Not terraformable" does not. The
     * field is prose rather than a flag, so it is matched rather than compared.
     */
    terraformable: terraforming !== '' && !/^not\b/i.test(terraforming),
    // "No atmosphere" is the string EDSM uses for none — an empty value means unknown, not absent.
    hasAtmosphere: atmosphere !== '' && !/^no\b/i.test(atmosphere),
    hasVolcanism: volcanism !== '' && !/^no\b/i.test(volcanism),
    parentBodyId: parentOf(raw.parents),
  };
}

/**
 * Fetches a system's bodies.
 *
 * ★ AN UNKNOWN SYSTEM IS HTTP 200 WITH AN EMPTY OBJECT ★
 *
 * Not a 404. EDSM answers `{}` for a name it has never heard of and for a real system nobody has
 * scanned, and both are indistinguishable at the transport layer — so a missing system has to be
 * detected from the BODY of the response rather than its status. Returning null for it means the
 * caller can say "we hold nothing for that system" instead of showing an empty diagram as though
 * the system were barren.
 */
export async function fetchSystemBodies(
  systemName: string,
  fetcher: Fetcher,
): Promise<EdsmSystemBodies | null> {
  const url = `${ENDPOINT}?systemName=${encodeURIComponent(systemName)}`;

  const response = await fetcher(url);
  if (!response.ok) return null;

  let raw: { id64?: unknown; name?: unknown; bodyCount?: unknown; bodies?: unknown };
  try {
    raw = JSON.parse(await response.text()) as typeof raw;
  } catch {
    return null;
  }

  const id64 = num(raw.id64);
  const name = typeof raw.name === 'string' ? raw.name : '';
  // The empty-object case. No id64 means EDSM has nothing, whatever the status code said.
  if (id64 === null || name === '') return null;

  const list = Array.isArray(raw.bodies) ? raw.bodies : [];
  const bodies: EdsmBody[] = [];
  for (const entry of list) {
    const mapped = mapBody(entry as RawBody);
    if (mapped !== null) bodies.push(mapped);
  }

  return {
    id64,
    name,
    bodyCount: num(raw.bodyCount),
    // Nearest first, which is the order a system map is read in and the order somebody flies them.
    bodies: bodies.sort((a, b) => (a.distanceLs ?? 0) - (b.distanceLs ?? 0)),
  };
}
