# INVARIANTS

Rules that must **always** hold. Every one is checkable by a test.

**Binding rule (ADR-016):** each invariant has at least one test tagged `@INV-nnn`. `pnpm test:invariants` runs that suite alone and is a required CI job.

**`due:Pn` is machine-read.** CI requires a passing tagged test only for invariants **due by the current phase** in `STATUS.md`, and fails on an invariant that is past due and untested, or that carries no `due:` marker at all. Not-yet-due invariants are reported as a count, never as a pass. Without this the gate is unsatisfiable from P0 until P8 — and the first agent to hit red CI would add an exemption list, neutering the one mechanism that turns invariants from prose into enforcement (ARCH-ADV A1, `10-quality/ci-cd.md`).

Severity: `SEC` = security; violating it is a breach. `DATA` = data integrity; violating it silently corrupts. `TRUST` = member trust; violating it makes the product lie. `OPS` = availability.

---

## Authorization

**INV-001** `SEC` `due:P1` · A user's effective permission mask equals `OR(masks of all granted roles) AND NOT user.denyMask`. **No other mechanism grants permission** — not a controller special case, not a config flag, not an `isAdmin` boolean.
*Test:* a user with two roles and a deny bit for a permission one role grants resolves to that permission absent.

**INV-002** `SEC` `due:P1` · A query executed on behalf of a user **MUST NOT** return rows from an ACL-bearing record whose `viewPerm` the user's mask does not satisfy — **enforced in the data layer, not the controller**.
*Test:* call the repository directly (bypassing every controller and guard) as a Ring 0 principal and assert zero Ring 1 rows returned.

**INV-003** `SEC` `due:P8` · `knowledgeChunk.visibility` always equals the visibility of its source record **at time of query**. An ACL change on the source re-indexes or deletes its chunks before the source's next retrieval.
*Test:* move a thread from a public to an officer category; assert no public-visibility chunk for it survives, and that a Ring 0 retrieval returns zero rows.

**INV-004** `TRUST` `due:P3` · **No market-derived value is displayed, returned by an API, or handed to a model without an accompanying data age.** Applies to UI, REST responses, AI tool results, Discord messages and templated fast-path answers alike.
*Test:* every response schema carrying a price also carries `dataAgeHours`; a snapshot test over the trade endpoints asserts it is present and non-null.

**INV-005** `DATA` `due:P1` · `cmdrVerification.cmdrName` is unique across all rows where `revokedAt IS NULL` **AND `isVerified = true`**. Two accounts cannot simultaneously hold a *proven* claim on one CMDR — and an *unproven* claim takes no lock at all.
*Test:* a second verified claim on the same CMDR name is rejected; **an abandoned pending claim does not block the real owner from verifying**, and expires by `nonceExpiresAt`. *(RED-TEAM R7 — locking on `revokedAt IS NULL` alone let any member permanently squat any CMDR name by opening a claim and never completing it.)*

**INV-006** `SEC` `due:P0` · A permission mask is never truncated. It is stored as `NUMERIC(40,0)`, transported as a decimal string, and handled as `bigint`. **No code path converts a mask to a JavaScript `number`.**
*Test:* round-trip `SITE_CONFIG` (`1n << 63n`) through storage, JSON and back; assert exact equality.

**INV-007** `SEC` `due:P1` · Deny beats grant, always and last. Adding a role that grants a permission a user is explicitly denied does not grant it.
*Test:* as above from the deny direction, for every permission group.

**INV-008** `SEC` `due:P1` · Discord role → internal role mappings are **data** (`role_mappings`), never hard-coded identifiers in application code.
*Test:* grep/lint assertion that no Discord snowflake literal appears outside seed and test fixtures.

**INV-009** `SEC` `due:P1` · Every privileged action writes an `audit_log` row with actor, action, target and before/after: role changes, moderation, BGS orders, config changes, and **every AI tool invocation including denied ones**.
*Test:* for each privileged endpoint, assert exactly one audit row with a populated diff; for a denied AI tool call, assert an audit row with `outcome = 'denied'`.

**INV-010** `SEC` `due:P1` · Every mutating API endpoint accepts an idempotency key and, on replay of the same key with the same body, returns the original result without repeating the side effect.
*Test:* POST twice with one key; assert one database mutation and identical responses.

## AI boundary

**INV-011** `SEC` `due:P8` · The tool list presented to the model is filtered by the caller's permission mask **before serialisation**. The model is never shown a tool it may not call, and the executor re-checks permission independently before execution.
*Test:* build a request as a Ring 0 caller; assert `set_bgs_order` appears nowhere in the outgoing payload, and that a forged call to it is refused and audited.

