import { inflateSync } from 'node:zlib';

/**
 * Reading one EDDN message.
 *
 * ★ DEFLATE, NOT GZIP — AND THAT IS A REAL TRAP ★
 *
 * EDDN publishes zlib-DEFLATE frames. `gunzipSync` on one of those throws `Z_DATA_ERROR: incorrect
 * header check`, which reads like a corrupt feed rather than the wrong function. The first probe of
 * the live relay on 2026-08-01 failed exactly this way, on the very first message. `inflateSync` is
 * the right call and there is no way to tell from the bytes which was meant.
 *
 * ★ EVERY FIELD IS TREATED AS UNTRUSTED ★
 *
 * This is a public relay: anybody may run an uploader, and the schema is a convention rather than
 * something enforced end to end. A malformed frame must cost one skipped message, never the process
 * — a subscriber that dies on bad input stops receiving the good input too.
 */

/** The schema we act on. Markets, current version. */
export const COMMODITY_SCHEMA = 'https://eddn.edcd.io/schemas/commodity/3';

/** One commodity line as EDDN sends it, after validation. */
export interface EddnCommodity {
  /** Frontier's internal symbol, lower case: `advancedcatalysers`. Resolved by `CommodityNames`. */
  readonly symbol: string;
  /** What the station charges to sell to us. */
  readonly buyPrice: number;
  /** What the station pays us. */
  readonly sellPrice: number;
  readonly stock: number;
  readonly demand: number;
}

/** A validated market snapshot for one station. */
export interface EddnMarket {
  readonly marketId: number;
  readonly stationName: string;
  readonly systemName: string;
  /** When the uploader observed it, not when we received it. */
  readonly observedAt: Date | null;
  readonly commodities: readonly EddnCommodity[];
}

/**
 * Decompresses and parses a frame, returning null for anything that is not a usable market.
 *
 * Null rather than throwing: at one message a second, roughly ninety-five per cent of the feed is
 * schemas we do not consume, and an exception is not a reasonable way to express "not this one".
 */
export function decodeMarket(frame: Buffer): EddnMarket | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(inflateSync(frame).toString('utf8'));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const env = parsed as Record<string, unknown>;
  if (env['$schemaRef'] !== COMMODITY_SCHEMA) return null;

  const msg = env['message'];
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as Record<string, unknown>;

  const marketId = asNumber(m['marketId']);
  const stationName = asString(m['stationName']);
  const systemName = asString(m['systemName']);
  if (marketId === null || stationName === null || systemName === null) return null;

  const raw = m['commodities'];
  if (!Array.isArray(raw)) return null;

  const commodities: EddnCommodity[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const c = entry as Record<string, unknown>;
    const symbol = asString(c['name']);
    if (symbol === null) continue;

    /*
     * Zeroes are KEPT, not filtered.
     *
     * A depot or construction site reports stock 0 and demand 0 with real prices — that is what it
     * looks like to have a market that is not currently trading, and dropping those rows would make
     * the station appear to trade nothing rather than to trade nothing RIGHT NOW. The route queries
     * already index on `supply > 0` / `demand > 0`, so a zero row costs nothing and carries the
     * price a member still wants to see.
     */
    commodities.push({
      symbol,
      buyPrice: asNumber(c['buyPrice']) ?? 0,
      sellPrice: asNumber(c['sellPrice']) ?? 0,
      stock: asNumber(c['stock']) ?? 0,
      demand: asNumber(c['demand']) ?? 0,
    });
  }

  if (commodities.length === 0) return null;

  return {
    marketId,
    stationName,
    systemName,
    observedAt: asDate(m['timestamp']),
    commodities,
  };
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/**
 * The uploader's clock, sanity-checked.
 *
 * A timestamp is written by somebody else's machine and can be wrong by years. It lands in
 * `market_seen_at`, which is how a member judges whether to trust a price — so a frame claiming
 * 2031 would make a stale price look like the freshest thing in the table. Anything outside a
 * plausible window is treated as absent, and the caller stamps `now()` instead.
 */
function asDate(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  const age = Date.now() - t;
  // Older than a week, or more than an hour in the future: not a clock we can use.
  if (age > 7 * 24 * 3_600_000 || age < -3_600_000) return null;
  return new Date(t);
}
