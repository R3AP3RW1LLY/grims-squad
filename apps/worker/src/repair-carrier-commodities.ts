import { PrismaClient } from '@grims/db';

/**
 * A one-off repair for carrier cargo stored under the game's internal symbol.
 *
 * ★ SQUADRON OWNER, 2026-08-09 ★
 *
 * "ensure that what is in a carriers hold is tracking on the whats needed and where to buy tabs of
 * the colonization project pages ... its supposed to appear in yellow so we know what we need and
 * dont need"
 *
 * It was not, because the companion stored `steel` where every other table says `Steel`. Frontier
 * omits `Type_Localised` for exactly the commodities whose symbol is already the plain word, so the
 * app's fallback fired for those and only those. `colony_needs.commodity` holds display names, the
 * carrier-cover join matched nothing, and the yellow segment never appeared.
 *
 * Measured on production before this ran: 1,298 t of Steel and 1,186 t of Aluminium aboard one
 * carrier serving FOUR builds, invisible on every one of them, while the shopping list quoted a trip
 * to buy Steel the squadron already owned.
 *
 * ★ WHY THE ROWS NEED TOUCHING AT ALL ★
 *
 * Both writers are fixed, but that does not heal what is stored. The upsert key is
 * `(market_id, commodity, source)`, so a corrected push writes a NEW row called `Steel` and leaves
 * the old `steel` beside it — a stale tonnage that no longer moves, counted by nothing and
 * confusing to anybody reading the table directly.
 *
 * ★ THE COLLISION THIS HAS TO SURVIVE ★
 *
 * If both spellings already exist for one carrier, renaming would violate that key. The newer
 * reading wins and the older row is removed, because these are SNAPSHOTS rather than a ledger —
 * each reading replaces the commodity's figure outright, so the freshest is simply the true one.
 */

const db = new PrismaClient();

interface Row {
  readonly marketId: string;
  readonly commodity: string;
  readonly source: string;
  readonly tonnes: number;
  readonly updatedAt: Date;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  console.log(apply ? 'repairing carrier commodity names' : 'DRY RUN — pass --apply to write');

  /* The display vocabulary the rest of the platform uses. 393 rows, not nineteen million. */
  const names = await db.$queryRawUnsafe<Array<{ commodity: string }>>(
    `SELECT DISTINCT commodity FROM commodity_snapshots`,
  );
  const canonical = new Map(names.map((n) => [n.commodity.toLowerCase(), n.commodity]));
  console.log(`  ${canonical.size} canonical commodity names`);

  const rows = await db.$queryRawUnsafe<Row[]>(
    `SELECT market_id::text AS "marketId", commodity, source, tonnes, updated_at AS "updatedAt"
       FROM colony_carrier_cargo`,
  );

  let fixed = 0;
  let merged = 0;

  for (const row of rows) {
    const want = canonical.get(row.commodity.toLowerCase());
    if (want === undefined || want === row.commodity) continue;

    // Does the correct spelling already exist for this carrier and source?
    const existing = rows.find(
      (r) =>
        r.marketId === row.marketId && r.source === row.source && r.commodity === want,
    );

    if (existing === undefined) {
      fixed += 1;
      console.log(`  ${row.marketId}  ${row.commodity} -> ${want}  (${row.tonnes} t)`);
      if (apply) {
        await db.$executeRawUnsafe(
          `UPDATE colony_carrier_cargo SET commodity = $1
            WHERE market_id = $2::bigint AND commodity = $3 AND source = $4`,
          want,
          row.marketId,
          row.commodity,
          row.source,
        );
      }
      continue;
    }

    // Both spellings present. Keep the newer reading, drop the older row.
    merged += 1;
    const keepNew = existing.updatedAt >= row.updatedAt;
    console.log(
      `  ${row.marketId}  ${row.commodity} (${row.tonnes} t) merges into ${want} ` +
        `(${existing.tonnes} t) — keeping the ${keepNew ? 'existing' : 'older-named'} reading`,
    );
    if (apply) {
      if (!keepNew) {
        await db.$executeRawUnsafe(
          `UPDATE colony_carrier_cargo SET tonnes = $1, updated_at = $2
            WHERE market_id = $3::bigint AND commodity = $4 AND source = $5`,
          row.tonnes,
          row.updatedAt,
          row.marketId,
          want,
          row.source,
        );
      }
      await db.$executeRawUnsafe(
        `DELETE FROM colony_carrier_cargo
          WHERE market_id = $1::bigint AND commodity = $2 AND source = $3`,
        row.marketId,
        row.commodity,
        row.source,
      );
    }
  }

  console.log(`\n${apply ? 'repaired' : 'would repair'}: ${fixed} renamed, ${merged} merged`);
  await db.$disconnect();
}

main().catch(async (e: unknown) => {
  console.error('repair failed:', e);
  await db.$disconnect();
  process.exit(1);
});
