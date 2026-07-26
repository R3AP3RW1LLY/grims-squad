# RETENTION

What is kept, for how long, and what deletes it. Every row here is enforced by a scheduled job or a database policy — **a retention rule with no enforcing job is a comment**, and unbounded growth on a 160 GB VPS is a real failure mode, not a theoretical one.

## Policy table

| Data | Retention | Enforced by | Rationale |
|---|---|---|---|
| `audit_log` | **1 year** | `retention:audit` nightly | Long enough to investigate a dispute or a breach; short enough to bound growth. Append-only — application code never updates or deletes a row. |
| `ai_conversations`, `ai_messages` | **90 days**, user-deletable sooner | `retention:ai` nightly | Members are entitled to a short memory of their own chats. Officers may review within the window. Encrypted at rest throughout. |
| `ai_tool_invocations` | **1 year** | `retention:audit` nightly | Kept longer than conversations because it is an audit trail, including denials (INV-009). Arguments are retained; results are not. |
| `telemetry_events` (raw) | **30 days, AND only once `processed_at` is set** | `retention:telemetry` nightly | Raw journal events are the most privacy-sensitive data we hold. Aggregates survive; the raw stream does not. **The `processed_at` condition is a data-loss control** — see below. |
| Telemetry-derived aggregates (`bgs_activity_reports`, `hauling_contributions`, ship/loadout state) | **indefinite** | — | These are squadron records, not surveillance. They contain no location trail. |
| `market_orders` | **current state only** | upsert-in-place | Superseded rows are overwritten, never accumulated. |
| `market_history` | **90 days** | **TimescaleDB `add_retention_policy`** (decision D10) — *not* a nightly job | Sparklines need three months. Timescale drops whole chunks rather than deleting rows, and compresses anything older than 7 days. **Do not also run a `retention:market` job — the two would race.** |
| `route_jobs` + stored results | **7 days** | `retention:jobs` nightly | Long enough for dedupe to pay off, short enough that object storage stays trivial. |
| `refresh_tokens` | **until `expiresAt` + 7 days** | `retention:sessions` hourly | The grace window preserves reuse detection after natural expiry. |
| `refresh_token_families` | **90 days after revocation** | `retention:sessions` nightly | Revoked families are evidence of a possible theft event; keep them briefly. |
| `idempotency_keys` | **24 hours** | `retention:idempotency` hourly | Longer than any realistic client retry. |
| `notifications` | **90 days**, or 30 days once read | `retention:notifications` nightly | |
| `post_revisions` | **indefinite** | — | Edit history is a moderation tool. Purged with the post on a hard-delete request. |
| Forum posts and threads | **indefinite, soft-deleted** | — | Never hard-deleted by user action (INV-022). Hard deletion happens only via a GDPR erasure request. |
| Uploaded images | **lifetime of the post** | `retention:orphans` weekly | Orphaned uploads (no referencing post after 24 h) are removed. |
| `knowledge_chunks` | **lifetime of the source** | RAG re-index jobs | Deleted or re-indexed when the source is deleted or its ACL changes. A chunk whose source cannot be resolved is deleted, never retained (INV-003). |
| `content_reports` | **1 year after resolution** | `retention:moderation` nightly | |
| `moderation_actions` | **indefinite** | — | Bans and their reasons must outlive the ban. |
| Backups | **30 days** | backup rotation | Restore-tested monthly (`09-runbooks/backup-restore.md`). |
| Application logs (Loki) | **30 days** | Loki retention | |
| Metrics (Prometheus) | **90 days** | Prometheus retention | |

### The telemetry purge must not outrun the derivation worker

