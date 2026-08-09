import { PrismaClient } from '@grims/db';
import { cleanStationName, hasLocalisationToken } from '@grims/shared';

/**
 * A one-off repair for names already stored in the game's vocabulary.
 *
 * ★ SQUADRON OWNER, 2026-08-09 ★
 *
 * "we have a member who started a colonization project, this is what the location name comes up as
 * in production: `$EXT_PANEL_ColonisationShip; Mitra Horizons` this should only say: Mitra Horizons"
 *
 * The writers are fixed — the galaxy ingest, the market feed and the journal dock path all clean the
 * name at the door now. This is for what is already in the database.
 *
 * ★ WHAT SELF-HEALS AND WHAT DOES NOT ★
 *
 * `knowledge_items` rows from the galaxy dump are rewritten by the next ingest, and
 * `market_entries.station_name` is copied from them by the rebuild, so those two correct themselves
 * within a day of this shipping. Measured on production: 882 of the 1,082 affected knowledge rows.
 *
 * These do not, and are why this script exists:
 *   - `colony_projects.station_name` is written once, when the project is posted, and never derived
 *     again. That is the row the owner reported.
 *   - `knowledge_items` rows sourced from `eddn` or the journal are only rewritten when that station
 *     is seen live again, which for a construction site may be never.
 *
 * ★ IT USES THE SAME FUNCTION THE WRITERS USE ★
 *
 * Deliberately not a regex in SQL. A second copy of the rule would drift from `cleanStationName`,
 * and the drift would be silent — the same failure mode the market rebuild's index list has already
 * demonstrated twice. Slower, and correct by construction.
 */

const db = new PrismaClient();

/** Anything that still reads as a key. Matched loosely; `cleanStationName` makes the real decision. */
const SUSPECT = `$%;%`;

interface Row {
  readonly id: string;
  readonly name: string;
}

async function repairKnowledgeItems(apply: boolean): Promise<number> {
  const rows = await db.$queryRawUnsafe<Row[]>(
    `SELECT id::text AS id, name FROM knowledge_items WHERE name LIKE $1`,
    SUSPECT,
  );

  let changed = 0;
  for (const row of rows) {
    if (!hasLocalisationToken(row.name)) continue;
    const cleaned = cleanStationName(row.name);
    if (cleaned === row.name) continue;
    changed += 1;
    if (changed <= 5) console.log(`  knowledge_items  ${row.name}  ->  ${cleaned}`);
    if (apply) {
      await db.$executeRawUnsafe(
        `UPDATE knowledge_items SET name = $1 WHERE id = $2::uuid`,
        cleaned,
        row.id,
      );
    }
  }
  return changed;
}

/**
 * ★ THE TITLE AS WELL AS THE STATION NAME — WIDENED 2026-08-09 ★
 *
 * The first run of this repaired `station_name` and left `title` alone, and the miss was plain on
 * the board: a project reading `$EXT_PANEL_ColonisationShip; Mitra Horizons` beside a location
 * column that correctly said "Mitra Horizons". Both surfaces offer the station's name as the default
 * title, so the game's string lands in both columns — and the title is the one the board, the
 * sidebar badge and every notification show.
 */
async function repairColonyProjects(apply: boolean): Promise<number> {
  const rows = await db.$queryRawUnsafe<Array<{ id: string; title: string; station: string | null }>>(
    `SELECT id::text AS id, title, station_name AS station
       FROM colony_projects
      WHERE title LIKE $1 OR station_name LIKE $1`,
    SUSPECT,
  );

  let changed = 0;
  for (const row of rows) {
    for (const [column, value] of [
      ['title', row.title],
      ['station_name', row.station],
    ] as const) {
      if (!hasLocalisationToken(value)) continue;
      const cleaned = cleanStationName(value);
      if (cleaned === value || cleaned === null) continue;

      changed += 1;
      console.log(`  colony_projects.${column}  ${value}  ->  ${cleaned}`);
      if (apply) {
        await db.$executeRawUnsafe(
          `UPDATE colony_projects SET ${column} = $1 WHERE id = $2::uuid`,
          cleaned,
          row.id,
        );
      }
    }
  }
  return changed;
}

/**
 * `market_entries` is derived and would correct itself on the next rebuild — but that is up to a day
 * away and these rows are what the Freight Office shows today.
 *
 * Grouped by the distinct bad name rather than per row: 4,005 rows carry roughly a thousand distinct
 * names, so this is a thousand statements instead of four thousand, and each one is a plain UPDATE
 * taking ROW EXCLUSIVE — no reader is blocked.
 */
async function repairMarketEntries(apply: boolean): Promise<number> {
  const names = await db.$queryRawUnsafe<Array<{ station_name: string; n: bigint }>>(
    `SELECT station_name, count(*)::bigint AS n FROM market_entries
      WHERE station_name LIKE $1 GROUP BY station_name`,
    SUSPECT,
  );

  let changed = 0;
  for (const { station_name: name, n } of names) {
    if (!hasLocalisationToken(name)) continue;
    const cleaned = cleanStationName(name);
    if (cleaned === name) continue;
    changed += Number(n);
    if (apply) {
      await db.$transaction(
        async (tx) => {
          // The same courtesy every other market write pays: give up rather than queue.
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
          await tx.$executeRawUnsafe(
            `UPDATE market_entries SET station_name = $1 WHERE station_name = $2`,
            cleaned,
            name,
          );
        },
        /*
         * ★ STATED, BECAUSE THE DEFAULT HAS NOW STOPPED THIS RUN TWICE ★
         *
         * Prisma's interactive transactions default to a FIVE SECOND budget. Run against production
         * this repair fixes every knowledge_items row and the colonisation project, then dies part
         * way through the market table: "the timeout for this transaction was 5000 ms, however
         * 5456 ms passed". One station's name can be on thousands of rows and `station_name` carries
         * no index, so each UPDATE is a sequential scan over nineteen million rows.
         *
         * The `lock_timeout` above is a different budget for a different hazard — it bounds WAITING
         * for a lock, not HOLDING the transaction — so it could never have caught this.
         */
        { timeout: 10 * 60_000, maxWait: 60_000 },
      );
    }
  }
  return changed;
}

async function main(): Promise<void> {
  // Dry run unless told otherwise. A repair that cannot be previewed is one nobody checks.
  const apply = process.argv.includes('--apply');
  console.log(apply ? 'repairing station names' : 'DRY RUN — pass --apply to write');

  const k = await repairKnowledgeItems(apply);
  const c = await repairColonyProjects(apply);
  const m = await repairMarketEntries(apply);

  console.log(
    `\n${apply ? 'repaired' : 'would repair'}: ` +
      `${k} knowledge_items, ${c} colony_projects, ${m} market_entries rows`,
  );
  await db.$disconnect();
}

main().catch(async (e: unknown) => {
  console.error('repair failed:', e);
  await db.$disconnect();
  process.exit(1);
});
