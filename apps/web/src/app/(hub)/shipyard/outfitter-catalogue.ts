import type { BuildCatalogue, CatalogueModule, CatalogueShip, SlotCategory } from '@grims/ed-clients/builds';

/**
 * A catalogue built from what the Shipyard endpoint sent, for the browser.
 *
 * ★ WHY NOT JUST RECOMPUTE THE STATS ON THE SERVER ★
 *
 * Because an outfitting screen changes a module and shows the effect in the same frame. A round
 * trip between picking a power plant and seeing what it did to the power budget is the one thing
 * Coriolis gets right that a naive rebuild of it gets wrong.
 *
 * ★ AND WHY NOT A SECOND IMPLEMENTATION OF THE MATHS ★
 *
 * Because then the page and the server would each have their own idea of a jump range, and they
 * would drift — quietly, in the fourth decimal at first. `computeStats` takes a `BuildCatalogue`,
 * so giving the browser one made from the payload runs the SAME arithmetic in both places.
 *
 * This is the adapter that makes that possible: the endpoint sends a flat list of modules and a
 * slot layout, and this presents them in the shape the maths already expects.
 */

export interface OutfitPayload {
  readonly ship: {
    readonly id: string;
    readonly name: string;
    readonly hullCost: number;
    readonly properties: Record<string, unknown>;
    readonly bulkheads: readonly RawModule[];
    readonly slots: ReadonlyArray<{
      group: string;
      index: number;
      size: number;
      fixedGroup: string | null;
      eligible: readonly string[] | null;
    }>;
    readonly defaults: Record<string, readonly (string | null)[]>;
  };
  readonly modules: readonly RawModule[];
}

export interface RawModule {
  readonly id: string;
  readonly grp: string;
  readonly name: string;
  readonly class: number;
  readonly rating: string | null;
  readonly mass: number | null;
  readonly power: number | null;
  readonly cost: number | null;
  readonly raw: Record<string, unknown>;
}

/** The standard slots, in the game's fixed order — position 2 is always the drive. */
const STANDARD_GROUPS: readonly string[] = ['pp', 't', 'fsd', 'ls', 'pd', 's', 'ft'];

function toModule(raw: RawModule): CatalogueModule {
  return {
    id: raw.id,
    grp: raw.grp,
    name: raw.name,
    symbol: typeof raw.raw['symbol'] === 'string' ? raw.raw['symbol'] : null,
    class: raw.class,
    rating: raw.rating,
    mass: raw.mass,
    power: raw.power,
    integrity: typeof raw.raw['integrity'] === 'number' ? raw.raw['integrity'] : null,
    cost: raw.cost,
    raw: raw.raw,
  };
}

/**
 * Which category a module belongs to, matching the server's own rule exactly.
 *
 * Standard groups are fixed; class 0 is a utility mount; anything with a `mount` is a weapon; the
 * rest is internal. Getting this wrong here and not there would put a module in a bucket the slot
 * never searches, and it would simply never appear in the dropdown.
 */
function categoryOfModule(module: CatalogueModule): SlotCategory {
  if (STANDARD_GROUPS.includes(module.grp)) return 'standard';
  if (module.class === 0) return 'utility';
  return module.raw['mount'] !== undefined ? 'hardpoint' : 'internal';
}

