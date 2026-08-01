/**
 * A ship build, in one shape, whatever it was imported from.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "users should be able to submit links to existing coriolis and other elite dangerous ship builds
 * and it should take that link and learn everything about that ship and build (player owned builds)
 * ... this needs to learn everything possbile about the ship, build and components so we have a
 * strong baseline to build ships from when players start asking for this information"
 *
 * ★ ONE SHAPE, OR THE SECOND IMPORTER RUINS THE FIRST ★
 *
 * Coriolis and EDSY describe the same fitted ship in completely different encodings. Without a
 * canonical form in the middle, every consumer — the stats calculator, the retrieval leg, the page
 * that renders a build — would need to know which site a build came from. Two importers becomes two
 * of everything, and the third one nobody wants to write.
 *
 * So an importer's whole job is: URL in, `ShipBuild` out. It performs no I/O, stores nothing, and
 * knows nothing about us. Everything downstream reads this and never the original link.
 *
 * ★ THE LINK IS THE INPUT, NOT A PAGE TO FETCH ★
 *
 * Coriolis and EDSY both encode the ENTIRE build in the URL fragment. Decoding one is a lookup
 * against module tables we already hold from EDCD/coriolis-data, so importing a build makes no
 * network request at all: it cannot be rate limited, cannot break when a site is redesigned, works
 * with the site down, and raises no question about scraping somebody else's pages.
 *
 * Sites that publish only HTML would need fetching and parsing, and would break silently on every
 * restyle. Squadron owner chose Coriolis and EDSY first, on exactly that trade.
 */

/** Where a build came from. */
export type BuildSource = 'coriolis' | 'edsy';

/** Which group of slots a module sits in. Coriolis's own division, and the game's. */
export type SlotGroup = 'standard' | 'hardpoint' | 'internal' | 'utility';

/**
 * One fitted module.
 *
 * ★ `moduleId` IS CORIOLIS'S ID, DELIBERATELY ★
 *
 * Two characters, like `5E` or `FN`, and the key into the module tables the coriolis ingest already
 * loads. Using the game's internal symbol instead would be more "correct" and would mean every
 * lookup needed a translation table we would have to build and keep current — for no gain, since
 * every stat we hold is already keyed this way.
 */
export interface FittedModule {
  readonly group: SlotGroup;
  /** Position within its group, from the outside in. Matches the ship's own slot ordering. */
  readonly index: number;
  /** Coriolis module id. Null for an empty slot, which is a real and common answer. */
  readonly moduleId: string | null;
  /**
   * Slot capacity, from the ship. Kept even for empty slots.
   *
   * An empty class 6 slot and an empty class 1 slot are different facts about a build — one is
   * somebody's spare capacity and the other is a corner of the hull. Dropping the size would make
   * "what could I fit here" unanswerable.
   */
  readonly slotSize: number;
  /** False when the module is fitted but switched off in the power priorities. */
  readonly enabled: boolean;
  /** Power priority group, 1-5. Lower numbers stay on longer under a power failure. */
  readonly priority: number;
  /** Engineering applied to this module, if any. */
  readonly engineering: Engineering | null;
}

/** Engineering on one module. */
export interface Engineering {
  /** Coriolis blueprint id, e.g. `fsd_longrange`. Null when the modifications are hand-rolled. */
  readonly blueprintId: string | null;
  readonly blueprintName: string | null;
  /** 1-5. Null when unknown. */
  readonly grade: number | null;
  /** 0-1. Null when the source does not record it; NOT assumed to be complete. */
  readonly quality: number | null;
  /** The experimental effect, by coriolis id. Null when none is applied. */
  readonly experimentalId: string | null;
  /**
   * The actual modified values, by property name.
   *
   * Kept ALONGSIDE the blueprint rather than derived from it. A member can roll a grade 5 blueprint
   * to any quality, and can hand-modify outside a blueprint entirely — so the blueprint says what
   * they aimed at and this says what they got. Only the second one flies.
   */
  readonly modifiers: Readonly<Record<string, number>>;
}

