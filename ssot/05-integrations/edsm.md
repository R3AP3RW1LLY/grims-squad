# EDSM — Elite Dangerous Star Map

## Role in this system
System coordinates, bodies, engineer locations and traffic statistics — the things Ardent does not cover and our EDDN mirror will not have for systems nobody has visited recently.

## Trust tier
**enrichment** — good coverage of static galactic geography, community-sourced like everything else.

## Access requirements
None for the endpoints we use. No key, no signup. (An API key exists for *writing* commander data; we never write.)

## Base URL
```
https://www.edsm.net
```
Docs: `https://www.edsm.net/en/api-v1`

## Endpoints we use
| Method | Path | Purpose | Params | Cache TTL |
|---|---|---|---|---|
| GET | `/api-v1/system` | One system: coordinates, information, primary star | `systemName`, `showCoordinates=1`, `showInformation=1`, `showPrimaryStar=1` | 24 h + persisted |
| GET | `/api-v1/systems` | Batch system lookup | `systemName[]`, `showCoordinates=1` | 24 h + persisted |
| GET | `/api-v1/sphere-systems` | Systems within a radius | `systemName`, `radius`, `showCoordinates=1` | 24 h |
| GET | `/api-system-v1/bodies` | Bodies in a system: type, landability, rings, materials | `systemName` \| `systemId64` | persisted |
| GET | `/api-system-v1/stations` | Stations: type, pad size, distance to arrival, services | `systemName` \| `systemId64` | 24 h |
| GET | `/api-system-v1/traffic` | Traffic counts — a useful proxy for how current market data is likely to be | `systemName` | 24 h |
| GET | `/api-system-v1/deaths` | Death counts — a danger signal for route safety | `systemName` | 24 h |
| GET | `/api-v1/systems?showId=1` | Resolve names to `id64` (= `SystemAddress`) | `systemName[]` | persisted |

**Prefer `systemId64` wherever the endpoint accepts it** — it is the same value as `SystemAddress` and is unambiguous (INV-018).

## Response shapes
`GET /api-v1/system?systemName=Shinrarta%20Dezhra&showCoordinates=1&showInformation=1`
```json
{
  "name": "Shinrarta Dezhra",
  "id": 4345,
  "id64": 3107509474002,
  "coords": { "x": 55.71875, "y": 17.59375, "z": 27.15625 },
  "coordsLocked": true,
  "information": {
    "allegiance": "Independent",
    "government": "Patronage",
    "faction": "The Pilots Federation",
    "factionState": "None",
    "population": 85206935,
    "security": "High",
    "economy": "Industrial",
    "secondEconomy": "High Tech",
    "reserve": "Common"
  },
  "primaryStar": { "type": "K (Yellow-Orange) Star", "name": "Shinrarta Dezhra", "isScoopable": true }
}
```

`GET /api-system-v1/bodies?systemName=...`
```json
{ "id": 4345, "id64": 3107509474002, "name": "Shinrarta Dezhra",
  "bodyCount": 12,
  "bodies": [
    { "id64": 3107509474002, "bodyId": 1, "name": "Shinrarta Dezhra A 1",
      "type": "Planet", "subType": "High metal content world",
      "isLandable": true, "gravity": 0.31, "rings": [],
      "materials": { "Iron": 21.4, "Nickel": 16.2 } }
  ] }
```

**An unknown system returns `{}` or `null`-ish content with HTTP 200 — not a 404.** Handle absence explicitly.

## Rate limits & etiquette
- Generous and unpublished. The stated expectation is respectful use.
- Cache aggressively — **this data is nearly static.** Coordinates and bodies do not change; re-fetching them daily is pure waste.
- Batch with `/api-v1/systems` rather than looping single lookups.
- Identify ourselves in the User-Agent.

## Failure modes
| Failure | Detection | Our response |
|---|---|---|
| System unknown | HTTP 200 with empty/null body | **Not an error.** Cache the negative for 24 h; fall back to our EDDN data. |
| Service down | timeout / 5xx | Circuit opens; serve persisted coordinates. **Coordinates are static, so this is nearly harmless.** |
| Rate limited | 429 | Backoff, reduce batch cadence. |
| Ambiguous name | multiple candidates | Return candidates; resolve to `id64` before use (INV-018). |
| Shape changed | Zod parse failure | Typed error, alert, serve persisted data. |
| Stale station data | `updateTime` old | EDSM station data lags EDDN. **Prefer our own mirror for stations and markets**; use EDSM to fill gaps only. |

## Adapter interface
```ts
// packages/ed-clients/src/edsm/edsm.adapter.ts
export interface IEdsmSystemProvider extends ISystemDataProvider {
  readonly source: 'edsm';
  readonly trustTier: 'enrichment';

  getSystem(nameOrId64: string | bigint): Promise<Enriched<EdsmSystem | null>>;
  getSystems(names: string[]): Promise<Enriched<EdsmSystem[]>>;
  getSphere(input: { systemName: string; radiusLy: number }): Promise<Enriched<EdsmSystem[]>>;
  getBodies(id64: bigint): Promise<Enriched<EdsmBody[]>>;
  getStations(id64: bigint): Promise<Enriched<EdsmStation[]>>;
  getTraffic(id64: bigint): Promise<Enriched<EdsmTraffic | null>>;
  getDeaths(id64: bigint): Promise<Enriched<EdsmDeaths | null>>;
}
```

## Gotchas
- **An unknown system is HTTP 200 with an empty body, not a 404.** Code that only checks the status will happily treat "no such system" as success and produce nulls three layers down.
- **`id` and `id64` are different.** `id` is EDSM's internal key; **`id64` is the game's `SystemAddress`** and the only one that matters to us. Storing `id` by mistake is a subtle, long-lived bug.
- **Coordinates are effectively immutable — cache them permanently.** Re-fetching static geography on a schedule wastes a courtesy we depend on.
- **`coordsLocked: false` means the coordinates are estimated.** Distance calculations from unlocked coordinates can be meaningfully wrong; surface it or exclude those systems from route results.
- **EDSM station and market data lags EDDN.** Our own mirror is fresher for anything trade-related. Use EDSM for geography, bodies and engineers; not for prices.
- **Engineer locations come from here**, and they change rarely — cache and refresh monthly alongside the FDevIDs job.
- **Traffic and death counts are a genuinely useful signal** that market data in a quiet system is probably stale, and that a route through a high-death system is worth flagging. Both are underused by most tools.
- **Body `materials` percentages** feed the mining and engineering features. They are per-body, not per-system — aggregating them at system level is wrong.
- Batch endpoints accept repeated `systemName[]` parameters. URL length limits apply; chunk at ~50 names.
