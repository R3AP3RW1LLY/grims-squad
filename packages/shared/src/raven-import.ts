/**
 * Reading a Raven Colonial export.
 *
 * ★ SQUADRON OWNER, 2026-08-24 ★
 *
 * "in raven colonial, we can export a json file with a users build plan, can we take this file ...
 * and generate a new colonization plan"
 *
 * ★ THE PART THAT CHANGES WHAT THIS PLATFORM CAN KNOW ★
 *
 * An earlier session verified across 101 journals that Elite emits no architect-view slot counts —
 * every `Slot` field in the journal belongs to `ModuleBuy` / `ModuleRetrieve` / `ModuleSell`. That
 * is still true, and it is written into comments elsewhere in this repo.
 *
 * A Raven export carries them:
 *
 *     "slots": {"1":[1,-1], "9":[1,-1], "17":[1,2], "18":[3,2]}
 *
 * Keyed by body number, valued `[orbital, surface]`, `-1` where a body cannot take that kind at
 * all. Checked against production before this was written: our own hand-typed rows for
 * Col 285 Sector GL-W c2-12 say body 17 is (1, 2) and body 18 is (3, 2) — exactly what the file
 * says, entered by a member weeks earlier and independently. So the reading is confirmed against
 * truth rather than assumed from the shape.
 *
 * That matters because typing them does not scale: of thirteen planned systems, three have any slot
 * data at all. Members did three and stopped.
 *
 * ★ TOTAL, NEVER THROWING ★
 *
 * A member picks a file off their disk. It may be from a newer Raven, hand-edited, truncated, or
 * simply the wrong file. None of those are exceptional enough to throw over — the useful answer is
 * "here is what I could read, and here is what I could not", so the import can show it before
 * anything is written.
 */

/** One body, as the export describes it. */
export interface RavenBody {
  /** Frontier's body id. The same number our own `colony_bodies.body_id` uses — verified. */
  readonly bodyNum: number;
  readonly name: string;
  /** `st` star, `gg` gas giant, `ib` icy body, `ac` asteroid cluster, `bc` barycentre. */
  readonly type: string;
  readonly subType: string | null;
  readonly isLandable: boolean;
  readonly hasRings: boolean;
  readonly distanceLs: number | null;
  readonly gravity: number | null;
  readonly temperatureK: number | null;
}

/** One structure, planned or standing. */
export interface RavenSite {
  /** Raven's own row id. Kept only to report duplicates sensibly. */
  readonly id: string;
  readonly name: string;
  readonly bodyNum: number | null;
  /**
   * The catalogue row — `ourea`, `bellona`, `dec_truss`.
   *
   * These are build_type_ids, not display names, which the owner corrected me on directly. They map
   * straight onto our own catalogue.
   */
  readonly buildTypeId: string | null;
  /** `complete` and `build` are Raven's; anything else is treated as still an intention. */
  readonly status: 'complete' | 'building' | 'planned';
}

/** Slot counts for one body. `null` means the file did not say, which is not the same as zero. */
export interface RavenSlots {
  readonly bodyNum: number;
  readonly orbital: number | null;
  readonly surface: number | null;
}

