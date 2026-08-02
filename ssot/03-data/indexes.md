# INDEXES

Two categories:
1. **Prisma-expressed** — declared with `@@index` / `@@unique` in `schema.prisma`. Generated automatically.
2. **Hand-written** — constructs Postgres supports and Prisma cannot express. **These MUST be added by hand to the initial migration.** A migration missing them is an incomplete migration, and several of them are correctness controls rather than performance tuning.

This file explains *why* the non-obvious ones exist. An index without a reason here is a candidate for deletion.

---

## 1 — Required extensions

```sql
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive handles, CMDR names, system names
CREATE EXTENSION IF NOT EXISTS cube;        -- N-dimensional cube type, for the spatial index
CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector, for knowledge_chunks.embedding
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS timescaledb; -- market_history hypertable (decision D10)
```

⚠ **The image must provide BOTH TimescaleDB and pgvector.** The stock `pgvector/pgvector:pg16`
image does not include TimescaleDB, and `timescale/timescaledb:pg16` does not include pgvector.
Use **`timescale/timescaledb-ha:pg16`**, which bundles both — this is the one operational
consequence of choosing Timescale and it is easy to discover the hard way at P0.2.

### `market_history` — hypertable, compression and retention

```sql
SELECT create_hypertable('market_history', 'observed_at', migrate_data => true);

ALTER TABLE market_history SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'market_id, commodity'
);
SELECT add_compression_policy('market_history', INTERVAL '7 days');
SELECT add_retention_policy('market_history', INTERVAL '90 days');
```

At a 500 ly prefilter this compression is not a nicety — it is what makes 90 days of history
affordable. `compress_segmentby` on `(market_id, commodity)` matches how the sparkline query
reads the data, so compressed chunks stay queryable without decompression.

**The retention policy replaces the `retention:market` job** — do not run both, or they will
race. `03-data/retention.md` is updated accordingly.

`btree_gist` is **not** required — the spatial index uses `cube` with the default GiST opclass.

---

## 2 — Hand-written DDL, by table

### `systems` — the spatial index
The workhorse behind every "nearby X" query: trade route search, carrier-aware routing, alert radius evaluation, BGS sphere views. Without it, every radius query is a sequential scan over the whole system table.

```sql
CREATE INDEX systems_xyz_idx ON systems USING GIST (cube(ARRAY[x, y, z]));
```

Radius queries then use the cube distance operator rather than computing `sqrt(power(...))` per row:
```sql
WHERE cube(ARRAY[x,y,z]) <-> cube(ARRAY[$ox,$oy,$oz]) <= $maxLy
```
**Note for implementers:** the illustrative SQL in the source spec (§7.4) uses `sqrt(power(...))` inline, which cannot use this index. Use the cube operator in the real query and keep the Euclidean form only for computing the exact distance on the already-filtered result set.

### `market_orders` — the two hot partial indexes
These are the difference between a sub-2-second route query and a 30-second one. Partial, because rows with no demand (or no stock) are useless to the respective query and are a large fraction of the table.

```sql
CREATE INDEX market_orders_sell_idx ON market_orders (commodity, sell_price DESC) WHERE demand > 0;
CREATE INDEX market_orders_buy_idx  ON market_orders (commodity, buy_price ASC)   WHERE stock  > 0;
```
`sell_idx` serves "where can I sell this" (importers by price paid). `buy_idx` serves "where can I buy this" (exporters by price). Both are ordered so the planner can stop early.

### `cmdr_verifications` — the uniqueness *invariant*
**This is a correctness control, not an optimisation.** It is what makes INV-005 true: two accounts cannot simultaneously claim one CMDR, while historical revoked rows are still permitted.

```sql
CREATE UNIQUE INDEX cmdr_verifications_active_name_uniq
  ON cmdr_verifications (cmdr_name) WHERE revoked_at IS NULL AND is_verified = true;

CREATE INDEX cmdr_verifications_pending_expiry_idx
  ON cmdr_verifications (nonce_expires_at)
  WHERE is_verified = false AND revoked_at IS NULL;
```

