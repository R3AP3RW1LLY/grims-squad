import type { FittedModule, ImportResult, SlotGroup } from '@grims/shared/ship-build';
import { categoryOf, type BuildCatalogue, type CatalogueShip } from './catalogue.js';

/**
 * Reading an EDSY build link.
 *
 * ★ THE FORMAT IS DOCUMENTED, NOT REVERSE-ENGINEERED ★
 *
 * The squadron owner supplied four links and then the repository, and `edsy.js` writes the layout
 * out in full at `getHash()`:
 *
 *     module hash format (HASH_VERSION=19):
 *       <3 chars / 18 bits>: module id (0..262143)
 *       <1 char  /  6 bits>: slot flags — 0x20 costed, 0x10 engineered, 0x08 powered,
 *                            0x07 priority
 *       !costed ?  <1 char>: discount bits
 *       costed  ?  <1 char cost bits> + <3-6 chars cost>
 *       engineered ? <2 chars flags> <2 chars roll> <1 char count> <4 chars per modifier>
 *
 * So a plain module is five characters — three of id, one of flags, one of discounts — which is
 * exactly what the four links measured before the source confirmed it. The alphabet is on line 628:
 * base 64 over `0..9 A..Z a..z _ -`.
 *
 * ★ THE ONE THING WE NEED FROM EDSY, AND WHERE IT COMES FROM ★
 *
 * Those ids are EDSY's own numbering. `edsy_ids` maps them to the game's symbol, refreshed from
 * `eddb.js` — and the symbol is the key our journal importer already joins on. So an EDSY link
 * becomes a Coriolis module in two hops, and nothing downstream knows the difference.
 *
 * ★ VARIABLE LENGTH IS THE WHOLE DIFFICULTY ★
 *
 * A build with engineering has longer entries than one without, and an entry with a real cost
 * longer still. Reading five characters at a time works until somebody engineers something and then
 * every module after it is nonsense. The length has to be computed from each entry's own flags,
 * which is what `entryLength` does.
 */

/** Line 628 of `edsy.js`. Base 64, and not the RFC's alphabet — the order matters. */
const HASH_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-';

/**
 * Resolves an EDSY id.
 *
 * `fdname` is the game's symbol, which is how MODULES join to Coriolis. `fdid` is Frontier's own
 * number, which is how SHIPS do — EDSY calls the Alliance Challenger `TypeX_3` and Coriolis calls it
 * `alliance_challenger`, and no string normalisation reconciles those, but both files record
 * Frontier's 128816588 and they agree exactly.
 */
export type EdsySymbolLookup = (
  kind: 'ship' | 'module',
  edsyId: number,
) => { fdname: string; fdid: number | null } | null;

function decodeNumber(text: string): number {
  let value = 0;
  for (const char of text) {
    const digit = HASH_CHARS.indexOf(char);
    if (digit < 0) return Number.NaN;
    value = value * 64 + digit;
  }
  return value;
}

/**
 * How long this entry is, from its own flag character.
 *
 * ★ READ THE FLAGS OR LOSE EVERYTHING AFTER THE FIRST ENGINEERED MODULE ★
 *
 * `0x20` costed, `0x10` engineered. A costed entry carries a cost-bits character whose top two bits
 * say how many more characters the cost occupies; an engineered one carries flags, a roll, a count,
 * and four characters per modified attribute.
 *
 * Assuming five would work perfectly on a stock ship and silently shred any real build — every
 * module after the first engineered one shifted by however many characters its engineering took,
 * producing a full loadout of plausible wrong modules.
 */
function entryLength(hash: string, at: number): number {
  const flags = decodeNumber(hash.slice(at + 3, at + 4));
  if (Number.isNaN(flags)) return 0;

  const costed = (flags & 0x20) !== 0;
  const engineered = (flags & 0x10) !== 0;

  // 3 id + 1 flags, then the cost or discount block.
  let length = 4;

  if (costed) {
    const costBits = decodeNumber(hash.slice(at + 4, at + 5));
    if (Number.isNaN(costBits)) return 0;
    // Top two bits are (size - 2), so the cost occupies 2..5 further characters after its own.
    length += 1 + (((costBits >> 4) & 0x3) + 2);
  } else {
    length += 1; // discount bits
  }

  if (engineered) {
    // 2 engineering flags + 2 roll + 1 count, then 4 per modified attribute.
    const count = decodeNumber(hash.slice(at + length + 4, at + length + 5));
    length += 5 + (Number.isNaN(count) ? 0 : (count & 0x1f) * 4);
  }

  return length;
}