export function catalogueFrom(payload: OutfitPayload): BuildCatalogue {
  const byCategory: Record<SlotCategory, Map<string, CatalogueModule>> = {
    standard: new Map(),
    hardpoint: new Map(),
    utility: new Map(),
    internal: new Map(),
  };

  for (const raw of payload.modules) {
    const module = toModule(raw);
    byCategory[categoryOfModule(module)].set(module.id, module);
  }

  const bulkheads = payload.ship.bulkheads.map(toModule);

  const ship: CatalogueShip = {
    id: payload.ship.id,
    name: payload.ship.name,
    edID: typeof payload.ship.properties['edID'] === 'number' ? payload.ship.properties['edID'] : null,
    slots: payload.ship.slots.map((s) => ({
      group: s.group as CatalogueShip['slots'][number]['group'],
      index: s.index,
      size: s.size,
      fixedGroup: s.fixedGroup,
      eligible: s.eligible,
    })),
    defaults: payload.ship.defaults as CatalogueShip['defaults'],
    bulkheads,
    properties: payload.ship.properties,
  };

  const standardByRating = new Map<string, CatalogueModule>();
  for (const module of byCategory.standard.values()) {
    if (module.rating !== null) standardByRating.set(`${module.grp}:${module.class}${module.rating}`, module);
  }

  return {
    ship: (id) => (id === ship.id ? ship : null),
    ships: () => [ship],
    module: (category, id) => byCategory[category].get(id) ?? null,
    moduleBySymbol: (category, symbol) =>
      [...byCategory[category].values()].find(
        (m) => m.symbol?.toLowerCase() === symbol.toLowerCase(),
      ) ?? null,
    standardByRating: (group, cls, rating) => standardByRating.get(`${group}:${cls}${rating}`) ?? null,
    modulesIn: (category, group) => [...byCategory[category].values()].filter((m) => m.grp === group),
  };
}

/**
 * Coriolis's stand-ins for modules it does not know yet.
 *
 * There are ten — "Unrecognised Power Plant", "Unrecognised Weapon" and so on — and they exist so
 * that importing a build containing a module coriolis has not catalogued yet degrades to a named
 * placeholder instead of failing. That is the right behaviour for an IMPORT and the wrong thing
 * entirely in a shop: they cost nothing, weigh nothing, do nothing, and cannot be bought.
 *
 * So they are filtered here rather than out of the catalogue, which still needs them.
 *
 * Matched on the symbol. Every one of the ten carries `_Missing_` and no real module does — the
 * `info` field ("Not in Coriolis yet") covers only nine of them, and names drift.
 */
function isPlaceholder(module: CatalogueModule): boolean {
  return module.symbol !== null && /_Missing_/i.test(module.symbol);
}

/**
 * Which bucket a SLOT draws from.
 *
 * Written once because it was written four times, and a copy that drifts would search a bucket the
 * module was never filed under — which does not throw, it just silently offers an empty list.
 */
export function slotCategory(slot: { group: string; size: number }): SlotCategory {
  if (slot.group === 'standard') return 'standard';
  if (slot.group === 'internal') return 'internal';
  return slot.size === 0 ? 'utility' : 'hardpoint';
}

/**
 * Every module that could go in one slot, best-sorted for a dropdown.
 *
 * ★ SORTED BY CLASS THEN RATING, NOT ALPHABETICALLY ★
 *
 * An outfitting list is read by size first — somebody filling a class 6 bay is looking for the class
 * 6 entries. Alphabetical order scatters them, which is why every outfitter in the game sorts this
 * way and why doing otherwise would feel broken even to somebody who could not say what was wrong.
 */
export function optionsFor(
  catalogue: BuildCatalogue,
  slot: { group: string; index: number; size: number; fixedGroup: string | null; eligible: readonly string[] | null },
  allGroups: readonly string[],
): CatalogueModule[] {
  const category = slotCategory(slot);

  const groups = slot.fixedGroup !== null ? [slot.fixedGroup] : (slot.eligible ?? allGroups);

  const found: CatalogueModule[] = [];
  for (const group of groups) {
    for (const module of catalogue.modulesIn(category, group)) {
      if (isPlaceholder(module)) continue;
      // Bigger than the slot cannot be fitted. Smaller is offered — under-filling saves weight and
      // is how every long-range build is made.
      if (module.class <= slot.size) found.push(module);
    }
  }

  const RATINGS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
  return found.sort((a, b) => {
    if (a.grp !== b.grp) return a.grp.localeCompare(b.grp);
    if (a.class !== b.class) return b.class - a.class;
    return RATINGS.indexOf(a.rating ?? 'Z') - RATINGS.indexOf(b.rating ?? 'Z');
  });
}
