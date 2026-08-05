// Rebuilds market_entries from the already-ingested galaxy rows.
// Separate entrypoint so it can be re-run without repeating the 4GB import.
import { PrismaClient } from '@grims/db';
import { rebuildMarketEntries } from './src/jobs/market-flatten.js';

const db = new PrismaClient();
const started = Date.now();
try {
  const n = await rebuildMarketEntries(db);
  console.log(`flattened ${n.toLocaleString()} rows in ${((Date.now() - started) / 1000).toFixed(1)}s`);
} finally {
  await db.$disconnect();
}
