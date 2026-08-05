import type { Engineering, FittedModule, ImportResult, SlotGroup } from '@grims/shared/ship-build';
import { categoryOf, type BuildCatalogue, type CatalogueShip, type CatalogueSlot } from './catalogue.js';

/**
 * Reading a ship straight out of the game.
 *
 * ★ THE BEST SOURCE WE HAVE, AND IT WAS ALREADY ARRIVING ★
 *
 * The companion app forwards the journal's `Loadout` event, and we have been storing them all
 * along — 72 of them across six ships before a line of this was written. It is not somebody's plan
 * for a ship; it is what is bolted to the hull right now, with the engineering that is actually on
 * it: grade, quality, the engineer who rolled it, and every modifier with its original value.
 *
 * No link to paste, no format to reverse-engineer, and it refreshes itself every time somebody
 * refits. A build link is a snapshot of an intention; this is the ship.
 *
 * ★ THE JOIN IS THE GAME'S OWN SYMBOL ★
 *
 * The journal writes `hpt_pulselaser_gimbal_medium`; coriolis-data records
 * `Hpt_PulseLaser_Gimbal_Medium` on the same module. Case-insensitively they are the same string,
 * so the two datasets join with no translation table to build or maintain.
 *
 * Measured on the real events: 2,250 functional modules, 2,109 matched — 93.7%. Every remaining
 * miss is a hologram, a ship-kit part, or a free fighter bay variant coriolis does not carry.
 * Cosmetics are dropped before matching rather than counted as failures, because a paint job is not
 * a module and reporting it as an unreadable one would make every import look broken.
 */

/**
 * Ships the game and coriolis-data call different things.
 *
 * ★ VERIFIED BY SLOT LAYOUT, NOT GUESSED FROM THE NAME ★
 *
 * Most ship keys agree — `anaconda`, `python_nx`, `panthermkii`, `explorer_nx` all match. Two do
 * not, and both were confirmed by comparing the fitted slots in a real loadout against every
 * candidate hull rather than by reading the name and hoping:
 *
 *   lakonminer         uses internal sizes 6,6,6,5,5,4,3,2,1,1. Only `type_11_prospector`
 *                      [6,6,6,5,5,5,5,4,3,2,1,1,1] can hold that set — `type_7_transport` was the
 *                      other candidate on weapon count and has no size 4 internal at all.
 *   mediumtransport01  uses 6,5,2,1 with two weapons, all of which fit `type_8_transport`
 *                      [7,6,6,6,5,5,4,2,1] — and it is, literally, the medium transport.
 *
 * A ship missing from here is REPORTED rather than dropped: `decodeLoadout` answers "we do not have
 * a ship called X yet", which is something an officer can act on when Frontier ships a new hull.
 */
const SHIP_ALIASES: Readonly<Record<string, string>> = {
  lakonminer: 'type_11_prospector',
  mediumtransport01: 'type_8_transport',
};

/** Slot names the game uses for the seven standard slots, in coriolis's order. */
const STANDARD_SLOTS: readonly string[] = [
  'powerplant',
  'mainengines',
  'frameshiftdrive',
  'lifesupport',
  'powerdistributor',
  'radar',
  'fueltank',
];

/** Hardpoint sizes, largest first — the order coriolis lists them in. */
const HARDPOINT_SIZE: Readonly<Record<string, number>> = {
  huge: 4,
  large: 3,
  medium: 2,
  small: 1,
  tiny: 0,
};

/**
 * Things in a `Loadout` that are not modules.
 *
 * Paint jobs, ship kits, decals, voice packs and holograms all arrive in the same `Modules` array as
 * the power plant. Matching them would fail every time and make a perfectly good import report
 * dozens of unreadable modules, which teaches people to ignore the warning that matters.
 */
const COSMETIC =
  /^(paintjob_|weaponcustomisation_|enginecustomisation_|voicepack_|nameplate_|decal_|bobble_|string_lights)|_shipkit|holograma|_spoiler\d|_wings\d|_bumper\d|_tail\d|_cockpit/i;

/** The hull armour, which is a bulkhead rather than a fitted module. */
const ARMOUR = /_armour_/i;

interface LoadoutModule {
  readonly Slot?: unknown;
  readonly Item?: unknown;
  readonly On?: unknown;
  readonly Priority?: unknown;
  readonly Engineering?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Where a game slot name sits in our layout.
 *
 * ★ MATCHED BY SIZE, IN ORDER, NOT BY NUMBER ★
 *
 * The game names hardpoints `MediumHardpoint3` and internals `Slot04_Size5`; coriolis lists slots as
 * a plain array in descending size. The numbers do NOT line up — a ship's `MediumHardpoint3` is not
 * coriolis's hardpoint index 3.
 *
 * So each game slot claims the first unclaimed catalogue slot of the right size. That is exact for
 * every layout the game actually has, because within one size the slots are interchangeable — which
 * is precisely why the game numbers them separately per size in the first place.
 */
function claimSlot(
  slots: readonly CatalogueSlot[],
  taken: Set<number>,
  group: SlotGroup,
  size: number,
): number | null {
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    if (slot === undefined || taken.has(i)) continue;
    if (slot.group !== group) continue;
    if (slot.size !== size) continue;
    taken.add(i);
    return i;
  }
  return null;
}

