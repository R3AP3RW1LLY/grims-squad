import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  commodityName,
  completeColonyProject,
  type ColonyStore,
  type ContributionReading,
  type DepotReading,
  type NeedRow,
  type TrackedProject,
} from './colony-sync.js';
import type { LiveNudge } from './notify.js';

/**
 * Reading colonisation events out of telemetry, and writing project records.
 *
 * ★ TELEMETRY IS THE ONLY SOURCE ★
 *
 * `ColonisationConstructionDepot` and `ColonisationContribution` arrive from members' companion
 * apps and land in `telemetry_events` like everything else. Nothing else in the world publishes
 * what a construction site still needs — not EDSM, not Spansh, not Ravencolonial, which learns it
 * the same way we now do.
 *
 * Consent has ALREADY been applied by the time a row exists here: the ingest drops events in a
 * category the member switched off. So this reads freely, and a member who declines `colonisation`
 * simply contributes nothing to it — which is the correct behaviour and not a special case.
 */

/** Rows arrive as JSON; the shapes are Frontier's. */
interface DepotPayload {
  MarketID?: unknown;
  ConstructionComplete?: unknown;
  ConstructionFailed?: unknown;
  ResourcesRequired?: unknown;
}

interface ContributionPayload {
  MarketID?: unknown;
  Contributions?: unknown;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export class PrismaColonyStore implements ColonyStore {
  constructor(
    private readonly db: PrismaClient,
    /**
     * How to nudge live badges when a completion is announced. Optional and process-specific:
     * the worker publishes through the Redis bridge, the API publishes to its own SSE service,
     * and a test passes nothing. Rows still land without it — see notify.ts.
     */
    private readonly nudge?: LiveNudge,
  ) {}

  async tracked(): Promise<readonly TrackedProject[]> {
    const rows = await this.db.colonyProject.findMany({
      // A finished project is history: its needs are settled and its ledger is closed. Re-reading
      // it every run would cost a query per project for ever and could only ever confirm itself.
      where: { completedAt: null },
      select: { id: true, marketId: true, completedAt: true },
    });
    return rows;
  }

  async latestDepot(marketId: bigint): Promise<DepotReading | null> {
    /*
     * ANYBODY's journal, not just the poster's. A squadron project is hauled to by many people, and
     * the freshest reading is whoever docked most recently — insisting on the owner's own journal
     * would leave a project stale whenever they were not the one flying.
     */
    const rows = await this.db.$queryRawUnsafe<Array<{ payload: unknown; occurred_at: Date }>>(
      `SELECT payload, occurred_at
         FROM telemetry_events
        WHERE event_type = 'ColonisationConstructionDepot'
          AND (payload->>'MarketID')::bigint = $1::bigint
        ORDER BY occurred_at DESC
        LIMIT 1`,
      marketId.toString(),
    );

    const row = rows[0];
    if (row === undefined) return null;

    const p = row.payload as DepotPayload;
    const raw = Array.isArray(p.ResourcesRequired) ? p.ResourcesRequired : [];

    const resources: Array<{ commodity: string; required: number; provided: number }> = [];
    for (const item of raw) {
      const r = item as {
        Name?: unknown;
        Name_Localised?: unknown;
        RequiredAmount?: unknown;
        ProvidedAmount?: unknown;
      };
      const commodity = commodityName({
        name: typeof r.Name === 'string' ? r.Name : null,
        localised: typeof r.Name_Localised === 'string' ? r.Name_Localised : null,
      });
      // A resource we cannot name is dropped rather than stored blank — an unnamed row on a needs
      // list is a line a member cannot act on and cannot look up.
      if (commodity === '') continue;

      resources.push({
        commodity,
        required: num(r.RequiredAmount),
        provided: num(r.ProvidedAmount),
      });
    }

    return {
      marketId,
      observedAt: row.occurred_at,
      complete: p.ConstructionComplete === true,
      failed: p.ConstructionFailed === true,
      resources,
    };
  }

  async replaceNeeds(
    projectId: string,
    needs: readonly NeedRow[],
    observedAt: Date,
  ): Promise<void> {
    /*
     * Delete-then-insert inside ONE transaction. Between the two the project needs nothing at all,
     * and a member refreshing the board in that window would see a finished build — the same
     * reasoning as the EDDN market replace, and the same fix.
     *
     * A depot reading with no resources still runs: that is a site that needs nothing more, and
     * leaving the old rows would show demands the game has stopped making.
     */
    await this.db.$transaction(async (tx) => {
      await tx.colonyNeed.deleteMany({ where: { projectId } });
      if (needs.length === 0) return;

      await tx.colonyNeed.createMany({
        data: needs.map((n) => ({
          projectId,
          commodity: n.commodity,
          remaining: n.remaining,
          required: n.required,
          observedAt,
        })),
        skipDuplicates: true,
      });
    });
  }

  async markComplete(projectId: string, at: Date): Promise<boolean> {
    /*
     * The guarded transition AND the announcement live in `completeColonyProject`, shared with
     * the manual close route — one place decides what "a build finished" means, whichever of the
     * four paths noticed it first.
     */
    return completeColonyProject(this.db, projectId, at, this.nudge);
  }

  async contributionsFor(marketId: bigint): Promise<readonly ContributionReading[]> {
    const rows = await this.db.$queryRawUnsafe<
      Array<{ payload: unknown; occurred_at: Date; user_id: string; event_key: string }>
    >(
      `SELECT payload, occurred_at, user_id, event_key
         FROM telemetry_events
        WHERE event_type = 'ColonisationContribution'
          AND (payload->>'MarketID')::bigint = $1::bigint
        ORDER BY occurred_at`,
      marketId.toString(),
    );

    const out: ContributionReading[] = [];
    for (const row of rows) {
      const p = row.payload as ContributionPayload;
      const raw = Array.isArray(p.Contributions) ? p.Contributions : [];

      const items: Array<{ commodity: string; amount: number }> = [];
      for (const entry of raw) {
        const c = entry as { Name?: unknown; Name_Localised?: unknown; Amount?: unknown };
        const commodity = commodityName({
          name: typeof c.Name === 'string' ? c.Name : null,
          localised: typeof c.Name_Localised === 'string' ? c.Name_Localised : null,
        });
        if (commodity === '') continue;
        items.push({ commodity, amount: num(c.Amount) });
      }

      out.push({
        marketId,
        userId: row.user_id,
        deliveredAt: row.occurred_at,
        eventKey: row.event_key,
        items,
      });
    }

    return out;
  }

  async recordContribution(
    projectId: string,
    c: ContributionReading,
    item: { commodity: string; amount: number },
  ): Promise<boolean> {
    /*
     * ★ ONE LEDGER ROW PER COMMODITY, SO THE KEY HAS TO CARRY THE COMMODITY ★
     *
     * A single ColonisationContribution event can hand over steel AND titanium, and each becomes
     * its own row so the tally can be summed per commodity. The telemetry event key alone is
     * therefore not unique here — using it raw, the first commodity would insert and the rest would
     * be silently swallowed as duplicates, under-counting exactly the deliveries this exists to
     * measure. The same trap INV-017 documents for the telemetry key itself.
     */
    const eventKey = createHash('sha256')
      .update(`${c.eventKey}|${item.commodity}`)
      .digest('hex');

    const written = await this.db.colonyContribution.createMany({
      data: [
        {
          projectId,
          userId: c.userId,
          commodity: item.commodity,
          amount: item.amount,
          deliveredAt: c.deliveredAt,
          eventKey,
        },
      ],
      // The ledger is append-only and the key is unique, so a re-run is a no-op at the database
      // level rather than by agreement between callers.
      skipDuplicates: true,
    });

    return written.count > 0;
  }
}
