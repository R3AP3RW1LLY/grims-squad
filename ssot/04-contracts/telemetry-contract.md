# TELEMETRY CONTRACT

`POST /v1/telemetry` — the EDMC plugin → API contract (ADR-014). This is the telemetry spine; four modules depend on it.

**The plugin runs on members' machines and cannot be force-upgraded.** Every rule below follows from that: the endpoint must be permissive about what it does not recognise and strict about what it accepts.

## Authentication

`Authorization: Bearer <device-token>` — issued from the member's profile, scoped `telemetry:write`, individually revocable, stored as a SHA-256 hash, encrypted where the plaintext is retained (INV-012). Not a session token, not a password.

| Failure | Response |
|---|---|
| Unknown / malformed / revoked token | `401 DEVICE_TOKEN_INVALID` |
| Member lacks `TELEMETRY_WRITE` | `403 PERMISSION_DENIED` |
| Member `status != active` | `403 PERMISSION_DENIED` |

## Request

```json
{
  "pluginVersion": "1.2.0",
  "gameVersion": "4.1.2.0",
  "cmdr": "Grimshaw",
  "events": [
    {
      "category": "location",
      "eventType": "FSDJump",
      "timestamp": "2026-07-25T18:14:02Z",
      "systemAddress": "3107509474002",
      "systemName": "Shinrarta Dezhra",
      "marketId": null,
      "shipType": "Python",
      "shipId": 12,
      "payload": { "...": "verbatim journal event" }
    }
  ]
}
```

| Field | Rule |
|---|---|
| `pluginVersion` | Semver. Logged, and used to nudge upgrades. **Never used to reject a request.** |
| `gameVersion` | From the journal. Non-Live (beta/alpha) events are **accepted and discarded** — the plugin should not have to know our filtering rules. |
| `cmdr` | Cross-checked against the member's active verification. A mismatch is a `409` (below). |
| `events` | 1–25 per batch. More is `400 TELEMETRY_BATCH_TOO_LARGE`. |
| `timestamp` | **The journal event's own timestamp, not the send time.** Ordering, idempotency and staleness rules all use this (INV-017). |
| `systemAddress` | **Decimal string** — BigInt is not JSON-safe (INV-021). Same for `marketId`. |
| `payload` | The verbatim journal event. Stored raw for 30 days, then purged; aggregates survive. |

## Consent enforcement — the security control

**Per-category consent is enforced server-side. A non-consented category is rejected with an explicit error, never silently ignored** (INV-013). Client-side filtering is a courtesy; the client is not a security boundary.

```
403 TELEMETRY_CATEGORY_NOT_CONSENTED
details: { rejectedCategories: ["combat"], consentedCategories: ["location","bgs"] }
```

A **partially** consented batch is a `207`-style partial success: consented events are accepted, non-consented ones rejected, and the response enumerates both. The plugin must not resend the rejected ones.

```json
{ "accepted": 18, "rejected": 4, "ignored": 3,
  "rejectedCategories": ["combat"],
  "errors": [ { "index": 5, "code": "TELEMETRY_CATEGORY_NOT_CONSENTED" } ] }
```

## Categories and their events

Each category is one consent toggle, default off.

| Category | Journal events | Feeds |
|---|---|---|
| `location` | `Location`, `FSDJump`, `Docked`, `Undocked`, `SupercruiseEntry`, `SupercruiseExit` | Activity ticker, ops coordination, "your ship, your system" |
| `bgs` | `MissionCompleted`, `MissionFailed`, `MissionAbandoned`, `RedeemVoucher`, `FactionKillBond`, `Bounty`, `CommitCrime`, `MultiSellExplorationData`, `SellExplorationData` | **BGS activity capture — the module that most justifies the plugin** |
| `trade` | `MarketBuy`, `MarketSell`, `CargoDepot`, `Cargo` | Group hauling progress, contribution ledgers |
| `exploration` | `Scan`, `FSSAllBodiesFound`, `SellOrganicData`, `SellExplorationData` | Exploration logs, exobiology, the public feed |
| `combat` | `Bounty`, `FactionKillBond`, `Died`, `PVPKill`, `Interdicted` | Combat stats, AAR enrichment |
| `carrier` | `CarrierJump`, `CarrierJumpRequest`, `CarrierJumpCancelled`, `CarrierStats`, `CarrierTradeOrder`, `CarrierDepositFuel` | Carrier registry, tritium tracker, jump schedule |
| `fleet` | `Loadout`, `ShipyardSwap`, `ShipyardBuy`, `ShipyardSell`, `StoredShips` | Automatic Loadout Locker sync, fleet register |

