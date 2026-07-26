# Ardent Insight

## Role in this system
Full-galaxy trade and system-commodity answers from day one, before our own EDDN collector has meaningful coverage — and the source of the database dumps we seed from.

## Trust tier
**authoritative (acceleration layer)** — the data is EDDN-derived, so the same freshness caveats apply as to our own mirror.

## Access requirements
**None.** Fully anonymous — no key, no signup, no approval lead time. It is the only major source with zero onboarding cost, which matters when we are already waiting on Frontier and Inara.

## Base URL
```
https://api.ardent-insight.com
```
Dumps: `https://ardent-insight.com/downloads`
Source: `github.com/iaincollins/ardent-api`, `ardent-collector`, `ardent-auth`

## Endpoints we use
| Method | Path | Purpose | Params | Cache TTL |
|---|---|---|---|---|
| GET | `/v2/commodities` | Full commodity catalogue with galactic price statistics | — | 6 h |
| GET | `/v2/commodity/name/{commodity}` | Min/max/avg buy and sell, total stock and demand | — | 6 h |
| GET | `/v2/commodity/name/{commodity}/imports` | **Where to SELL** — importers by price paid | `minVolume`, `minPrice`, `fleetCarriers`, `maxDaysAgo` | 1 h |
| GET | `/v2/commodity/name/{commodity}/exports` | **Where to BUY** — exporters by price | `minVolume`, `maxPrice`, `fleetCarriers`, `maxDaysAgo` | 1 h |
| GET | `/v2/system/address/{id}` | System detail — **preferred form** | — | 24 h |
| GET | `/v2/system/name/{system}` | System detail by name — **ambiguous, avoid** | — | 24 h |
| GET | `/v2/system/name/{system}/nearby` | Systems within a radius | `maxDistance` | 24 h |
| GET | `/v2/system/name/{system}/nearest/{service}` | Nearest station with a service | `minLandingPadSize` | 6 h |
| GET | `/v2/system/name/{system}/commodities` | Every commodity traded in a system | — | 1 h |
| GET | `/v2/system/name/{system}/commodity/name/{commodity}/nearby/imports` | Radius-scoped importers | `maxDistance`, `minVolume` | 1 h |
| GET | `/v2/system/name/{system}/commodity/name/{commodity}/nearby/exports` | Radius-scoped exporters | `maxDistance` | 1 h |
| GET | `/v2/market/{marketId}/commodity/name/{commodity}` | One commodity at one market | — | 15 min |
| GET | `/v2/stats` | Coverage statistics — useful on the admin health dashboard | — | 1 h |

## Response shapes
`GET /v2/commodity/name/tritium/imports?minVolume=1000&maxDaysAgo=7`
```json
[
  {
    "commodityId": "tritium",
    "commodityName": "Tritium",
    "marketId": 3705689344,
    "stationName": "Jameson Memorial",
    "systemName": "Shinrarta Dezhra",
    "systemAddress": 3107509474002,
    "systemX": 55.71875, "systemY": 17.59375, "systemZ": 27.15625,
    "fleetCarrier": 0,
    "buyPrice": 0,
    "demand": 12450,
    "demandBracket": 3,
    "meanPrice": 41000,
    "sellPrice": 51200,
    "stock": 0,
    "stockBracket": 0,
    "updatedAt": "2026-07-25T15:02:11Z"
  }
]
```

`GET /v2/system/address/3107509474002`
```json
{
  "systemAddress": 3107509474002,
  "systemName": "Shinrarta Dezhra",
  "systemX": 55.71875, "systemY": 17.59375, "systemZ": 27.15625,
  "systemSecurity": "High",
  "systemGovernment": "Patronage",
  "systemAllegiance": "Independent",
  "systemEconomy": "Industrial",
  "systemPopulation": 85206935,
  "updatedAt": "2026-07-20T09:11:00Z"
}
```

`updatedAt` is on **every** row. It is the input to `dataAgeHours` and therefore to INV-004 — a response without it is a defect, not a missing nicety.

## Rate limits & etiquette
- **No rate limits currently enforced**, with respectful use requested.
- We treat "no limit today" as "a limit tomorrow": cache per the table above, dedupe identical in-flight requests, and back off on any 429 or 5xx.
- A single maintainer runs this. Hammering it is both rude and a self-inflicted availability risk.