**INV-012** `SEC` `due:P1` · OAuth refresh tokens, cAPI tokens and device tokens are **encrypted at rest** (AES-256-GCM, key from the secret store) and never appear in logs, error messages, audit rows or API responses.
*Test:* write a token, read the raw column, assert the plaintext is absent; assert a log-scrubbing test over a payload containing a token.

**INV-013** `SEC` `due:P3` · Telemetry is **OPT-OUT**. The companion app sends everything it reads; the server stores everything a member has not switched off. A member may decline any category or any individual event **except `session`**, which cannot be declined because promotion eligibility is computed from it. Opting out **purges** what was already stored for that scope, and enforcement is **server-side**: a declined event is discarded with an explicit answer, never silently.
*Test:* post an event in a declined category; assert zero rows written and the scope named in the response. Post any event with no preferences recorded; assert it IS stored. Attempt to decline `session`; assert it is refused.

> **Amended 2026-07-29 — opt-out, on the squadron owner's instruction.**
> The model is inverted. The companion app no longer filters anything: it sends
> what it reads, and the WEBSITE is where a member decides what is kept. Default
> is everything; a member switches off what they do not want, at category or at
> individual-event granularity.
>
> **The consequence, stated plainly rather than buried:** a declined event is
> discarded by the SERVER, which means it left the member's machine before it
> was dropped. Under the previous model the app filtered locally and the data
> never travelled. That is a real reduction in privacy and it is the deliberate
> price of having one place — the website — that shows a member everything
> collected and lets them switch any of it off. The app is still entirely
> optional and still ships disabled.
>
> **`session` cannot be declined.** Promotion eligibility is computed from it
> (rank-progression.yaml), so a member who switched it off would silently stop
> qualifying for promotions they had earned — which is exactly the failure the
> 2026-07-27 amendment below was written to prevent. It is the one exception,
> and the UI states why rather than showing a disabled toggle with no
> explanation.

> **Amended 2026-07-27.** Previously every category was opt-in. That made the
> squadron's own core function — knowing who is playing, what rank they hold and
> what they fly — conditional on a checkbox, so a member could install the app,
> leave it running for a month, and be told they had not qualified for a
> promotion because of a setting they never saw.
>
> The baseline is the data the platform exists to hold, and running the app is
> the act of agreeing to it: the app is **entirely optional**, ships disabled,
> states plainly what it sends, and will show a member the exact contents of a
> batch from their own journals before they turn it on. The optional categories
> — where they went, what they fought, what they traded — are for leaderboards
> and remain opt-in, because those answer questions about a member rather than
> about the squadron.

**INV-014** `SEC` `due:P8` · A mutating AI tool never executes without explicit human confirmation of that specific call. `grant_role` requires two-step confirmation. No exception for convenience, permission level, or an "obviously safe" argument set.
*Test:* invoke each mutating tool without a confirmation token; assert `needsConfirmation` and no side effect.

**INV-015** `SEC` `due:P8` · Authorization for AI actions is enforced in the executor and the API, **never in the system prompt**. A prompt injection carried in retrieved content cannot invoke a tool the caller lacks permission for.
*Test:* inject an instruction into indexed forum content telling the model to call an unpermitted tool; assert refusal plus a `denied` audit row.

**INV-016** `SEC` `due:P8` · GSAI reads squadron data only by calling back to the API with the caller's signed context. **The agent has no direct database connection and no local replica.**
*Test:* assert the agent runtime's configuration contains no database URL; assert the egress allowlist rejects anything outside Ollama-localhost, our API, and the whitelisted ED APIs.

## Data integrity

**INV-017** `DATA` `due:P3` · EDDN and telemetry upserts are idempotent and **discard any message whose observation timestamp is older than the stored OBSERVATION timestamp** — `marketOrder.updatedAt`, `system.observedAt`, `station.observedAt`. Never a write timestamp (see INV-043). Out-of-order arrival never moves data backwards.
*Test:* apply a newer then an older market message for one `(marketId, commodity)`; assert the newer value survives.

**INV-018** `DATA` `due:P3` · `SystemAddress` (BigInt) is the canonical key for a system. Names are for display and search only. Any lookup that begins with a name resolves to an address before use, and an ambiguous name returns candidates rather than a guess.
*Test:* resolve a known ambiguous name; assert multiple candidates and no arbitrary selection.

**INV-019** `DATA` `due:P4` · A faction's influence for a given system and tick is recorded **once**. Multiple EDDN reports of the same tick are deduplicated, never summed or averaged into a second row.
*Test:* feed three reports of one tick for one faction/system; assert exactly one snapshot associated to that `tickId`.

