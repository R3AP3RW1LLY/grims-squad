import type { SlotGroup } from '@grims/shared/ship-build';

/**
 * Everything a build decoder needs to know about ships and modules.
 *
 * ★ BUILT FROM DATA WE ALREADY HOLD ★
 *
 * The `coriolis` ingest lands EDCD/coriolis-data nightly: 47 ships with their slot layouts and
 * stock loadouts, and 89 module groups holding every class and rating. A build link is nothing but
 * a list of ids into that. So decoding one is a lookup, not a download — no network, no rate limit,
 * nothing that breaks when a site is redesigned.
 *
 * ★ THE INDEX IS GROUPED, AND THAT IS NOT AN OPTIMISATION ★
 *
 * Coriolis module ids are unique only WITHIN a module group. Measured on the live data: 115 of 847
 * ids appear in more than one group. `F9` is `Int_Hyperdrive_Size3_Class1` in the `fsd` group and a
 * Fuel Transfer Limpet Controller in `fx`.
 *
 * A flat id → module map therefore returns whichever group happened to be indexed last, and the
 * build it produces is plausible, wrong, and impossible to spot: an Adder with a limpet controller
 * where its frame shift drive should be. Every lookup here is scoped, and the scope comes from the
 * SLOT, which the ship layout knows.
 *
 * Within a slot CATEGORY there is no ambiguity at all — standard 297 ids, hardpoint 177, utility
 * 39, internal 449, and zero collisions in any of them. So scoping by category is both necessary
 * and sufficient.
 */

/** One module, as coriolis describes it. */
export interface CatalogueModule {
  readonly id: string;
  /** Coriolis group key: `pp`, `fsd`, `pl`, `sg`… */
  readonly grp: string;
  readonly name: string;
  /** The game's own symbol, e.g. `Int_Hyperdrive_Size3_Class1`. The join to journal data. */
  readonly symbol: string | null;
  readonly class: number;
  readonly rating: string | null;
  readonly mass: number | null;
  readonly power: number | null;
  readonly integrity: number | null;
  readonly cost: number | null;
  /** Everything else coriolis records, verbatim. The stats an answer is actually built from. */
  readonly raw: Readonly<Record<string, unknown>>;
}

/** One slot on a hull. */
export interface CatalogueSlot {
  readonly group: SlotGroup;
  readonly index: number;
  readonly size: number;
  /**
   * For standard slots, the one group that may go there. Null elsewhere.
   *
   * Standard slots are positional and fixed: power plant, thrusters, FSD, life support, power
   * distributor, sensors, fuel tank, in that order and no other. That is what makes them decodable
   * without ambiguity even though the id alone would not be.
   */
  readonly fixedGroup: string | null;
  /**
   * Module groups this slot will accept, when it is restricted. Null when anything of the size fits.
   *
   * ★ RESTRICTED SLOTS ARE REAL AND THE FITTER MUST RESPECT THEM ★
   *
   * The Type-11 Prospector's hardpoints are mining-only (`ml`, `abl`, `mvr`, `pwa`, `scl`, `sdm`);
   * several hulls have a limpet-only bay and a fighter-only bay. Fitting a beam laser into a mining
   * mount produces a build that reads perfectly and cannot be bought.
   */
  readonly eligible: readonly string[] | null;
}

