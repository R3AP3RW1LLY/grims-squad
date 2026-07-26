# EXTERNAL INTEGRATIONS

Every external service sits behind an adapter interface in `packages/ed-clients` (ADR-013). **Application code never imports a vendor SDK or hits a vendor URL directly** — a lint rule enforces it and CI fails on violation.

The ED third-party ecosystem has a documented habit of disappearing. **EDDB.io — the default data source for the whole community — shut down in 2023** and broke every tool built against it. These adapters are why that becomes a one-file change here.

## The services

| Service | Trust tier | Access | Rate limit | Adapter interface | Blocks |
|---|---|---|---|---|---|
| [Discord](discord.md) | authoritative | OAuth2 app + bot token, **SERVER MEMBERS intent** | strict, per-route buckets | `IIdentityProvider` | P1 |
| [Frontier cAPI](frontier-capi.md) | authoritative | OAuth2 + PKCE, **discretionary approval** | undocumented; be conservative | `ICmdrProfileProvider` | P1.8 |
| [EDDN](eddn.md) | authoritative (for what it carries) | none — public ZeroMQ | none (it is a firehose) | `IGameDataStream` | P3.4 |
| [FDevIDs](fdevids.md) | authoritative | none — GitHub releases | n/a | `IReferenceDataProvider` | P3.3 |
| [Ardent Insight](ardent.md) | authoritative (acceleration) | none — anonymous | none enforced *today* | `ITradeDataProvider`, `ISystemDataProvider` | P3.2 |
| [EDSM](edsm.md) | enrichment | none for most endpoints | generous, unpublished | `ISystemDataProvider` | P3.3 |
| [Spansh](spansh.md) | best-effort | none | be polite — one maintainer | `IRoutePlanner` | P3.6 |
| [Inara](inara.md) | enrichment | **app whitelisting required** | **~2 req/min** | `ICmdrProfileProvider` | P1.8b |
| [Coriolis](coriolis.md) | self-hosted subsystem | none — MIT source | n/a | none (deployed, not called) | P7.1 |
| ~~EDDB~~ | **DEAD** | — | — | — | — |

> **EDDB.io shut down in 2023.** Any tutorial, plugin or Stack Overflow answer telling you to hit `eddb.io/api` is stale. It appears in this table only so nobody re-discovers it and thinks it was an oversight.

## Failure policy — uniform across every adapter

| Aspect | Rule |
|---|---|
| **Timeout** | Every call has one. Default 10 s; Spansh submission 30 s; never unbounded. |
| **Retry** | Exponential backoff with **jitter**, max 3 attempts, only on 5xx/timeout/connection errors. **Never retry a 4xx** — it will fail identically and burns a rate-limit budget. |
| **Circuit breaker** | Opens after 5 consecutive failures; half-open probe after 60 s. Open circuit → serve cache with its age, or an explicit "source unavailable". |
| **Degradation** | A typed degraded result, never an exception reaching a user. The UI says *"Ardent unavailable — showing data from 6 hours ago"*, never a 500. |
| **Freshness** | Every response is decorated with `source`, `fetchedAt`, `dataAgeHours` **inside the adapter**, so INV-004 holds in one place rather than at every call site. |
| **Caching** | TTL per the table below. A cache miss on an open circuit returns stale-with-age or nothing — it never triggers a synchronous fetch. |
| **Validation** | Every response Zod-parsed at the adapter boundary. A shape change becomes a typed error and an alert, not a downstream crash. |
| **Fakes** | Every adapter has a fake in the same package. Tests never touch the network. Swapping the fake in must need zero application changes — that is the proof the abstraction is real. |
| **`@unverified`** | An adapter written from documentation but not yet exercised live is marked `@unverified` and listed in `STATUS.md`. **A phase cannot exit with `@unverified` adapters in its scope.** |
| **Logging** | Every outbound call logs method, host, latency, status and cache outcome — never the payload, never a token. |

## Cache TTLs

| Data | Store | TTL | Invalidated by |
|---|---|---|---|
| Permission masks | Redis | 5 min | `guildMemberUpdate`, role/mapping change |
| Ardent commodity summary | Redis | 6 h | scheduled refresh |
| Ardent system lookup | Redis + PG | 24 h / persistent | EDDN write |
| EDSM system/bodies | Redis + PG | 24 h / persistent | EDDN write |
| Market orders | PG | live | EDDN write |
| Spansh job results | PG + object storage | 7 d | param-hash dedupe |
| Inara profiles | PG | 24 h | nightly worker |
| GalNet | Redis | 1 h | — |
| FDevIDs reference | PG | until the next release | monthly job |
| cAPI profile | PG | per verification | 25-day ceremony |

## The three rules that matter most

1. **`SystemAddress` over system name, everywhere.** ~1,300 systems have ambiguous names. Any lookup starting from a name resolves to an address before use, and an ambiguous name returns *candidates* — never a guess (INV-018). A wrong system name costs a member a 40-minute round trip.
2. **Never block a request path on a third party.** Inara is nightly (INV-033). cAPI is scheduled or user-initiated (INV-031). Spansh is submit-and-poll (INV-032). These are invariants, not preferences.
3. **Never surface a price without its age.** Every market value is player-reported through EDDN and may be stale. Freshness travels with the data from the adapter to the UI to the AI's tool result (INV-004).
