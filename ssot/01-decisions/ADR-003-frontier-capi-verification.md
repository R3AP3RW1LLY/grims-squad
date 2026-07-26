# ADR-003 — Frontier cAPI is a verification ceremony, not a session

**Status:** Accepted · **Date:** 2026-07-25 · **Spec origin:** §2.2, §5.3

## Context

Discord tells us *who a person is socially*. It tells us nothing about *which CMDR they fly*. Without a verified CMDR name, the fleet register, BGS attribution, ops signups and the loadout locker are all built on self-declared free text.

The Frontier Companion API is a real OAuth2 + PKCE identity provider and is the only way to obtain cryptographic proof that a browser session belongs to the Frontier account owning CMDR X. It has three operational properties that dictate the design:

1. Access tokens are short-lived; expiry surfaces as **HTTP 422**, not 401.
2. **Refresh tokens work for at most ~25 days from the original authorization.** After that the user must re-authorize interactively.
3. Client approval is discretionary and can take weeks. It may never arrive.

## Decision

**cAPI verification is a periodic ceremony whose durable *result* is stored, not a session that pages depend on.**

- Flow: PKCE (S256) with the verifier in Redis at 10-minute TTL → Frontier authorize → exchange → `GET /profile` for the authoritative commander name → write `cmdr_verifications { userId, cmdrName, method: 'fdev_capi', trustTier: 3, verifiedAt, expiresAt = verifiedAt + 25d }`.
- **Refresh and access tokens are encrypted at rest** (AES-256-GCM, key from the secret store). Never plaintext in the database, never in logs (INV-012).
- **No page load, no API request, and no AI tool may block on a live cAPI call** (INV-018). cAPI is called by the worker, on a schedule, or by an explicit user-initiated import.
- Lifecycle worker, hourly: proactively refresh tokens approaching expiry; at `verifiedAt + 20d` DM the member via the bot; at expiry mark the verification `stale` — **keep read access, revoke writes to fleet data.** Do not hard-kick; friction loses members.
- **Three trust tiers, always recorded, never inferred:**

  | Tier | Method | Proof strength | Grants |
  |---|---|---|---|
  | 3 | `fdev_capi` | Cryptographic | Full Ring 1, cAPI fleet/carrier import |
  | 2 | `inara_nonce` | Member proved control of an Inara profile carrying our nonce | Ring 1 |
  | 1 | `officer_manual` | An officer eyeballed a screenshot | Ring 1, recorded as weakest |

- **The fallback path ships regardless of whether cAPI approval arrives.** cAPI is an upgrade, never a dependency (`STATUS.md`, P1.8).
- `cmdrName` is unique across all non-revoked verifications (INV-005) — two accounts cannot claim the same CMDR.

## Consequences

**Positive**
- BGS attribution, fleet data and ops signups rest on a verified identity for tier-3 members.
- cAPI is additionally the source of *real* in-game loadouts, fleet carrier state and carrier markets — replacing hand entry in P5 and P7.
- The project is not blocked on an external approval it does not control.

**Negative / accepted costs**
- A recurring ~monthly re-authorization prompt for tier-3 members. Softened by a 5-day warning DM and by not revoking read access on expiry.
- Mixed trust tiers across the membership forever. Any feature that cares must read `trustTier` explicitly rather than a boolean `isVerified`.
- **HTTP 422 must be handled as "token expired"** in the adapter. Treating it as a generic client error produces a baffling and hard-to-diagnose failure.
- Encrypted token columns cannot be inspected in psql during debugging. Deliberate.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **cAPI as the primary login (ADR-002 alternative)** | ~25-day token life makes it a monthly interactive ceremony just to read the forum. |
| **Persisting a cAPI session and refreshing indefinitely** | Impossible. The refresh token has a hard ~25-day ceiling from the original authorization; there is no rolling extension. |
| **Trusting a self-declared CMDR name** | Lets anyone claim any CMDR, poisoning BGS attribution and the fleet register. The entire reason this ADR exists. |
| **Inara profile as the only verification** | Inara requires app whitelisting, is rate-limited to ~2 req/min, and proves control of an Inara account rather than a Frontier one. Good enough for tier 2, not for tier 3. |
| **Blocking Ring 1 access until cAPI approval arrives** | Would stall P1 indefinitely on a third party's discretion. Rejected explicitly in the phase plan. |
| **Hard-kicking members to Ring 0 at expiry** | Friction that loses members for an administrative reason. Downgrade to `stale` with read retained instead. |
