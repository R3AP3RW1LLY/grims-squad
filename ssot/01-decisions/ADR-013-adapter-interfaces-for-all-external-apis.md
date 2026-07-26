# ADR-013 — Every external API sits behind an adapter interface

**Status:** Accepted · **Date:** 2026-07-25 · **Spec origin:** §3.3, §2.3, §16

## Context

The Elite Dangerous third-party ecosystem has a documented habit of disappearing. **EDDB.io — for years the default data source for the entire community — shut down in 2023**, breaking every tool built directly against its API. Ardent is a single maintainer. Spansh is a single maintainer. Inara can revoke an app key. Frontier can decline or withdraw cAPI access.

Any of these going away must cost us a file, not a rewrite.

## Decision

**`packages/ed-clients` defines the interfaces. Application code depends on the interface and never on a vendor.**

```
ISystemDataProvider    systems, coordinates, stations, services, bodies
ITradeDataProvider     commodity prices, importers, exporters, market snapshots
ICmdrProfileProvider   CMDR ranks, squadron membership, verification signals
IRoutePlanner          async route jobs (neutron, galaxy, carrier, riches, tourist)
INewsProvider          GalNet
IReferenceDataProvider FDevIDs internal→display name mapping
```

**Rules, all enforced:**
1. **No application code imports a vendor SDK or hits a vendor URL directly.** A lint rule restricts vendor HTTP clients to `packages/ed-clients`, and CI fails on violation.
2. **Every adapter has: typed inputs and outputs (Zod-validated at the boundary), retry with exponential backoff and jitter, a circuit breaker, a timeout, and a documented cache TTL.** Not optional per-adapter.
3. **Every adapter is documented in `05-integrations/<service>.md` in an identical structure** — role, trust tier, access requirements, endpoints, response shapes, rate limits, failure modes, adapter interface, gotchas.
4. **Every adapter decorates its output with provenance and freshness** (`source`, `fetchedAt`, `dataAgeHours`) before returning. INV-004 depends on this happening in one place rather than at each call site.
5. **Every adapter has a fake** in the same package, used by tests. Swapping the fake in must require zero application changes — that is the proof the abstraction is real (task P3.1).
6. **Adapters written from documentation but not yet exercised against the live service are marked `@unverified`** and listed in `STATUS.md`. A phase cannot exit with `@unverified` adapters in its scope.
7. **Failure is a typed, degraded result, not an exception that reaches a user.** Circuit open → serve cache with its age, or return an explicit "source unavailable" the UI can render honestly.
8. **Async-by-shape where the vendor is async.** `IRoutePlanner` has no synchronous method at all, because Spansh is a job-submit-and-poll service (INV-016). The interface makes the wrong thing unrepresentable.

**Trust tiers are a property of the source and are recorded in the interface contract:** `authoritative` (cAPI, FDevIDs, EDDN, our own DB), `enrichment` (Inara, EDSM), `best-effort` (Spansh, Ardent as an acceleration layer).

## Consequences

**Positive**
- The EDDB scenario becomes a one-file change plus a data backfill.
- Retry, backoff, circuit breaking, caching and freshness decoration are written once and cannot be forgotten at a call site.
- Tests never touch the network, which makes them fast, deterministic, and runnable in CI without secrets.
- Provider substitution is a real option: our own EDDN data can quietly become the `ITradeDataProvider` implementation as coverage grows (ADR-007, ADR-008), with no caller changes.

**Negative / accepted costs**
- **Interfaces are lowest-common-denominator by nature.** A vendor-specific capability that no interface expresses either goes unused or forces an interface change. Accepted: we would rather lose a niche feature than a working product.
- Boilerplate. Every adapter needs its fake and its documentation page.
- An extra indirection when debugging: "why is this response shaped like this" now has two places to look.
- Discipline is required. The lint rule exists because good intentions do not survive a deadline.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Call vendor APIs directly from services** | Exactly what broke every EDDB-dependent tool in 2023. Also scatters retry, caching and freshness logic across the codebase, guaranteeing it is inconsistent. |
| **A single generic `IEdDataProvider`** | One interface for markets, systems, profiles, routes and news would be enormous and mostly unimplemented by any given vendor. Segregate by capability. |
| **Adapters without fakes** | Tests then require network access and vendor availability, so they are slow, flaky, and quietly skipped. The fake *is* the proof the abstraction holds. |
| **Throwing on adapter failure and handling it upstream** | Produces 500s in a UI for a third party's outage. Degraded typed results let the UI say "Ardent unavailable, showing data from 6 hours ago". |
| **A synchronous convenience wrapper around Spansh** | Would hide a tens-of-seconds job behind a method call and reintroduce the blocking pattern the design forbids. The interface is async because the service is. |
| **Deferring the abstraction until a second provider exists** | The abstraction's value is realised precisely when a provider vanishes without notice — which is when there is no time to build it. |