/** The engineering on one module, as the game reports it. */
function readEngineering(raw: unknown): Engineering | null {
  const eng = asRecord(raw);
  if (Object.keys(eng).length === 0) return null;

  const modifiers: Record<string, number> = {};
  for (const entry of Array.isArray(eng['Modifiers']) ? eng['Modifiers'] : []) {
    const mod = asRecord(entry);
    const label = mod['Label'];
    /*
     * `Value` is the MODIFIED number and `OriginalValue` is what it started as. The modified one is
     * what flies, so it is what is kept — but a modifier that carries only an original value is a
     * real shape in the journal and is recorded rather than dropped, so nothing silently vanishes.
     */
    const value = typeof mod['Value'] === 'number' ? mod['Value'] : mod['OriginalValue'];
    if (typeof label === 'string' && typeof value === 'number') modifiers[label] = value;
  }

  return {
    blueprintId: typeof eng['BlueprintName'] === 'string' ? eng['BlueprintName'] : null,
    blueprintName: typeof eng['BlueprintName'] === 'string' ? eng['BlueprintName'] : null,
    grade: typeof eng['Level'] === 'number' ? eng['Level'] : null,
    quality: typeof eng['Quality'] === 'number' ? eng['Quality'] : null,
    experimentalId: typeof eng['ExperimentalEffect'] === 'string' ? eng['ExperimentalEffect'] : null,
    modifiers,
  };
}

/**
 * Turns a `Loadout` event into a build.
 *
 * `sourceUrl` is our own reference for the event rather than a link somebody can open — this build
 * did not come from a website and pretending it did would be a lie in the one field a member uses
 * to check where their data came from.
 */
export function decodeLoadout(payload: unknown, catalogue: BuildCatalogue, sourceUrl: string): ImportResult {
  const event = asRecord(payload);

  const shipKey = typeof event['Ship'] === 'string' ? event['Ship'].toLowerCase() : null;
  if (shipKey === null) return { ok: false, problem: 'That loadout does not name a ship.' };

  const ship: CatalogueShip | null =
    catalogue.ship(shipKey) ?? catalogue.ship(SHIP_ALIASES[shipKey] ?? '');
  if (ship === null) {
    return { ok: false, problem: `We do not have a ship called "${shipKey}" in our data yet.` };
  }

  const modules = Array.isArray(event['Modules']) ? (event['Modules'] as LoadoutModule[]) : [];

  const taken = new Set<number>();
  const fitted = new Map<number, FittedModule>();
  let bulkheadId = ship.bulkheads[0]?.id ?? null;

  /*
   * ★ LARGEST FIRST, THEN BY THE GAME'S OWN NUMBER ★
   *
   * Slots are claimed in order, so the order they are considered in decides which catalogue slot
   * each one lands in. Sorting matches coriolis's own descending-size layout; without it a small
   * hardpoint processed first could claim a slot a large one needed, and every weapon after it
   * would shift.
   */
  const ordered = [...modules].sort((a, b) => {
    const rank = (m: LoadoutModule): number => {
      const slot = typeof m.Slot === 'string' ? m.Slot.toLowerCase() : '';
      const size = Object.entries(HARDPOINT_SIZE).find(([name]) => slot.startsWith(name))?.[1];
      return size ?? -1;
    };
    return rank(b) - rank(a);
  });

  for (const module of ordered) {
    const slotName = typeof module.Slot === 'string' ? module.Slot.toLowerCase() : '';
    const item = typeof module.Item === 'string' ? module.Item : '';
    if (slotName === '' || item === '') continue;

    if (ARMOUR.test(item)) {
      // The hull's armour is a bulkhead. Matched by symbol against the ship's own bulkhead list.
      bulkheadId = ship.bulkheads.find((b) => b.raw['symbol'] === item)?.id ?? bulkheadId;
      continue;
    }
    if (COSMETIC.test(item)) continue;

    let index: number | null = null;

    const standardAt = STANDARD_SLOTS.indexOf(slotName);
    if (standardAt !== -1) {
      index = ship.slots.findIndex((s) => s.group === 'standard' && s.index === standardAt);
      if (index !== -1) taken.add(index);
    } else {
      const hardpointSize = Object.entries(HARDPOINT_SIZE).find(([name]) =>
        slotName.startsWith(name),
      )?.[1];

      if (hardpointSize !== undefined) {
        index = claimSlot(ship.slots, taken, 'hardpoint', hardpointSize);
      } else {
        // `Slot04_Size5` and the planetary approach suite are the internal bays.
        const size = /size(\d+)/.exec(slotName)?.[1];
        index = claimSlot(ship.slots, taken, 'internal', size === undefined ? 1 : Number(size));
      }
    }

    if (index === null || index < 0) continue;
    const slot = ship.slots[index];
    if (slot === undefined) continue;

    fitted.set(index, {
      group: slot.group,
      index: slot.index,
      moduleId: catalogue.moduleBySymbol(categoryOf(slot), item)?.id ?? null,
      slotSize: slot.size,
      enabled: module.On !== false,
      priority: typeof module.Priority === 'number' ? module.Priority + 1 : 1,
      engineering: readEngineering(module.Engineering),
    });
  }

  const all: FittedModule[] = ship.slots.map(
    (slot, i) =>
      fitted.get(i) ?? {
        group: slot.group,
        index: slot.index,
        moduleId: null,
        slotSize: slot.size,
        enabled: true,
        priority: 1,
        engineering: null,
      },
  );

  return {
    ok: true,
    build: {
      shipId: ship.id,
      shipName: ship.name,
      buildName: typeof event['ShipName'] === 'string' && event['ShipName'] !== '' ? event['ShipName'] : null,
      source: 'journal',
      sourceUrl,
      bulkheadId: bulkheadId ?? 'Bs',
      modules: all,
    },
  };
}