**INV-020** `DATA` `due:P3` · Commodity, module and ship names shown to a user are **display names resolved through FDevIDs**. An internal name never reaches a user-facing surface.
*Test:* assert every commodity row resolves to a display name; assert a rendering test fails on an unmapped internal name.

**INV-021** `DATA` `due:P3` · Credits, `SystemAddress` and `MarketId` are `BigInt` end to end. No path converts them to `number`.
*Test:* round-trip a value above 2^53 through API and database; assert exact equality.

**INV-022** `DATA` `due:P2` · Forum content is **soft-deleted**. A deleted post leaves a moderator-visible tombstone and remains recoverable; it never disappears from the database on a user action.
*Test:* delete a post; assert `deletedAt` set, row present, invisible to a non-moderator, visible with tombstone to a moderator.

**INV-023** `DATA` `due:P3` · Every external adapter response carries provenance and freshness (`source`, `fetchedAt`, `dataAgeHours`) attached inside `packages/ed-clients`, not at the call site.
*Test:* for each adapter's fake, assert the decoration is present on every returned shape.

## Trust & correctness

**INV-024** `TRUST` `due:P2` · Search results are ACL-filtered **in the query**, never after retrieval. A Ring 0 search for a term appearing only in Ring 2 content returns **zero** results — not a redacted result, and not a result count.
*Test:* index a unique token in a Ring 2 post; search as Ring 0; assert zero hits, zero facet counts, and no pagination total revealing existence.

**INV-025** `TRUST` `due:P5` · Every user-facing time renders **both** the viewer's local time and UTC. Elite runs on game time; a bare local time is a defect.
*Test:* render an operation for a viewer in a non-UTC zone; assert both are present.

**INV-026** `TRUST` `due:P6` · Trade route results account for `distanceToArrivalLs` and landing-pad size, and **exclude fleet carriers unless explicitly included**. Carrier prices distort results and their availability is not guaranteed.
*Test:* a route query with default parameters returns no carrier markets and no station beyond the requested max Ls.

**INV-027** `TRUST` `due:P1` · A member's location, credit balance and fleet are never present in a public API response unless that member has explicitly opted in **for that specific field**. Absent, not merely hidden by the UI.
*Test:* set every privacy toggle to private; assert the fields are absent from the public serialisation, not null.

**INV-028** `TRUST` `due:P8` · GSAI never presents a market fact without its age, and never asserts a system, station, commodity or CMDR name it did not obtain from a tool.
*Test:* the tool-result contract requires freshness fields; an evaluation set asserts freshness is relayed in generated answers.

**INV-029** `TRUST` `due:P1` · The Frontier non-commercial attribution notice is present on every rendered page.
*Test:* a rendering test asserts the notice in the footer of the public and authenticated layouts.

## Availability & operations

**INV-030** `OPS` `due:P8` · **No page load, API request or non-GSAI background job depends on the local AI box.** With the box powered off, every non-AI feature works and GSAI reports `OFFLINE` honestly.
*Test:* integration run with the gateway unreachable; assert full functionality and an `OFFLINE` status with a templated fallback for read queries.

**INV-031** `OPS` `due:P1` · No request path performs a synchronous Frontier cAPI call. cAPI is exercised only by scheduled workers and explicit user-initiated imports.
*Test:* assert no cAPI client call originates from a request-scoped provider.

**INV-032** `OPS` `due:P3` · No request path performs a blocking Spansh call. Route planning is submit-job → poll → WebSocket push, always.
*Test:* assert `IRoutePlanner` exposes no synchronous method and that the trade plot endpoint returns a job identifier without awaiting a result.

**INV-033** `OPS` `due:P3` · Inara is called at most twice per minute **globally**, through one shared limiter, and never from a request path.
*Test:* issue 10 concurrent adapter calls; assert dispatch spacing ≥30 s and that the limiter is a singleton.

**INV-034** `OPS` `due:P3` · The EDDN collector writes in batches and is resumable. A restart loses no acknowledged message and produces no duplicate row.
*Test:* kill mid-batch, restart, assert row counts and no duplicates.

**INV-035** `OPS` `due:P2` · All user-supplied HTML is sanitized **server-side** before storage and served under a strict CSP with nonces and `frame-ancestors 'none'`.
*Test:* the XSS suite — script tags, event handlers, `javascript:` URLs, SVG payloads, polyglot uploads — all neutralised; CSP headers asserted.

