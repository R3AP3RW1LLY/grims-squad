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

/**
 * Where a build came from.
 *
 * ★ `journal` IS THE STRONGEST OF THE THREE ★
 *
 * A link is somebody's PLAN for a ship. `journal` is the ship — the game's own `Loadout` event,
 * forwarded by the companion app, carrying the engineering that is actually fitted with its grade,
 * quality, engineer and every modifier. It needs no decoding and it refreshes on every refit.
 *
 * Worth ranking explicitly, because an answer built from a member's real ship and one built from a
 * link they shared a year ago deserve different confidence.
 */
export type BuildSource = 'coriolis' | 'edsy' | 'journal';

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

/**
 * What a build is FOR, inferred from what is bolted to it.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "please add a status bar like we have on the image training page so we know how many ship builds
 * we need for reliable training ... over do it on the requirements so we have a solid base to train
 * with"
 *
 * A bar needs something to count TOWARDS, and "forty builds" is not a target — forty exploration
 * builds teach the assistant nothing about mining. So builds are counted per role, and the role is
 * read off the modules rather than asked for: the person pasting a link they found on a forum has
 * no idea how we categorise it, and a dropdown they guess at is worse data than a rule.
 */
export type BuildRole = 'mining' | 'combat' | 'exploration' | 'trading' | 'multipurpose';

export const BUILD_ROLES: readonly BuildRole[] = [
  'mining',
  'combat',
  'exploration',
  'trading',
  'multipurpose',
];

export const BUILD_ROLE_LABELS: Readonly<Record<BuildRole, string>> = {
  mining: 'Mining',
  combat: 'Combat',
  exploration: 'Exploration',
  trading: 'Trading',
  multipurpose: 'Multipurpose',
};

/**
 * How many builds each role needs before the assistant should be trusted on it.
 *
 * ★ DELIBERATELY HIGH, ON INSTRUCTION ★
 *
 * "over do it on the requirements so we have a solid base to train with." These are not the minimum
 * that makes an answer possible — the fitting engine already computes a correct build from one hull
 * and one module table. They are the number at which the assistant can say what people ACTUALLY
 * fly, which is a different and much more useful claim, and it needs enough examples that one
 * unusual build cannot skew it.
 *
 * Combat is highest because it has the widest spread: the same hull is fitted completely differently
 * for ganking, for AX, for bounty hunting and for PvP, and a handful of examples would teach the
 * assistant that one of those is "the" combat build.
 */
export const BUILD_ROLE_TARGETS: Readonly<Record<BuildRole, number>> = {
  combat: 60,
  mining: 40,
  exploration: 40,
  trading: 40,
  multipurpose: 30,
};

/** Module groups that mark a build as belonging to a role. */
const ROLE_MARKERS: Readonly<Record<Exclude<BuildRole, 'multipurpose'>, readonly string[]>> = {
  // A refinery is the tell. Mining lasers without one is somebody cutting rocks for fun.
  mining: ['rf'],
  // Weapons that do damage, as opposed to mining tools that also happen to.
  combat: ['mc', 'pl', 'bl', 'c', 'rg', 'pa', 'ml_', 'nl', 'tp', 'mr', 'axmc', 'abl_'],
  // A fuel scoop is what separates a long trip from a long jump.
  exploration: ['fs'],
  trading: ['cr'],
};

/**
 * Which role a build serves, from the module groups fitted to it.
 *
 * ★ ORDER MATTERS, AND IT IS NOT ALPHABETICAL ★
 *
 * A mining ship carries cargo racks; a trader does not carry a refinery. So the SPECIFIC markers are
 * tested before the general ones — otherwise every miner and every explorer with a hold would be
 * filed as a trader, and the trading bar would fill with ships nobody trades in.
 *
 * `multipurpose` is the honest answer for a build that shows no strong marker, not a failure. Plenty
 * of real ships are exactly that, and forcing them into a role would put noise in a bar somebody is
 * using to decide what to go and collect.
 */