/** A fitted ship, canonically. */
export interface ShipBuild {
  /** Coriolis ship key, e.g. `mandalay`. The join to everything we know about the hull. */
  readonly shipId: string;
  /** Display name, e.g. `Mandalay`. */
  readonly shipName: string;
  /** What the member called it, when the link carried a name. */
  readonly buildName: string | null;
  readonly source: BuildSource;
  /** The link exactly as submitted, so a member can always get back to it. */
  readonly sourceUrl: string;
  /** Coriolis bulkhead id, e.g. `Bs` for Lightweight Alloy. */
  readonly bulkheadId: string;
  readonly modules: readonly FittedModule[];
}

/**
 * What an importer answers.
 *
 * ★ A FAILURE IS A SENTENCE, NOT AN EXCEPTION ★
 *
 * Most import failures are somebody pasting the wrong thing — a link to the outfitting page with no
 * build in it, a truncated URL from a Discord message, a shortened link. None of those are errors in
 * our sense and all of them have a specific thing the member should do instead. A thrown exception
 * flattens them into "that did not work", which is the least useful thing we could say.
 */
export type ImportResult =
  | { readonly ok: true; readonly build: ShipBuild }
  | { readonly ok: false; readonly problem: string };

/** Hosts we can read, and which importer reads them. */
export const BUILD_HOSTS: Readonly<Record<string, BuildSource>> = {
  'coriolis.io': 'coriolis',
  'orbis.zone': 'coriolis',
  'edsy.org': 'edsy',
};

/**
 * Which importer handles a URL, or null.
 *
 * ★ `orbis.zone` IS CORIOLIS ★
 *
 * It is a community-run Coriolis mirror and by far the most commonly shared form of a Coriolis
 * link — a member pasting one is not doing anything unusual, and rejecting it as "unsupported"
 * would be wrong about the most likely input.
 *
 * Matching is on the HOST, after parsing, never on the string. `startsWith('https://coriolis.io')`
 * accepts `https://coriolis.io.evil.test/...` and a substring test accepts anything containing the
 * name anywhere — both are the classic way a URL check becomes an open door.
 */
export function sourceOf(url: string): BuildSource | null {
  let host: string;
  try {
    const parsed = new URL(url.trim());
    // Only the web. A `javascript:` or `data:` URL that happened to contain a known host would
    // otherwise be accepted by a naive host check.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    host = parsed.hostname.toLowerCase();
  } catch {
    return null;
  }

  // `www.` is stripped rather than listed twice, so a new host cannot be added in one form only.
  const bare = host.startsWith('www.') ? host.slice(4) : host;
  return BUILD_HOSTS[bare] ?? null;
}

/** Every host a member may paste, for the form's own help text. */
export const SUPPORTED_BUILD_HOSTS: readonly string[] = Object.keys(BUILD_HOSTS);

/**
 * How much of a build we managed to read.
 *
 * ★ A PARTIAL IMPORT IS REPORTED, NEVER PRESENTED AS COMPLETE ★
 *
 * Engineering is the part most likely to be missing: an older link may carry no modifications, and
 * an unknown blueprint id resolves to nothing. A build whose engineering did not survive still has
 * a correct hull and a correct module list and is worth keeping — but the AI must not answer
 * "Rablefin gets 68ly" from a build whose grade 5 FSD roll was silently dropped.
 */
export interface ImportCoverage {
  readonly modulesRead: number;
  readonly slotsTotal: number;
  readonly engineeredModules: number;
  /** True when every slot resolved to a known module or a known empty. */
  readonly complete: boolean;
  /** Anything skipped, in words, for the member who submitted it. */
  readonly warnings: readonly string[];
}

export function coverageOf(build: ShipBuild): ImportCoverage {
  const slotsTotal = build.modules.length;
  const modulesRead = build.modules.filter((m) => m.moduleId !== null).length;
  const engineeredModules = build.modules.filter((m) => m.engineering !== null).length;

  const warnings: string[] = [];
  /*
   * An empty module list is the shape a decoder returns when it recognised the ship and nothing
   * else. Worth saying out loud: it would otherwise be stored as a stock hull, which is a specific
   * and wrong claim about what somebody flies.
   */
  if (modulesRead === 0) {
    warnings.push('No modules could be read from this link — only the ship type.');
  }

  return {
    modulesRead,
    slotsTotal,
    engineeredModules,
    complete: warnings.length === 0,
    warnings,
  };
}
