# Spansh

## Role in this system
Heavy route computation we will never write ourselves — neutron routing, galaxy plotting with refuelling, fleet-carrier routing, Road to Riches, tourist/multi-stop — plus the nightly full-galaxy dumps we seed our database from.

## Trust tier
**best-effort** — a one-person operation. Excellent, and not something to build a request path on.

## Access requirements
None. No key, no signup.

## Base URL
```
https://spansh.co.uk
```
Dumps: `https://spansh.co.uk/dumps`

> **⚠ Verify the exact current endpoint paths and parameters against Spansh's own documentation before coding.** They are not formally versioned and have changed. The adapter ships `@unverified` until exercised live, and that status is tracked in `STATUS.md` (AGENTS.md — never fabricate an endpoint).

## The interaction pattern — the whole point
**Asynchronous job submission. Never a blocking call** (INV-032).

```
POST  <planner endpoint>          → { job: "<jobId>" }          (fast)
GET   /api/results/<jobId>        → { status: "queued" | "ok", result?: {...} }
```

A long route legitimately takes **tens of seconds**. Therefore:

```
POST /v1/trade/plot
  → create a route_jobs row (status=queued), enqueue a BullMQ job, return 202 + jobId
worker
  → submit to Spansh → store upstreamJobId → poll with exponential backoff
  → on completion: write the result document to object storage, update the row
  → emit trade.job_complete on the trade:jobs:{jobId} WebSocket channel
browser
  → never blocked; renders waypoints on the push, with copy-to-clipboard per hop
```

**`IRoutePlanner` exposes no synchronous method at all.** The interface makes the wrong thing unrepresentable — that is deliberate (ADR-013).

## Planners we use
| Planner | Purpose | Typical duration |
|---|---|---|
| neutron | Fastest route using neutron boosts | seconds |
| galaxy | Route with refuelling and scoopable-star constraints | seconds to a minute |
| fleet_carrier | Carrier route with tritium planning | seconds |
| road_to_riches | Exploration earnings circuit | tens of seconds |
| tourist | Multi-stop "visit these places" | tens of seconds |
| trade | Spansh's own trade router — a cross-check on ours | seconds |

## Dumps
| Dump | Contents | Use |
|---|---|---|
| `galaxy.json.gz` | Full galaxy: systems, bodies, stations | **Seeding** (P3.5) |
| daily / weekly / monthly deltas | Changes since | Periodic top-up |

Multi-GB. **Stream-parse and prefilter on the way in** — a naive `JSON.parse` of the file is an out-of-memory crash, and inserting the whole galaxy blows the 160 GB disk (`03-data/seed-plan.md`).

## Rate limits & etiquette
Not formally published. Our self-imposed rules:
- **Dedupe by a hash of normalised parameters.** Two members asking for Sol→Colonia at 60 ly cost **one** upstream job, not two.
- **Cache results 7 days**, keyed by that hash.
- **Poll with exponential backoff** — start at 2 s, cap at 15 s. Never a tight poll loop.
- Cap concurrent in-flight jobs (start at 3).
- Download dumps **at most daily**, off-peak, resumable.
- Identify ourselves in the User-Agent with a contact route.

**Being rude here would be both antisocial and self-defeating** — there is no alternative provider for neutron routing.

## Failure modes
| Failure | Detection | Our response |
|---|---|---|
| Service down | timeout / 5xx on submit | Job stays `queued`, retried with backoff. **The member sees "queued", never an error page.** |
| Job never completes | poll exceeds the deadline (10 min) | Mark `failed`, notify, allow resubmit. Never poll forever. |
| Endpoint path changed | 404 on a previously-working path | Circuit opens, **alert loudly** — this is the most likely way Spansh breaks for us. |
| Result shape changed | Zod parse failure | Store the raw document, mark `failed`, alert. Never crash the worker. |
| Rate limited | 429 | Backoff hard, reduce concurrency, alert. |
| Dump download interrupted | byte count mismatch | Resume from the checkpointed offset. Seeding is resumable by requirement. |
| Duplicate identical jobs | param-hash collision check | Return the existing job. `deduped: true` in the response. |

## Adapter interface
```ts
// packages/ed-clients/src/spansh/spansh.adapter.ts
export interface IRoutePlanner {
  readonly source: 'spansh';
  readonly trustTier: 'best-effort';

  /** Submits and returns immediately. There is deliberately NO synchronous plot method. */
  submit(input: RoutePlotInput): Promise<{ upstreamJobId: string }>;

  /** Called only by the worker's polling loop, never by a request. */
  poll(upstreamJobId: string): Promise<RouteJobResult>;

  /** Deterministic hash of normalised parameters — the dedupe and cache key. */
  paramHash(input: RoutePlotInput): string;
}

export type RouteJobResult =
  | { status: 'pending' }
  | { status: 'complete'; result: unknown }
  | { status: 'failed'; error: string };

export interface IGalaxyDumpReader {
  /** Streaming, resumable, prefiltering. Never loads the file into memory. */
  streamSystems(opts: {
    dumpPath: string;
    resumeFromOffset?: number;
    filter: (system: RawSystem) => boolean;
    onBatch: (systems: RawSystem[], offset: number) => Promise<void>;
  }): Promise<void>;
}
```

## Gotchas
- **Submit-and-poll is not optional.** A blocking call means a request thread held for tens of seconds, a gateway timeout, and a frozen UI. This is a named common failure in the phase plan for a reason.
- **Endpoint paths are not formally versioned and have changed.** Verify against Spansh's own docs before coding, keep paths in configuration, and alert loudly on a 404 for a previously-working path.
- **Never poll forever.** A hard deadline (10 min) plus a `failed` state, or a stuck job occupies a worker indefinitely.
- **Deduplicate before submitting.** The param hash must normalise: sort waypoints, round the jump range, canonicalise system names to addresses. Two logically identical requests that hash differently defeat the whole mechanism.
- **The galaxy dump does not fit in memory.** Stream it, prefilter during the stream, checkpoint the offset, and make re-running a no-op (`03-data/seed-plan.md`).
- **A dump is a floor, not an override.** Seeding must never overwrite fresher EDDN data — the same stale-timestamp rule applies (INV-017).
- **Results are large.** They belong in object storage with a database row pointing at them, not in a Postgres column.
- **Spansh's trade router is a useful cross-check on ours**, but it is not authoritative either — it is downstream of the same EDDN data.
- **One maintainer.** Cache, dedupe, back off, and treat its absence as a degraded feature rather than an outage.
