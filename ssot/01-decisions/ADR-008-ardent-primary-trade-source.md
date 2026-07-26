# ADR-008 — Ardent Insight is the primary external trade/system source

**Status:** Accepted · **Date:** 2026-07-25 · **Spec origin:** §2.5, §2.8

## Context

We own our own EDDN-derived data (ADR-007), but that data starts empty, covers only our prefiltered radius, and reflects only what players have recently visited. For galaxy-wide questions — "what is Tritium worth anywhere", "where is the nearest material trader", "who imports this at the best price" — an external source with full-galaxy coverage is the difference between a working feature on day one and a feature that becomes useful in three months.

Post-EDDB the credible options are Ardent Insight, EDSM, and Spansh. They are not interchangeable: EDSM is strong on systems and bodies but not markets; Spansh is a route planner with dumps, not a query API; Ardent is the only one whose endpoint set maps close to 1:1 onto the trade terminal's feature list.

## Decision

**Ardent Insight (`api.ardent-insight.com`) is the primary external trade and system-commodity source, behind `ITradeDataProvider` / `ISystemDataProvider` (ADR-013).**

- **Anonymous** — no key, no signup, no approval lead time. It is the only major source with zero onboarding cost, which matters for a project that is already waiting on Frontier and Inara.
- **No rate limits currently enforced**, with respectful use requested. We cache aggressively anyway (6 h on commodity summaries) and treat "no limit today" as "a limit tomorrow".
- Endpoints map directly onto features: commodity min/max/avg pricing, importers by price paid, exporters by price, nearby importers/exporters within a radius, nearest station providing a service, whole-system commodity dumps.
- **Always prefer `/v2/system/address/{id}` over `/v2/system/name/{name}`.** Roughly 1,300 systems have ambiguous names; the address form is unambiguous. Name lookup is for user-facing search only, and its result is resolved to an address immediately.
- **`maxDaysAgo` defaults to 30 and is doing enormous work for data quality.** It is exposed as a first-class adapter parameter and surfaced in the UI as a freshness slider, never left implicit.
- **Every response is decorated with a computed `dataAgeHours`** before it leaves the adapter (INV-004).
- **Strategy over time:** hosted API in v1; our own EDDN collector plus their published dumps by v2. The adapter interface means this is a swap, not a rewrite.
- Their **dumps are used for seeding** our database (ADR-007, P3.5).

### Licence position
Ardent is AGPL-3.0. **Using the hosted API imposes no obligation on us.** Self-hosting an *unmodified* Ardent imposes none either. Self-hosting a *modified* Ardent and exposing it over a network would oblige us to offer the modified source to users. Our position: use the hosted API; if we ever self-host, run it unmodified or keep the fork public.

## Consequences

**Positive**
- The trade terminal has full-galaxy answers from day one, before our own collector has meaningful coverage.
- No approval lead time, so nothing in P3 or P6 is blocked on a third party's discretion.
- The AGPL question is a non-issue as long as we consume the hosted API.

**Negative / accepted costs**
- A single-operator service is a real availability risk. Mitigated by the adapter boundary, a circuit breaker, aggressive caching, and — decisively — by owning the EDDN pipeline so its absence degrades rather than breaks us.
- "No enforced rate limit" is a courtesy, not a contract. We self-limit and cache as if it were enforced.
- Ambiguous system names will bite anyone who forgets the address-first rule. It appears in the invariants (INV-015) and in the adapter's own API shape, which makes name lookup return candidates rather than a single system.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **EDDB API** | Shut down in 2023. |
| **EDSM as the primary trade source** | Excellent for coordinates, bodies and traffic — which is exactly what we do use it for — but it is not a market-pricing API. |
| **Spansh as the primary query API** | Spansh is an asynchronous *job* service for route computation plus a dump publisher. Submitting a job to answer "what does Tritium sell for" is the wrong shape entirely (ADR-013, INV-016). |
| **Inara for trade data** | ~2 req/min and requires whitelisting. Enrichment only (ADR-004). |
| **Our own EDDN data alone, no external source** | Correct destination, wrong starting point: coverage would be near-zero at P3 and thin for months. Ardent bridges exactly that gap. |
| **Self-hosting Ardent from the start** | Brings an AGPL obligation the moment we modify it, plus a second data model and service to operate, to replace an API that is free and anonymous. Revisit only if the hosted service becomes unreliable. |
| **Using `/system/name/` because it is easier** | ~1,300 ambiguous system names means silently wrong answers, and a wrong system name costs a member a 40-minute round trip. |
