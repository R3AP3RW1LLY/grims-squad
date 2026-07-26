# ERROR TAXONOMY

## The envelope — the only shape that leaves the API

```json
{
  "error": {
    "code": "FORUM_CATEGORY_FORBIDDEN",
    "message": "You do not have permission to view this category.",
    "requestId": "01J8ZQ7K3M9P2XRV4B6N0TDGWA",
    "details": { "requiredPermissions": ["FORUM_VIEW_OFFICER"] },
    "retryable": false,
    "retryAfterSeconds": null
  }
}
```

| Field | Rule |
|---|---|
| `code` | `SCREAMING_SNAKE`, stable forever. Clients branch on this, never on `message`. |
| `message` | Human-readable, **safe to display**, actionable where possible. Never contains a stack trace, SQL, an internal hostname, or a third party's raw error. |
| `requestId` | Correlates to the Pino log line and the OpenTelemetry trace. **Always present**, including on 500s — it is what makes a member's bug report actionable. |
| `details` | Optional, structured, machine-readable. Never free text. |
| `retryable` | Whether an identical retry could plausibly succeed. |
| `retryAfterSeconds` | Set whenever `retryable` is true and a wait is required. |

**Rules:**
1. Never leak internals. A Prisma error, a third-party 500, or an unhandled exception becomes `INTERNAL_ERROR` with a `requestId`; the detail goes to the log.
2. **Never confirm the existence of a resource the caller may not see.** A Ring 1 thread requested by a Ring 0 caller returns `404 NOT_FOUND`, not `403`. A 403 is itself an information leak (INV-002, INV-024). 403 is used only where the caller can already see that the resource exists.
3. Validation errors enumerate **every** failing field at once, not the first.
4. No bare `catch {}` (`CONVENTIONS.md`). Catch, classify, log with context, then convert.

## HTTP status mapping

| Status | Meaning here |
|---|---|
| 200 / 201 / 204 | Success |
| 202 | Accepted — an async job was created (Spansh plots, bulk telemetry) |
| 400 | Malformed or invalid request |
| 401 | No valid session |
| 403 | Authenticated, insufficient permission, **and the caller may already know the resource exists** |
| 404 | Not found, **or exists but the caller may not know that** |
| 409 | Conflict — idempotency-key mismatch, duplicate verification, version conflict |
| 410 | Gone — expired nonce, revoked token, expired confirmation |
| 422 | Semantically invalid though well-formed (e.g. an operation ending before it starts) |
| 429 | Rate limited. `retryAfterSeconds` is mandatory. |
| 500 | Unhandled. Always `INTERNAL_ERROR`. |
| 502 / 503 | An upstream dependency failed or is degraded |
| 504 | An upstream dependency timed out |

## Codes

### Authentication & session
| Code | Status | Meaning | Retryable |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | No session, or the access token expired | no — refresh first |
| `SESSION_EXPIRED` | 401 | Access token expired; a valid refresh may exist | no |
| `REFRESH_TOKEN_INVALID` | 401 | Unknown or malformed refresh token | no |
| `REFRESH_TOKEN_REUSED` | 401 | **A spent refresh token was replayed. The entire family is revoked and every session for that device is dead.** Treated as theft. | no |
| `SESSION_REVOKED` | 401 | Revoked from the device list or on Discord departure | no |
| `CSRF_TOKEN_INVALID` | 403 | Double-submit token missing or mismatched | no |
| `DISCORD_OAUTH_FAILED` | 502 | Discord rejected the code exchange | yes |
| `DISCORD_GUILD_MEMBERSHIP_REQUIRED` | 403 | Authenticated with Discord but not a member of our guild | no |