export interface CatalogueShip {
  readonly id: string;
  readonly name: string;
  /**
   * Frontier's own id for the hull. Null when coriolis-data does not record one.
   *
   * The join to EDSY, which records the same number as `fdid`. Names cannot do it: EDSY calls the
   * Alliance Challenger `TypeX_3` and this file calls it `alliance_challenger`.
   */
  readonly edID: number | null;
  readonly slots: readonly CatalogueSlot[];
  /**
   * The stock loadout, PER GROUP, aligned to that group's own slots.
   *
   * ★ NOT ONE FLAT ARRAY — SQUADRON OWNER, 2026-08-01 ★
   *
   * "check the cargo levels on the imported builds they do not seem right especially the panther
   * clipper ... 32t seems really low even for the stock build!"
   *
   * It was. This used to be `standard ++ hardpoints ++ internal` flattened, mapped index-to-index
   * against the slots flattened the same way — which is correct only while every array is the same
   * length on both sides. TEN of the 141 arrays in coriolis-data are not: the Panther lists more
   * hardpoint slots than hardpoint defaults, so every internal default shifted left by the
   * difference.
   *
   * The Panther's first cargo bay is a class 8 (`06`, 256 t). It was reading `04`, a class 5, out of
   * a later position — 32 t, in a hauler, which is exactly what looked wrong to the owner. Nothing
   * errored; the build was simply somebody else's modules in the wrong holes.
   *
   * Kept per group, each aligned to its own slots, a short array just leaves the later slots empty.
   */
  readonly defaults: Readonly<Record<SlotGroup, readonly (string | null)[]>>;
  readonly bulkheads: readonly CatalogueModule[];
  readonly properties: Readonly<Record<string, unknown>>;
}

/**
 * The order of the standard slots.
 *
 * Fixed by the game and by coriolis, and the reason a standard slot never needs a search: position
 * 2 is the frame shift drive, so `F9` there is looked up in `fsd` and cannot resolve to the limpet
 * controller that shares its id.
 */
export const STANDARD_GROUPS: readonly string[] = ['pp', 't', 'fsd', 'ls', 'pd', 's', 'ft'];

/** Which category a slot falls into, for scoping a lookup. */
export type SlotCategory = 'standard' | 'hardpoint' | 'utility' | 'internal';

export function categoryOf(slot: CatalogueSlot): SlotCategory {
  if (slot.group === 'standard') return 'standard';
  if (slot.group === 'internal') return 'internal';
  // A hardpoint of class 0 IS a utility mount — coriolis keeps them in one array and tells them
  // apart by size, and so does the game.
  return slot.size === 0 ? 'utility' : 'hardpoint';
}

export interface BuildCatalogue {
  ship(shipId: string): CatalogueShip | null;
  /** Every ship, for the baseline importer and for name matching. */
  ships(): readonly CatalogueShip[];
  /** A module by id, scoped to a slot category. Null when the id is not one. */
  module(category: SlotCategory, id: string): CatalogueModule | null;
  /**
   * A standard module by class and rating, e.g. the class 3 rating E frame shift drive.
   *
   * ★ STOCK LOADOUTS SPEAK A DIFFERENT DIALECT ★
   *
   * `defaults.standard` in coriolis-data is `["3E","3E","3E","1E","2E","3E","3C"]` — CLASS AND
   * RATING, not module ids. The URL code for the same ship writes `p9 t9 F9 l4 d9 se f3`, which are
   * ids. Two encodings for the same seven slots, in one file.
   *
   * Reading a stock loadout through the id index therefore resolves nothing at all, silently: every
   * standard slot comes back empty and the ship looks like a hull with no power plant. Found by
   * decoding the owner's `coriolis.io/outfit/panthermkii` link and seeing seven blanks.
   *
   * Internal and hardpoint defaults DO use ids. Only `standard` is different.
   */
  standardByRating(group: string, cls: number, rating: string): CatalogueModule | null;
  /**
   * A module by the GAME's own symbol, scoped to a slot category.
   *
   * The journal writes `hpt_pulselaser_gimbal_medium`; coriolis records `Hpt_PulseLaser_Gimbal_Medium`
   * on the same module. Case-insensitively they are the same string, so the two datasets join with
   * no translation table to build or keep current — 93.7% of every functional module we have ever
   * seen in a real loadout, with the remainder being holograms and ship-kit parts.
   */
  moduleBySymbol(category: SlotCategory, symbol: string): CatalogueModule | null;
  /**
   * Every module of one group that could go in one kind of slot.
   *
   * The fitter's whole vocabulary. Scoped by category for the same reason every other lookup is —
   * `F9` is a drive among the standard modules and a limpet controller among the internals, and a
   * fitter that searched across categories would offer one for the other.
   */
  modulesIn(category: SlotCategory, group: string): readonly CatalogueModule[];
}

