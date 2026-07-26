# ADR-007 — Run our own EDDN collector; own the data layer

**Status:** Accepted · **Date:** 2026-07-25 · **Spec origin:** §2.4, §6.3, §13.4

## Context

Every feature that matters — the trade terminal, BGS influence tracking, system and commodity pages, carrier markets — needs current galaxy data. Two ways to get it: query someone else's API on demand, or subscribe to the source.

The Elite Dangerous Data Network is a free ZeroMQ pub/sub relay at `tcp://eddn.edcd.io:9500` carrying zlib-compressed, player-submitted journal events: market snapshots, outfitting, shipyard, FSS scans, docking, carrier jumps. **Every major site — Inara, EDSM, Spansh, Ardent — is downstream of it.** EDDB, which was also downstream of it, shut down in 2023 and took every application built on its API with it.

## Decision

**Subscribe to EDDN directly and maintain our own systems / stations / market database. External APIs are acceleration, never the foundation.**

Design rules, all mandatory (see `05-integrations/eddn.md` for the full contract):

- **Batch writes.** Accumulate 500 rows or 2 seconds, whichever first, then one `INSERT … ON CONFLICT DO UPDATE`. Single-row inserts from the firehose put the database irrecoverably behind within an hour.
- **Idempotent upserts** keyed on `(marketId, commodity)`; **discard any message older than the stored `updatedAt`** (INV-014). Messages arrive out of order.
- **Backpressure by value.** When the write queue exceeds threshold, shed low-value schemas (outfitting, shipyard) before high-value ones (commodity, journal). Never shed silently — emit a metric.
- **Radius prefilter.** Ingest only systems within a configured radius of home, plus tracked BGS systems, plus anything a member has queried in the last 30 days. This is a >95% storage saving and is what keeps us inside a 160 GB disk (decision D4 sets the radius).
- **Seed from dumps.** Bootstrap systems and stations from Spansh's galaxy dump and/or Ardent's downloads rather than waiting weeks for organic EDDN coverage. Idempotent and resumable.
- **Retention.** `market_orders` holds current state only; `market_history` is capped at 90 days (or Timescale compression — decision D10).
- **Version-tolerant parsing with a dead-letter queue** and an alert on parse-failure rate. Schemas change without notice.
- **Live galaxy only.** Filter out beta/alpha game versions.
- **Singleton service, resumable.** A few seconds of gap on deploy is fine; silent data loss is not.

## Consequences

**Positive**
- No rate limits, no API key, no dependency on anyone's uptime for the data our core features need.
- The route optimiser (P6) runs as SQL against local tables and can return in under 2 s — impossible against a remote API.
- If Ardent or Spansh disappears, we lose acceleration and convenience, not the product.
- We can compute things nobody else will, such as carrier-aware routing against *our* carriers.

**Negative / accepted costs**
- **Disk is now a live operational concern.** Without the prefilter, growth is unbounded. `09-runbooks/` and the alerting thresholds exist for this.
- Coverage is only as good as the last CMDR who docked somewhere. **Every price we surface carries its age** (INV-004) — this is not optional politeness, it is the difference between a useful tool and one that lies.
- We own a singleton, always-on ingestion service with its own failure modes: silence, backlog, parse-failure spikes. Hence `09-runbooks/incident-eddn-stalled.md`.
- Schema changes upstream will break parsing eventually. The dead-letter queue converts that from data loss into a triage item.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Query Ardent/EDSM per request instead of holding data** | Puts a third party in every hot path, imports their rate limits and latency into ours, and makes the route optimiser impossible. Also the exact posture that killed everything built on EDDB. |
| **Build on the EDDB API** | EDDB shut down in 2023. Any tutorial saying otherwise is stale. |
| **Self-host Ardent's collector instead of writing our own** | Ardent is AGPL-3.0; self-hosting a *modified* copy over a network obliges us to publish our fork. More importantly it brings a whole second data model and service to operate for a component that is ~150 lines of our own. We do use Ardent's *dumps* for seeding, which imposes nothing. |
| **Consume EDDN through a third-party HTTP mirror** | Reintroduces the single point of failure we are removing. |
| **Ingest the entire galaxy with no prefilter** | Exceeds the 160 GB VPS disk and blows the budget ceiling in `constraints.md`. |
| **Keep full market history indefinitely** | Unbounded disk growth for a feature (price sparklines) that only needs 90 days. |
| **Single-row inserts, "optimise later"** | The collector falls behind within an hour and never recovers. This is a design requirement, not a performance tweak. |
