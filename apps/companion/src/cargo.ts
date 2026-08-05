/**
 * What is actually in the hold.
 *
 * ★ SQUADRON OWNER, 2026-08-03 ★
 *
 * "the cargo hold overlay is not working as it is intended. i have a full hold and it is not
 * showing what i am carrying, its value, nothing at all!"
 *
 * It was sending null on purpose — the panel honestly said "Waiting for your hold" because nothing
 * in the app had ever read a hold. This is that missing half.
 *
 * ★ Cargo.json, NOT THE JOURNAL ★
 *
 * The journal's routine `Cargo` lines carry a vessel and a count and no inventory at all; the full
 * list appears only on the ship-boarding snapshot. Frontier writes the live hold to `Cargo.json`,
 * a sidecar in the same directory the journals live in — the one `findJournalDir()` already
 * resolves — and rewrites it every time the hold changes.
 *
 * So the file is the accurate source and the event fold is the cheap one that drifts. This reads
 * the file.
 *
 * ★ CAPACITY COMES FROM SOMEWHERE ELSE ENTIRELY ★
 *
 * Nothing Frontier writes to a sidecar says how big the hold is. `Status.json` carries the tonnage
 * currently carried and not the ceiling; `Cargo.json` carries the contents and not the ceiling. The
 * only source is `Loadout.CargoCapacity` in the journal, which is emitted on boarding and on every
 * refit — so it is read from the journal tail and then remembered.
 */

/** One commodity in the hold. */
export interface CargoItem {
  readonly commodity: string;
  readonly count: number;
  /** True when the current construction site is asking for this. Filled in by the caller. */
  readonly wanted: boolean;
}

export interface Hold {
  readonly items: readonly CargoItem[];
  /** Tonnes carried, as Frontier reports it rather than as a sum of the items. */
  readonly used: number;
  /** When the game last wrote the file. */
  readonly at: string | null;
}

/*
 * ★ BUILT FROM A CHAR CODE, NOT TYPED ★
 *
 * A literal byte-order mark in source is invisible in every editor and trips lint's
 * irregular-whitespace rule — which is the only reason anybody ever finds out it is there.
 */
const BOM_AT_START = new RegExp(`^${String.fromCharCode(0xfe_ff)}`);

interface RawEntry {
  Name?: unknown;
  Name_Localised?: unknown;
  Count?: unknown;
}

/**
 * `$steel_name;` or `steel` → `Steel`.
 *
 * Frontier's own convention, and stable for years. The localised name is preferred when present
 * because that is what a market screen shows and what our commodity tables are keyed on — a symbol
 * would match nothing when the panel tries to work out whether a build wants it.
 */
export function commodityName(raw: RawEntry): string {
  const localised = typeof raw.Name_Localised === 'string' ? raw.Name_Localised.trim() : '';
  if (localised !== '') return localised;

  const symbol = typeof raw.Name === 'string' ? raw.Name.trim() : '';
  if (symbol === '') return '';

  const cleaned = symbol
    .replace(/^\$/, '')
    .replace(/_name;?$/i, '')
    .replace(/[_;]/g, ' ')
    .trim();
  if (cleaned === '') return symbol;

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Reads `Cargo.json`.
 *
 * Null rather than an empty hold when the file is missing or unreadable, and that distinction is
 * the whole point: an empty hold renders "Hold empty", which is a claim about the member's ship.
 * Not knowing renders "Waiting for your hold", which is true.
 *
 * ★ AN EMPTY INVENTORY IS STILL A REAL ANSWER ★
 *
 * A member who has just delivered everything has `Count: 0` and an empty list, and that IS their
 * hold. It comes back as a Hold with no items rather than as null, so the panel can say so.
 */
export function parseCargo(text: string): Hold | null {
  let raw: { Count?: unknown; Inventory?: unknown; timestamp?: unknown };
  try {
    /*
     * ★ THE BOM AGAIN ★
     *
     * Frontier writes these files as UTF-8 and some tooling adds a byte-order mark. `JSON.parse`
     * throws on one, and the failure looks exactly like a corrupt file — which cost us a whole
     * evening once already on the config.
     */
    raw = JSON.parse(text.replace(BOM_AT_START, '')) as typeof raw;
  } catch {
    return null;
  }

  const inventory = Array.isArray(raw.Inventory) ? raw.Inventory : [];

  const items: CargoItem[] = [];
  for (const entry of inventory) {
    const item = entry as RawEntry;
    const commodity = commodityName(item);
    const count = Number(item.Count);
    if (commodity === '' || !Number.isFinite(count) || count <= 0) continue;
    items.push({ commodity, count, wanted: false });
  }

  return {
    // Frontier's own total, not a sum of the list. They agree in practice, and when they do not it
    // is because the file was read mid-write — in which case their figure is the less wrong one.
    used: Number.isFinite(Number(raw.Count)) ? Number(raw.Count) : items.reduce((a, i) => a + i.count, 0),
    // Biggest first: a hold is scanned for "what am I carrying most of", and on a panel over a
    // cockpit only the first few lines are ever read.
    items: items.sort((a, b) => b.count - a.count),
    at: typeof raw.timestamp === 'string' ? raw.timestamp : null,
  };
}

/**
 * The last `CargoCapacity` in a slice of journal.
 *
 * ★ THE LAST ONE, NOT THE FIRST ★
 *
 * `Loadout` fires on boarding and again on every refit, so a session can contain several — and only
 * the most recent describes the ship the member is flying now. Scanning forward and keeping the
 * last match is what makes a mid-session cargo rack swap show up.
 *
 * Regex rather than parsing every line as JSON: this runs over half a megabyte of journal at
 * startup, and every line that is not a Loadout would be parsed and thrown away.
 */
export function capacityFrom(journal: string): number | null {
  let capacity: number | null = null;
  for (const match of journal.matchAll(/"CargoCapacity":\s*(\d+)/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value >= 0) capacity = value;
  }
  return capacity;
}

/**
 * Marks the commodities a construction site is asking for.
 *
 * ★ THIS IS THE WHOLE REASON THE PANEL IS WORTH DRAWING ★
 *
 * A list of what is in the hold is something the game already shows. What it cannot show is which
 * of it the site you are flying to actually wants — so a member hauling a mixed load knows what to
 * hand over and what they are carrying for nothing.
 */
export function markWanted(hold: Hold, wanted: ReadonlySet<string>): Hold {
  if (wanted.size === 0) return hold;

  return {
    ...hold,
    items: hold.items.map((item) => ({ ...item, wanted: wanted.has(item.commodity) })),
  };
}
