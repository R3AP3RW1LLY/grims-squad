import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { MARKET_STORE } from '../logistics/logistics.tokens.js';
import type { MarketStore } from '../logistics/market.store.js';
import { valueHold, type HoldValue, type SellQuote } from './mining-valuation.js';

/**
 * The mining module's reads: what a hold is worth, and which rings are actually paying.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "our own version of EDminer ... this must meet / exceed ED tools as it works currently!"
 *
 * ★ THE TWO THINGS A SINGLE-PLAYER TOOL CANNOT DO ★
 *
 * Valuation needs a market database; ring intelligence needs more than one commander. This squadron
 * has both — eighteen million market rows, and every rock every member prospects. Neither answer is
 * available to EDMiner at any price, and they are the reason this module is worth building rather
 * than installing something.
 */
@Injectable()
export class MiningService {
  constructor(
    private readonly db: PrismaClient,
    @Inject(MARKET_STORE) private readonly market: MarketStore,
  ) {}

  /**
   * What the hold is worth, and where to take it.
   *
   * ★ ONE QUERY PER MINERAL, NOT PER TONNE ★
   *
   * A hold holds a handful of distinct minerals however many tonnes are in it, so this is a
   * bounded fan-out — and it runs concurrently rather than in sequence for the same reason the
   * colony shopping list does: the member is looking at an overlay waiting for it.
   */
  async valueCargo(
    hold: Readonly<Record<string, number>>,
    origin: string | null,
    withinLy: number,
  ): Promise<HoldValue> {
    const materials = Object.entries(hold)
      .filter(([, t]) => Number.isFinite(t) && t > 0)
      .map(([name]) => name);

    if (materials.length === 0) return { value: 0, bestSale: null, unpriced: [] };

    const near = origin === null ? null : await this.market.systemCoords(origin);

    const quotes: SellQuote[] = [];
    await Promise.all(
      materials.map(async (material) => {
        const places = await this.market.bestSells(material, {
          // Enough to find a station that takes several minerals; more would not change the answer
          // and every extra row is work on the largest table on the platform.
          limit: 25,
          order: near === null ? 'price' : 'distance',
          excludeCarriers: true,
          largePadOnly: false,
          /*
           * A price nobody has reported in a fortnight is not a price. Sending a member across the
           * bubble on a stale quote is the specific failure the colony pages were rebuilt to avoid.
           */
          seenSince: new Date(Date.now() - 14 * 24 * 3_600_000),
          near,
          withinLy,
          // A station wanting a handful of tonnes is not a destination for a full hold.
          minQuantity: 1,
        });

        for (const p of places) {
          quotes.push({
            material,
            perTonne: p.price,
            station: p.stationName,
            system: p.systemName,
            distanceLy: p.distance,
            // On a SELL row `quantity` is tonnes WANTED — which is exactly the demand cap the
            // valuation needs to avoid naming a station that cannot take the load.
            demand: p.quantity,
          });
        }
      }),
    );

    return valueHold(hold, quotes);
  }

  /**
   * Which rings the squadron has actually been paying in, lately.
   *
   * ★ THE ANSWER FULL ROCK COLLECTION WAS ASKED FOR ★
   *
   * Every member's prospector limpet is a sample. One commander's memory of "that ring was good
   * last week" is an anecdote; a hundred members' rocks are a measurement — and it is the reason
   * `prospected_rocks` was worth the volume it costs.
   *
   * Ranked by the SHARE of rocks worth shooting rather than by the best rock ever seen, because the
   * question is "will my evening there be worth it", not "what is the record".
   */
  async rings(
    material: string | null,
    days: number,
    limit: number,
  ): Promise<
    ReadonlyArray<{
      system: string;
      body: string;
      rocks: number;
      hitRate: number;
      bestPercent: number;
      topMaterial: string;
      lastSeen: Date;
    }>
  > {
    const rows = await this.db.$queryRawUnsafe<
      Array<{
        system_name: string;
        body_name: string;
        rocks: number;
        hit_rate: number;
        best_percent: number;
        top_material: string;
        last_seen: Date;
      }>
    >(
      `SELECT system_name, body_name,
              count(*)::int AS rocks,
              (avg(CASE WHEN top_percent >= 15 THEN 1.0 ELSE 0.0 END) * 100)::float AS hit_rate,
              max(top_percent)::float AS best_percent,
              -- The mineral this ring is known for: whichever tops the most rocks in it.
              mode() WITHIN GROUP (ORDER BY top_material) AS top_material,
              max(at) AS last_seen
         FROM prospected_rocks
        WHERE at > now() - ($2 || ' days')::interval
          AND system_name IS NOT NULL AND body_name IS NOT NULL
          AND ($1::text IS NULL
               OR lower(regexp_replace(top_material, '[^a-zA-Z0-9]', '', 'g'))
                  = lower(regexp_replace($1::text, '[^a-zA-Z0-9]', '', 'g')))
        GROUP BY system_name, body_name
        -- Under ten rocks is one commander having a look, not a measurement.
        HAVING count(*) >= 10
        ORDER BY hit_rate DESC, rocks DESC
        LIMIT $3`,
      material,
      String(Math.max(1, Math.floor(days))),
      Math.max(1, Math.min(100, Math.floor(limit))),
    );

    return rows.map((r) => ({
      system: r.system_name,
      body: r.body_name,
      rocks: r.rocks,
      hitRate: r.hit_rate,
      bestPercent: r.best_percent,
      topMaterial: r.top_material,
      lastSeen: r.last_seen,
    }));
  }

  /** A member's own mining evenings, newest first. */
  async sessions(
    userId: string,
    limit: number,
  ): Promise<
    ReadonlyArray<{
      id: string;
      startedAt: Date;
      endedAt: Date | null;
      system: string | null;
      ring: string | null;
      rocks: number;
      hits: number;
      tonnes: number;
      points: number;
    }>
  > {
    const rows = await this.db.$queryRawUnsafe<
      Array<{
        id: string;
        started_at: Date;
        ended_at: Date | null;
        system_name: string | null;
        ring_name: string | null;
        rocks_prospected: number;
        rocks_hit: number;
        tonnes_refined: number;
        points: number;
      }>
    >(
      `SELECT id, started_at, ended_at, system_name, ring_name,
              rocks_prospected, rocks_hit, tonnes_refined, points
         FROM mining_sessions
        WHERE user_id = $1::uuid
        ORDER BY started_at DESC
        LIMIT $2`,
      userId,
      Math.max(1, Math.min(100, Math.floor(limit))),
    );

    return rows.map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      system: r.system_name,
      ring: r.ring_name,
      rocks: r.rocks_prospected,
      hits: r.rocks_hit,
      tonnes: r.tonnes_refined,
      points: r.points,
    }));
  }
}
