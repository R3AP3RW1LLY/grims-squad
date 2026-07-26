# Inara

## Role in this system
A nightly, out-of-band corroboration of CMDR ranks and squadron membership, plus the polling target for tier-2 nonce verification — and nothing else.

## Trust tier
**enrichment** — never authoritative, never in a request path.

## Access requirements
- **No OAuth. No login delegation.** "Login with Inara" does not exist and cannot be built.
- A JSON-POST API taking an app name plus an app key.
- **The application must be whitelisted by Inara's operator (CMDR Artie) before the key works at all.** An unapproved app receives `400 This application has no access allowed.`
- **Lead time: days to weeks. Apply in week 1** (`STATUS.md` external dependencies).
- Request should state: app name, purpose, expected request volume, and that this is a non-commercial squadron site.

## Base URL
```
POST https://inara.cz/inapi/v1/
```
One endpoint. Everything is an "event" in the POST body.

## Endpoints we use
| Method | Path | Purpose | Params | Cache TTL |
|---|---|---|---|---|
| POST | `/inapi/v1/` event `getCommanderProfile` | CMDR ranks, squadron membership, and the profile text we search for our nonce | `searchName` | 24 h in Postgres |

**That is the entire surface.** We send no events *to* Inara — we are a consumer, not a contributor.

## Response shapes
Request envelope:
```json
{
  "header": {
    "appName": "GrimsSquadHub",
    "appVersion": "1.0.0",
    "isBeingDeveloped": false,
    "APIkey": "<key>",
    "commanderName": "<our registered CMDR>"
  },
  "events": [
    { "eventName": "getCommanderProfile",
      "eventTimestamp": "2026-07-25T18:00:00Z",
      "eventData": { "searchName": "Grimshaw" } }
  ]
}
```

Response envelope:
```json
{
  "header": { "eventStatus": 200, "eventStatusText": "OK" },
  "events": [
    { "eventStatus": 200,
      "eventData": {
        "userID": 12345,
        "userName": "Grimshaw",
        "commanderName": "Grimshaw",
        "commanderRanksPilot": [
          { "rankName": "combat", "rankValue": 7, "rankProgress": 0.42 }
        ],
        "commanderSquadron": { "SquadronID": 999, "SquadronName": "Grim's Squad",
                               "SquadronMemberRank": "Wing Leader" },
        "otherNamesFound": [],
        "inaraURL": "https://inara.cz/cmdr/12345/"
      } }
  ]
}
```

**The status you actually care about is `events[0].eventStatus`, not the HTTP status.** A `200 OK` HTTP response routinely carries a per-event failure. Checking only the HTTP status is the classic Inara integration bug.

| `eventStatus` | Meaning | Our response |
|---|---|---|
| 200 | OK | Parse and cache |
| 202 | OK, with a warning in `eventStatusText` | Parse, log the warning |
| 204 | No result — CMDR not found on Inara | Cache the negative for 24 h; **not an error** |
| 400 | Bad request, or **app not whitelisted** | Alert admins; disable the adapter until fixed |
| 429 | Rate limited | Open the circuit; back off hard |

## Rate limits & etiquette
- **~2 requests per minute** is the published guidance for tool authors. Harsher throttling for abusive apps.
- **A single global token bucket at 2 req/min across the entire application**, enforced in the adapter as a singleton (INV-033). Not per-feature limiters — several limiters cannot enforce a *global* limit.
- A 150-member sweep takes ~75 minutes. That is fine for a nightly job and it rules out any interactive "refresh now" button — so we do not build one.
- Being banned costs us the tier-2 verification path. Nothing else, which is precisely why Inara is enrichment-only.

## Failure modes
| Failure | Detection | Our response |
|---|---|---|
| Not whitelisted | `eventStatus 400` with "no access allowed" | Alert admins. Tier-2 verification unavailable; the UI explains why. Nothing else degrades. |
| Rate limited | `eventStatus 429` | Circuit opens, exponential backoff, resume next window. |
| CMDR not found | `eventStatus 204` | Cache negative 24 h. For nonce verification this is the **normal** in-progress state, not a failure — the UI says "not found yet, we check periodically". |
| Inara down | timeout / 5xx | Circuit opens. Serve cached profiles with their age. Nightly sweep resumes tomorrow. |
| Response shape changed | Zod parse failure | Typed error, alert on failure rate, cached data retained. |
| Key revoked | `eventStatus 400` | Same as not whitelisted. |

## Adapter interface
```ts
// packages/ed-clients/src/inara/inara.adapter.ts
export interface ICmdrProfileProvider {
  readonly source: 'inara';
  readonly trustTier: 'enrichment';

  /** Queued through the GLOBAL 2/min limiter. Never call from a request path (INV-033). */
  getCommanderProfile(cmdrName: string): Promise<Enriched<InaraCommanderProfile | null>>;

  /** Convenience for tier-2 verification: does the profile text contain our nonce? */
  profileContainsNonce(cmdrName: string, nonce: string): Promise<Enriched<boolean>>;
}

export interface InaraCommanderProfile {
  inaraUserId: number;
  commanderName: string;
  ranks: Array<{ rank: string; value: number; progress: number }>;
  squadron: { id: number; name: string; memberRank: string } | null;
  inaraUrl: string;
}
```
`Enriched<T>` adds `{ source, fetchedAt, dataAgeHours }` — applied in the adapter so INV-004 holds in one place.

## Gotchas
- **There is no OAuth and there never was.** If a plan says "login with Inara", the plan is wrong. This is the single most common misconception about Inara and it has cost teams weeks.
- **Whitelisting is a hard gate, not a soft one.** The key does nothing at all until approved. Test against a stub until it arrives; never build a demo that "works" only because someone hard-coded a response.
- **HTTP 200 does not mean success.** Check `events[0].eventStatus`. This will bite you exactly once, in production, on a Sunday.
- **~2 req/min is per *application*, not per key or per IP.** Every feature shares one budget. A "just this once" bypass is how the app gets throttled.
- **`isBeingDeveloped: true` in the header** flags a development app; leave it false in production or results may differ.
- **Squadron membership on Inara is self-declared and frequently stale.** It is a *corroborating signal* for officers, never an automatic action. Never auto-remove a member because Inara does not list them.
- **`otherNamesFound`** appears when the search is ambiguous. Treat a non-empty array as an ambiguous result and do not assume the first match.
- Inara stores rank *values*, not names, in some fields. Map through `packages/ed-domain`, never render a raw integer.
- **Nothing critical may depend on Inara.** If it vanished tomorrow we would lose one verification path and a nightly cross-check. That is the correct blast radius, and it is a design choice, not luck.
