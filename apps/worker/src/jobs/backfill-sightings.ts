import type { PrismaClient } from '@grims/db';
import { enrichStationFromDock, recordSystemSighting } from '@grims/db';
import { readDockSighting, readSystemSighting } from '@grims/shared';

/**
 * The systems and stations members already told us about, and we threw away.
 *
 * ★ SQUADRON OWNER, 2026-08-08 ★
 *
 * "we need system data that our members discover to update our market data near instantly."
 *
 * From now on that happens on upload. This is the other half: production held 866 `FSDJump`, 987
 * `Docked` and 188 `Location` events from one week alone, none of which had ever been routed
 * anywhere, and 502 distinct systems that `knowledge_items` did not hold.
 *
 * One of those was Col 285 Sector GL-W c2-12 — the owner's own system, which the colonisation
 * scout rejected on 2026-08-07 with "We hold no coordinates ... Check the spelling — it has to
 * match the game." A member had flown there and sent us the coordinates. We had the answer the
 * whole time.
 *
 * ★ IT USES NOTHING THE MEMBER DID NOT ALREADY CONSENT TO ★
 *
 * These rows are in `telemetry_events` precisely because they passed the consent gate on the way
 * in. A member who had `location` switched off has no rows here to backfill, which is the correct
 * behaviour and needs no special case.
 *
 * ★ IDEMPOTENT, AND SAFE TO RUN TWICE ★
 *
 * Both writers upsert, and `recordSystemSighting` never unlearns a coordinate. Running this again
 * re-teaches the same facts. It is written to be re-runnable because the first run happens against
 * production by hand, and a job that must only ever run once is a job somebody will run twice.
 */
export interface BackfillReport {
  readonly systemEvents: number;
  readonly systemsWritten: number;
  readonly dockEvents: number;
  readonly docksWritten: number;
}

const SYSTEM_EVENTS = ['FSDJump', 'Location', 'CarrierJump'];
const BATCH = 2_000;

export async function backfillSightings(db: PrismaClient): Promise<BackfillReport> {
  let systemEvents = 0;
  let dockEvents = 0;

  /*
   * NEWEST FIRST, and deduped by address in memory.
   *
   * A system's coordinates do not change, so the first sighting of an address is as good as the
   * hundredth — and taking the newest means the name and the economy reflect the most recent visit
   * rather than whatever was true months ago.
   */
  const seenSystems = new Map<string, ReturnType<typeof readSystemSighting>>();
  for (let offset = 0; ; offset += BATCH) {
    const rows = await db.$queryRawUnsafe<Array<{ payload: Record<string, unknown> }>>(
      `SELECT payload FROM telemetry_events
        WHERE event_type = ANY($1::text[])
        ORDER BY occurred_at DESC
        LIMIT ${BATCH} OFFSET ${offset}`,
      SYSTEM_EVENTS,
    );
    if (rows.length === 0) break;
    systemEvents += rows.length;
    for (const r of rows) {
      const seen = readSystemSighting(r.payload);
      // First wins because the scan is newest-first.
      if (seen !== null && !seenSystems.has(seen.systemAddress)) {
        seenSystems.set(seen.systemAddress, seen);
      }
    }
    if (rows.length < BATCH) break;
  }

  let systemsWritten = 0;
  for (const seen of seenSystems.values()) {
    if (seen === null) continue;
    try {
      await recordSystemSighting(db, seen);
      systemsWritten += 1;
    } catch {
      // One malformed payload must not end the pass. The live path will teach it again.
    }
  }

  const seenDocks = new Map<number, ReturnType<typeof readDockSighting>>();
  for (let offset = 0; ; offset += BATCH) {
    const rows = await db.$queryRawUnsafe<Array<{ payload: Record<string, unknown> }>>(
      `SELECT payload FROM telemetry_events
        WHERE event_type = 'Docked'
        ORDER BY occurred_at DESC
        LIMIT ${BATCH} OFFSET ${offset}`,
    );
    if (rows.length === 0) break;
    dockEvents += rows.length;
    for (const r of rows) {
      const dock = readDockSighting(r.payload);
      if (dock !== null && !seenDocks.has(dock.marketId)) seenDocks.set(dock.marketId, dock);
    }
    if (rows.length < BATCH) break;
  }

  let docksWritten = 0;
  for (const dock of seenDocks.values()) {
    if (dock === null) continue;
    try {
      await enrichStationFromDock(db, dock);
      docksWritten += 1;
    } catch {
      /* as above */
    }
  }

  return { systemEvents, systemsWritten, dockEvents, docksWritten };
}