> **`AND is_verified = true` is load-bearing.** Keyed on `revoked_at IS NULL` alone, merely
> *starting* a claim took the lock — so any member could permanently deny any CMDR name,
> including every officer's, by opening an `inara_nonce` claim and never completing it.
> `VERIFICATION_NONCE_NOT_FOUND` is explicitly *not* an error state, so nothing revoked the
> squatting row (RED-TEAM R7). The second index drives the pending-claim expiry sweep, which
> previously had no column to sweep on.

### `faction_influence_snapshots` — the dedupe guarantee
`tick_id` is **non-null** (schema), so Prisma's `@@unique([factionId, systemAddress, tickId])` is *total* and no partial index is required.

> **An earlier revision of this file got this wrong, and the failure is worth recording.**
> It permitted a NULL `tick_id` and added:
>
> ```sql
> -- WRONG. DO NOT REINSTATE.
> CREATE UNIQUE INDEX faction_influence_untick_uniq
>   ON faction_influence_snapshots (faction_id, system_address, observed_at)
>   WHERE tick_id IS NULL;
> ```
>
> `observed_at` is the *uploader's* journal moment, so it differs for every CMDR reporting the
> same tick. Three CMDRs flying through one system after one tick produced three rows, the
> index permitted all three, and INV-019's test still passed because it supplied a known
> `tick_id` and never exercised the NULL path (DATA-INTEGRITY B3).
>
> **The fix is structural, not another index:** ingestion resolves-or-creates the provisional
> `bgs_ticks` row for the current window, so `tick_id` is never NULL and the plain unique
> constraint covers every case.

### `bgs_activity_reports` and `hauling_contributions` — the NULL-distinctness trap, again
Prisma's `@@unique([userId, sourceEventId])` enforces **nothing** on the manual and BGS-Tally paths, because those rows leave `source_event_id` NULL. Re-running a partially-failed BGS-Tally import inserted all 240 rows a second time with zero constraint violations, and `hauling_targets.delivered_tons` inherited the doubling (DATA-INTEGRITY B2).

Two partial unique indexes per table — one per ingestion path:

```sql
CREATE UNIQUE INDEX bgs_reports_event_uniq
  ON bgs_activity_reports (user_id, source_event_id) WHERE source_event_id IS NOT NULL;
CREATE UNIQUE INDEX bgs_reports_import_uniq
  ON bgs_activity_reports (user_id, import_batch_key) WHERE import_batch_key IS NOT NULL;

CREATE UNIQUE INDEX hauling_event_uniq
  ON hauling_contributions (user_id, source_event_id) WHERE source_event_id IS NOT NULL;
CREATE UNIQUE INDEX hauling_import_uniq
  ON hauling_contributions (user_id, import_batch_key) WHERE import_batch_key IS NOT NULL;
```

**A row with both keys NULL is rejected at the application boundary**, not silently accepted — an un-dedupable contribution row is indistinguishable from a duplicate forever.

### `systems` — the un-track sweep
The prefilter's third clause ("anything a member queried in the last 30 days") needs an expiry, or the tracked set is monotonic and the >95% saving decays to zero (ARCH-ADV A3).

```sql
CREATE INDEX systems_untrack_idx ON systems (last_queried_at)
  WHERE is_tracked = true AND last_queried_at IS NOT NULL;
```

### `forum_posts` — full-text search column and index
Prisma cannot express generated columns. The column is declared `Unsupported("tsvector")` in the schema and generated here:

```sql
ALTER TABLE forum_posts
  ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', body_md)) STORED;

CREATE INDEX forum_posts_search_idx ON forum_posts USING GIN (search_tsv);
```
Meilisearch is the primary search surface; this is the in-database fallback and the backing store for exact-identifier lookups. **Neither substitutes for the ACL filter** — see INV-024.

### `forum_threads` — the category listing index
Prisma emits this without the partial clause. Add the partial form and drop Prisma's, because a soft-deleted thread is never listed:

```sql
CREATE INDEX forum_threads_listing_idx
  ON forum_threads (category_id, is_pinned DESC, last_post_at DESC)
  WHERE deleted_at IS NULL;
```

### `forum_posts` — the thread reading index
```sql
CREATE INDEX forum_posts_thread_live_idx
  ON forum_posts (thread_id, created_at)
  WHERE deleted_at IS NULL;
```

