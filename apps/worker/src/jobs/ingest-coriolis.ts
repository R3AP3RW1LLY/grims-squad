import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ships, modules and engineering, from EDCD's coriolis-data.
 *
 * ★ WHY THIS SOURCE FIRST ★
 *
 * 117KB, and it answers the questions members actually ask — "what is a good exploration Phantom",
 * "what does G5 dirty drives do", "will this fit". The galaxy dump is thirty thousand times larger
 * and answers a narrower band of questions.
 *
 * It is also the only source that needs no key, no rate limiting and no network at ingest time: it
 * is a git checkout, and it changes only when Frontier ships a game update.
 *
 * ★ STORED FOR LOOKUP, NOT EMBEDDED ★
 *
 * "How many class 5 slots does a Krait have" has one correct answer, and a model recalling it from a
 * vector approximates. These rows are looked up by name and read exactly — see `STORAGE_KIND`.
 */

export interface KnowledgeRow {
  readonly source: 'coriolis';
  readonly kind: 'ship' | 'module' | 'blueprint';
  readonly extKey: string;
  readonly name: string;
  readonly data: unknown;
  /** A sentence describing the row. Embedded, and what the assistant reads. */
  readonly text: string;
}

/**
 * Reads a coriolis-data checkout into knowledge rows.
 *
 * Pure and synchronous: given a directory it returns rows, touching no database. That makes the
 * shape of every source testable without a Postgres, which matters because the shapes are the part
 * that breaks when upstream changes.
 */
export function readCoriolis(root: string): KnowledgeRow[] {
  const rows: KnowledgeRow[] = [];

  // ── ships ────────────────────────────────────────────────────────────────
  const shipDir = join(root, 'ships');
  if (existsSync(shipDir)) {
    for (const file of readdirSync(shipDir).filter((f) => f.endsWith('.json'))) {
      const parsed = readJson(join(shipDir, file));
      if (parsed === null) continue;

      /*
       * Each file is `{ "<key>": { properties: {...}, slots: {...} } }` rather than the ship object
       * directly — a shape worth naming, because assuming the file IS the ship yields rows whose
       * name is undefined and whose data is a wrapper.
       */
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const ship = value as { properties?: { name?: unknown } };
        const name = typeof ship.properties?.name === 'string' ? ship.properties.name : key;
        rows.push({
          source: 'coriolis',
          kind: 'ship',
          extKey: key,
          name,
          data: value,
          text: describeShip(name, value),
        });
      }
    }
  }

  // ── modules ──────────────────────────────────────────────────────────────
  //
  // Nested by group (standard / hardpoints / internal), and each file holds many variants. Flattened
  // here: a member asking about a Frame Shift Drive does not care which directory it lives in.
  const moduleRoot = join(root, 'modules');
  if (existsSync(moduleRoot)) {
    for (const group of readdirSync(moduleRoot)) {
      const groupDir = join(moduleRoot, group);
      if (!existsSync(groupDir) || !isDir(groupDir)) continue;

      for (const file of readdirSync(groupDir).filter((f) => f.endsWith('.json'))) {
        const parsed = readJson(join(groupDir, file));
        if (parsed === null) continue;
        const base = file.replace(/\.json$/, '');

        for (const [variant, value] of Object.entries(parsed as Record<string, unknown>)) {
          rows.push({
            text: `${prettyName(base)} is a ${group} module for Elite Dangerous ships (variant ${variant}).`,
            source: 'coriolis',
            kind: 'module',
            // Group included: `frame_shift_drive` exists under more than one group in principle, and
            // a collision would silently overwrite one with the other.
            extKey: `${group}/${base}/${variant}`,
            name: prettyName(base),
            data: value,
          });
        }
      }
    }
  }

  // ── engineering blueprints ───────────────────────────────────────────────
  //
  // The highest-value file in the repository for an assistant: what every modification does at every
  // grade. Almost every "how do I engineer X" question resolves here.
  const blueprints = readJson(join(root, 'modifications', 'blueprints.json'));
  if (blueprints !== null) {
    for (const [key, value] of Object.entries(blueprints as Record<string, unknown>)) {
      rows.push({
        source: 'coriolis',
        kind: 'blueprint',
        extKey: key,
        name: prettyName(key),
        data: value,
        text:
          `${prettyName(key)} is an engineering blueprint. It modifies a module's statistics at ` +
          `grades 1 to 5; higher grades give a larger effect and need rarer materials.`,
      });
    }
  }

  return rows;
}

/**
 * One ship, as a sentence.
 *
 * ★ WRITTEN AT INGEST SO IT CAN BE EMBEDDED ★
 *
 * Structured rows carried no text, so nothing could embed them and the assistant was handed raw
 * JSON when it retrieved one. The numbers people actually ask about — pads, jump range, hardpoints
 * — belong in words a vector search can match.
 */
