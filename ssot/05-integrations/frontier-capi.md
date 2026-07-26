# Frontier cAPI (Companion API)

## Role in this system
The only cryptographic proof that a browser session belongs to the Frontier account owning CMDR X — plus the source of real in-game fleet, loadouts, carrier state and carrier markets.

## Trust tier
**authoritative** — trust tier 3, the highest we issue.

## Access requirements
- **OAuth2 with PKCE (S256).** Client registration at `https://user.frontierstore.net/`.
- **Approval is discretionary and can take weeks. It may never arrive. Apply in week 1** (`STATUS.md`).
- The fallback verification path (Inara nonce, officer manual) ships regardless — **cAPI is an upgrade, never a dependency** (ADR-003).
- Reference implementation worth reading before coding: `github.com/Athanasius/fd-api`, and Ardent's `ardent-auth`.

## Base URLs
```
Authorize   https://auth.frontierstore.net/auth
Token       https://auth.frontierstore.net/token
Decode      https://auth.frontierstore.net/decode
API         https://companion.orerve.net
```
Confirm current hosts against `fd-api` before coding — Frontier has moved them historically.

## Endpoints we use
| Method | Path | Purpose | Params | Cache TTL |
|---|---|---|---|---|
| GET | `auth/auth` | Start PKCE flow | `response_type=code`, `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method=S256`, `scope=auth capi` | — |
| POST | `auth/token` | Exchange code, and later refresh | `grant_type`, `code`/`refresh_token`, `client_id`, `code_verifier`, `redirect_uri` | — |
| GET | `/profile` | Authoritative commander name, credits, current ship, ship inventory | — | per verification |
| GET | `/fleetcarrier` | Carrier state: location, fuel, services, market, docking access | — | 1 h, worker only |
| GET | `/market` | Market at the CMDR's current station | — | 15 min, worker only |
| GET | `/shipyard` | Shipyard and outfitting at the current station | — | 15 min, worker only |

## Response shapes
`GET /profile` (abridged — the real document is large):
```json
{
  "commander": {
    "id": 1234567,
    "name": "Grimshaw",
    "credits": 4123456789,
    "debt": 0,
    "currentShipId": 12,
    "docked": true,
    "rank": { "combat": 7, "trade": 8, "explore": 6, "crime": 0,
              "service": 3, "empire": 9, "federation": 8, "cqc": 1 }
  },
  "lastSystem":  { "id": 3107509474002, "name": "Shinrarta Dezhra" },
  "lastStarport":{ "id": 128666762, "name": "Jameson Memorial" },
  "ship":  { "name": "Python", "id": 12, "modules": { "...": {} } },
  "ships": { "12": { "name": "Python", "station": { "id": 128666762, "name": "Jameson Memorial" } } }
}
```

Token response:
```json
{ "access_token": "...", "refresh_token": "...", "token_type": "bearer", "expires_in": 14400 }
```

## Rate limits & etiquette
- Not publicly documented. **Be conservative**: only scheduled workers and explicit user-initiated imports call cAPI (INV-031).
- Never poll `/profile` on page load. Never call cAPI from a request path.
- One `/profile` per verification ceremony; carrier and market pulls at most hourly, and only for members who opted in.

## Failure modes
| Failure | Detection | Our response |
|---|---|---|
| **Access token expired** | **HTTP 422** — *not* 401 | Refresh using the stored refresh token. **This is the single most surprising thing about cAPI**; treating 422 as a generic client error produces a baffling bug. |
| Refresh token past ~25 days | Token endpoint rejects the refresh | Mark the verification `stale`. DM the member. **Keep read access; revoke fleet writes.** Never a hard kick. |
| Not approved yet | Client credentials rejected | `503 CAPI_NOT_APPROVED`. Offer the fallback verification path. |
| cAPI down / maintenance | timeout, 5xx, or HTML error page | Circuit opens. Verification unavailable; **everything else is unaffected** because nothing depends on a live call. |
| CMDR already claimed | our own uniqueness check | `409 CMDR_ALREADY_CLAIMED` (INV-005) |
| Game update mid-flight | shape change | Zod parse failure → typed error, alert, retain stored verification |
| PKCE verifier lost | Redis key absent after 10 min | Restart the flow. Never accept a code without its verifier. |

## Adapter interface
```ts
// packages/ed-clients/src/frontier/capi.adapter.ts
export interface IFrontierCapiProvider {
  readonly source: 'fdev_capi';
  readonly trustTier: 'authoritative';

  buildAuthorizeUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string;

  exchangeCode(input: {
    code: string; codeVerifier: string; redirectUri: string;
  }): Promise<CapiTokens>;

  /** Throws CapiRefreshExpiredError once past the ~25-day ceiling — interactive re-auth required. */
  refresh(refreshToken: string): Promise<CapiTokens>;

  /** Throws CapiTokenExpiredError on HTTP 422. Callers refresh and retry ONCE. */
  getProfile(accessToken: string): Promise<Enriched<CapiProfile>>;
  getFleetCarrier(accessToken: string): Promise<Enriched<CapiFleetCarrier | null>>;
  getMarket(accessToken: string): Promise<Enriched<CapiMarket | null>>;
}

export interface CapiTokens {
  accessToken: string;
  refreshToken: string;
  /** Absolute expiry of the ACCESS token. */
  expiresAt: Date;
  /** verifiedAt + 25 days — the hard ceiling on the refresh chain. */
  refreshExpiresAt: Date;
}
```

**Token storage is a security control:** both tokens are AES-256-GCM encrypted at rest with a key from the secret store, never plaintext, never logged (INV-012).

## Gotchas
- **Expiry surfaces as HTTP 422, not 401.** Handle it explicitly in the adapter. This is the number-one cAPI integration bug.
- **The refresh token has a hard ~25-day ceiling from the ORIGINAL authorization.** There is no rolling extension — refreshing does not restart the clock. After 25 days the member must re-authorize interactively, full stop. Every design that assumes a persistent session is wrong.
- **Therefore verification is a ceremony, not a session.** Store the *result* (`cmdrName`, `verifiedAt`, `method`, `trustTier`) durably and let it decay into a re-verify nudge. Nothing may block on a live call (INV-031).
- **Warn at day 20, degrade at day 25.** Degrading means `stale` — read retained, fleet writes revoked. Hard-kicking members for an administrative reason is how you lose them.
- **Approval may simply never arrive.** Build the fallback path first and treat cAPI as an enhancement. The phase plan explicitly forbids blocking P1 on it.
- **`/profile` returns the CMDR's *credits*.** That is real financial-ish data about a real person; it is never published without an explicit per-field opt-in (INV-027), and it is not stored at all unless the member consented.
- **The `ships` map is keyed by ship ID as a *string*.** Not an array, not numeric keys. Parse accordingly.
- **A game update can change the profile document without notice.** Zod-parse it; a shape change must degrade, not crash a worker.
- **PKCE is mandatory** — the verifier lives in Redis at 10-minute TTL and a code is never accepted without it.
- Frontier's endpoints have moved before. Pin them in config, not in code.