### `knowledge_chunks` — the vector index
```sql
CREATE INDEX knowledge_chunks_embedding_idx
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
```
**Build this only after the initial bulk index load.** Building HNSW on an empty table then inserting is far slower than the reverse.

**Dimension is 768**, matching `nomic-embed-text` (resolved 2026-07-26). The source spec said `vector(1024)` while pinning a 768-dimension model, which would have failed on every insert. Since the embedding model is pinned forever, this dimension is effectively immutable — changing either forces a full re-index of every chunk.

The composite retrieval filter is the security-relevant one — the visibility predicate must be evaluated **with** the ANN scan, not after it:
```sql
CREATE INDEX knowledge_chunks_visibility_idx ON knowledge_chunks (visibility);
```

### `audit_log` — append-only, time-ordered
Prisma's `@@index([createdAt])` is emitted ascending. Reads are always newest-first:
```sql
CREATE INDEX audit_log_recent_idx ON audit_log (created_at DESC);
```

### `market_history` — retention scan support
**Not needed — superseded by the Timescale retention policy above (decision D10).** An earlier
revision proposed a partial index to support a manual retention job; the hypertable's own
`add_retention_policy` drops whole chunks instead, which is dramatically cheaper than a
row-by-row delete and needs no supporting index.

### `telemetry_events` — retention and processing queue
```sql
CREATE INDEX telemetry_events_unprocessed_idx ON telemetry_events (received_at)
  WHERE processed_at IS NULL;
```
Partial, because the processing queue is a small fraction of a 30-day table.

### `ship_builds` — one journal build per member per ship
```sql
CREATE UNIQUE INDEX ship_builds_one_journal_per_ship_idx
  ON ship_builds (submitted_by_id, ship_id)
  WHERE from_journal;
```
Partial, and it has to be. A member's ship refits, so the journal row for (member, ship) is updated
rather than added to. Their *pasted* builds are a different thing entirely: somebody may keep three
plans for the same hull and compare them, and two members may save the same build.

This replaced `@@unique([submittedById, shipId, fromJournal])`, which looks like it says the same
thing and does not. Adding `fromJournal` as a column makes the tuple unique for *every* value of it,
so the second plan a member saved for one hull was rejected — found the first time the Shipyard's
save button was pressed.

### `idempotency_keys` — expiry sweep
```sql
CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys (expires_at);
```
Already Prisma-expressed; listed for completeness because the sweep job depends on it.

---

## 3 — Materialised view: `best_trades`

Not an index, but in the same performance budget. The common trade query ("best routes near me") is expensive enough to precompute.

> **THE GRAIN MUST BE BOUNDED, AND THAT IS NOT OPTIONAL.**
> An earlier revision specified this view at `(from_market, to_market, commodity)` grain with no
> cap — *every ordered pair of markets, per commodity*. At ~5,000 markets inside a 250 ly radius
> and ~380 tradable commodities the honest join is 25M pairs before pruning, rebuilt **in full**
> every 15 minutes by `REFRESH … CONCURRENTLY` (which re-executes the whole query into a new
> relation, builds its index, then diffs — needing disk headroom for a second full copy) on the
> *same 4 vCPU* running the EDDN collector's batch upserts against the same table. The first
> visible symptom is EDDN lag climbing, which `incident-eddn-stalled.md` would misdiagnose as an
> upstream problem (ARCH-ADV A2).

**Three bounds, all required:** top 20 routes **per origin system** (not per market pair), a 100 ly
distance cap, and a 1,000 Cr/t profit floor.

```sql
CREATE MATERIALIZED VIEW best_trades AS
WITH ranked AS (
  SELECT b.system_address AS from_system, b.market_id AS from_market,
         s.market_id AS to_market, b.commodity,
         (s.sell_price - b.buy_price) AS profit_per_ton,
         b.ly AS distance_ly, LEAST(b.updated_at, s.updated_at) AS observed_at,
         row_number() OVER (PARTITION BY b.system_address
                            ORDER BY (s.sell_price - b.buy_price) DESC) AS rn
  FROM buy_candidates b
  JOIN sell_candidates s
    ON s.commodity = b.commodity AND s.market_id <> b.market_id
  WHERE s.sell_price - b.buy_price >= 1000
    AND b.ly <= 100
)
SELECT * FROM ranked WHERE rn <= 20
WITH DATA;

CREATE UNIQUE INDEX best_trades_pk ON best_trades (from_market, to_market, commodity);
CREATE INDEX best_trades_profit_idx ON best_trades (profit_per_ton DESC);
```

