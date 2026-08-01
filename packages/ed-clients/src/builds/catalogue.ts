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
}

export interface CatalogueShip {
  readonly id: string;
  readonly name: string;
  readonly slots: readonly CatalogueSlot[];
  /** The stock loadout, as coriolis ids. `null` for a slot the stock ship leaves empty. */
  readonly defaults: readonly (string | null)[];
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
}

/** The raw shapes the coriolis ingest stores. Narrow on purpose — this reads a few fields of many. */
export interface RawShipItem {
  readonly extKey: string;
  readonly name: string;
  readonly data: unknown;
}
export interface RawModuleItem {
  readonly data: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toModule(raw: Record<string, unknown>): CatalogueModule | null {
  const id = raw['id'];
  const grp = raw['grp'];
  if (typeof id !== 'string' || typeof grp !== 'string') return null;

  return {
    id,
    grp,
    name: typeof raw['name'] === 'string' ? raw['name'] : (raw['symbol'] as string) || id,
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

/** A stock-loadout entry. Coriolis writes `0` or `""` for an empty slot, not null. */
function defaultId(entry: unknown): string | null {
  return typeof entry === 'string' && entry !== '' ? entry : null;
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
      const module = toModule(asRecord(entry));
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
      })),
      ...hardpoints.map((s, i) => ({
        group: 'hardpoint' as SlotGroup,
        index: i,
        size: slotSize(s),
        fixedGroup: null,
      })),
      ...internal.map((s, i) => ({
        group: 'internal' as SlotGroup,
        index: i,
        size: slotSize(s),
        fixedGroup: null,
      })),
    ];

    const defaults = [
      ...(Array.isArray(defaultData['standard']) ? defaultData['standard'] : []).map(defaultId),
      ...(Array.isArray(defaultData['hardpoints']) ? defaultData['hardpoints'] : []).map(defaultId),
      ...(Array.isArray(defaultData['internal']) ? defaultData['internal'] : []).map(defaultId),
    ];

    const bulkheads = (Array.isArray(data['bulkheads']) ? data['bulkheads'] : [])
      .map((b) => toModule(asRecord(b)))
      .filter((b): b is CatalogueModule => b !== null);

    shipsById.set(item.extKey, {
      id: item.extKey,
      name: item.name,
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
  };
}