/** Every module entry in one slot-group field, in order. */
export function readEntries(field: string): Array<{ edsyId: number; enabled: boolean; priority: number }> {
  const entries: Array<{ edsyId: number; enabled: boolean; priority: number }> = [];

  let at = 0;
  while (at + 4 <= field.length) {
    const length = entryLength(field, at);
    // A length we cannot compute means the rest of the field is unreadable. Stopping keeps what was
    // read; guessing five would put wrong modules in every remaining slot.
    if (length <= 0 || at + length > field.length) break;

    const edsyId = decodeNumber(field.slice(at, at + 3));
    const flags = decodeNumber(field.slice(at + 3, at + 4));

    if (!Number.isNaN(edsyId) && !Number.isNaN(flags)) {
      entries.push({
        edsyId,
        enabled: (flags & 0x08) !== 0,
        // 0x07 is the priority group, zero-based in the hash and one-based everywhere a human sees it.
        priority: (flags & 0x07) + 1,
      });
    }

    at += length;
  }

  return entries;
}

/**
 * The build, from the fragment.
 *
 * `https://edsy.org/#/L=<ship>,<field>,<field>,…,<name>` — comma separated, with the slot groups in
 * the middle and the build name near the end.
 */
export function decodeEdsy(
  url: string,
  catalogue: BuildCatalogue,
  symbolOf: EdsySymbolLookup,
): ImportResult {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { ok: false, problem: 'That is not a link.' };
  }

  const fragment = decodeURIComponent(parsed.hash.replace(/^#\/?/, ''));
  const body = /^L=(.*)$/s.exec(fragment)?.[1];

  if (body === undefined || body === '') {
    /*
     * A short link — `edsy.org/s/vgQS6Nb` — carries a key and no build. Named, because "that link
     * is not readable" would send somebody to check a URL they copied perfectly.
     */
    return {
      ok: false,
      problem:
        'That EDSY link carries no build. Open it on edsy.org and copy the long address from the ' +
        'browser bar — the one starting `edsy.org/#/L=`.',
    };
  }

  /*
   * ★ THE VERSION CHARACTER COMES OFF BEFORE THE SPLIT ★
   *
   * `Build.fromHash` reads `buildhash.slice(0, 1)` as the format version and only THEN splits the
   * rest on commas. So the first comma-separated field is `<version><ship chunk>` joined, and the
   * ship id is one character in — at version 12 and above it is a single character, not two.
   *
   * Read as two characters, `JD` decodes to 1229 and no ship has that id; every link came back
   * "we do not recognise the ship", which reads like missing data rather than an offset.
   */
  const fields = body.split(',');
  const version = decodeNumber((fields[0] ?? '').slice(0, 1));
  const shipField = (fields[0] ?? '').slice(1);

  // One character from version 12; two before it. Nothing that old is still shared, but reading the
  // version rather than assuming costs one line and cannot be wrong.
  const shipIdWidth = version >= 12 ? 1 : 2;
  const shipRef = symbolOf('ship', decodeNumber(shipField.slice(0, shipIdWidth)));
  if (shipRef === null) {
    return { ok: false, problem: 'We do not recognise the ship in that EDSY link.' };
  }

  /*
   * ★ MATCHED ON FRONTIER'S ID, NOT ON THE NAME ★
   *
   * EDSY names the Alliance Challenger `TypeX_3` and the Type-6 `Type6`; Coriolis keys them
   * `alliance_challenger` and `type_6_transporter`. Neither is wrong and no amount of lower-casing
   * and stripping joins them — matching on the name failed on the owner's very first two links.
   *
   * Both sides carry Frontier's own number: EDSY as `fdid`, Coriolis as `edID`. Verified identical
   * on the live data. The name is kept only as a fallback for anything EDSY records without one.
   */
  const ship: CatalogueShip | undefined =
    catalogue.ships().find((s) => s.edID !== null && s.edID === shipRef.fdid) ??
    catalogue
      .ships()
      .find(
        (s) =>
          s.id.replace(/[^a-z0-9]/g, '') ===
          shipRef.fdname.toLowerCase().replace(/[^a-z0-9]/g, ''),
      );

  if (ship === undefined) {
    return { ok: false, problem: `We do not have a ship called "${shipRef.fdname}" in our data yet.` };
  }

  /*
   * ★ THE SLOT GROUPS ARE POSITIONAL, AND EMPTY FIELDS ARE REAL ★
   *
   * Fields 1..5 are the slot groups. A ship with no utility mounts fitted has an EMPTY field there,
   * not a missing one — which is why the fields are read by index rather than by filtering the
   * blanks out. Filtering would shift every later group into the wrong slots.
   */
  /*
   * ★ THE FIELD ORDER IS EDSY'S, TAKEN FROM `Build.fromHash` ★
   *
   *   0 ship   1 hardpoint   2 utility   3 component   4 military   5 internal   6 name   7 nametag
   *
   * `component` is what we call standard, and `military` is the armour-only bay some hulls have —
   * which Coriolis lists among the internals, so both feed the same group in order. Guessing that
   * field 4 was internal put the military module in the first internal bay and pushed everything
   * after it along by one.
   *
   * An empty field is REAL: a ship with nothing in its utility mounts has a blank there, not a
   * missing one. Reading by index rather than filtering blanks is what keeps that from shifting
   * every later group.
   */
  const groups: Array<{ group: SlotGroup; field: string }> = [
    { group: 'hardpoint', field: fields[1] ?? '' },
    { group: 'utility', field: fields[2] ?? '' },
    { group: 'standard', field: fields[3] ?? '' },
    { group: 'internal', field: fields[4] ?? '' },
    { group: 'internal', field: fields[5] ?? '' },
  ];

  const fitted = new Map<string, { edsyId: number; enabled: boolean; priority: number }>();
  const counters = new Map<SlotGroup, number>();
  let bulkheadId: string | null = null;

  for (const { group, field } of groups) {
    if (field === '') continue;

    const entries = readEntries(field);

    /*
     * ★ THE COMPONENT FIELD OPENS WITH THE BULKHEAD ★
     *
     * EDSY's `component` chunk carries EIGHT entries for seven standard slots, and the first is the
     * hull armour — id 40131 on a Sidewinder is `SideWinder_Armour_Grade1`. Read as a standard
     * module it takes the power plant's slot and shifts every core module along by one, which puts
     * a class 2 power plant on an Anaconda: obviously wrong once seen, and completely plausible in
     * a list.
     */
    const rest =
      group === 'standard' && entries.length > 0
        ? (() => {
            const armour = entries[0];
            const ref = armour === undefined ? null : symbolOf('module', armour.edsyId);
            bulkheadId =
              ref === null
                ? null
                : (ship.bulkheads.find((b) => b.raw['symbol'] === ref.fdname)?.id ?? null);
            return entries.slice(1);
          })()
        : entries;

    for (const entry of rest) {
      const index = counters.get(group) ?? 0;
      counters.set(group, index + 1);
      fitted.set(`${group}:${index}`, entry);
    }
  }

  const modules: FittedModule[] = ship.slots.map((slot) => {
    /*
     * Utility mounts live in the hardpoint array on our side and in their own field on EDSY's, so a
     * class 0 hardpoint is looked up under `utility` and the rest under `hardpoint`.
     */
    const key = `${slot.group === 'hardpoint' && slot.size === 0 ? 'utility' : slot.group}:${slot.index}`;
    const entry = fitted.get(key);

    const ref = entry === undefined ? null : symbolOf('module', entry.edsyId);
    const module = ref === null ? null : catalogue.moduleBySymbol(categoryOf(slot), ref.fdname);

    return {
      group: slot.group,
      index: slot.index,
      moduleId: module?.id ?? null,
      slotSize: slot.size,
      enabled: entry?.enabled ?? true,
      priority: entry?.priority ?? 1,
      // Engineering is present in the hash and not read yet — the modifier table is EDSY's own
      // attribute indexing, which is a second mapping and a separate piece of work.
      engineering: null,
    };
  });

  return {
    ok: true,
    build: {
      shipId: ship.id,
      shipName: ship.name,
      // Field 6 is the name and 7 the ident tag — `…,Dreamtime,GU_D09`.
      buildName: (fields[6] ?? '') === '' ? null : (fields[6] ?? null),
      source: 'edsy',
      sourceUrl: url.trim(),
      bulkheadId: bulkheadId ?? ship.bulkheads[0]?.id ?? 'Bs',
      modules,
    },
  };
}
