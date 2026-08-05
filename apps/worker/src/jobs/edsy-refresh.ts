import type { PrismaClient } from '@grims/db';

/**
 * Keeping EDSY's id-to-symbol table current.
 *
 * ★ WHY WE NEED ANYTHING FROM EDSY AT ALL ★
 *
 * An EDSY build link encodes each module as a three-character base-64 id in EDSY's own numbering.
 * `FBG` is 62160 is `Hpt_PulseLaser_Fixed_Small`. Nothing in Frontier's data or in coriolis-data
 * carries that numbering, so without this mapping an EDSY link is undecodable — which is exactly
 * where this feature was stuck until the squadron owner pointed at the repository.
 *
 * ★ WHAT IS TAKEN, AND WHAT IS NOT ★
 *
 * Only `id -> fdname`. Not EDSY's code, and not its statistics — we already hold mass, power, cost,
 * damage and the rest from Coriolis, and carrying a second copy would give us two sources that can
 * disagree about the same module with nothing to say which wins.
 *
 * `fdname` is the game's own symbol, which is precisely the key the journal importer already joins
 * on. So this is one hop, and everything downstream is unchanged.
 *
 * ★ LICENSING, SINCE IT IS NOT OURS ★
 *
 * taleden's work in EDSY is CC BY-NC 4.0. This squadron hub is non-commercial and attributes EDSY
 * on the import page. The Elite Dangerous data inside `eddb.js` remains Frontier's, used under the
 * media rules coriolis-data already relies on.
 *
 * ★ PARSED AS TEXT, NEVER EXECUTED ★
 *
 * `eddb.js` is a script. Running it — or `eval`-ing the object out of it — would execute somebody
 * else's code inside our worker on every refresh, with whatever that file happens to contain on the
 * day. It is read with a regular expression instead: slower, duller, and incapable of doing
 * anything but producing numbers and names.
 */

/** Upstream. taleden maintain this; it is the data EDSY itself is built from. */
const SOURCE = 'https://raw.githubusercontent.com/taleden/EDSY/master/eddb.js';

/** Where the recorded upstream version lives, so an unchanged file costs one request. */
const VERSION_KEY = 'edsy.eddb_version';

export interface EdsyRefreshResult {
  readonly changed: boolean;
  readonly ships: number;
  readonly modules: number;
  /** Set when we could not reach upstream. The existing table stays exactly as it was. */
  readonly problem?: string;
}

/**
 * Every `id : { … fdname:'…' }` entry, by kind.
 *
 * ★ SHIPS AND MODULES ARE TOLD APART BY `fdid`, NOT BY POSITION ★
 *
 * Both live in the same file in the same shape. A ship entry carries `fdid` immediately followed by
 * `fdname` and sits under `ship :`; a module entry has `mtype` and sits under `module :`. Splitting
 * the file on those two section headers is what keeps a ship's armour variants — which are nested
 * INSIDE a ship and share the module shape — from being read as top-level modules.
 */
export interface EdsyEntry {
  readonly edsyId: number;
  readonly fdname: string;
  /**
   * Frontier's own id, which Coriolis records as `edID`.
   *
   * The join for ships. EDSY calls the Alliance Challenger `TypeX_3` and Coriolis calls it
   * `alliance_challenger` — no string normalisation reconciles those, and the journal importer
   * already needed a hand-written alias map for two hulls. Both files carry Frontier's number and
   * they agree exactly, so this replaces that class of maintenance entirely.
   */
  readonly fdid: number | null;
}

