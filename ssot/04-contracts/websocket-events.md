# WEBSOCKET EVENTS

`wss://api.<domain>/v1/ws` — socket.io. Push only, in practice: clients subscribe and receive. The one client→server message is a subscribe/unsubscribe request.

## Authentication and subscription authorization

1. The client connects with its access JWT in the socket.io `auth` payload. **Never in the query string** — query strings land in access logs and proxy logs.
2. The server verifies the JWT and computes the effective permission mask **at connect time**.
3. Every `subscribe` is authorized against that mask **and** against per-channel ownership rules. **A subscription is an authorization decision, exactly like an HTTP request** — the same data-layer rules apply (INV-002). An unauthorized subscribe returns an error and is audited; it does not silently succeed with no events.
4. **The mask is re-evaluated on `perm:{userId}` cache-bust.** A demotion in Discord must drop the socket's channels within the same 5 s window as an HTTP request would (J3). A long-lived socket that keeps Ring 1 events after a demotion is a real leak — this is not an edge case, it is the obvious way to get this wrong.
5. Access JWTs expire in 15 minutes; the client re-authenticates in-place over the existing socket. Failure to re-authenticate closes the connection.

## Channels

| Channel | Who may subscribe | Purpose |
|---|---|---|
| `notifications:{userId}` | that user only | Personal notifications |
| `ops:{operationId}` | `OPS_VIEW` **and** the op is visible to them | Signup and composition changes |
| `ai:{conversationId}` | the conversation's owner only | Token streaming, tool cards, confirmations |
| `bgs:updates` | `BGS_VIEW` | Tick detected, influence updated, orders changed |
| `carriers:{callsign}` | `CARRIER_VIEW` | Location, fuel, jump schedule |
| `presence:squadron` | `FORUM_VIEW_MEMBER` | Who is online, **respecting each member's privacy settings** |
| `trade:jobs:{jobId}` | the job's submitter only | Spansh job completion |
| `admin:health` | `SITE_CONFIG` | Live health dashboard |
| `forum:category:{categoryId}` | satisfies that category's `viewPerm` | New threads and posts |

## Client → server

```ts
// subscribe
{ event: 'subscribe',   data: { channel: 'ops:0193f2a1-...' } }
// ack
{ event: 'subscribed',  data: { channel: 'ops:0193f2a1-...' } }
// refusal — audited, never a silent no-op
{ event: 'subscribe_error',
  data: { channel: 'bgs:updates', code: 'PERMISSION_DENIED',
          requiredPermissions: ['BGS_VIEW'] } }

{ event: 'unsubscribe', data: { channel: 'ops:0193f2a1-...' } }
{ event: 'reauth',      data: { accessToken: '<jwt>' } }
```

## Server → client

Every payload carries `v` (schema version), `ts` (UTC ISO-8601 emit time) and `channel`. Payload bodies are Zod schemas in `packages/shared`, shared with the client.

### `notification`
```json
{ "v": 1, "ts": "2026-07-25T18:22:04Z", "channel": "notifications:0193...",
  "data": { "id": "0193...", "kind": "forum_reply",
            "title": "CMDR Grimshaw replied to \"Thursday BGS push\"",
            "body": null, "link": "/forum/threads/0193...", "createdAt": "2026-07-25T18:22:03Z" } }
```

### `op.signup_changed`
```json
{ "v": 1, "ts": "...", "channel": "ops:0193...",
  "data": { "operationId": "0193...", "userId": "0193...", "displayName": "CMDR Grimshaw",
            "state": "yes", "roleTag": "mining", "shipType": "Python",
            "counts": { "yes": 7, "maybe": 2, "no": 1, "standby": 3 },
            "composition": { "satisfied": false, "missing": [ { "roleTag": "mining", "count": 2 } ] } } }
```

### `op.reminder`
`data: { operationId, title, startsAt, minutesUntil }` — `minutesUntil` ∈ `1440 | 60 | 10`.

### `ai.token`
```json
{ "v": 1, "ts": "...", "channel": "ai:0193...",
  "data": { "messageId": "0193...", "delta": "Tritium is selling at ", "done": false } }
```

