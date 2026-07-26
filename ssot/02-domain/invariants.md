# INVARIANTS

Rules that must **always** hold. Every one is checkable by a test.

**Binding rule (ADR-016):** each invariant has at least one test tagged `@INV-nnn`. `pnpm test:invariants` runs that suite alone and is a required CI job. **An invariant without a passing tagged test is an unbuilt invariant** — CI fails if any number below has no tagged test.

Severity: `SEC` = security; violating it is a breach. `DATA` = data integrity; violating it silently corrupts. `TRUST` = member trust; violating it makes the product lie. `OPS` = availability.

---

## Authorization

**INV-001** `SEC` · A user's effective permission mask equals `OR(masks of all granted roles) AND NOT user.denyMask`. **No other mechanism grants permission** — not a controller special case, not a config flag, not an `isAdmin` boolean.
*Test:* a user with two roles and a deny bit for a permission one role grants resolves to that permission absent.

**INV-002** `SEC` · A query executed on behalf of a user **MUST NOT** return rows from an ACL-bearing record whose `viewPerm` the user's mask does not satisfy — **enforced in the data layer, not the controller**.
*Test:* call the repository directly (bypassing every controller and guard) as a Ring 0 principal and assert zero Ring 1 rows returned.

**INV-003** `SEC` · `knowledgeChunk.visibility` always equals the visibility of its source record **at time of query**. An ACL change on the source re-indexes or deletes its chunks before the source's next retrieval.
*Test:* move a thread from a public to an officer category; assert no public-visibility chunk for it survives, and that a Ring 0 retrieval returns zero rows.

**INV-004** `TRUST` · **No market-derived value is displayed, returned by an API, or handed to a model without an accompanying data age.** Applies to UI, REST responses, AI tool results, Discord messages and templated fast-path answers alike.
*Test:* every response schema carrying a price also carries `dataAgeHours`; a snapshot test over the trade endpoints asserts it is present and non-null.

**INV-005** `DATA` · `cmdrVerification.cmdrName` is unique across all rows where `revokedAt IS NULL`. Two accounts cannot simultaneously claim one CMDR.
*Test:* attempt a second active verification for the same CMDR name; assert a constraint violation.

**INV-006** `SEC` · A permission mask is never truncated. It is stored as `NUMERIC(40,0)`, transported as a decimal string, and handled as `bigint`. **No code path converts a mask to a JavaScript `number`.**
*Test:* round-trip `SITE_CONFIG` (`1n << 63n`) through storage, JSON and back; assert exact equality.

**INV-007** `SEC` · Deny beats grant, always and last. Adding a role that grants a permission a user is explicitly denied does not grant it.
*Test:* as above from the deny direction, for every permission group.

**INV-008** `SEC` · Discord role → internal role mappings are **data** (`role_mappings`), never hard-coded identifiers in application code.
*Test:* grep/lint assertion that no Discord snowflake literal appears outside seed and test fixtures.

**INV-009** `SEC` · Every privileged action writes an `audit_log` row with actor, action, target and before/after: role changes, moderation, BGS orders, config changes, and **every AI tool invocation including denied ones**.
*Test:* for each privileged endpoint, assert exactly one audit row with a populated diff; for a denied AI tool call, assert an audit row with `outcome = 'denied'`.

**INV-010** `SEC` · Every mutating API endpoint accepts an idempotency key and, on replay of the same key with the same body, returns the original result without repeating the side effect.
*Test:* POST twice with one key; assert one database mutation and identical responses.

## AI boundary

**INV-011** `SEC` · The tool list presented to the model is filtered by the caller's permission mask **before serialisation**. The model is never shown a tool it may not call, and the executor re-checks permission independently before execution.
*Test:* build a request as a Ring 0 caller; assert `set_bgs_order` appears nowhere in the outgoing payload, and that a forged call to it is refused and audited.

**INV-012** `SEC` · OAuth refresh tokens, cAPI tokens and device tokens are **encrypted at rest** (AES-256-GCM, key from the secret store) and never appear in logs, error messages, audit rows or API responses.
*Test:* write a token, read the raw column, assert the plaintext is absent; assert a log-scrubbing test over a payload containing a token.

**INV-013** `SEC` · Telemetry is opt-in per category, defaults to off, and **consent is enforced server-side**: an event in a non-consented category is **rejected with an explicit error**, never silently discarded.
*Test:* post an event in a non-consented category; assert a 4xx with the documented error code and zero rows written.

**INV-014** `SEC` · A mutating AI tool never executes without explicit human confirmation of that specific call. `grant_role` requires two-step confirmation. No exception for convenience, permission level, or an "obviously safe" argument set.
*Test:* invoke each mutating tool without a confirmation token; assert `needsConfirmation` and no side effect.

**INV-015** `SEC` · Authorization for AI actions is enforced in the executor and the API, **never in the system prompt**. A prompt injection carried in retrieved content cannot invoke a tool the caller lacks permission for.
*Test:* inject an instruction into indexed forum content telling the model to call an unpermitted tool; assert refusal plus a `denied` audit row.

**INV-016** `SEC` · GSAI reads squadron data only by calling back to the API with the caller's signed context. **The agent has no direct database connection and no local replica.**
*Test:* assert the agent runtime's configuration contains no database URL; assert the egress allowlist rejects anything outside Ollama-localhost, our API, and the whitelisted ED APIs.

## Data integrity

**INV-017** `DATA` · EDDN and telemetry upserts are idempotent and **discard any message whose observation timestamp is older than the stored `updatedAt`**. Out-of-order arrival never moves data backwards.
*Test:* apply a newer then an older market message for one `(marketId, commodity)`; assert the newer value survives.

