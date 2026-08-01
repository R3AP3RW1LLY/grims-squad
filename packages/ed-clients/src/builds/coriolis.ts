import type { FittedModule, ImportResult, ShipBuild } from '@grims/shared/ship-build';
import { categoryOf, type BuildCatalogue, type CatalogueShip } from './catalogue.js';

/**
 * Reading a Coriolis build link.
 *
 * ★ THE FORMAT, ESTABLISHED AGAINST REAL LINKS ★
 *
 * The squadron owner supplied working links on 2026-08-01 and this was derived from them and
 * verified against the ingested module tables rather than guessed at.
 *
 *   https://coriolis.io/outfit/adder?code=A0p9t9F9l4d9sef31b1717003y014400----4F.Iw18UA==.Aw18UA==..Ewel…
 *                                        │└ bulkhead index
 *                                        └ format version
 *
 * After those two characters the code is TWO CHARACTERS PER SLOT, in the ship's own order —
 * standard, then hardpoints, then internal — with `--` for an empty slot. The remaining
 * dot-separated segments are the power-enabled bitfield, the power priorities, an unused field, and
 * the engineering as an LZ-string blob.
 *
 * Decoding the Adder link above against our tables gives 3E power plant, 3E thrusters, 3E FSD, 1E
 * life support, 2E distributor, 3E sensors, 3C fuel tank — every standard slot exactly right.
 *
 * ★ WHY IDS ARE LOOKED UP BY SLOT AND NEVER BY ID ALONE ★
 *
 * 115 of 847 coriolis module ids appear in more than one group. In that very link, `F9` is the
 * frame shift drive — and it is ALSO a Fuel Transfer Limpet Controller. A flat lookup produces an
 * Adder with a limpet controller where its FSD should be: plausible, wrong, and invisible.
 *
 * ★ A BARE OUTFIT URL IS THE STOCK SHIP ★
 *
 * `https://coriolis.io/outfit/panthermkii` with no code is not a broken link. It is how Coriolis
 * addresses a ship with its factory loadout, and it is exactly what the baseline import wants — we
 * already store every ship's stock fit, so it decodes with no code to parse at all.
 */

/** `https://coriolis.io/outfit/<ship>?code=…` — the ship id is the last path segment. */
function shipIdFrom(url: URL): string | null {
  const segments = url.pathname.split('/').filter((s) => s !== '');
  const last = segments.at(-1);
  if (last === undefined || last === 'outfit') return null;
  return decodeURIComponent(last).toLowerCase();
}

/**
 * The build code, from wherever this link keeps it.
 *
 * Coriolis puts it in `?code=`; some shared forms put it in the fragment. Read from both rather
 * than insisting on one, because a member pasting the address bar has no idea which they have.
 */
function codeFrom(url: URL): string | null {
  const query = url.searchParams.get('code');
  if (query !== null && query.trim() !== '') return query.trim();

  const hash = url.hash.replace(/^#/, '');
  const match = /(?:^|[?&])code=([^&]+)/.exec(hash);
  return match?.[1] !== undefined ? decodeURIComponent(match[1]) : null;
}

/** Splits the module run into two-character ids, mapping `--` to an empty slot. */
function slotIds(run: string): (string | null)[] {
  const ids: (string | null)[] = [];
  for (let i = 0; i + 1 < run.length; i += 2) {
    const pair = run.slice(i, i + 2);
    ids.push(pair === '--' ? null : pair);
  }
  return ids;
}

/**
 * Power-enabled flags and priorities, from their base64 segments.
 *
 * Best effort, and deliberately so: a build whose priorities we could not read is still a correct
 * list of modules, and refusing the whole import over a power setting would throw away the part
 * everybody actually asked for. Missing flags default to enabled at priority 1, which is what
 * Coriolis itself shows for a fresh build.
 */
function readFlags(segment: string | undefined, count: number): boolean[] {
  const flags = Array.from({ length: count }, () => true);
  if (segment === undefined || segment === '') return flags;

  try {
    const bytes = Buffer.from(segment, 'base64');
    for (let i = 0; i < count; i += 1) {
      const byte = bytes[Math.floor(i / 8)];
      if (byte === undefined) break;
      flags[i] = (byte & (1 << i % 8)) !== 0;
    }
  } catch {
    /* an unreadable power setting is not a reason to lose the build */
  }
  return flags;
}

export function decodeCoriolis(url: string, catalogue: BuildCatalogue): ImportResult {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { ok: false, problem: 'That is not a link.' };
  }

  const shipId = shipIdFrom(parsed);
  if (shipId === null) {
    return {
      ok: false,
      problem:
        'That Coriolis link does not name a ship. Open your build on Coriolis and copy the address ' +
        'from the browser bar.',
    };
  }

  const ship = catalogue.ship(shipId);
  if (ship === null) {
    /*
     * Named rather than generic. A ship we do not hold is almost always a link from before our last
     * coriolis refresh — a newly released hull — and "we do not know the X yet" is something an
     * officer can act on, where "invalid link" sends them to check the URL they copied correctly.
     */
    return { ok: false, problem: `We do not have a ship called "${shipId}" in our data yet.` };
  }

  const code = codeFrom(parsed);
  // No code at all is the STOCK ship, which is a real and useful build rather than a failure.
  if (code === null) return { ok: true, build: stockBuild(ship, url, catalogue) };

  return { ok: true, build: decodeCode(ship, catalogue, code, url, parsed) };
}