**INV-036** `OPS` `due:P0` · No secret, key or token appears in the repository. `.env.example` contains placeholders only.
*Test:* gitleaks over the working tree and full history, in CI, blocking.

---

## Added by the SSOT bootstrap review panels

These eight came from the independent adversarial review of the SSOT itself, before any code
existed (`10-quality/review-log.md`). Each closes a hole that the original invariant set stated a
property for but did not make structurally impossible.

**INV-037** `SEC` `due:P1` · A user whose `status` is not `active` has an effective permission mask of **zero**. Account status is an input to `computeEffectiveMask`, not a filter applied somewhere else, and `guildMemberRemove` and any status change bust the permission cache.
*Test:* an officer with a `manual` role grant is set to `left`, then `banned`; assert the recomputed mask is `NO_PERMISSIONS` in both cases and that their WebSocket channels drop. *(RED-TEAM R4 — `manual` grants survive reconciliation, so without this a departed officer kept `AUDIT_VIEW` and `BGS_SET_ORDERS` forever.)*

**INV-038** `SEC` `due:P8` · A RAG chunk whose source ACL cannot be expressed by the `Visibility` enum is stored with the source's exact `viewPermMask`, and retrieval tests that mask in the query. **`visibility` has no default; indexing fails closed, never open.**
*Test:* index a thread from a category gated on `SITE_CONFIG`; assert a `member`-masked retrieval returns zero rows, and that an unresolvable ACL yields `visibility = officer` rather than `public`.

**INV-039** `SEC` `due:P2` · Notification fan-out re-checks each recipient's current mask against the target's **current** category at send time, and moving a thread prunes subscriptions whose holders no longer satisfy the destination `viewPerm`.
*Test:* subscribe as a member, move the thread to an officer category, post a reply; assert no notification row, no Discord DM and no WebSocket event for that member. *(RED-TEAM R3 — fan-out is not "on behalf of a user", so INV-002 does not reach it.)*

**INV-040** `SEC` `due:P8` · A confirmation token is single-use and bound to both its invocation and the exact argument hash the human was shown.
*Test:* present a spent token → refused; present a valid token with mutated arguments → refused; present a token issued for another invocation → refused. *(RED-TEAM R5.)*

**INV-041** `SEC` `due:P1` · Idempotency keys are namespaced by `(userId, endpoint, key)`. A key presented by a different actor is never a replay.
*Test:* an officer stores a response under key K; a member presents K with an identical body on the same endpoint; assert the officer's stored body is **not** returned and the permission guard executes normally. *(RED-TEAM R8 — a global key namespace returned a stored response before any guard ran.)*

**INV-042** `DATA` `due:P3` · Ingestion idempotency keys are collision-free for genuinely distinct events. The telemetry `eventKey` includes a payload hash, and every derived contribution row carries either `sourceEventId` or `importBatchKey` — never neither.
*Test:* submit 18 `MissionCompleted` events whose journal timestamps span only 3 whole seconds; assert 18 rows stored. Re-run a BGS-Tally import twice; assert no duplication. Submit a row with both keys NULL; assert rejection. *(DATA-INTEGRITY B1, B2.)*

**INV-043** `DATA` `due:P3` · Staleness comparisons use **observation time**, never write time. `systems.observedAt` and `stations.observedAt` are what INV-017 compares against, and a dump seed sets them from the dump's generation date.
*Test:* seed a system from a month-old dump today, then apply an EDDN message observed a week ago; assert the EDDN data **wins**. *(DATA-INTEGRITY B4 — comparing against `updatedAt` discarded every EDDN update observed before the seed run.)*

**INV-044** `DATA` `due:P3` · `market_orders` reflects only what a market currently trades. A commodity absent from an EDDN market message is deleted for that market in the same transaction as the upsert.
*Test:* ingest a market listing Tritium, then the same market without it; assert the Tritium row is gone and does not appear in `best_trades`. *(DATA-INTEGRITY B6 — an upsert-only collector leaves ghost supply inside the freshness window forever.)*

**INV-046** `SEC` `due:P1` · **A tenure or loyalty rank never grants a permission.** `SquadronRank.roleKey` is NULL for every rank of kind `tenure` or `loyalty`, and a member's effective mask is identical whether they are a Sergeant or a Grand Lord General.
*Test:* compute the effective mask for a member at 1 month and at 14 months holding `GMSD: Legend`; assert the two masks are **equal** and equal to the `member` preset. Assert a `tenure`/`loyalty` rank row with a non-NULL `roleKey` fails a constraint. *(Human decision 2026-07-26 — time served must never confer moderation power.)*