### Authorization
| Code | Status | Meaning | Retryable |
|---|---|---|---|
| `PERMISSION_DENIED` | 403 | Missing permission on a visible resource. `details.requiredPermissions` lists them. | no |
| `FORUM_CATEGORY_FORBIDDEN` | 404 | Category exists but is invisible to this caller. **404 by design.** | no |
| `RESOURCE_NOT_VISIBLE` | 404 | Generic form of the above for any ACL-bearing resource | no |
| `OWNERSHIP_REQUIRED` | 403 | The permission is held, but this row belongs to someone else | no |
| `TWO_FACTOR_REQUIRED` | 403 | Officer-tier action without 2FA on the session | no |

### CMDR verification
| Code | Status | Meaning | Retryable |
|---|---|---|---|
| `CMDR_ALREADY_CLAIMED` | 409 | Another active verification holds this CMDR name (INV-005) | no |
| `CAPI_TOKEN_EXPIRED` | 401 | **Frontier surfaces this as HTTP 422 on its side**; we normalise it here. Interactive re-auth required. | no |
| `CAPI_UNAVAILABLE` | 503 | cAPI unreachable or erroring | yes |
| `CAPI_NOT_APPROVED` | 503 | Our cAPI client is not approved yet. Offer the fallback verification path. | no |
| `VERIFICATION_NONCE_EXPIRED` | 410 | The Inara-bio nonce timed out | no — reissue |
| `VERIFICATION_NONCE_NOT_FOUND` | 422 | Nonce not present in the Inara profile yet. **Not an error state** — the UI says "not found yet, we check periodically". | yes |
| `VERIFICATION_STALE` | 403 | Verification past its 25-day life. Read access retained; this write is not. | no |

### Validation
| Code | Status | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Zod parse failed. `details.issues[]` = `{ path, code, message }` for **every** failing field. |
| `INVALID_SYSTEM_ADDRESS` | 400 | Not a valid `SystemAddress` |
| `AMBIGUOUS_SYSTEM_NAME` | 409 | Name matches multiple systems. `details.candidates[]` = `{ address, name, coords }`. **Never guess** (INV-018). |
| `UNKNOWN_COMMODITY` | 404 | No FDevIDs mapping for this name |
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | Key reused with a different body (INV-010) |
| `INVALID_LOADOUT_FORMAT` | 422 | Not a recognised Coriolis URL, EDSY URL, Coriolis JSON or journal `Loadout` |

### Forum & content
| Code | Status | Meaning |
|---|---|---|
| `THREAD_LOCKED` | 403 | Thread or category is locked |
| `POST_TOO_LARGE` | 400 | Body exceeds the configured limit |
| `UPLOAD_REJECTED` | 400 | Type, size, or re-encoding failed. `details.reason` ∈ `mime_mismatch \| too_large \| reencode_failed \| polyglot_detected`. |
| `CONTENT_FLAGGED` | 422 | Held by an automatic moderation flag |
| `USER_MUTED` | 403 | `details.until` carries the expiry |
| `USER_BANNED` | 403 | `details.appealThreadId` where one exists |

### Game data & trade
| Code | Status | Meaning | Retryable |
|---|---|---|---|
| `DATA_TOO_STALE` | 422 | Every candidate row is older than the requested `maxDataAgeDays`. **Returned rather than silently serving stale data** (INV-004). `details.oldestAvailableHours`. | no — widen the filter |
| `NO_ROUTES_FOUND` | 200 | **Not an error.** An empty result with `details.bindingConstraint` naming which filter eliminated everything. |
| `ROUTE_JOB_FAILED` | 200 | Job row reports failure; the request itself succeeded | yes |
| `UPSTREAM_UNAVAILABLE` | 503 | An adapter's circuit breaker is open. `details.source`, `details.cachedDataAgeHours` where a cached fallback is offered. | yes |
| `UPSTREAM_TIMEOUT` | 504 | Adapter timed out | yes |
| `UPSTREAM_RATE_LIMITED` | 503 | We hit a third party's limit (Inara's ~2/min). Never surfaced as the member's fault. | yes |