An earlier revision purged raw telemetry unconditionally at 30 days. If the derivation worker
stalls — a poison payload crash-loop, or a game update adding an event type it has no handler for
(which the endpoint correctly accepts and stores) — the rows sit with `processed_at IS NULL`, and
on night 31 the purge deletes them. The job then reports **success**, because deleting rows is its
success signal and the only tuned alert points the other way ("a job that deletes zero rows for a
week is broken"). A month of members' BGS and hauling contributions is gone irrecoverably, and the
gap is discoverable only months later by someone noticing an activity type with no rows for a date
range (DATA-INTEGRITY B7).

```sql
DELETE FROM telemetry_events
WHERE received_at < now() - INTERVAL '30 days'
  AND processed_at IS NOT NULL;          -- never purge unprocessed
```

**Alert — this one matters more than the purge:** any `telemetry_events` row with
`processed_at IS NULL` older than 7 days. That is a stalled worker, and it is the last warning
before the data would have been silently destroyed.

### The un-track sweep for `systems`

The prefilter's third clause is "anything a member queried in the last 30 days". Without an
expiry the tracked set only ever grows: every member browsing systems, every AI briefing, every
far-origin trade query permanently widens ingestion, and the >95% saving decays to zero on a
160 GB disk (ARCH-ADV A3).

```sql
UPDATE systems SET is_tracked = false
WHERE is_tracked = true
  AND last_queried_at IS NOT NULL
  AND last_queried_at < now() - INTERVAL '30 days'
  AND address NOT IN (SELECT home_system FROM tracked_factions WHERE home_system IS NOT NULL)
  AND address NOT IN (SELECT system_address FROM bgs_orders WHERE active_until IS NULL
                                                              OR active_until > now());
```

Systems inside the home radius and tracked BGS systems are never un-tracked — only the
query-driven third clause expires. `market_orders` for un-tracked systems are then eligible for
deletion by the same job.

### `market_orders` — delisted commodities are not "current state"

`market_orders` is documented as current state only, but an upsert-only collector can never remove
a row for a commodity a market has **stopped carrying**. EDDN `commodity/3` messages carry the
market's *full* list; a commodity that disappears from the list is simply not upserted, so the old
row survives with its old `updated_at` — inside every freshness filter, rendered amber, INV-004
fully satisfied because the age shown is truthful (DATA-INTEGRITY B6).

**On every commodity message, delete rows for that `market_id` absent from the message**, in the
same transaction as the upsert:

```sql
DELETE FROM market_orders
WHERE market_id = $marketId AND commodity <> ALL($commoditiesInMessage);
```

Without it, members are routed to markets that no longer trade the commodity, and the ghost rows
are counted against the disk budget as "current state".

## Member-initiated data rights

Implemented as endpoints, not as a manual process (`constraints.md`, J11).

| Right | Behaviour |
|---|---|
| **Export** | JSON archive of everything held about the member: profile, roles, verifications (tokens excluded), forum content, ships, loadouts, ops history, BGS reports, telemetry aggregates, AI conversations, audit rows where they are the actor. |
| **Revoke telemetry** | Device token revoked immediately. A purge of that member's raw telemetry events is offered and, if accepted, executed inside 24 h. |
| **Erasure on departure** | Full purge offered. **Default is anonymisation, not deletion**: the user row becomes a tombstone, forum posts are reattributed to a "former member" placeholder, and thread coherence is preserved. Full deletion is available on explicit request. |
| **Correction** | Profile fields are member-editable. Verification records are not — a wrong CMDR verification is revoked and re-done, so the history stays truthful. |

**What survives an erasure request, and why:** `audit_log` and `moderation_actions` rows referencing the member are retained with the actor reference nulled. Retaining a factual record that a moderation action occurred is a legitimate interest and does not identify the person once the reference is removed.

## Growth model and the disk budget

The VPS has 160 GB. The dominant consumers:

| Consumer | Without controls | With the controls above |
|---|---|---|
| `systems` + `stations` (full galaxy) | ~40–60 GB | ~2–5 GB inside the prefilter radius |
| `market_orders` (full galaxy) | ~20–40 GB and rising | ~3–8 GB inside the radius |
| `market_history` (full galaxy, unbounded) | **unbounded** | ~5–15 GB at 90 days inside the radius |
| `telemetry_events` | grows with membership | small at 30 days |
| `knowledge_chunks` + HNSW | grows with content | ~1–3 GB |
| Indexes | ~30–40% of table size | same ratio, smaller base |

**The radius prefilter (decision D4) is the single biggest lever** — a >95% storage saving (ADR-007). Without it, the disk fills and the collector stops; with it, the target is comfortably under 50 GB.

## Alerting

| Condition | Threshold | Action |
|---|---|---|
| Disk usage | > 80% | Alert `#site-alerts`. Do not wait for 95%; a full disk fails the restart too. |
| `market_history` row count growth | > 20% week-on-week | Investigate — usually the prefilter has been widened or bypassed. |
| Any retention job failed | any | Alert. A silently failing retention job is invisible until the disk is full. |
| Backup failed or unverified | > 48 h | Alert. |
| Restore test not run | > 30 days | Alert. **An untested backup is a rumour.** |

## Implementation notes

- Retention jobs are BullMQ repeatables in `apps/worker`, each idempotent and each emitting a metric of rows deleted. **A job that deletes zero rows for a week is either broken or the policy is wrong** — both warrant investigation.
- Deletes are batched (`DELETE ... WHERE ... LIMIT n` in a loop) so a long-running purge never holds a lock that blocks ingestion.
- **`audit_log` purging requires elevated database privileges** the application role does not hold, so an application-level bug cannot erase the audit trail.
- Every retention job writes an `audit_log` row recording what it purged and how much.