> **CLARIFIED 2026-07-29 — membership roles are NOT tenure ranks.** `Grim's Squad
> members`, `Allies` and `Unranked` became real, permission-bearing roles on the
> squadron owner's instruction, and INV-046 does not forbid that: it governs the
> TENURE ladder (Cadet…Grand Master General) and the LOYALTY awards, where time
> served must never confer moderation power. Membership is a different statement
> — it says somebody flies with this squadron, not how long — and it is the only
> place the platform can express what an ordinary member may do. All three ship
> with a mask of **zero**, so the clarification grants nobody anything; it makes
> the setting possible. `Unranked` is granted by role sync when nothing else
> maps, because a role granted to nobody is a control that silently does nothing.

**INV-047** `DATA` `due:P1` · A member holds **exactly one** ladder rank at a time, and every change to it is written to `audit_log` with the qualifying months that justified it. A reserved rank has at most one active holder.
*Test:* move a member's `guildJoinedAt` back by 12 months; assert their displayed rank changes with no write to `rank_awards`. Assert a second active award of `galactic_admiral` is rejected.

**INV-048** `SECURITY` `due:P1` · A live event delivered to EVERY connected browser never identifies a member. Member-scoped events carry a `userId`; squadron-wide events carry `userId: null` and a type that names no person. An event arriving on the cross-process bridge with a MISSING `userId` is refused rather than treated as squadron-wide.
*Test:* publish a verification for member A and assert member B's stream receives nothing naming A; assert the accompanying broadcast event contains no user id anywhere in its payload; assert `{"type":"verification"}` with no `userId` field is dropped. *(D29 — "everybody" and "we forgot to say who" must not be the same message.)*

**INV-045** `OPS` `due:P3` · A batch write never loses good rows because of one bad row. Market rows whose parent station has not yet arrived are buffered and drained, not dropped, and the buffer depth is a monitored metric.
*Test:* submit a 500-row batch containing 1 row for an unknown `marketId`; assert 499 rows written, 1 buffered, and `writeFailureRate` non-zero. *(ARCH-ADV A6 — a mandatory FK plus an all-or-nothing statement lost 499 observations per orphan, while `parseFailureRate` stayed at 0.0%.)*

---

## Coverage map — invariant to phase

| Phase | Invariants that must be proven before exit |
|---|---|
| P0 | INV-006, INV-036 |
| P1 | INV-001, INV-002, INV-005, INV-007, INV-008, INV-009, INV-010, INV-012, INV-027, INV-029, INV-031, INV-048 |
| P2 | INV-022, INV-024, INV-035 |
| P3 | INV-004, INV-013, INV-017, INV-018, INV-020, INV-021, INV-023, INV-032, INV-033, INV-034 |
| P4 | INV-019 |
| P5 | INV-025 |
| P6 | INV-026 |
| P7 | INV-021 (fleet queries), INV-020 (module names) |
| P8 | INV-003, INV-011, INV-014, INV-015, INV-016, INV-028, INV-030 |
| P9 | all, re-verified in the standing audit |

**The table above is the human-readable mirror.** `due:Pn` on each invariant is the machine-readable form CI actually reads; if they disagree, `due:` wins.

Review-panel additions: INV-037, INV-041 (P1) · INV-039 (P2) · INV-042, INV-043, INV-044, INV-045 (P3) · INV-038, INV-040 (P8).

Rank-model additions (human decision 2026-07-26): INV-046, INV-047 (P1).
Live-event addition (2026-07-29): INV-048 (P1). Arose from D29 — a verification has to reach
every viewer's roster, and the obvious way to do that would have told a hundred browsers who
had just proved their commander name.

**Deliberately NOT an invariant: the backup-verification rule (D33).** A backup is only
recorded as successful after its size is read back from the bucket, which is exactly the
shape of an invariant — but it lives in a shell script with no test harness, and the
coverage gate can only prove tagged Vitest tests. An invariant that cannot be proven is
the gate that gets switched off in week one (see the independent panel's findings). It is
recorded as a decision, and proving it needs a test harness for `infra/scripts/`.

> **INV-047 was REWRITTEN on 2026-07-27.** It previously read: *"A tenure rank is
> **computed** from `guildJoinedAt`, never stored per user, so it cannot drift
> from the truth."* That described the old model, where time in the server alone
> decided rank. The human replaced it with earned progression: a member advances
> only by being active, so rank is now stored state.
>
> The original invariant existed to stop rank drifting from reality. That concern
> is real and does not go away — it is now met by requiring an audit row for
> every change, so a rank that looks wrong can always be traced to the months
> that produced it. See `ssot/02-domain/rank-progression.yaml`.