/** The raw shapes the coriolis ingest stores. Narrow on purpose — this reads a few fields of many. */
export interface RawShipItem {
  readonly extKey: string;
  readonly name: string;
  readonly data: unknown;
}
export interface RawModuleItem {
  /**
   * The group's display name, e.g. "Power Distributor".
   *
   * Optional so existing callers that select only `data` still compile — but they will get symbol
   * fallbacks for the 168 modules that carry no name of their own, so pass it.
   */
  readonly name?: string | null;
  readonly data: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * A name a person would recognise.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "in the various equipment dropdowns, we need to make sure the names of the items are human
 * readable, these look like they are keys."
 *
 * They were keys. The fallback was `symbol`, so most of the fleet's modules were offered as
 * `Int_PowerDistributor_Size8_Class1`.
 *
 * ★ THREE SOURCES, BECAUSE NO ONE OF THEM COVERS THE FLEET ★
 *
 * Of 970 modules, 141 carry `name` — only the variants that need distinguishing from their group,
 * like "Guardian Power Distributor". 742 carry `ukName`, coriolis's display name. 168 carry
 * NEITHER: the abrasion blasters and AX missile racks, whose group name is the whole name.
 *
 * So: the module's own name, else its display name, else the group's. Every one of the 970 resolves
 * to something readable, and `symbol` survives only as a last resort that should now be unreachable
 * — kept because a new module group with no name at all should show something rather than blank.
 */
function displayName(raw: Record<string, unknown>, groupName: string | null, id: string): string {
  if (typeof raw['name'] === 'string' && raw['name'] !== '') return raw['name'];
  if (typeof raw['ukName'] === 'string' && raw['ukName'] !== '') return raw['ukName'];
  if (groupName !== null && groupName !== '') return groupName;
  return typeof raw['symbol'] === 'string' && raw['symbol'] !== '' ? raw['symbol'] : id;
}

/**
 * Coriolis derives its group names from directory names, and a few are misspelled at the source.
 *
 * Corrected here rather than in the ingest: the ingest's job is to mirror upstream faithfully, and a
 * squadron member reading "Pristmatic Shield Generator" in a dropdown would reasonably conclude we
 * could not spell. If coriolis fixes these upstream the corrected spelling simply matches and this
 * map stops mattering.
 */
const GROUP_NAME_FIXES: Readonly<Record<string, string>> = {
  'Pristmatic Shield Generator': 'Prismatic Shield Generator',
  'Planetary Vehicle Hanger': 'Planetary Vehicle Hangar',
  'Ax Missile Rack Enhanced': 'AX Missile Rack (Enhanced)',
  'Ax Multi Cannon': 'AX Multi-Cannon',
  'Guardian Fsd Booster': 'Guardian FSD Booster',
};

function toModule(raw: Record<string, unknown>, groupName: string | null): CatalogueModule | null {
  const id = raw['id'];
  const grp = raw['grp'];
  if (typeof id !== 'string' || typeof grp !== 'string') return null;

  const fixed = groupName === null ? null : (GROUP_NAME_FIXES[groupName] ?? groupName);

  return {
    id,
    grp,
    name: displayName(raw, fixed, id),
    symbol: typeof raw['symbol'] === 'string' ? raw['symbol'] : null,
    // Utility mounts and bulkheads have no class; zero is the honest reading, and `categoryOf`
    // relies on it to tell a chaff launcher from a pulse laser.
    class: num(raw['class']) ?? 0,
    rating: typeof raw['rating'] === 'string' ? raw['rating'] : null,
    mass: num(raw['mass']),
    power: num(raw['power']),
    integrity: num(raw['integrity']),
    cost: num(raw['cost']),
    raw,
  };
}

/**
 * A slot's size, from coriolis's own encoding.
 *
 * Slots are usually a bare number. The Planetary Approach Suite is an object with a `class`, and
 * treating it as a number would give NaN and a slot nothing can be fitted into — which is exactly
 * the slot every stock loadout fills.
 */
function slotSize(entry: unknown): number {
  if (typeof entry === 'number') return entry;
  const size = num(asRecord(entry)['class']);
  return size ?? 0;
}

/**
 * Which module groups a restricted slot accepts.
 *
 * Coriolis writes these as `{ name: 'Mining', class: 3, eligible: { ml: 1, abl: 1, … } }`. A plain
 * numeric slot has no restriction and returns null — which the fitter reads as "anything of the
 * size", not as "nothing".
 */
function eligibleOf(entry: unknown): readonly string[] | null {
  const eligible = asRecord(asRecord(entry)['eligible']);
  const groups = Object.keys(eligible);
  return groups.length === 0 ? null : groups;
}

/**
 * A stock-loadout entry.
 *
 * ★ CORIOLIS WRITES MODULE IDS AS BOTH STRINGS AND NUMBERS ★
 *
 * `"4j"` and `17` are both module ids in the same array. Ids are base-62-ish pairs, so any pair of
 * digits — `17`, `02`, `00` — parses as a JSON number if whoever edited the file left the quotes
 * off, and coriolis's own loosely-typed JS never noticed. Accepting only strings silently dropped
 * 89 stock modules across the fleet, which is why hardpoints came up empty on ships that ship with
 * weapons fitted.
 *
 * ★ AND `0` IS EMPTY, NOT MODULE ZERO ★
 *
 * 482 entries are a numeric `0` meaning "nothing fitted". There IS a module whose id is `"0"` — a
 * medium turreted Plasma Shock Cannon — so coercing every number to a string would have fitted 482
 * plasma shock cannons across the fleet and made every stock loadout wrong in a way that looks
 * deliberate. Coriolis's own rule is falsiness: `0` and `""` are empty, anything else is an id.
 */
function defaultId(entry: unknown): string | null {
  if (typeof entry === 'string') return entry === '' ? null : entry;
  if (typeof entry === 'number') return entry === 0 || !Number.isFinite(entry) ? null : String(entry);
  return null;
}

/**
 * Builds the index.
 *
 * One pass over the ingested rows. Called once per import rather than held in a long-lived cache:
 * the data changes when Frontier ships an update, imports are rare, and a stale catalogue would
 * decode a build against last month's ships without saying so.
 */
export function buildCatalogue(ships: readonly RawShipItem[], modules: readonly RawModuleItem[]): BuildCatalogue {
  const byCategory: Record<SlotCategory, Map<string, CatalogueModule>> = {
    standard: new Map(),
    hardpoint: new Map(),
    utility: new Map(),
    internal: new Map(),
  };

  const standardGroups = new Set(STANDARD_GROUPS);

  for (const item of modules) {
    const variants = Array.isArray(item.data) ? item.data : [];
    for (const entry of variants) {
      const module = toModule(asRecord(entry), item.name ?? null);
      if (module === null) continue;

      /*
       * Category from the module's own shape, mirroring `categoryOf` on the slot side. `mount` is
       * present on weapons and absent on internals; class 0 marks a utility. Getting this wrong
       * would put a module in a bucket no slot ever searches, and it would simply never resolve.
       */
      const category: SlotCategory = standardGroups.has(module.grp)
        ? 'standard'
        : module.class === 0
          ? 'utility'
          : module.raw['mount'] !== undefined
            ? 'hardpoint'
            : 'internal';

      byCategory[category].set(module.id, module);
    }
  }

  const shipsById = new Map<string, CatalogueShip>();

  for (const item of ships) {
    const data = asRecord(item.data);
    const slotData = asRecord(data['slots']);
    const defaultData = asRecord(data['defaults']);

    const standard = Array.isArray(slotData['standard']) ? slotData['standard'] : [];
    const hardpoints = Array.isArray(slotData['hardpoints']) ? slotData['hardpoints'] : [];
    const internal = Array.isArray(slotData['internal']) ? slotData['internal'] : [];

    const slots: CatalogueSlot[] = [
      ...standard.map((s, i) => ({
        group: 'standard' as SlotGroup,
        index: i,
        size: slotSize(s),
        fixedGroup: STANDARD_GROUPS[i] ?? null,
        eligible: eligibleOf(s),
      })),
      ...hardpoints.map((s, i) => ({
        group: 'hardpoint' as SlotGroup,
        index: i,
        size: slotSize(s),
        fixedGroup: null,
        eligible: eligibleOf(s),
      })),
      ...internal.map((s, i) => ({
        group: 'internal' as SlotGroup,
        index: i,
        size: slotSize(s),
        fixedGroup: null,
        eligible: eligibleOf(s),
      })),
    ];

    const defaults: Record<SlotGroup, readonly (string | null)[]> = {
      standard: (Array.isArray(defaultData['standard']) ? defaultData['standard'] : []).map(defaultId),
      hardpoint: (Array.isArray(defaultData['hardpoints']) ? defaultData['hardpoints'] : []).map(defaultId),
      internal: (Array.isArray(defaultData['internal']) ? defaultData['internal'] : []).map(defaultId),
      // Utilities live in the hardpoint array on both sides; nothing indexes this one.
      utility: [],
    };

    const bulkheads = (Array.isArray(data['bulkheads']) ? data['bulkheads'] : [])
      // Bulkheads carry their own names in the ship row — "Lightweight Alloy", "Military Grade".
      .map((b) => toModule(asRecord(b), null))
      .filter((b): b is CatalogueModule => b !== null);

    shipsById.set(item.extKey, {
      id: item.extKey,
      name: item.name,
      // A sibling of `properties`, not inside it — reading it from there silently returned undefined
      // and left every EDSY ship match falling back to the name.
      edID: num(data['edID']),
      slots,
      defaults,
      bulkheads,
      properties: asRecord(data['properties']),
    });
  }

  /*
   * Standard modules again, keyed the way stock loadouts name them. Built in the same pass rather
   * than searched on demand: it is seven lookups per import against a few hundred modules, and a
   * linear scan per slot is the kind of thing that is fine until somebody imports a hundred builds.
   */
  const standardByRating = new Map<string, CatalogueModule>();
  for (const module of byCategory.standard.values()) {
    if (module.rating === null) continue;
    standardByRating.set(`${module.grp}:${module.class}${module.rating}`, module);
  }

  // The game's symbol, per category, for reading a journal loadout. Lower-cased on both sides
  // because the journal and coriolis-data disagree about capitalisation and about nothing else.
  const bySymbol: Record<SlotCategory, Map<string, CatalogueModule>> = {
    standard: new Map(),
    hardpoint: new Map(),
    utility: new Map(),
    internal: new Map(),
  };
  for (const [category, index] of Object.entries(byCategory) as [SlotCategory, Map<string, CatalogueModule>][]) {
    for (const module of index.values()) {
      if (module.symbol !== null) bySymbol[category].set(module.symbol.toLowerCase(), module);
    }
  }

  return {
    ship: (shipId) => shipsById.get(shipId) ?? null,
    ships: () => [...shipsById.values()],
    module: (category, id) => byCategory[category].get(id) ?? null,
    standardByRating: (group, cls, rating) =>
      standardByRating.get(`${group}:${cls}${rating}`) ?? null,
    moduleBySymbol: (category, symbol) => bySymbol[category].get(symbol.toLowerCase()) ?? null,
    modulesIn: (category, group) =>
      [...byCategory[category].values()].filter((m) => m.grp === group),
  };
}
