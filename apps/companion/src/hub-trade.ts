import type { HubCall } from './hub-colony.js';

/**
 * The Freight Office, read from the hub.
 *
 * ★ SQUADRON OWNER, 2026-08-03: "add this to the companion app too please so we have full feature
 * parridy." ★
 *
 * Same shapes the website's planner reads, off the companion's device door. The app adds nothing
 * and computes nothing — the hub is the record, exactly as colonisation established.
 */

export interface TradeLeg {
  readonly stationName: string;
  readonly systemName: string;
  readonly stationType: string | null;
  readonly largePads: number;
  readonly price: number;
  readonly quantity: number;
  readonly seenAt: string | null;
  readonly distance: number | null;
  readonly arrivalLs: number | null;
}

export interface TradeRoute {
  readonly commodity: string;
  readonly buy: TradeLeg;
  readonly sell: TradeLeg;
  readonly profitPerTonne: number;
  readonly tonnes: number;
  readonly totalProfit: number;
  readonly outlay: number;
  readonly distanceLy: number;
  readonly limitedBy: 'hold' | 'supply' | 'demand' | 'budget';
  readonly tripMinutes: number;
  readonly profitPerHour: number;
}

export interface TradePlan {
  readonly routes: TradeRoute[];
  readonly considered: string[];
  readonly origin: {
    readonly system: string;
    readonly station: string | null;
    readonly from: 'typed' | 'journal';
    readonly age?: string;
    readonly stale?: boolean;
  } | null;
  readonly unknownSystem: string | null;
  readonly timeModel: {
    readonly jumpLy: number;
    readonly minutesPerJump: number;
    readonly minutesPerStop: number;
  };
}

export interface TradeQuery {
  readonly near?: string;
  readonly cargo?: string;
  readonly buyWithinLy?: string;
  readonly sellWithinLy?: string;
  readonly budget?: string;
  readonly commodity?: string;
  readonly sort?: string;
}

/** One commodity as the index lists it — the website's row shape, near columns included. */
export interface CommodityRow {
  readonly commodity: string;
  readonly category: string | null;
  readonly avgBuy: number | null;
  readonly avgSell: number | null;
  readonly minBuy: number | null;
  readonly maxSell: number | null;
  readonly supply: string;
  readonly demand: string;
  readonly buyMarkets: number;
  readonly sellMarkets: number;
  readonly sellTrend: number | null;
  readonly nearBuy?: number | null;
  readonly nearSell?: number | null;
  readonly nearMarkets?: number;
}

export interface CommoditiesIndex {
  readonly commodities: CommodityRow[];
  readonly origin: TradePlan['origin'];
  readonly unknownSystem: string | null;
  readonly nearWithinLy: number | null;
}

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

/** Same failure-becomes-a-sentence contract as the other hub readers. */
export async function tradeRoutes(call: HubCall, query: TradeQuery): Promise<Answer<TradePlan>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (typeof v === 'string' && v.trim() !== '') qs.set(k, v.trim());
  }
  return tradeGet<TradePlan>(call, `/routes?${qs.toString()}`);
}

/** The commodities index, near columns measured from the device's member unless `near` names elsewhere. */
export function tradeCommodities(call: HubCall, near?: string): Promise<Answer<CommoditiesIndex>> {
  const trimmed = near?.trim() ?? '';
  return tradeGet<CommoditiesIndex>(
    call,
    `/commodities${trimmed === '' ? '' : `?near=${encodeURIComponent(trimmed)}`}`,
  );
}

async function tradeGet<T>(call: HubCall, path: string): Promise<Answer<T>> {
  if (call.deviceToken === '') return { ok: false, error: 'Pair this device first.' };

  const doFetch = call.fetchImpl ?? fetch;
  const ac = new AbortController();
  // Route planning fans out across many market queries; it earns a longer leash than a list read.
  const timer = setTimeout(() => ac.abort(), call.timeoutMs ?? 30_000);

  try {
    const res = await doFetch(
      `${call.apiBaseUrl.replace(/\/+$/, '')}/v1/companion/trade${path}`,
      {
        headers: { authorization: `Bearer ${call.deviceToken}` },
        signal: ac.signal,
      },
    );

    if (res.status === 401) return { ok: false, error: 'This device is no longer paired.' };
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, error: body?.error?.message ?? `The hub answered ${res.status}.` };
    }

    const data = (await res.json().catch(() => null)) as T | null;
    if (data === null) return { ok: false, error: 'The hub sent something we could not read.' };
    return { ok: true, data };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? 'The hub did not answer in time.'
        : 'Could not reach the hub. Check your connection.',
    };
  } finally {
    clearTimeout(timer);
  }
}