`Bounty` and `FactionKillBond` appear in both `bgs` and `combat`. **They are accepted if the member consented to *either*** — refusing an event the member has plainly consented to under one heading would be surprising and wrong.

## Idempotency

`eventKey = sha256(deviceTokenId + '|' + timestamp + '|' + eventType)`

Duplicates are accepted and counted as `ignored`, never rejected — **a retry after a timeout is normal plugin behaviour, not an error** (INV-017). Derived records (`bgs_activity_reports`, `hauling_contributions`) carry `sourceEventId` with a unique constraint, so ingestion is idempotent end-to-end.

## Unknown events

```
200 OK — counted in `ignored`, logged at debug, never an error.
```

**A game update that adds an event type must not break the plugin for everyone.** This is the single most important robustness rule in the contract. New events are added to the accepted set on our schedule, not the game's.

## Rate limits

| Limit | Value | On exceed |
|---|---|---|
| Requests per device token | 60/min | `429`, `retryAfterSeconds` set |
| Events per device token | 1,500/min | `429` |
| Batch size | 25 events | `400 TELEMETRY_BATCH_TOO_LARGE` |
| Body size | 1 MB | `413` |

Limits are generous — a busy combat session legitimately produces a lot of events. They exist to bound a runaway plugin, not to shape normal play.

## Plugin obligations — from ADR-014, non-negotiable

1. **Never block or slow the game.** All I/O on a background thread, bounded queue, short timeouts, silent failure, retry next loop. `journal_entry` returns immediately, always.
2. **Per-category opt-in, defaulting to off**, with a settings panel.
3. **Fail silently.** Network loss, a 500, an expired token — none of it surfaces as a game-session interruption. Errors go to the EDMC log.
4. **Bounded queue.** If the queue fills (network down for hours), drop oldest and record the drop count. **Never grow without limit inside the member's game process.**
5. **Public source.** Members are installing code that reads their game journal.
6. **Optional EDDN forwarding** for members not already contributing.
7. **Back off on 429 and 5xx** with exponential backoff and jitter. Never a tight retry loop.
8. **Never send credentials other than the device token.** No Discord token, no session cookie, no Frontier token.

## Server obligations

1. Zod-validate every event before it reaches business logic.
2. Enforce consent server-side (INV-013).
3. Persist raw for 30 days; derive aggregates; purge on schedule (`03-data/retention.md`).
4. **Respond fast.** Target p99 < 500 ms — a slow endpoint makes the plugin's queue back up in a member's game process.
5. **Accept older payload versions gracefully.** The plugin cannot be force-upgraded.
6. Cross-check `cmdr` against the member's verification; on mismatch return `409 CMDR_MISMATCH` with the expected name, since this usually means a shared machine or a wrong token rather than an attack.
7. Record `lastUsedAt` on the device token so the profile's "EDMC connected" indicator is truthful.

## Privacy surface

The member always sees what is being collected and can stop it in one click:

- Live indicator: **"EDMC connected — sharing: location, BGS"**, listing exactly the consented categories.
- One-click revoke → token dead immediately, purge of raw events offered.
- `GET /v1/me/telemetry/summary` → per category: event count, oldest and newest retained, what each feeds.
- Data export includes everything derived from telemetry, not just the raw events.