### Telemetry
| Code | Status | Meaning |
|---|---|---|
| `DEVICE_TOKEN_INVALID` | 401 | Unknown, malformed or revoked |
| `TELEMETRY_CATEGORY_NOT_CONSENTED` | 403 | **The category is not in the member's consent set. Rejected explicitly, never silently dropped** (INV-013). `details.rejectedCategories[]`, `details.consentedCategories[]`. |
| `TELEMETRY_BATCH_TOO_LARGE` | 400 | More than 25 events |
| `TELEMETRY_EVENT_UNKNOWN` | 200 | Unrecognised event type — accepted and ignored, counted in `details.ignored`. **Never a hard failure**: the plugin must keep working across game updates. |

### AI
| Code | Status | Meaning | Retryable |
|---|---|---|---|
| `AI_OFFLINE` | 503 | Gateway heartbeat missed 3 times. UI shows OFFLINE; read queries fall back to templates; chat queues. | yes |
| `AI_DEGRADED` | 200 | Queued. `details.queuePosition`, `details.estimatedSeconds`. Not an error. | — |
| `AI_DISABLED` | 503 | Admin kill switch active | no |
| `AI_WRITE_TOOLS_DISABLED` | 403 | Write-tools kill switch active | no |
| `AI_RATE_LIMITED` | 429 | 20/hour or 80/day exceeded. `retryAfterSeconds` mandatory. | yes |
| `AI_CONFIRMATION_REQUIRED` | 200 | **Not an error.** `details.tool`, `details.args`, `details.preview`, `details.confirmationToken`. |
| `AI_CONFIRMATION_EXPIRED` | 410 | Confirmation token timed out. Re-plan; never auto-execute. |
| `AI_TOOL_NOT_PERMITTED` | 403 | The model attempted a tool outside the caller's mask. **Audited as `denied`** — this is the boundary working, and the audit row is the proof (INV-011). | no |
| `AI_STEP_LIMIT_REACHED` | 200 | `MAX_STEPS` exhausted. Honest partial answer, never a fabricated one. |

### Infrastructure
| Code | Status | Meaning | Retryable |
|---|---|---|---|
| `RATE_LIMITED` | 429 | Per-IP or per-user limit. `retryAfterSeconds` mandatory. | yes |
| `SERVICE_DEGRADED` | 503 | A non-critical dependency is down. `details.degradedServices[]`. | yes |
| `MAINTENANCE_MODE` | 503 | Planned. `details.estimatedEndAt`. | yes |
| `INTERNAL_ERROR` | 500 | Unhandled. Generic message plus `requestId`, nothing more. | yes |

## Health endpoint semantics

`GET /v1/health` never returns 500 for a dependency failure — that would make monitoring useless and take the page down with a cache.

```json
{
  "status": "degraded",
  "version": "1.4.2",
  "checks": {
    "db":          { "status": "ok",       "latencyMs": 3 },
    "redis":       { "status": "down",     "error": "connection refused" },
    "meilisearch": { "status": "ok",       "latencyMs": 11 },
    "eddn":        { "status": "ok",       "lagSeconds": 4 },
    "gsai":        { "status": "offline",  "lastHeartbeatAt": "2026-07-25T18:02:11Z" }
  }
}
```

`status` = `ok` (all critical up) | `degraded` (a non-critical dependency is down) | `down` (Postgres unreachable). **HTTP 200 for `ok` and `degraded`; 503 only for `down`.** GSAI being offline is `degraded` at worst and never affects the site's health (INV-030).

## Client obligations

- Branch on `code`, never on `message` or status alone.
- Honour `retryAfterSeconds`; retry only where `retryable` is true, with exponential backoff and jitter.
- Show `requestId` in any error UI — it is what makes a member's report diagnosable.
- Treat `AI_CONFIRMATION_REQUIRED`, `AI_DEGRADED`, `NO_ROUTES_FOUND` and `TELEMETRY_EVENT_UNKNOWN` as normal flow, not failure.