### `ai.tool_call`
```json
{ "v": 1, "ts": "...", "channel": "ai:0193...",
  "data": { "invocationId": "0193...", "tool": "find_trade_route",
            "status": "running", "label": "Checking market data…",
            "args": { "origin_system": "Sol", "cargo_capacity": 256 } } }
```
`status` ∈ `running | ok | error | denied`. **`denied` is emitted, not hidden** — the member sees that a boundary was enforced (INV-011).

### `ai.confirmation_required`
```json
{ "v": 1, "ts": "...", "channel": "ai:0193...",
  "data": { "invocationId": "0193...", "tool": "set_bgs_order",
            "args": { "system": "Ross 128", "directive": "push", "priority": 1 },
            "preview": "Set Ross 128 to PUSH at priority 1, effective now.",
            "confirmationToken": "...", "expiresAt": "2026-07-25T18:27:04Z",
            "twoStep": false } }
```
No mutating tool proceeds without a confirmation carrying this token (INV-014).

### `ai.status`
`data: { status: 'online' | 'degraded' | 'offline', queueDepth, estimatedSeconds, instance: 'interactive' | 'heavy' | null }`
Broadcast on every transition. Drives the honest status indicator (INV-030).

### `bgs.tick_detected`
```json
{ "v": 1, "ts": "...", "channel": "bgs:updates",
  "data": { "tickId": "0193...", "occurredAt": "2026-07-25T17:04:00Z",
            "source": "community_detector", "confidence": 1.0 } }
```
**`source: "inferred"` with `confidence < 1` must be rendered as provisional.** A tick presented as certain when it was guessed poisons every delta a member reads.

### `bgs.influence_updated`
`data: { systemAddress, systemName, factionId, factionName, influence, deltaSinceLastTick, state, pendingStates[], tickId }`
`systemAddress` is a **decimal string** — BigInt is not JSON-safe (INV-021). This applies to every BigInt in every payload.

### `bgs.orders_changed`
`data: { orders: [{ systemAddress, systemName, directive, priority, guidanceMd }], setBy, setAt }`

### `carrier.updated`
`data: { callsign, name, currentSystem, currentSystemName, fuelLevel, nextJumpSystem, nextJumpAt, dataAgeHours }`
Carries `dataAgeHours` because carrier state is EDDN-sourced and can be hours old (INV-004).

### `trade.job_complete`
`data: { jobId, kind, status, resultUrl, hopCount, totalDistanceLy, computedAt }`
The push that makes Spansh delegation non-blocking (INV-032).

### `trade.alert_fired`
`data: { alertId, commodity, commodityDisplay, marketId, stationName, systemName, price, distanceLy, dataAgeHours }`

### `presence.changed`
`data: { userId, displayName, status: 'online'|'offline'|'in_game', currentSystem?, currentShip? }`
**`currentSystem` and `currentShip` are present only if that member set `showLocation`/`showFleet`** — absent, not null (INV-027).

### `forum.thread_created` / `forum.post_created`
`data: { threadId, categoryId, title, slug, authorDisplayName, createdAt }` / `data: { postId, threadId, authorDisplayName, excerpt, createdAt }`
`excerpt` is derived from sanitized HTML, never raw markdown.

### `admin.health`
`data: { status, checks: { db, redis, meilisearch, eddn, gsai, disk } }` — same shape as `GET /v1/health`, pushed every 15 s.

## Operational rules

| Concern | Rule |
|---|---|
| **Reconnection** | Exponential backoff with jitter, capped at 30 s. On reconnect the client re-subscribes; the server re-authorizes every channel from scratch. |
| **Missed events** | The socket is **not** a durable queue. On reconnect the client refetches current state over REST. Notifications are additionally persisted, so nothing important depends on socket delivery. |
| **Backpressure** | Per-connection outbound queue cap. A client that cannot keep up is disconnected with `slow_consumer` rather than being allowed to consume server memory. |
| **Fan-out** | Redis pub/sub, so any `api` replica can emit to a socket held by another. |
| **Rate limiting** | Subscribe/unsubscribe limited per connection; a subscribe storm is treated as abuse. |
| **BigInt** | Always a decimal string in payloads. Never a JSON number (INV-021). |
| **Timestamps** | Always UTC ISO-8601 with `Z`. The client renders local **and** UTC (INV-025). |
| **Versioning** | `v` is per-event-type. A breaking payload change increments it and both versions are emitted for one release cycle. |