## Failure modes
| Failure | Detection | Our response |
|---|---|---|
| Service down | timeout / 5xx | Circuit opens. **Fall back to our own EDDN data with its age shown.** This is exactly why ADR-007 exists. |
| Rate limited (future) | 429 | Backoff, circuit opens, serve cache. |
| Ambiguous system name | multiple/unexpected results from a name lookup | Return **candidates**; never pick one (INV-018). |
| Commodity unknown | 404 | `404 UNKNOWN_COMMODITY`. Check the FDevIDs mapping — usually a naming mismatch, not a missing commodity. |
| All rows stale | every `updatedAt` older than `maxDataAgeDays` | `422 DATA_TOO_STALE` with `oldestAvailableHours`. **Return this rather than silently serving stale data.** |
| Response shape changed | Zod parse failure | Typed error, alert, serve cache. |
| Empty result | `[]` | **Not an error.** Return empty with `bindingConstraint` naming which filter eliminated everything. |

## Adapter interface
```ts
// packages/ed-clients/src/ardent/ardent.adapter.ts
export interface ITradeDataProvider {
  readonly source: 'ardent';
  readonly trustTier: 'authoritative';

  getCommodity(internalName: string): Promise<Enriched<CommodityStats>>;
  listCommodities(): Promise<Enriched<CommoditySummary[]>>;

  /** Where to SELL. maxDaysAgo is REQUIRED here — the upstream default of 30 is far too loose. */
  findImporters(input: {
    commodity: string;
    nearSystemAddress?: bigint;
    maxDistanceLy?: number;
    minVolume?: number;
    minPrice?: number;
    includeCarriers: boolean;
    maxDaysAgo: number;
  }): Promise<Enriched<MarketListing[]>>;

  /** Where to BUY. Same contract, on price/stock. */
  findExporters(input: { /* symmetric */ }): Promise<Enriched<MarketListing[]>>;

  getMarketCommodity(marketId: bigint, commodity: string): Promise<Enriched<MarketListing | null>>;
  getCoverageStats(): Promise<Enriched<ArdentStats>>;
}

export interface ISystemDataProvider {
  /** PREFERRED. Unambiguous. */
  getSystemByAddress(address: bigint): Promise<Enriched<SystemDetail | null>>;
  /** Returns CANDIDATES. ~1,300 names are ambiguous — never resolves to one on the caller's behalf. */
  findSystemsByName(name: string): Promise<Enriched<SystemSummary[]>>;
  findNearby(address: bigint, maxDistanceLy: number): Promise<Enriched<SystemSummary[]>>;
  findNearestService(input: {
    address: bigint; service: StationService; minLandingPad?: 1 | 2 | 3;
  }): Promise<Enriched<StationWithDistance[]>>;
}
```

## Licence position — important and frequently misread
Ardent is **AGPL-3.0**.

| What we do | Obligation |
|---|---|
| **Use the hosted API** | **None.** Consuming a network service imposes nothing. |
| Download and use the dumps | None. |
| Self-host **unmodified** Ardent | None beyond preserving notices. |
| Self-host **modified** Ardent, exposed over a network | **We must offer our modified source to users.** |

**Our position:** use the hosted API. If we ever self-host, run it unmodified or keep the fork public (`00-charter/constraints.md`).

## Gotchas
- **`maxDaysAgo` defaults to 30 upstream, and that default is doing enormous work for data quality.** Never leave it implicit. The adapter makes it a required parameter and the UI exposes it as a freshness slider. A 30-day-old price presented as current is exactly how a tool loses a member's trust.
- **Prefer `/v2/system/address/{id}` over `/v2/system/name/{name}` everywhere possible.** ~1,300 systems have ambiguous names, and a wrong system name costs a member a 40-minute round trip (INV-018). Name lookup is for user-facing search only, and its result is resolved to an address immediately.
- **`fleetCarrier` is `0`/`1`, not a boolean.** Coerce it, and **exclude carriers by default** — their prices distort results and their availability is not guaranteed (INV-026).
- **`systemAddress` and `marketId` exceed 2^53.** Parse as BigInt; a JSON number silently corrupts them (INV-021).
- **`meanPrice` is the galactic average, not this station's price.** Confusing it with `sellPrice` produces confidently wrong profit calculations.
- **`buyPrice: 0` means the station does not sell it** — it does not mean it is free. Same for `sellPrice: 0`. Filter on `> 0`, not on presence.
- **Coverage is not uniform.** Popular systems are fresh; the black is not. Always surface `dataAgeHours` rather than implying completeness.
- **Ardent is downstream of EDDN, like us.** It is not a second, independent opinion — if EDDN is wrong, Ardent is wrong the same way. It is a coverage accelerator, not a cross-check.
- **Single maintainer.** Cache aggressively, dedupe in-flight requests, and design so that its absence degrades rather than breaks (which is exactly what ADR-007 buys us).
