import { inflateSync } from 'node:zlib';
import type { PrismaClient } from '@grims/db';
import { enrichStationFromDock } from '@grims/db';

/**
 * Everything on the relay that is not a commodity market.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "Capture and leverage all information that we can use on our system from EDDN! ... we need to be
 * leveraging EDDN in every aspect of our platform! non-negotiable!" — and, offered the full menu,
 * chose every family: station services, exploration & bodies, carrier tracking, traffic & routes.
 *
 * The collector subscribed to the whole relay and consumed 2.6% of it by message count. This module
 * consumes the rest. Measured mix over 240s: journal/1 66.6% (Scan 1246, FSDJump 246, Docked 104,
 * Location 28, SAASignalsFound 27, CarrierJump 6), then outfitting, shipyard, navroute and the
 * small schemas.
 *
 * ★ WRITE SHAPES ARE CHOSEN BY ARRIVAL RATE ★
 *
 * Docked and outfitting arrive at well under one a second — they write directly. FSDJump and
 * navroute arrive at several a second and would be several INSERTs a second for ever — they
 * accumulate in memory and flush as ONE statement on the heartbeat. A message a second is nothing;
 * a write per message per second, sustained for months, is a database doing busywork.
 *
 * ★ EVERY FIELD UNTRUSTED, EVERY FAILURE COUNTED AND DROPPED ★
 *
 * Same contract as the market path: this is a public relay, a malformed frame costs one message,
 * and the feed does not replay so blocking on a retry only puts us behind.
 */

// ─────────────────────────────────────────────────────────────────────── envelope

export interface Envelope {
  readonly schema: string;
  readonly message: Record<string, unknown>;
}

