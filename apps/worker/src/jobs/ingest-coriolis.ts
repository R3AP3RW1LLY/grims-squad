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
  const ship = value as { properties?: Record<string, unknown> };
  const p = ship.properties ?? {};
  const bits = [`${name} is a ship in Elite Dangerous`];

  const num = (k: string): number | null => (typeof p[k] === 'number' ? (p[k] as number) : null);
  const cls = num('class');
  if (cls !== null) {
    // Landing pad size is the single most consequential fact about a hull.
    bits.push(`It needs a ${cls === 1 ? 'small' : cls === 2 ? 'medium' : 'large'} landing pad`);
  }
  const hardpoints = num('hardpoints');
  if (hardpoints !== null) bits.push(`with ${hardpoints} hardpoints`);
  const mass = num('hullMass');
  if (mass !== null) bits.push(`and a hull mass of ${mass} tonnes`);

  const parts = [`${bits.join(', ')}.`];
  const cost = num('cost');
  if (cost !== null) parts.push(`It costs about ${cost.toLocaleString()} credits.`);
  const speed = num('speed');
  if (speed !== null) parts.push(`Top speed ${speed} m/s.`);
  return parts.join(' ');
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