export function classifyBuild(groups: readonly string[]): BuildRole {
  const has = (markers: readonly string[]): boolean => markers.some((m) => groups.includes(m));

  if (has(ROLE_MARKERS.mining)) return 'mining';
  if (has(ROLE_MARKERS.combat)) return 'combat';
  if (has(ROLE_MARKERS.exploration)) return 'exploration';

  /*
   * Cargo alone is a trader only if there is a REAL hold. Two tonnes is the rack a stock ship ships
   * with, and counting it would file every unmodified hull as a trading build.
   */
  if (has(ROLE_MARKERS.trading)) return 'trading';

  return 'multipurpose';
}

/** How the training page reports one role. */
export interface BuildRoleProgress {
  readonly role: BuildRole;
  readonly label: string;
  readonly have: number;
  readonly need: number;
  /** True once there are enough to answer from with confidence. */
  readonly ready: boolean;
}

export function buildProgress(counts: Readonly<Partial<Record<BuildRole, number>>>): BuildRoleProgress[] {
  return BUILD_ROLES.map((role) => {
    const have = counts[role] ?? 0;
    const need = BUILD_ROLE_TARGETS[role];
    return { role, label: BUILD_ROLE_LABELS[role], have, need, ready: have >= need };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARING
//
// ★ SQUADRON OWNER, 2026-08-01 ★
//
// "also include shareable links, and the ability for our users to share their builds and make them
// visible to the squadron and public if they choose to please."
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Who may open a saved build.
 *
 * ★ THREE STATES, AND THE DEFAULT IS THE QUIET ONE ★
 *
 * A build is a plan. Somebody working out whether they can afford a Cutter has not decided to tell
 * the squadron they are saving for one, and a builder that published by default would make that
 * decision for them. So `private` is where every build starts and the other two are chosen.
 *
 * `squadron` and `public` are separate rather than a single "shared" flag because they differ in
 * one property that matters: a squadron link can be un-shared and it is actually gone, since every
 * reader had to sign in. A public link cannot — once it is copied, it is out.
 */
export type BuildVisibility = 'private' | 'squadron' | 'public';

export const BUILD_VISIBILITIES: readonly BuildVisibility[] = ['private', 'squadron', 'public'];

/** What each choice means, in the words shown to the member making it. */
export const BUILD_VISIBILITY_LABELS: Readonly<Record<BuildVisibility, string>> = {
  private: 'Only you',
  squadron: 'Anyone in the squadron',
  public: 'Anyone with the link',
};

export const BUILD_VISIBILITY_NOTES: Readonly<Record<BuildVisibility, string>> = {
  private: 'Kept against your account. Nobody else can open it.',
  squadron: 'Signed-in members can open it, with your name on it. Set it back to private and it is gone.',
  public: 'Works without signing in. Once somebody has the link you cannot take it back.',
};

export function isBuildVisibility(value: unknown): value is BuildVisibility {
  return typeof value === 'string' && (BUILD_VISIBILITIES as readonly string[]).includes(value);
}

/**
 * The alphabet a share token is drawn from.
 *
 * ★ NO VOWELS, NO LOOKALIKES ★
 *
 * Vowels are out so a random token cannot spell something the squadron then has to explain. `0/O`
 * and `1/l/I` are out because these get read down a voice channel and typed by hand — a token that
 * is unambiguous when spoken is worth more than four extra bits of entropy.
 *
 * 29 characters and a length of 12 is about 58 bits, which is far past guessable for a resource
 * whose worst case is a stranger reading a ship build.
 */
export const SHARE_TOKEN_ALPHABET = '23456789bcdfghjkmnpqrstvwxyz';
export const SHARE_TOKEN_LENGTH = 12;

export function isShareToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === SHARE_TOKEN_LENGTH &&
    [...value].every((c) => SHARE_TOKEN_ALPHABET.includes(c))
  );
}
