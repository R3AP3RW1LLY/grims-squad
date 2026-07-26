# ADR-004 — Inara is a nightly enrichment source, never a request-path dependency

**Status:** Accepted · **Date:** 2026-07-25 · **Spec origin:** §2.1, §2.9

## Context

Inara is the most prominent third-party ED site and the obvious first thought for "get CMDR ranks and squadron membership". Three facts constrain how it can be used:

1. **It has no OAuth provider and no login delegation.** The API is a JSON-POST endpoint taking an app key plus events.
2. **The application must be whitelisted by Inara's operator (CMDR Artie)** before the key functions at all. An unapproved app receives `400 This application has no access allowed.` Lead time is days to weeks.
3. **Rate limits are tight, per-app, and enforced** — published guidance for tool authors is on the order of **~2 requests per minute**, with harsher throttling for abusive apps.

## Decision

**Inara is `enrichment` trust tier. It runs on a schedule, out of band, cached, and nothing in a request path may depend on it.**

- The only endpoint we use is `getCommanderProfile`, for a CMDR's ranks and squadron membership.
- **Uses, all asynchronous:**
  - Nightly corroboration: "is this member actually listed in Grim's Squad on Inara?" — a signal for officers, never an automatic action.
  - The tier-2 verification fallback: the member places our nonce (e.g. `GRIM-7X2Q`) in their Inara bio; a worker polls for it (ADR-003).
  - Optional profile enrichment on the member dossier, clearly labelled with its source and age.
- **A global token-bucket limiter at 2 requests/minute across the whole application**, enforced in the adapter, not by convention. Every call goes through one queue; there is no second code path.
- Results cached in Postgres for 24 h. A cache miss returns stale-with-age or nothing — it never triggers a synchronous fetch.
- If whitelisting is denied or revoked, **every dependent feature degrades to "unavailable", and nothing else breaks.**

## Consequences

**Positive**
- No feature can be taken down by Inara's availability, rate limiting, or a revoked key.
- The 2 req/min budget is spent deliberately (nightly sweep, verification polls) rather than burned by page loads.
- Denial of whitelisting is a Low-impact risk, which is why it appears as such in the risk register.

**Negative / accepted costs**
- A squadron of 150 members takes ~75 minutes to sweep at 2 req/min. Acceptable for a nightly job; it rules out any interactive "refresh my Inara data now" button, which we therefore do not build.
- Inara-sourced data on a profile can be up to 24 h stale and must be labelled as such.
- Tier-2 verification is not instant — the member sets the nonce and the worker finds it on the next poll. The UI must say so.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **"Login with Inara"** | Does not exist. No OAuth provider, no login delegation. Impossible, not merely unwise. |
| **Inara as the authoritative squadron roster** | Membership on Inara is self-declared and frequently stale. Discord roles are the roster (ADR-002). |
| **Calling Inara on profile page load with a short cache** | A page view would consume the global rate budget, and a burst of views would get us throttled or banned. |
| **Scraping the Inara website instead of using the API** | Against the spirit of the operator's terms, brittle, and would justifiably get us blocked. |
| **Skipping Inara entirely** | The nonce-in-bio flow is the only tier-2 verification path that works without cAPI approval, and it is genuinely useful as an officer-facing cross-check. Keeping it costs one adapter and one nightly job. |
| **Per-feature rate limiters** | Multiple limiters cannot enforce a *global* 2 req/min. One queue, one bucket, no exceptions. |