**The refresh cost is measured, not assumed.** P6.3 asserts the refresh completes in under
3 minutes on a populated database — an unmeasured refresh is how this fails silently.

**Refresh every 15 minutes, `CONCURRENTLY`** — which requires the unique index above. A non-concurrent refresh takes an `ACCESS EXCLUSIVE` lock and blocks every reader for its duration.

The view's rows carry the underlying `updated_at`, so freshness survives materialisation (INV-004). A materialised view is a second staleness layer on top of already-stale player data — the UI must show the *observation* age, not the refresh age.

---

## 4 — Prisma-expressed indexes worth explaining

| Index | Why it exists |
|---|---|
| `users(status)` | Member list filtering; the admin console's default view excludes non-active. |
| `users(lastSeenAt)` | Inactivity flags and the probation review prompt. |
| `discord_identities(syncedAt)` | The nightly reconciliation walks oldest-synced-first. |
| `cmdr_verifications(expiresAt)` | The hourly lifecycle worker finds verifications approaching the 25-day cliff. |
| `role_mappings(discordRoleId)` | The bot resolves a Discord role ID to internal roles on every `guildMemberUpdate`. |
| `refresh_token_families(userId, revokedAt)` | The profile's device list, and family revocation on reuse detection. |
| `refresh_tokens(tokenHash)` unique | Reuse detection: presenting a hash whose row has `usedAt` set kills the family. |
| `device_tokens(userId, revokedAt)` | Profile listing and the revocation path. |
| `stations(services)` GIN | "Nearest station with a material trader / tech broker / interstellar factors". |
| `stations(isCarrier)` | Carrier exclusion is the default on every route query (INV-026). |
| `systems(isTracked)` | The EDDN prefilter's hot check, evaluated per inbound message. |
| `market_orders(updatedAt)` | Freshness filtering (`maxDaysAgo`) and the staleness sweep. |
| `reference_names(kind, displayName)` | Commodity/module/ship autocomplete. |
| `ships(shipType)` | Fleet queries — "every Anaconda in the squadron". |
| `loadouts(shipType, roleTag)` | Doctrine lookup and the wing composition checker. |
| `loadouts(visibility)` | Data-layer ACL filtering (INV-002). |
| `operations(startsAt, status)` | The calendar and the dashboard's "next op". |
| `operation_signups(operationId, state, signedUpAt)` | Deterministic, ordered standby promotion. |
| `bgs_orders(activeFrom, activeUntil)` | "What are tonight's orders" — the dashboard's hottest BGS query. |
| `bgs_activity_reports(userId, sourceEventId)` unique | Idempotent telemetry ingestion (INV-017). |
| `hauling_contributions(userId, sourceEventId)` unique | Same, for cargo deliveries. |
| `route_jobs(paramHash, status)` | Job dedupe — two members asking for Sol→Colonia cost one upstream job. |
| `ai_tool_invocations(toolName, outcome)` | The audit UI's "show me every denied call" view. |
| `knowledge_chunks(sourceType, sourceId)` | Re-index and delete on source ACL change (INV-003) — the path that prevents the leak. |
| `telemetry_events(eventKey)` unique | Idempotency across plugin retries. |
| `notifications(userId, readAt, createdAt)` | The unread badge and the notification list. |

---

## 5 — Index review checklist

Run at each phase exit that adds queries:
- [ ] `pg_stat_user_indexes` shows every index with `idx_scan > 0` after a week of real traffic. Zero-scan indexes are write overhead — drop them.
- [ ] `EXPLAIN (ANALYZE, BUFFERS)` on the trade route query stays under 2 s on a populated database (P6 exit criterion).
- [ ] No sequential scan on `systems`, `stations` or `market_orders` in any hot path.
- [ ] The `best_trades` refresh completes well inside its 15-minute window.
- [ ] Total index size is tracked against disk headroom — on a 160 GB VPS, indexes are a material fraction of usage.