export interface RavenImport {
  readonly systemName: string;
  /** Frontier's 64-bit address, as a string — it exceeds 2^53 and must not become a float. */
  readonly systemId64: string | null;
  /** Galactic coordinates, when present. Feeds the map. */
  readonly coords: { readonly x: number; readonly y: number; readonly z: number } | null;
  readonly architect: string | null;
  readonly bodies: readonly RavenBody[];
  readonly sites: readonly RavenSite[];
  readonly slots: readonly RavenSlots[];
  /** The export's schema version, recorded so a future shape change can be recognised. */
  readonly version: number | null;
  /**
   * Everything that could not be read, in a member's words.
   *
   * Not errors — the import still proceeds with what parsed. A file whose sites are unreadable but
   * whose forty bodies and nine slot records are fine is still worth importing, and the member
   * should be told exactly that rather than shown a failure.
   */
  readonly problems: readonly string[];
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const asFiniteNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Raven writes `-1` for "not applicable" and for several unknown measurements.
 *
 * A gas giant's `gravity` is real; its `radius` may be `-1`. A star's surface slots are `-1` because
 * it has no surface. Treating that as the number minus one would put a negative gravity in a plan
 * and a negative slot count in a checker, so it becomes null — an absence, which every consumer here
 * already knows how to render.
 */
const notApplicable = (v: unknown): number | null => {
  const n = asFiniteNumber(v);
  return n === null || n < 0 ? null : n;
};

const asText = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * Reads an export.
 *
 * `raw` is whatever `JSON.parse` produced, or the text itself — both are accepted, because the
 * caller reading a file and the caller holding an object should not need different functions.
 */
export function readRavenExport(raw: unknown): RavenImport | null {
  let parsed: unknown = raw;

  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // The one case that returns null: not JSON at all. There is nothing partial to offer.
      return null;
    }
  }

  const root = asRecord(parsed);
  if (root === null) return null;

  const systemName = asText(root['name']);
  if (systemName === null) {
    /*
     * Without a system name there is nothing to import INTO, and guessing from the body names would
     * be inventing the one fact everything else hangs off.
     */
    return null;
  }

  const problems: string[] = [];

  /*
   * id64 read as a STRING even though the file holds a number. 3382588805794 is fine in a double,
   * but ids in this range are routinely past 2^53 and `JSON.parse` has already rounded by the time
   * we see them — so this is best-effort and the caller matches on the NAME as well.
   */
  const id64 = asFiniteNumber(root['id64']);
  const systemId64 = id64 === null ? null : String(BigInt(Math.trunc(id64)));

  const pos = root['pos'];
  const coords =
    Array.isArray(pos) && pos.length === 3 && pos.every((n) => asFiniteNumber(n) !== null)
      ? { x: Number(pos[0]), y: Number(pos[1]), z: Number(pos[2]) }
      : null;
  if (pos !== undefined && coords === null) problems.push('The system’s coordinates could not be read.');

  const bodies: RavenBody[] = [];
  const rawBodies = root['bodies'];
  if (Array.isArray(rawBodies)) {
    for (const entry of rawBodies) {
      const b = asRecord(entry);
      const bodyNum = b === null ? null : asFiniteNumber(b['num']);
      const name = b === null ? null : asText(b['name']);
      if (b === null || bodyNum === null || name === null) continue;

      const features = Array.isArray(b['features'])
        ? b['features'].filter((f): f is string => typeof f === 'string')
        : [];

      bodies.push({
        bodyNum,
        name,
        type: asText(b['type']) ?? 'unknown',
        subType: asText(b['subType']),
        isLandable: features.includes('landable'),
        hasRings: features.includes('rings'),
        distanceLs: notApplicable(b['distLS']),
        gravity: notApplicable(b['gravity']),
        temperatureK: notApplicable(b['temp']),
      });
    }
    const dropped = rawBodies.length - bodies.length;
    if (dropped > 0) {
      problems.push(
        `${dropped} ${dropped === 1 ? 'body' : 'bodies'} had no id or name and ${dropped === 1 ? 'was' : 'were'} skipped.`,
      );
    }
  } else if (rawBodies !== undefined) {
    problems.push('The body list could not be read.');
  }

  const sites: RavenSite[] = [];
  const rawSites = root['sites'];
  if (Array.isArray(rawSites)) {
    for (const entry of rawSites) {
      const s = asRecord(entry);
      if (s === null) continue;

      const status = asText(s['status']);
      sites.push({
        id: asText(s['id']) ?? '',
        name: asText(s['name']) ?? '',
        bodyNum: asFiniteNumber(s['bodyNum']),
        buildTypeId: asText(s['buildType']),
        /*
         * `build` is Raven's word for under construction. Anything it does not recognise falls to
         * `planned`, which is the safe direction: a site wrongly called planned can be corrected by
         * a member, where one wrongly called complete would be treated as immovable by the drafter.
         */
        status: status === 'complete' ? 'complete' : status === 'build' ? 'building' : 'planned',
      });
    }
  } else if (rawSites !== undefined) {
    problems.push('The structure list could not be read.');
  }

  const slots: RavenSlots[] = [];
  const rawSlots = asRecord(root['slots']);
  if (rawSlots !== null) {
    for (const [key, value] of Object.entries(rawSlots)) {
      const bodyNum = Number.parseInt(key, 10);
      if (!Number.isFinite(bodyNum)) continue;
      if (!Array.isArray(value) || value.length < 2) continue;

      slots.push({
        bodyNum,
        orbital: notApplicable(value[0]),
        surface: notApplicable(value[1]),
      });
    }
  } else if (root['slots'] !== undefined) {
    problems.push('The slot counts could not be read.');
  }

  return {
    systemName,
    systemId64,
    coords,
    architect: asText(root['architect']),
    bodies,
    sites,
    slots,
    version: asFiniteNumber(root['v']),
    problems,
  };
}

/**
 * What the import would do, in a member's words, before it does any of it.
 *
 * ★ THE PREVIEW IS NOT OPTIONAL ★
 *
 * The worst outcome available here is silently replacing a plan somebody spent an evening on. A
 * count of what is about to change, shown first, is the whole difference between a tool and an
 * accident.
 */
export function describeRavenImport(file: RavenImport): string {
  const parts = [`${file.bodies.length} ${file.bodies.length === 1 ? 'body' : 'bodies'}`];

  if (file.sites.length > 0) {
    /*
     * "already placed", not "already standing". A `building` site is not finished, but the game has
     * taken its slot — and it is immovable for exactly the same reason a completed one is. The word
     * has to cover both, because what the member needs from this line is which structures the
     * drafter will have to work around rather than which are finished.
     */
    const placed = file.sites.filter((s) => s.status !== 'planned').length;
    parts.push(
      `${file.sites.length} ${file.sites.length === 1 ? 'structure' : 'structures'}` +
        (placed > 0 ? ` (${placed} already placed)` : ''),
    );
  }

  if (file.slots.length > 0) {
    parts.push(`slot counts for ${file.slots.length} ${file.slots.length === 1 ? 'body' : 'bodies'}`);
  }

  return `${file.systemName}: ${parts.join(', ')}.`;
}
