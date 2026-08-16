import type { PrismaClient } from '@grims/db';
import { completedBuilds, type StationSighting, type WatchedBuild } from '@grims/shared';

/**
 * The safeguard that closes a build nobody told us about, reading what cAPI brought back.
 *
 * ★ SQUADRON OWNER ★
 *
 * "if a build is completed then close the project as completed", pulling "from CAPI!", on a cadence
 * that is "auto scaling fast if active slow if now" — measured, not a fixed twenty minutes. The
 * scheduling lives in the daemon; `newestSightingAt` below is the signal it measures.
 *
 * ★ WHERE THE SIGHTINGS COME FROM ★
 *
 * `telemetry_events`, which the journal poller fills straight from Frontier. A `Docked` event names
 * the station type at a market id; that is Frontier stating what is standing there now.
 *
 * Deliberately NOT restricted to the poller's own rows. A member running the companion produces the
 * same `Docked` event through the desktop door, and both are equally true about the site — filtering
 * to one route would ignore the evidence we already hold.
 */

export class PrismaBuildWatchStore {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Live builds, with what their depot still wants.
   *
   * A project whose needs have never been read reports null, and `COALESCE` makes that a positive
   * number rather than zero. That is the safe direction: an unread depot must not look satisfied,
   * or the first sweep would close every project nobody has docked at yet.
   */
  async watched(): Promise<readonly WatchedBuild[]> {
    const rows = await this.db.$queryRawUnsafe<
      Array<{ id: string; market_id: string; system_name: string; completed_at: Date | null; remaining: number }>
    >(
      `SELECT p.id, p.market_id::text AS market_id, p.system_name, p.completed_at,
              COALESCE((SELECT SUM(n.remaining) FROM colony_needs n WHERE n.project_id = p.id), 1)::int AS remaining
         FROM colony_projects p
        WHERE p.completed_at IS NULL
          AND p.abandoned_at IS NULL
          AND p.market_id IS NOT NULL`,
    );

    return rows.map((r) => ({
      projectId: r.id,
      marketId: r.market_id,
      systemName: r.system_name,
      completedAt: r.completed_at,
      remaining: Number(r.remaining),
    }));
  }

  /**
   * The newest station type seen at each of these market ids.
   *
   * `DISTINCT ON` takes one row per market — the latest — so a site docked at fifty times does not
   * hand fifty identical sightings to a decision that only needs the most recent one.
   */
  async sightings(marketIds: readonly string[]): Promise<readonly StationSighting[]> {
    if (marketIds.length === 0) return [];

    const rows = await this.db.$queryRawUnsafe<
      Array<{ market_id: string; station_type: string | null; occurred_at: Date }>
    >(
      `SELECT DISTINCT ON (t.payload->>'MarketID')
              t.payload->>'MarketID' AS market_id,
              t.payload->>'StationType' AS station_type,
              t.occurred_at
         FROM telemetry_events t
        WHERE t.event_type = 'Docked'
          AND t.payload->>'MarketID' = ANY($1::text[])
        ORDER BY t.payload->>'MarketID', t.occurred_at DESC`,
      marketIds,
    );

    return rows.map((r) => ({
      marketId: r.market_id,
      stationType: r.station_type,
      observedAt: r.occurred_at,
    }));
  }

  /**
   * Closes it, and returns whether THIS call did.
   *
   * The `WHERE completed_at IS NULL` is what makes that answer true under a race: the manual close
   * route, the depot sync and this sweep can all reach the same project, and only one of them should
   * announce a completion the squadron reads.
   */
  async close(projectId: string, at: Date, because: string): Promise<boolean> {
    const n = await this.db.$executeRawUnsafe(
      `UPDATE colony_projects SET completed_at = $2 WHERE id = $1::uuid AND completed_at IS NULL`,
      projectId,
      at,
    );

    if (n === 0) return false;

    await this.db
      .$executeRawUnsafe(
        `INSERT INTO audit_logs (actor_type, action, target_type, target_id, before, after)
         VALUES ('system', 'colony.project.auto-close', 'colony_project', $1, '{}'::jsonb, $2::jsonb)`,
        projectId,
        JSON.stringify({ at: at.toISOString(), saw: because, source: 'capi-journal' }),
      )
      .catch(() => undefined);

    return true;
  }
}

export interface WatchReport {
  readonly checked: number;
  readonly closed: number;
  /**
   * The newest sighting this pass saw, or null.
   *
   * The cadence signal. The scheduler compares it with the previous pass's: an advance means
   * somebody is flying to these sites right now, and this is worth checking often. No advance means
   * nothing has happened at any watched build since we last looked.
   */
  readonly newestSightingAt: Date | null;
}

/**
 * One pass: which live builds are demonstrably finished, and close them.
 *
 * The decision is `completedBuilds` in @grims/shared, tested without a database. This is the
 * plumbing, and it stays dull on purpose.
 */
export async function runBuildCompletionWatch(
  store: PrismaBuildWatchStore,
  now: Date,
): Promise<WatchReport> {
  const builds = await store.watched();
  if (builds.length === 0) return { checked: 0, closed: 0, newestSightingAt: null };

  const seen = await store.sightings(builds.map((b) => b.marketId));
  const done = completedBuilds(builds, seen, now);

  let closed = 0;
  for (const d of done) {
    if (await store.close(d.projectId, d.at, d.becauseSaw)) closed += 1;
  }

  const newestSightingAt = seen.reduce<Date | null>(
    (acc, x) => (acc === null || x.observedAt > acc ? x.observedAt : acc),
    null,
  );

  return { checked: builds.length, closed, newestSightingAt };
}
