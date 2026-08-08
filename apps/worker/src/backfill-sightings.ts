import { PrismaClient } from '@grims/db';
import { backfillSightings } from './jobs/backfill-sightings.js';

/**
 * Replaying the systems and stations members already told us about.
 *
 * ★ WE HAD THE ANSWER AND THREW THE MESSAGE AWAY ★
 *
 * From 2026-08-08 the ingest routes `FSDJump`, `Location`, `CarrierJump` and `Docked` into the
 * galaxy tables as they arrive. This replays the ones that came in before that and were stored,
 * consented to, and never read.
 *
 * Production held 866 FSDJump, 987 Docked and 188 Location events from a single week, and 502
 * distinct systems that `knowledge_items` did not hold. One of them was Col 285 Sector GL-W c2-12
 * — the owner's own — which the colonisation scout had rejected the previous day with "We hold no
 * coordinates ... Check the spelling — it has to match the game." The spelling was right. A member
 * had flown there and sent us the coordinates.
 *
 * ★ IT USES NOTHING THAT WAS NOT ALREADY CONSENTED TO ★
 *
 * These rows exist in `telemetry_events` precisely because they passed the consent gate on the way
 * in. A member with `location` switched off has nothing here to replay, which needs no special
 * case because there is no data.
 *
 * ★ SAFE TO RUN TWICE, WHICH IS THE RUN THAT HAPPENS BY ACCIDENT ★
 *
 * Both writers upsert and neither unlearns a coordinate, so a second pass re-teaches the same
 * facts. A one-off that corrupts on its second run is a one-off somebody will corrupt.
 *
 *   node apps/worker/dist/backfill-sightings.js
 */
async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const started = Date.now();
    const r = await backfillSightings(db);
    const secs = Math.round((Date.now() - started) / 1000);

    console.log(
      `sightings backfilled in ${secs}s — ` +
        `${r.systemEvents.toLocaleString()} system events read, ${r.systemsWritten.toLocaleString()} systems written; ` +
        `${r.dockEvents.toLocaleString()} dock events read, ${r.docksWritten.toLocaleString()} stations written`,
    );
  } finally {
    await db.$disconnect();
  }
}

await main();