**INV-018** `DATA` · `SystemAddress` (BigInt) is the canonical key for a system. Names are for display and search only. Any lookup that begins with a name resolves to an address before use, and an ambiguous name returns candidates rather than a guess.
*Test:* resolve a known ambiguous name; assert multiple candidates and no arbitrary selection.

**INV-019** `DATA` · A faction's influence for a given system and tick is recorded **once**. Multiple EDDN reports of the same tick are deduplicated, never summed or averaged into a second row.
*Test:* feed three reports of one tick for one faction/system; assert exactly one snapshot associated to that `tickId`.

**INV-020** `DATA` · Commodity, module and ship names shown to a user are **display names resolved through FDevIDs**. An internal name never reaches a user-facing surface.
*Test:* assert every commodity row resolves to a display name; assert a rendering test fails on an unmapped internal name.

**INV-021** `DATA` · Credits, `SystemAddress` and `MarketId` are `BigInt` end to end. No path converts them to `number`.
*Test:* round-trip a value above 2^53 through API and database; assert exact equality.

**INV-022** `DATA` · Forum content is **soft-deleted**. A deleted post leaves a moderator-visible tombstone and remains recoverable; it never disappears from the database on a user action.
*Test:* delete a post; assert `deletedAt` set, row present, invisible to a non-moderator, visible with tombstone to a moderator.

**INV-023** `DATA` · Every external adapter response carries provenance and freshness (`source`, `fetchedAt`, `dataAgeHours`) attached inside `packages/ed-clients`, not at the call site.
*Test:* for each adapter's fake, assert the decoration is present on every returned shape.

## Trust & correctness

**INV-024** `TRUST` · Search results are ACL-filtered **in the query**, never after retrieval. A Ring 0 search for a term appearing only in Ring 2 content returns **zero** results — not a redacted result, and not a result count.
*Test:* index a unique token in a Ring 2 post; search as Ring 0; assert zero hits, zero facet counts, and no pagination total revealing existence.

**INV-025** `TRUST` · Every user-facing time renders **both** the viewer's local time and UTC. Elite runs on game time; a bare local time is a defect.
*Test:* render an operation for a viewer in a non-UTC zone; assert both are present.

**INV-026** `TRUST` · Trade route results account for `distanceToArrivalLs` and landing-pad size, and **exclude fleet carriers unless explicitly included**. Carrier prices distort results and their availability is not guaranteed.
*Test:* a route query with default parameters returns no carrier markets and no station beyond the requested max Ls.

**INV-027** `TRUST` · A member's location, credit balance and fleet are never present in a public API response unless that member has explicitly opted in **for that specific field**. Absent, not merely hidden by the UI.
*Test:* set every privacy toggle to private; assert the fields are absent from the public serialisation, not null.

**INV-028** `TRUST` · GSAI never presents a market fact without its age, and never asserts a system, station, commodity or CMDR name it did not obtain from a tool.
*Test:* the tool-result contract requires freshness fields; an evaluation set asserts freshness is relayed in generated answers.

**INV-029** `TRUST` · The Frontier non-commercial attribution notice is present on every rendered page.
*Test:* a rendering test asserts the notice in the footer of the public and authenticated layouts.

## Availability & operations

**INV-030** `OPS` · **No page load, API request or non-GSAI background job depends on the local AI box.** With the box powered off, every non-AI feature works and GSAI reports `OFFLINE` honestly.
*Test:* integration run with the gateway unreachable; assert full functionality and an `OFFLINE` status with a templated fallback for read queries.

**INV-031** `OPS` · No request path performs a synchronous Frontier cAPI call. cAPI is exercised only by scheduled workers and explicit user-initiated imports.
*Test:* assert no cAPI client call originates from a request-scoped provider.

**INV-032** `OPS` · No request path performs a blocking Spansh call. Route planning is submit-job → poll → WebSocket push, always.
*Test:* assert `IRoutePlanner` exposes no synchronous method and that the trade plot endpoint returns a job identifier without awaiting a result.

**INV-033** `OPS` · Inara is called at most twice per minute **globally**, through one shared limiter, and never from a request path.
*Test:* issue 10 concurrent adapter calls; assert dispatch spacing ≥30 s and that the limiter is a singleton.

**INV-034** `OPS` · The EDDN collector writes in batches and is resumable. A restart loses no acknowledged message and produces no duplicate row.
*Test:* kill mid-batch, restart, assert row counts and no duplicates.

**INV-035** `OPS` · All user-supplied HTML is sanitized **server-side** before storage and served under a strict CSP with nonces and `frame-ancestors 'none'`.
*Test:* the XSS suite — script tags, event handlers, `javascript:` URLs, SVG payloads, polyglot uploads — all neutralised; CSP headers asserted.

**INV-036** `OPS` · No secret, key or token appears in the repository. `.env.example` contains placeholders only.
*Test:* gitleaks over the working tree and full history, in CI, blocking.

---

## Coverage map — invariant to phase

| Phase | Invariants that must be proven before exit |
|---|---|
| P0 | INV-006, INV-036 |
| P1 | INV-001, INV-002, INV-005, INV-007, INV-008, INV-009, INV-010, INV-012, INV-027, INV-029, INV-031 |
| P2 | INV-022, INV-024, INV-035 |
| P3 | INV-004, INV-013, INV-017, INV-018, INV-020, INV-021, INV-023, INV-032, INV-033, INV-034 |
| P4 | INV-019 |
| P5 | INV-025 |
| P6 | INV-026 |
| P7 | INV-021 (fleet queries), INV-020 (module names) |
| P8 | INV-003, INV-011, INV-014, INV-015, INV-016, INV-028, INV-030 |
| P9 | all, re-verified in the standing audit |