/**
 * The factory loadout, straight from the ship's own record.
 *
 * ★ STANDARD SLOTS ARE NAMED DIFFERENTLY IN A STOCK LOADOUT ★
 *
 * `defaults.standard` holds CLASS AND RATING — `["8E","8E","7E",…]` — while every other default and
 * the whole URL code use module ids. Passing `8E` to the id index resolves nothing, so a stock
 * import produced a hull with no power plant, no thrusters and no drive, silently. Caught by
 * decoding the owner's `coriolis.io/outfit/panthermkii` link and reading the output.
 */
export function stockBuild(ship: CatalogueShip, sourceUrl: string, catalogue: BuildCatalogue): ShipBuild {
  const modules: FittedModule[] = ship.slots.map((slot) => {
    /*
     * Looked up by GROUP and index, not by position in a flattened array. Ten of the arrays in
     * coriolis-data have more slots than defaults, and a flat mapping shifted every later group —
     * see the note on `CatalogueShip.defaults`.
     */
    const entry = ship.defaults[slot.group][slot.index] ?? null;

    let moduleId: string | null = null;
    if (entry !== null) {
      /*
       * ★ BOTH DIALECTS, IN THE SAME ARRAY ★
       *
       * Most ships write their standard defaults as class and rating — the Imperial Clipper's are
       * `["6E","6E","5E","5E","6E","5E","4C"]`. The Panther Clipper Mk II writes `FD` for its drive,
       * which is a module ID, because its stock fit is an SCO drive that has no plain class/rating
       * equivalent in that group.
       *
       * Insisting on either form alone leaves a hull with a hole in it: forcing class+rating lost
       * the Panther's frame shift drive, and forcing ids loses every other ship's whole standard
       * row. So both are tried, and the one that resolves wins.
       */
      const byId = catalogue.module(categoryOf(slot), entry)?.id ?? null;

      if (byId !== null) {
        moduleId = byId;
      } else if (slot.group === 'standard' && slot.fixedGroup !== null) {
        // `8E` → class 8, rating E, in this slot's fixed group.
        const cls = Number.parseInt(entry.slice(0, -1), 10);
        const rating = entry.slice(-1);
        moduleId = Number.isNaN(cls)
          ? null
          : (catalogue.standardByRating(slot.fixedGroup, cls, rating)?.id ?? null);
      }
    }

    return {
      group: slot.group,
      index: slot.index,
      moduleId,
      slotSize: slot.size,
      enabled: true,
      priority: 1,
      engineering: null,
    };
  });

  return {
    shipId: ship.id,
    shipName: ship.name,
    buildName: `${ship.name} — stock`,
    source: 'coriolis',
    sourceUrl,
    // Index 0 is Lightweight Alloy on every hull, and is what a ship leaves the factory with.
    bulkheadId: ship.bulkheads[0]?.id ?? 'Bs',
    modules,
  };
}

function decodeCode(
  ship: CatalogueShip,
  catalogue: BuildCatalogue,
  code: string,
  sourceUrl: string,
  parsed: URL,
): ShipBuild {
  const [run = '', enabledSegment, prioritySegment] = code.split('.');

  // Two leading characters: format version, then the bulkhead index.
  const bulkheadIndex = Number.parseInt(run.slice(1, 2), 10);
  const bulkhead = ship.bulkheads[Number.isNaN(bulkheadIndex) ? 0 : bulkheadIndex];

  const ids = slotIds(run.slice(2));
  const enabled = readFlags(enabledSegment, ship.slots.length);
  const priorities = readFlags(prioritySegment, ship.slots.length);

  const modules: FittedModule[] = ship.slots.map((slot, i) => {
    const id = ids[i] ?? null;

    /*
     * ★ ALIGNED TO THE CURRENT HULL, NOT TO THE CODE'S LENGTH ★
     *
     * Frontier adds slots to ships, so a link written last year can carry FEWER ids than the hull
     * now has. The Adder link supplied on 2026-08-01 has six internal ids against the eight slots
     * coriolis-data now lists.
     *
     * Reading ids positionally against the current layout and running out is the safe direction:
     * the extra slots come back empty and coverage reports it. Stretching the ids to fill the slots
     * would shift every module after the gap into the wrong place and produce a build that looks
     * completely reasonable.
     */
    const resolved =
      id === null ? null : (catalogue.module(categoryOf(slot), id)?.id ?? null);

    return {
      group: slot.group,
      index: slot.index,
      moduleId: resolved,
      slotSize: slot.size,
      enabled: enabled[i] ?? true,
      priority: priorities[i] === false ? 2 : 1,
      // Engineering lives in the LZ-string segment. Not read yet — see `decodeEngineering`.
      engineering: null,
    };
  });

  return {
    shipId: ship.id,
    shipName: ship.name,
    buildName: parsed.searchParams.get('bn'),
    source: 'coriolis',
    sourceUrl,
    bulkheadId: bulkhead?.id ?? ship.bulkheads[0]?.id ?? 'Bs',
    modules,
  };
}