function describeShip(name: string, value: unknown): string {
  const ship = value as {
    properties?: Record<string, unknown>;
    slots?: { internal?: unknown[]; hardpoints?: unknown[] };
  };
  const p = ship.properties ?? {};

  const num = (k: string): number | null => (typeof p[k] === 'number' ? (p[k] as number) : null);

  const bits = [`${name} is a ship in Elite Dangerous`];

  const maker = typeof p['manufacturer'] === 'string' ? p['manufacturer'] : null;
  if (maker !== null) bits.push(`built by ${maker}`);

  const cls = num('class');
  if (cls !== null) {
    // Landing pad size is the single most consequential fact about a hull. Lower case and
    // participial, because these fragments are joined with commas into one sentence — "built by
    // Faulcon DeLacy, It needs a medium landing pad" is what a capital here produces.
    bits.push(`needing a ${cls === 1 ? 'small' : cls === 2 ? 'medium' : 'large'} landing pad`);
  }

  /*
   * ★ READ FROM slots, NOT FROM properties — AND THE OLD CODE READ NEITHER ★
   *
   * `describeShip` asked for `properties.hardpoints` and `properties.cost`. Neither field exists in
   * coriolis-data: the counts live in `slots`, and the price is `hullCost`. Both lookups returned
   * null, silently, so every ship in the knowledge base was described as a landing pad size, a hull
   * mass and a top speed.
   *
   * The cost of that was measurable. Asked "what does a Krait Mk II hold?", the assistant retrieved
   * the correct ship and answered "I do not have that information" — which was true, and was the
   * fault of this function rather than of the model.
   */
  const hardpointSizes = numericSizes(ship.slots?.hardpoints);
  const guns = hardpointSizes.filter((s) => s > 0);
  // Size 0 entries are utility mounts, which is where the shield boosters and heat sinks go.
  const utilities = hardpointSizes.filter((s) => s === 0).length;
  if (guns.length > 0) {
    bits.push(`with ${guns.length} weapon hardpoints (${describeMounts(guns)}) and ${utilities} utility mounts`);
  }

  const mass = num('hullMass');
  if (mass !== null) bits.push(`and a hull mass of ${mass} tonnes`);

  const parts = [`${bits.join(', ')}.`];

  /*
   * ★ MAXIMUM CARGO, DERIVED — because it is the question people actually ask ★
   *
   * Coriolis stores no cargo figure, and there is no single right one: capacity depends on what a
   * commander fits. What CAN be stated is the ceiling, and it follows from the optional internal
   * slots — a cargo rack of class N carries 2^N tonnes, so filling every optional slot with racks
   * gives the maximum the hull can physically hold.
   *
   * Phrased as the ceiling rather than as "cargo: N", because a member reading "230 tonnes" against
   * a ship they have fitted with shields and a fuel scoop would rightly call it wrong.
   */
  const internal = numericSizes(ship.slots?.internal);
  if (internal.length > 0) {
    const maxCargo = internal.reduce((n, size) => n + 2 ** size, 0);
    parts.push(
      `It has ${internal.length} optional internal slots and can carry up to ${maxCargo} tonnes of ` +
        `cargo if every one of them is filled with cargo racks — less once shields, a fuel scoop or ` +
        `anything else is fitted.`,
    );
  }

  const cost = num('hullCost');
  if (cost !== null) parts.push(`The hull costs about ${cost.toLocaleString()} credits.`);

  const speed = num('speed');
  const boost = num('boost');
  if (speed !== null) {
    parts.push(boost === null ? `Top speed ${speed} m/s.` : `Top speed ${speed} m/s, ${boost} boosting.`);
  }

  const crew = num('crew');
  if (crew !== null) parts.push(`It seats a crew of ${crew}.`);

  const armour = num('baseArmour');
  const shields = num('baseShieldStrength');
  if (armour !== null && shields !== null) {
    parts.push(`Base armour ${armour}, base shields ${shields}.`);
  }

  if (p['fighterHangars'] === true) parts.push('It can carry a ship-launched fighter.');

  return parts.join(' ');
}

/**
 * The numeric slot sizes, ignoring the restricted ones.
 *
 * Some entries are objects rather than numbers — a Planetary Approach Suite bay, a military slot —
 * and those cannot take a cargo rack. Counting them would overstate what a hull holds.
 */
function numericSizes(slots: unknown[] | undefined): number[] {
  if (!Array.isArray(slots)) return [];
  return slots.filter((s): s is number => typeof s === 'number');
}

/** `3,3,3,2,2` -> `3 large, 2 medium`. Sizes are what a member fits weapons into. */
function describeMounts(sizes: readonly number[]): string {
  const names: Record<number, string> = { 1: 'small', 2: 'medium', 3: 'large', 4: 'huge' };
  const counts = new Map<number, number>();
  for (const s of sizes) counts.set(s, (counts.get(s) ?? 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([size, n]) => `${n} ${names[size] ?? `class ${size}`}`)
    .join(', ');
}

/** `frame_shift_drive` -> `Frame Shift Drive`. What a member would type and read. */
function prettyName(raw: string): string {
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function isDir(path: string): boolean {
  try {
    return readdirSync(path).length >= 0;
  } catch {
    return false;
  }
}

/**
 * Reads one JSON file, or null.
 *
 * Null rather than throwing: upstream is somebody else's repository, and one malformed file must
 * cost that file rather than the entire ingest. A source that refuses to load at all because of one
 * bad ship is a source that is down.
 */
function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}