export function parseEdsyIds(source: string): {
  ships: EdsyEntry[];
  modules: EdsyEntry[];
} {
  const shipsAt = source.indexOf('\n\tship : {');
  const modulesAt = source.indexOf('\n\tmodule : {');

  const section = (from: number, to: number): string =>
    from === -1 ? '' : source.slice(from, to === -1 ? source.length : to);

  /*
   * The module section starts after the ship section in the file as published. Slicing from each
   * header to the next keeps armour variants — nested inside a ship, and shaped like modules —
   * inside the SHIP section where they belong, rather than leaking into the module table where an
   * id collision would silently replace a real module.
   */
  const shipText = shipsAt < modulesAt ? section(shipsAt, modulesAt) : section(shipsAt, -1);
  const moduleText = modulesAt > shipsAt ? section(modulesAt, -1) : section(modulesAt, shipsAt);

  /*
   * ★ FOUND BY WALKING BACK FROM EACH `fdname`, NOT BY MATCHING A WHOLE ENTRY ★
   *
   * The obvious pattern — `<id> : { … fdname:'…' }` with a body that cannot contain braces — fails
   * on every entry that has a nested object, and plenty do: weapons carry `damagedist:{T:1}` and
   * ships nest their whole armour table. The first version of this silently dropped
   * `Int_Powerplant_Size6_Class1` and produced 58 ships out of 289 parsed entries, which is the
   * kind of loss that looks like a working import right up until somebody's link is missing its
   * power plant.
   *
   * So: find every `fdname`, then walk BACKWARDS to the id that opens its entry. An id is always
   * the nearest preceding `<digits> :` at the start of an indented line, and nesting cannot
   * confuse that because a nested object has no such opener.
   */
  const entries = (text: string): EdsyEntry[] => {
    /*
     * ★ ONE ORDERED PASS, NOT A BACKWARDS SEARCH PER NAME ★
     *
     * The version before this ran `/(?:^|\n)\s*(\d+)\s*:\s*\{[^]*$/` against the text preceding each
     * name, meaning to find the nearest opener behind it. A regex engine scans left to right and
     * returns the FIRST position that satisfies the whole pattern — and with `[^]*$` able to swallow
     * the rest of the file, the first opener in the section always satisfies it.
     *
     * So every one of the 1,194 modules came back with id 60150, the first beam laser. Every lookup
     * missed, and the table was full and useless. It was caught only because the ids were checked
     * against known values afterwards; nothing about the run itself looked wrong.
     *
     * Collecting both lists in order and walking them together is O(n), obviously correct, and has
     * no direction to get backwards.
     */
    const openers: Array<{ at: number; id: number }> = [];
    for (const match of text.matchAll(/(?:^|\n)\s*(\d+)\s*:\s*\{/g)) {
      const id = Number(match[1]);
      if (Number.isFinite(id)) openers.push({ at: match.index, id });
    }

    const found: EdsyEntry[] = [];
    let cursor = 0;

    for (const match of text.matchAll(/fdid:(\d+),\s*fdname:'([^']+)'/g)) {
      const fdid = Number(match[1]);
      const fdname = match[2];
      if (fdname === undefined) continue;

      // Both lists are in file order, so the cursor only ever moves forward.
      while (cursor + 1 < openers.length && (openers[cursor + 1]?.at ?? Infinity) < match.index) {
        cursor += 1;
      }

      const opener = openers[cursor];
      if (opener !== undefined && opener.at < match.index) {
        found.push({ edsyId: opener.id, fdname, fdid: Number.isFinite(fdid) ? fdid : null });
      }
    }

    return found;
  };

  const shipEntries = entries(shipText);

  /*
   * ★ A HULL'S ARMOUR IS A MODULE, NOT A SHIP ★
   *
   * Bulkheads live nested inside each ship in EDSY's file, and a build link references them by id
   * exactly like any other fitted item. Filed under `ship` they would be unreachable when decoding
   * a build, and they would collide with real ship ids in the same numbering space.
   */
  const isArmour = (fdname: string): boolean => /_Armour_/i.test(fdname);

  return {
    ships: shipEntries.filter((e) => !isArmour(e.fdname)),
    modules: [...entries(moduleText), ...shipEntries.filter((e) => isArmour(e.fdname))],
  };
}

export async function refreshEdsyIds(
  db: PrismaClient,
  fetchImpl: typeof fetch = fetch,
): Promise<EdsyRefreshResult> {
  let source: string;
  try {
    const res = await fetchImpl(SOURCE, { headers: { accept: 'text/plain' } });
    if (!res.ok) {
      return { changed: false, ships: 0, modules: 0, problem: `EDSY returned HTTP ${res.status}` };
    }
    source = await res.text();
  } catch {
    /*
     * Upstream being unreachable leaves the existing table alone. An EDSY link decoded fine
     * yesterday and will decode fine today; emptying the table because GitHub was briefly down
     * would break a working feature to report a network blip.
     */
    return { changed: false, ships: 0, modules: 0, problem: 'Could not reach EDSY.' };
  }

  const version = /version\s*:\s*(\d+)/.exec(source)?.[1] ?? null;
  const recorded = await db.siteConfig
    .findUnique({ where: { key: VERSION_KEY }, select: { value: true } })
    .catch(() => null);

  const counts = await db.edsyId.groupBy({ by: ['kind'], _count: true }).catch(() => []);
  const held = counts.reduce((n, row) => n + row._count, 0);

  /*
   * Unchanged upstream AND a table that already has rows means stop. The second half matters: after
   * a fresh deploy the version may already be recorded while the table is empty, and skipping on
   * the version alone would leave EDSY permanently undecodable with nothing reporting a problem.
   */
  if (version !== null && recorded?.value === version && held > 0) {
    return { changed: false, ships: 0, modules: held };
  }

  const { ships, modules } = parseEdsyIds(source);
  if (ships.length === 0 && modules.length === 0) {
    // A file we could not read is not a reason to delete the one we could.
    return { changed: false, ships: 0, modules: 0, problem: 'EDSY data could not be parsed.' };
  }

  const rows = [
    ...ships.map((s) => ({ kind: 'ship', edsyId: s.edsyId, fdname: s.fdname, fdid: s.fdid })),
    ...modules.map((m) => ({ kind: 'module', edsyId: m.edsyId, fdname: m.fdname, fdid: m.fdid })),
  ];

  /*
   * Replaced wholesale inside one transaction. A module REMOVED upstream must disappear here too,
   * and an upsert-only refresh would keep it for ever — decoding a link to a module that no longer
   * exists, with no way to notice.
   */
  await db.$transaction([
    db.edsyId.deleteMany({}),
    db.edsyId.createMany({ data: rows, skipDuplicates: true }),
    ...(version === null
      ? []
      : [
          db.siteConfig.upsert({
            where: { key: VERSION_KEY },
            create: { key: VERSION_KEY, value: version },
            update: { value: version },
          }),
        ]),
  ]);

  return { changed: true, ships: ships.length, modules: modules.length };
}
