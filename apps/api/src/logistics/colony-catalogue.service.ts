import type { PrismaClient } from '@grims/db';
import type { MarketStore } from './market.store.js';

/**
 * The build catalogue, read.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "ensure our baseline colonization setup we have now meets and exceeds the current feature and
 * system of raven colonial."
 *
 * The table exists and until now nothing could see it. This is what answers "what does a Coriolis
 * cost" before anybody has flown anywhere — which is the question worth asking while you are still
 * deciding, and the one a project page could never answer because a project has no needs until
 * somebody docks at it.
 */

export interface BuildTypeRow {
  readonly id: string;
  readonly displayName: string;
  readonly category: string;
  readonly tier: number;
  readonly location: 'orbital' | 'surface';
  readonly padSize: 'none' | 'small' | 'medium' | 'large';
  readonly totalTonnes: number;
  readonly commodities: number;
  /**
   * `community` or `observed`.
   *
   * Shown rather than hidden. Frontier publishes none of these figures, so every one of them is
   * either somebody's gathered number or a measurement from one of our own builds — and a reader
   * deciding whether to commit a fortnight of hauling to a plan deserves to know which.
   */
  readonly source: 'community' | 'observed';
  readonly confirmations: number;
}

export interface BuildCostLine {
  readonly commodity: string;
  readonly tonnes: number;
  /** Best price found near the origin, or null when nobody in range sells it. */
  readonly price: number | null;
  readonly stationName: string | null;
  readonly systemName: string | null;
  readonly distance: number | null;
  readonly cost: number | null;
}

export interface BuildTypeDetail extends BuildTypeRow {
  readonly layouts: readonly string[];
  readonly costs: readonly BuildCostLine[];
  /** Total credits for everything that could be priced. */
  readonly total: number;
  /** How many lines nobody in range sells, so the total can be qualified rather than trusted. */
  readonly unsourced: number;
}

/**
 * How many commodities to price at once.
 *
 * Eight, not twenty-three. The whole build in one go would open a connection per commodity and
 * fight the pool the rest of the API is using — to save time nobody can perceive past the first
 * batch, since three batches of eight is already a few hundred milliseconds.
 */
const PRICE_BATCH = 8;

export class ColonyCatalogueService {
  constructor(
    private readonly db: PrismaClient,
    private readonly market: MarketStore,
  ) {}

  /** Every build type, biggest haul last — the order somebody scanning for "what can I afford" wants. */
  async list(): Promise<readonly BuildTypeRow[]> {
    const rows = await this.db.$queryRawUnsafe<
      Array<{
        id: string;
        display_name: string;
        category: string;
        tier: number;
        location: string;
        pad_size: string;
        total_tonnes: number;
        commodities: bigint;
        source: string;
        confirmations: number;
      }>
    >(
      `SELECT b.id, b.display_name, b.category, b.tier, b.location, b.pad_size,
              b.total_tonnes, b.source, b.confirmations,
              count(c.commodity) AS commodities
         FROM colony_build_types b
         LEFT JOIN colony_build_costs c ON c.build_type_id = b.id
        GROUP BY b.id
        ORDER BY b.tier, b.total_tonnes`,
    );

    return rows.map((r) => this.#row(r));
  }

  /**
   * One build type, priced.
   *
   * ★ ONE QUERY PER COMMODITY, RUN IN PARALLEL ★
   *
   * A build wants around twenty commodities and each needs its own indexed lookup against 18.78M
   * market rows. There is no cheaper shape that still answers "where would I actually buy this".
   *
   * Measured sequentially it was 2.2 seconds warm and 7.4 cold, because ordering by distance means
   * computing a distance for every matching row and sorting them — about 95ms a commodity, not the
   * 8ms a price-ordered lookup costs. The queries do not depend on each other, so waiting for each
   * one before starting the next was pure wall-clock. In batches it is a few hundred milliseconds.
   *
   * Batched rather than all at once: twenty-three simultaneous connections would fight the pool
   * that the rest of the API is using, to save time nobody can perceive past the first batch.
   *
   * `near` absent means no prices at all rather than galaxy-wide ones. A cheapest-anywhere figure
   * would be a number nobody can act on, and worse, would look like a real quote.
   */
  async byId(id: string, near: { x: number; y: number; z: number } | null): Promise<BuildTypeDetail | null> {
    const [head] = await this.db.$queryRawUnsafe<
      Array<{
        id: string;
        display_name: string;
        category: string;
        tier: number;
        location: string;
        pad_size: string;
        total_tonnes: number;
        layouts: string[];
        source: string;
        confirmations: number;
      }>
    >(
      `SELECT id, display_name, category, tier, location, pad_size, total_tonnes,
              layouts, source, confirmations
         FROM colony_build_types WHERE id = $1`,
      id,
    );

    if (head === undefined) return null;

    const costs = await this.db.$queryRawUnsafe<Array<{ commodity: string; tonnes: number }>>(
      `SELECT commodity, tonnes FROM colony_build_costs
        WHERE build_type_id = $1 ORDER BY tonnes DESC`,
      id,
    );

    const priceOne = async (line: { commodity: string; tonnes: number }): Promise<BuildCostLine> => {
      const place =
        near === null
          ? undefined
          : (
              await this.market
                .bestBuys(line.commodity, {
                  limit: 1,
                  // Carriers off: a plan for a trip must not point at something that has jumped
                  // away by the time somebody flies there.
                  excludeCarriers: true,
                  largePadOnly: false,
                  seenSince: null,
                  withinLy: 100,
                  minQuantity: 1,
                  near,
                  // Nearest first, then price. A build is hauled, so the trip is the cost that
                  // matters — the same reasoning the project shopping list now uses.
                  order: 'distance',
                })
                .catch(() => [])
            )[0];

      return {
        commodity: line.commodity,
        tonnes: line.tonnes,
        price: place?.price ?? null,
        stationName: place?.stationName ?? null,
        systemName: place?.systemName ?? null,
        distance: place?.distance ?? null,
        cost: place === undefined ? null : place.price * line.tonnes,
      };
    };

    const lines: BuildCostLine[] = [];
    for (let i = 0; i < costs.length; i += PRICE_BATCH) {
      lines.push(...(await Promise.all(costs.slice(i, i + PRICE_BATCH).map(priceOne))));
    }

    let total = 0;
    let unsourced = 0;
    for (const line of lines) {
      if (line.cost === null) unsourced += 1;
      else total += line.cost;
    }

    return {
      ...this.#row({ ...head, commodities: BigInt(costs.length) }),
      layouts: head.layouts,
      costs: lines,
      total,
      unsourced,
    };
  }

  #row(r: {
    id: string;
    display_name: string;
    category: string;
    tier: number;
    location: string;
    pad_size: string;
    total_tonnes: number;
    commodities: bigint;
    source: string;
    confirmations: number;
  }): BuildTypeRow {
    return {
      id: r.id,
      displayName: r.display_name,
      category: r.category,
      tier: r.tier,
      location: r.location === 'surface' ? 'surface' : 'orbital',
      padSize: (['none', 'small', 'medium', 'large'] as const).includes(
        r.pad_size as 'none' | 'small' | 'medium' | 'large',
      )
        ? (r.pad_size as 'none' | 'small' | 'medium' | 'large')
        : 'none',
      totalTonnes: r.total_tonnes,
      commodities: Number(r.commodities),
      source: r.source === 'observed' ? 'observed' : 'community',
      confirmations: r.confirmations,
    };
  }
}