/** One inflate + parse per frame, shared by the market path and everything here. */
export function decodeEnvelope(frame: Buffer): Envelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(inflateSync(frame).toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const env = parsed as Record<string, unknown>;

  const schema = env['$schemaRef'];
  const message = env['message'];
  if (typeof schema !== 'string' || typeof message !== 'object' || message === null) return null;

  return { schema, message: message as Record<string, unknown> };
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

// ─────────────────────────────────────────────────────────────────────── batched tallies

/**
 * The high-rate accumulators, flushed on the collector's existing heartbeat.
 *
 * Keys are strings because two Maps keyed on tuples is how counts silently split. Hour buckets are
 * truncated HERE so a flush is a pure multi-row upsert.
 */
export class ExtrasTally {
  /** `${systemAddress}` → jumps this flush period. */
  readonly jumps = new Map<string, number>();
  /** `${systemAddress}` → route plots through it this flush period. */
  readonly routed = new Map<string, number>();
  /** `${schema}` → messages this flush period. Every schema, including the ones with tables. */
  readonly schemas = new Map<string, number>();

  bump(map: Map<string, number>, key: string, by = 1): void {
    map.set(key, (map.get(key) ?? 0) + by);
  }

  get pending(): number {
    return this.jumps.size + this.routed.size + this.schemas.size;
  }

  /**
   * One statement per table, however many systems accumulated. The hour is stamped at flush time —
   * a tally held for thirty seconds cannot straddle an hour boundary in any way anybody would
   * notice, and per-event hours would mean per-event rows again.
   */
  async flush(db: PrismaClient): Promise<void> {
    const hourExpr = `date_trunc('hour', now())`;

    if (this.jumps.size > 0 || this.routed.size > 0) {
      const keys = new Set([...this.jumps.keys(), ...this.routed.keys()]);
      const values: string[] = [];
      const params: unknown[] = [];
      for (const key of keys) {
        params.push(key, this.jumps.get(key) ?? 0, this.routed.get(key) ?? 0);
        values.push(`($${params.length - 2}::bigint, ${hourExpr}, $${params.length - 1}::int, $${params.length}::int)`);
      }
      await db.$executeRawUnsafe(
        `INSERT INTO system_traffic (system_address, hour, jumps, routed)
         VALUES ${values.join(',')}
         ON CONFLICT (system_address, hour) DO UPDATE SET
           jumps  = system_traffic.jumps  + EXCLUDED.jumps,
           routed = system_traffic.routed + EXCLUDED.routed`,
        ...params,
      );
      this.jumps.clear();
      this.routed.clear();
    }

    if (this.schemas.size > 0) {
      const values: string[] = [];
      const params: unknown[] = [];
      for (const [schema, n] of this.schemas) {
        params.push(schema, n);
        values.push(`($${params.length - 1}, ${hourExpr}, $${params.length}::int)`);
      }
      await db.$executeRawUnsafe(
        `INSERT INTO eddn_schema_stats (schema, hour, messages)
         VALUES ${values.join(',')}
         ON CONFLICT (schema, hour) DO UPDATE SET
           messages = eddn_schema_stats.messages + EXCLUDED.messages`,
        ...params,
      );
      this.schemas.clear();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────── system learning

/**
 * Systems learned live, so a provisional station in one can be PLACED.
 *
 * FSDJump and navroute carry `StarPos` — exact coordinates, no lookup. A system the galaxy dump
 * has never indexed (the exact place new colonisation happens) becomes searchable the first time
 * anybody jumps into it.
 *
 * The known-set is the hot path: several jumps a second, almost all into systems we already hold.
 * An EXISTS probe only runs on a cache miss, an INSERT only when the probe misses too.
 */
const knownSystems = new Set<string>();
const KNOWN_SYSTEMS_MAX = 250_000;

export async function learnSystem(
  db: PrismaClient,
  sys: { address: number; name: string; pos: readonly [number, number, number] | null },
): Promise<void> {
  const key = String(sys.address);
  if (knownSystems.has(key)) return;

  const [row] = await db.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM knowledge_items
      WHERE kind = 'system' AND ext_key = $1 AND source IN ('galaxy', 'eddn', 'companion')`,
    key,
  );

  if ((row?.n ?? 0) === 0 && sys.pos !== null) {
    await db.$executeRawUnsafe(
      `INSERT INTO knowledge_items (source, kind, ext_key, name, data, coords, text)
       VALUES ('eddn', 'system', $1, $2, jsonb_build_object('live', true),
               cube(ARRAY[$3::float8, $4::float8, $5::float8]), $6)
       ON CONFLICT (source, kind, ext_key) DO NOTHING`,
      key,
      sys.name,
      sys.pos[0],
      sys.pos[1],
      sys.pos[2],
      `${sys.name} is a star system first charted live from the journal feed.`,
    );
  }

  if (knownSystems.size >= KNOWN_SYSTEMS_MAX) knownSystems.clear();
  knownSystems.add(key);
}

// ─────────────────────────────────────────────────────────────────────── per-schema appliers

export interface ExtrasResult {
  /** Which family handled it, for the window log. Null when the schema has no handler. */
  readonly handled: string | null;
}

const starPos = (v: unknown): readonly [number, number, number] | null => {
  if (!Array.isArray(v) || v.length < 3) return null;
  const [x, y, z] = v;
  return typeof x === 'number' && typeof y === 'number' && typeof z === 'number'
    ? [x, y, z]
    : null;
};

/** `$SAA_SignalType_Biological;` → biological. The localised field is locale-dependent; never use it. */
function signalCounts(raw: unknown): { bio: number; geo: number } {
  let bio = 0;
  let geo = 0;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as Record<string, unknown>;
      const type = str(e['Type']) ?? '';
      const count = num(e['Count']) ?? 0;
      if (/biological/i.test(type)) bio += count;
      else if (/geological/i.test(type)) geo += count;
    }
  }
  return { bio, geo };
}

export async function applyExtras(
  db: PrismaClient,
  env: Envelope,
  tally: ExtrasTally,
): Promise<ExtrasResult> {
  const m = env.message;
  const schemaKey = env.schema.replace('https://eddn.edcd.io/schemas/', '');
  tally.bump(tally.schemas, schemaKey);

  // ---- journal/1: the grab-bag — dispatch again by event -------------------------------------
  if (schemaKey.startsWith('journal/')) {
    const event = str(m['event']);

    if (event === 'Docked' || (event === 'Location' && m['Docked'] === true)) {
      const marketId = num(m['MarketID']);
      const stationName = str(m['StationName']);
      const systemName = str(m['StarSystem']);
      if (marketId === null || stationName === null || systemName === null) {
        return { handled: null };
      }

      /*
       * The enrichment the whole provisional-station design waits for: type, pads, system id64
       * and star distance, from somebody actually on the pad.
       */
      const padsRaw = m['LandingPads'];
      const large =
        typeof padsRaw === 'object' && padsRaw !== null
          ? num((padsRaw as Record<string, unknown>)['Large'])
          : null;

      await enrichStationFromDock(db, {
        marketId,
        stationName,
        systemName,
        systemAddress: num(m['SystemAddress']),
        stationType: str(m['StationType']),
        largePads: large,
        distFromStarLs: num(m['DistFromStarLS']),
      });

      // A dock at a carrier is also a position fix for a station that moves.
      if (str(m['StationType']) === 'FleetCarrier') {
        await upsertCarrierPosition(db, {
          marketId,
          callsign: stationName,
          systemName,
          systemAddress: num(m['SystemAddress']),
          event: 'Docked',
        });
      }
      return { handled: 'dock' };
    }

    if (event === 'FSDJump') {
      const address = num(m['SystemAddress']);
      const name = str(m['StarSystem']);
      if (address === null || name === null) return { handled: null };

      tally.bump(tally.jumps, String(address));
      await learnSystem(db, { address, name, pos: starPos(m['StarPos']) });
      return { handled: 'traffic' };
    }

    if (event === 'CarrierJump') {
      const marketId = num(m['MarketID']);
      const callsign = str(m['StationName']);
      const systemName = str(m['StarSystem']);
      if (marketId === null || callsign === null || systemName === null) {
        return { handled: null };
      }
      await upsertCarrierPosition(db, {
        marketId,
        callsign,
        systemName,
        systemAddress: num(m['SystemAddress']),
        event: 'CarrierJump',
      });
      return { handled: 'carrier' };
    }

    if (event === 'SAASignalsFound') {
      const address = num(m['SystemAddress']);
      const bodyId = num(m['BodyID']);
      if (address === null || bodyId === null) return { handled: null };
      const { bio, geo } = signalCounts(m['Signals']);
      if (bio === 0 && geo === 0) return { handled: null };
      await upsertBodySignals(db, address, bodyId, str(m['BodyName']), bio, geo);
      return { handled: 'signals' };
    }

    // Scan, fssdiscoveryscan-adjacent events: counted in the schema stats, stored nowhere yet.
    // Galaxy-wide body storage is its own design with its own growth problem — signals cover the
    // economy model's blind spots, which is the value the owner named.
    return { handled: null };
  }

  // ---- station services ----------------------------------------------------------------------
  if (schemaKey.startsWith('outfitting/')) {
    const marketId = num(m['marketId']);
    const modules = Array.isArray(m['modules'])
      ? m['modules'].filter((x): x is string => typeof x === 'string')
      : [];
    if (marketId === null || modules.length === 0) return { handled: null };

    await db.$executeRawUnsafe(
      `INSERT INTO station_outfitting (market_id, modules, seen_at)
       VALUES ($1, $2::text[], now())
       ON CONFLICT (market_id) DO UPDATE SET modules = EXCLUDED.modules, seen_at = now()`,
      marketId,
      modules,
    );
    return { handled: 'outfitting' };
  }

  if (schemaKey.startsWith('shipyard/')) {
    const marketId = num(m['marketId']);
    const ships = Array.isArray(m['ships'])
      ? m['ships'].filter((x): x is string => typeof x === 'string')
      : [];
    if (marketId === null || ships.length === 0) return { handled: null };

    await db.$executeRawUnsafe(
      `INSERT INTO station_shipyard (market_id, ships, seen_at)
       VALUES ($1, $2::text[], now())
       ON CONFLICT (market_id) DO UPDATE SET ships = EXCLUDED.ships, seen_at = now()`,
      marketId,
      ships,
    );
    return { handled: 'shipyard' };
  }

  // ---- exploration ---------------------------------------------------------------------------
  if (schemaKey.startsWith('fssbodysignals/')) {
    const address = num(m['SystemAddress']);
    const bodyId = num(m['BodyID']);
    if (address === null || bodyId === null) return { handled: null };
    const { bio, geo } = signalCounts(m['Signals']);
    if (bio === 0 && geo === 0) return { handled: null };
    await upsertBodySignals(db, address, bodyId, str(m['BodyName']), bio, geo);
    return { handled: 'signals' };
  }

  if (schemaKey.startsWith('approachsettlement/')) {
    const address = num(m['SystemAddress']);
    const name = str(m['Name']);
    if (address === null || name === null) return { handled: null };

    await db.$executeRawUnsafe(
      `INSERT INTO settlements (system_address, name, body_name, market_id, latitude, longitude, seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (system_address, name) DO UPDATE SET
         body_name = COALESCE(EXCLUDED.body_name, settlements.body_name),
         market_id = COALESCE(EXCLUDED.market_id, settlements.market_id),
         latitude  = COALESCE(EXCLUDED.latitude,  settlements.latitude),
         longitude = COALESCE(EXCLUDED.longitude, settlements.longitude),
         seen_at = now()`,
      address,
      name,
      str(m['BodyName']),
      num(m['MarketID']),
      num(m['Latitude']),
      num(m['Longitude']),
    );
    return { handled: 'settlement' };
  }

  // ---- carriers ------------------------------------------------------------------------------
  if (schemaKey.startsWith('fcmaterials')) {
    const marketId = num(m['MarketID']);
    const items = Array.isArray(m['Items']) ? m['Items'] : [];
    if (marketId === null || items.length === 0) return { handled: null };

    const rows: Array<{ item: string; price: number; stock: number; demand: number }> = [];
    for (const entry of items) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as Record<string, unknown>;
      const item = str(e['Name']);
      if (item === null) continue;
      rows.push({
        item,
        price: num(e['Price']) ?? 0,
        stock: num(e['Stock']) ?? 0,
        demand: num(e['Demand']) ?? 0,
      });
    }
    if (rows.length === 0) return { handled: null };

    // Replace, don't merge — the message lists everything the bartender trades right now.
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM fc_bartender WHERE market_id = $1`, marketId);
      const values: string[] = [];
      const params: unknown[] = [marketId];
      for (const r of rows) {
        params.push(r.item, r.price, r.stock, r.demand);
        values.push(
          `($1, $${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length}, now())`,
        );
      }
      await tx.$executeRawUnsafe(
        `INSERT INTO fc_bartender (market_id, item, price, stock, demand, seen_at)
         VALUES ${values.join(',')}`,
        ...params,
      );
    });
    return { handled: 'carrier' };
  }

  // ---- routes --------------------------------------------------------------------------------
  if (schemaKey.startsWith('navroute/')) {
    const route = Array.isArray(m['Route']) ? m['Route'] : [];
    let counted = 0;
    for (const hop of route) {
      if (typeof hop !== 'object' || hop === null) continue;
      const h = hop as Record<string, unknown>;
      const address = num(h['SystemAddress']);
      const name = str(h['StarSystem']);
      if (address === null || name === null) continue;
      tally.bump(tally.routed, String(address));
      await learnSystem(db, { address, name, pos: starPos(h['StarPos']) });
      counted += 1;
    }
    return { handled: counted > 0 ? 'traffic' : null };
  }

  // Counted in eddn_schema_stats above; no table yet, by design rather than omission.
  return { handled: null };
}

async function upsertCarrierPosition(
  db: PrismaClient,
  pos: {
    marketId: number;
    callsign: string;
    systemName: string;
    systemAddress: number | null;
    event: string;
  },
): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO carrier_positions (market_id, callsign, system_name, system_address, event, seen_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (market_id) DO UPDATE SET
       callsign = EXCLUDED.callsign,
       system_name = EXCLUDED.system_name,
       system_address = EXCLUDED.system_address,
       event = EXCLUDED.event,
       seen_at = now()`,
    pos.marketId,
    pos.callsign,
    pos.systemName,
    pos.systemAddress,
    pos.event,
  );
}

async function upsertBodySignals(
  db: PrismaClient,
  systemAddress: number,
  bodyId: number,
  bodyName: string | null,
  bio: number,
  geo: number,
): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO body_signals (system_address, body_id, body_name, biological, geological, seen_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (system_address, body_id) DO UPDATE SET
       body_name  = COALESCE(EXCLUDED.body_name, body_signals.body_name),
       -- The larger count wins: a partial SAA scan must not shrink a full FSS reading.
       biological = GREATEST(EXCLUDED.biological, body_signals.biological),
       geological = GREATEST(EXCLUDED.geological, body_signals.geological),
       seen_at = now()`,
    systemAddress,
    bodyId,
    bodyName,
    bio,
    geo,
  );
}
