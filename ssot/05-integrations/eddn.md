# EDDN — Elite Dangerous Data Network

## Role in this system
The firehose we subscribe to directly to build and maintain **our own** systems, stations and market database. It is our data layer, not an acceleration layer.

## Trust tier
**authoritative** for what it carries — with the permanent caveat that it is player-reported and only as fresh as the last CMDR who docked somewhere. Hence INV-004.

## Access requirements
None. Public ZeroMQ relay, no key, no signup, no approval.

## Base URL
```
tcp://eddn.edcd.io:9500      # ZeroMQ SUB socket
```
Schemas: `https://github.com/EDCD/EDDN`

## Message shape
Every message is **zlib-compressed JSON**. Inflate before parsing.

```json
{
  "$schemaRef": "https://eddn.edcd.io/schemas/commodity/3",
  "header": {
    "uploaderID": "<anonymised hash>",
    "softwareName": "EDMarketConnector",
    "softwareVersion": "5.11.2",
    "gatewayTimestamp": "2026-07-25T18:14:07.123456Z",
    "gameversion": "4.1.2.0",
    "gamebuild": "r312345/r0"
  },
  "message": {
    "systemName": "Shinrarta Dezhra",
    "stationName": "Jameson Memorial",
    "marketId": 128666762,
    "timestamp": "2026-07-25T18:14:02Z",
    "commodities": [
      { "name": "tritium", "meanPrice": 41000, "buyPrice": 0, "stock": 0,
        "stockBracket": 0, "sellPrice": 51200, "demand": 12000, "demandBracket": 3 }
    ]
  }
}
```

## Schemas we consume
| Schema | Feeds | Priority under backpressure |
|---|---|---|
| `commodity/3` | `market_orders`, `market_history` | **highest — never shed** |
| `journal/1` (`FSDJump`, `Location`, `Docked`, `CarrierJump`) | `systems`, `stations`, `faction_influence_snapshots` | **highest — never shed** |
| `fcmaterials_journal/1`, `fcmaterials_capi/1` | carrier materials | medium |
| `outfitting/2` | station module availability | low — shed first |
| `shipyard/2` | station ship availability | low — shed first |
| `approachsettlement/1`, `navroute/1`, `scanbarycentre/1` | not used | ignored at the switch |

## Collector design — every rule is mandatory
| Rule | Why |
|---|---|
| **Batch writes.** 500 rows or 2 s, whichever first, then one `INSERT … ON CONFLICT DO UPDATE`. | Single-row inserts put the database irrecoverably behind **within an hour**. This is a design requirement, not a later optimisation. |
| **Idempotent upsert** keyed `(marketId, commodity)`. | Messages repeat. |
| **Discard messages older than the stored `updatedAt`** (INV-017). | Messages arrive out of order; without this, stale data overwrites fresh data. |
| **Radius prefilter** — systems within the configured radius of home, plus tracked BGS systems, plus anything queried in the last 30 days. | **>95% storage saving.** It is what keeps us inside a 160 GB disk (decision D4). |
| **Backpressure by value.** Shed `outfitting`/`shipyard` before `commodity`/`journal`. Emit a metric. | Never shed silently — an unmeasured drop is invisible data loss. |
| **Live galaxy only.** Filter on `header.gameversion`. | Beta and alpha data would corrupt the live picture. |
| **Version-tolerant parsing + dead-letter queue + alert on failure rate.** | Schemas change without notice. |
| **Singleton, resumable.** | A few seconds of gap on deploy is acceptable; silent loss is not (INV-034). |
| **Seed from dumps first.** | Organic coverage takes weeks. Bootstrap from Spansh/Ardent, then let EDDN keep it fresh. |
| **`receiveTimeout` ~60 s and reconnect on silence.** | A silent socket looks identical to a quiet galaxy. It is not. |

## Volume expectations
Hundreds of thousands of trade updates per day; millions per week galaxy-wide. **Stand the collector up against a throwaway database for an hour before designing anything** — the volume makes the batching decision self-evident and shapes everything downstream.

## Failure modes
| Failure | Detection | Our response |
|---|---|---|
| Relay unreachable | connect error | Reconnect with backoff. Alert if down > 10 min. |
| **Silent socket** (connected, no messages) | `receiveTimeout` fires; messages/sec = 0 | **Reconnect.** Alert if silent > 10 min. A connected-but-silent socket is the most dangerous failure because nothing errors. |
| Malformed / non-zlib payload | inflate or parse throws | Dead-letter, increment counter. Alert if the failure *rate* rises. |
| Unknown `$schemaRef` | switch default | Ignore, count. **Never an error** — new schemas appear. |
| Schema field change | Zod parse failure | Dead-letter, alert on rate. Do not crash the collector. |
| Write queue backing up | queue depth metric | Shed low-value schemas, then alert. |
| Disk approaching full | disk metric > 80% | **Alert at 80%, not 95%** — a full disk also fails the restart. |
| Duplicate rows after restart | row-count check | Should be impossible: upserts are idempotent. If it happens, the key is wrong. |

## Adapter interface
```ts
// packages/ed-clients/src/eddn/eddn.stream.ts
export interface IGameDataStream {
  readonly source: 'eddn';
  start(handlers: EddnHandlers): Promise<void>;
  stop(): Promise<void>;
  stats(): EddnStats;
}

export interface EddnHandlers {
  onCommodity(msg: CommodityMessage, header: EddnHeader): Promise<void>;
  onJournal(msg: JournalMessage, header: EddnHeader): Promise<void>;
  onOutfitting(msg: OutfittingMessage, header: EddnHeader): Promise<void>;
  onShipyard(msg: ShipyardMessage, header: EddnHeader): Promise<void>;
  onCarrierMaterials(msg: FcMaterialsMessage, header: EddnHeader): Promise<void>;
}

export interface EddnStats {
  messagesPerSecond: number;
  lagSeconds: number;          // now - header.gatewayTimestamp
  parseFailureRate: number;
  deadLetterCount: number;
  shedCount: Record<string, number>;
  lastMessageAt: Date | null;
}
```

## Gotchas
- **Messages are zlib-compressed.** Forgetting to inflate yields "invalid JSON" and a confusing half-hour.
- **A connected socket with no traffic is a real failure mode**, and it looks exactly like a quiet period. `receiveTimeout` plus a messages/sec alert is the only way to tell them apart.
- **`header.gatewayTimestamp` is when EDDN received it; `message.timestamp` is when the player observed it.** Use `message.timestamp` for data currency and `gatewayTimestamp` for pipeline lag. Confusing them makes lag monitoring meaningless.
- **`uploaderID` is anonymised.** EDDN **cannot** attribute activity to a member. This is precisely why the EDMC plugin exists (ADR-014) — do not attempt to correlate.
- **Commodity names arrive as FDevIDs internal names**, lowercase and inconsistent. Resolve through FDevIDs; never display them (INV-020).
- **`marketId` and `SystemAddress` are 64-bit.** Parse as BigInt. JavaScript `number` silently corrupts them (INV-021).
- **Fleet carriers appear as stations.** They must be flagged `isCarrier` and excluded from route results by default, or their prices distort everything (INV-026).
- **The same tick generates many faction-state messages.** Deduplicate per `(faction, system, tick)` — **never sum** (INV-019). A double-count corrupts the entire influence history.
- **Not every message has every field.** Optional fields are genuinely optional; a non-null assertion here is a crash waiting for a quiet Tuesday.
- **Some uploaders send stale data**, e.g. a journal replay after a long offline session. The stale-timestamp rule (INV-017) is what protects you.
- **The prefilter must run at parse time, before insert.** Filtering after insert saves no disk at all.
