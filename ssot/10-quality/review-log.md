# REVIEW LOG

Every adversarial review gate records its outcome here (ADR-017). In **local mode** this file also carries the PR body for each merge (`git-workflow.md`).

**Zero BLOCKER/MAJOR across an entire phase is automatically flagged** — it is evidence the adversarial stance may have decayed into rubber-stamping, not evidence of flawless code.

---

## Summary

| Phase | DESIGN-ADV | ARCH-ADV | RED-TEAM | DATA-INTEGRITY-ADV | UX-ADV | OPS-ADV |
|---|---|---|---|---|---|---|
| SSOT bootstrap (self-review) | — | 2 | 3 | 2 | — | — |
| **SSOT bootstrap (independent panel)** | — | **9 (3 BLOCKER)** | **8 (4 BLOCKER)** | **8 (3 BLOCKER)** | — | — |
| P0 | pending | pending | n/a | n/a | pending | pending |
| P1 | pending | pending | pending | n/a | pending | pending |

---

## 2026-07-25 — SSOT bootstrap, part 1: authoring self-review

**Subject:** the `ssot/` directory itself, before any code exists.
**Rationale:** a specification is a design, and designs are what DESIGN-ADV and ARCH-ADV exist to attack. Finding these in P4 would cost weeks.

> **Provenance, stated honestly:** these findings came from the authoring agent's own adversarial pass while transforming the spec — **not** from an independent panel. Under ADR-017 that does not satisfy a gate ("no self-approval"), so it is recorded as *self-review* and the independent panel is logged separately in part 2 below. The findings are real and the resolutions are in the SSOT; the process caveat is that the same party found and fixed them.

### Findings

| # | Gate | Severity | Finding | Verdict | Resolution |
|---|---|---|---|---|---|
| B1 | DATA-INTEGRITY-ADV | **BLOCKER** | `knowledge_chunks.embedding` is declared `vector(1024)` while the pinned embedder `nomic-embed-text` emits **768** dimensions. Every insert would fail, and the mismatch is only discovered at P8.9 after the schema is long since migrated. | CONFIRMED | Cannot be resolved by the agent without inventing a decision the spec does not make. Recorded as **decision D16** in `STATUS.md`, flagged in `schema.prisma`, `models.md`, `rag.md` and `indexes.md`, and made a blocker on P8.9. |
| B2 | ARCH-ADV | **MAJOR** | The spec's illustrative route SQL (§7.4) computes distance with an inline `sqrt(power(...))` expression, which **cannot use the GiST index** on `cube(ARRAY[x,y,z])`. Copying it verbatim yields a sequential scan over every system and misses the <2 s acceptance criterion by an order of magnitude. | CONFIRMED | `03-data/indexes.md` now states the cube-operator form explicitly and calls out the spec's version as non-indexable. P6.3 acceptance requires `EXPLAIN ANALYZE` to show no sequential scan. |
| B3 | RED-TEAM | **MAJOR** | Prisma's `@@unique([factionId, systemAddress, tickId])` does **not** constrain rows where `tickId IS NULL`, because Postgres treats NULLs as distinct. Unassociated snapshots could therefore be inserted repeatedly and INV-019 would fail **silently**. | CONFIRMED | ~~Partial unique index covering the NULL-tick case.~~ **SUPERSEDED by part-2 B3** — that index keyed on `observed_at`, which is per-uploader and therefore deduped nothing. Fixed structurally instead: `tickId` is now non-null. |
| B4 | RED-TEAM | **MAJOR** | A long-lived WebSocket authorises its channels **at connect time**. A member demoted in Discord would keep receiving Ring 1 events for the life of the socket — the HTTP path busts the permission cache, the socket does not. | CONFIRMED | `04-contracts/websocket-events.md` now requires mask re-evaluation on `perm:{userId}` bust and channel drop within the same 5 s window as HTTP. Added to the must-have test corpus in `test-strategy.md`. |
| B5 | RED-TEAM | MAJOR | The three-value `visibility` enum on `knowledge_chunks` cannot express a category gated on a **custom** permission mask (e.g. BGS Intelligence on `BGS_REPORT`). A design relying on the enum alone would leak the moment such a category was indexed. | CONFIRMED | ~~Documented in prose; `viewPerm` carried in chunk `metadata`.~~ **SUPERSEDED by part-2 R1** — prose was not enough and `metadata` had no defined shape. Now a real `viewPermMask` column, tested **in** the retrieval SQL, with the `visibility` default removed so indexing fails closed. |
| B6 | DATA-INTEGRITY-ADV | MAJOR | Spec §8.4 marks four mutating AI tools as not requiring confirmation, which **directly contradicts** `AGENTS.md` §3.4 and INV-014. Left unresolved, an implementer would follow whichever document they read last. | CONFIRMED | Resolved in favour of the constitution (`AGENTS.md` §1 — it outranks the spec). All 11 write tools carry `confirmation: required` or `two_step`; the divergence and its reasoning are documented explicitly in `06-ai/guardrails.md`. |
| B7 | ARCH-ADV | MINOR | The spec's `market_history` design has no foreign key and no stated partitioning, while also being the highest-volume table. Unbounded growth is the failure mode. | CONFIRMED | 90-day retention documented in `03-data/retention.md` with an enforcing job and an alert; the absent FK is now a stated deliberate choice (batch-write performance) rather than an omission. |
| B8 | RED-TEAM | MINOR | `text.dim`, `brand.orangeDim` and `semantic.hostile`-on-`panelHover` all fail WCAG AA for normal text — while the spec's stated concern (`brand.orange`) actually **passes** at 5.95–7.31 against our surfaces. Following the spec's rule of thumb would have restricted a compliant colour and permitted three non-compliant ones. | CONFIRMED | All ratios computed rather than asserted; the three failures are listed as **forbidden combinations** in `07-design/accessibility.md`, with required substitutions. A CI contrast check now blocks a regression. |
| B9 | DATA-INTEGRITY-ADV | MINOR | Nothing in the spec states what happens to the RAG index after a **database restore**. A restored `knowledge_chunks` table predating an ACL change re-introduces exactly the leak INV-003 prevents. | CONFIRMED | `09-runbooks/backup-restore.md` now lists `rag:reindex` as a **security step** in the restore procedure, not a convenience, with the reasoning stated. |

### Not accepted

| # | Gate | Finding | Verdict | Reason |
|---|---|---|---|---|
| N1 | ARCH-ADV | "The monorepo couples all six services; a failure in one blocks all deploys." | REFUTED | Services build and deploy independently; the monorepo shares *source*, not a deployment unit. Turborepo scopes builds to changed packages. |
| N2 | RED-TEAM | "`describePermissions` in audit rows leaks the permission model to officers." | REFUTED | Officers are the intended audience of the audit log, and the permission model is documented in the SSOT rather than being a secret. Obscurity is not a control here. |

### Outcome
**9 findings accepted and resolved in the SSOT; 2 refuted.** One (B1) could not be resolved without inventing a decision the spec does not make, and was correctly escalated to the human as decision D16 rather than guessed at.

---

## Template for future entries

```markdown
## <ISO date> — <phase>.<task> <name>

**Risk tier:** <1|2|3>
**Gates run:** <list>
**Reviewers:** independent, no shared findings before submission

### Findings
| # | Gate | Severity | Finding | Verdict | Resolution |
|---|---|---|---|---|---|

### Merge
- CI: <result>
- Unresolved BLOCKER/MAJOR: <count — must be 0 to merge>
- Autonomous merge: <permitted | HUMAN REQUIRED, with the reason>
- Merge commit: <sha>
```

---

## 2026-07-25 — SSOT bootstrap, part 2: INDEPENDENT ADVERSARIAL PANEL

**Subject:** the `ssot/` directory as delivered by part 1.
**Gates run:** ARCH-ADV · RED-TEAM · DATA-INTEGRITY-ADV
**Reviewers:** three independent agents, run **in parallel**, each given only the change, its SSOT
context and its own brief. **No reviewer saw another's findings.** None was the authoring agent
(ADR-017, no self-approval).
**Verification:** every finding was checked against the SSOT before action.

### Outcome

**25 findings — 10 BLOCKER, 12 MAJOR, 3 MINOR. All 25 CONFIRMED; 2 separate claims refuted.**

That so few were refuted is worth noting: the panels were finding real defects rather than
over-reporting. Three clusters dominated — **ACL gaps the invariants asserted but did not make
structurally impossible**, **NULL-distinctness and key-collision bugs that would have corrupted
data silently for months**, and **a process defect that would have disabled the invariant gate in
week one.**

### RED-TEAM

| # | Sev | Finding | Resolution |
|---|---|---|---|
| R1 | **BLOCKER** | Categories carry an arbitrary `viewPerm`, but chunks carried a 4-value enum and the retrieval SQL had no mask test — a category gated on `SITE_CONFIG` indexed as `public` (the column defaulted to it). The mandatory P8 leak test passed anyway, because it exercises an *officer* category, which maps cleanly. | `visibility` default **removed** (fails closed); `viewPermMask` column added; mask test now **in** the SQL; INV-038. |
| R2 | **BLOCKER** | The applicant's "own application thread" predicate punched an unbounded hole through the **Ring 2 Applications category** — where officers deliberate about that applicant. | `Application` now links **two** threads: `deliberationThreadId` (Ring 2, never visible) and `applicantThreadId` (public tier, ownership-scoped). |
| R3 | **BLOCKER** | Notification fan-out is outside INV-002 (not "on behalf of a user"). A subscription survives a thread moving to an officer category, so the subscriber gets the title and an excerpt of officer-only content. | Move prunes subscriptions; fan-out re-checks each recipient's mask at send time; INV-039. |
| R4 | **BLOCKER** | `users.status` fed no authorization decision and no cache-bust, and `manual` grants survive reconciliation — a departed or banned officer kept `AUDIT_VIEW`, `MEMBER_MANAGE` and `BGS_SET_ORDERS` **indefinitely**. | `computeEffectiveMask` now **requires** status and returns `NO_PERMISSIONS` for anything but `active`; `guildMemberRemove` added to bust triggers; INV-037. Verified by runtime test. |
| R5 | MAJOR | Confirmation tokens had no single-use ledger and no binding to invocation or arguments — no column recorded a spend. An injection could reuse an unexpired token for a *different* call. | `confirmationTokenHash`, `confirmedArgsHash`, `confirmationConsumedAt` added; INV-040. |
| R6 | MAJOR | `showActivity` was enforced nowhere — a member with every toggle private still had `status: "in_game"` broadcast squadron-wide. | `presence.changed` suppressed **entirely** for `showActivity = false`. |
| R7 | MAJOR | The uniqueness lock keyed on `revokedAt IS NULL`, so merely *starting* a claim squatted a CMDR name forever; no column existed for nonce expiry. | Lock requires `is_verified = true`; `nonceExpiresAt` added with a sweep index; INV-005 rewritten. |
| R8 | MAJOR | `IdempotencyKey.key` was a **global** PK matched on body hash alone — a member presenting an officer's key received the officer's stored response **before any guard ran**. | PK is now `(userId, endpoint, key)`; INV-041. |

### DATA-INTEGRITY-ADV

| # | Sev | Finding | Resolution |
|---|---|---|---|
| B1 | **BLOCKER** | `eventKey` hashed only device+timestamp+type over **whole-second** journal timestamps. 18 massacre missions yield 3 keys; 15 events silently swallowed as duplicates. Under-counting scales with how well a member plays, unrecoverable after the 30-day purge. | `eventKey` now includes a canonical payload hash; INV-042. |
| B2 | **BLOCKER** | `@@unique([userId, sourceEventId])` enforces **nothing** on manual and BGS-Tally paths — NULLs are distinct in Postgres. The same footgun the SSOT documented one section earlier for snapshots. A re-run import doubles every contribution. | `importBatchKey` added; four partial unique indexes; both-NULL rejected at the boundary. |
| B3 | **BLOCKER** | The NULL-tick partial index keyed on `observed_at` — **per-uploader, therefore always distinct** — so it deduped nothing in the exact case it existed for. INV-019's test passed because it supplied a known `tickId`. | Fixed **structurally**: `tickId` non-null via resolve-or-create provisional ticks. The broken index is recorded as DO NOT REINSTATE. |
| B4 | **BLOCKER** | `systems`/`stations` had no observation-time column — `updatedAt` was a *write* time, not even `@updatedAt`. A seed stamps month-old dump data as "now", after which **every earlier-observed EDDN update is discarded** by INV-017 itself. | `observedAt` added to both; `updatedAt` demoted to write-time; INV-017 rewritten; INV-043. |
| B5 | MAJOR | Both specs mandate "parse as BigInt", but `JSON.parse` coerces to a double first — `BigInt()` then preserves the *rounded* value. P3.4 had no BigInt criterion at all. | Lossless parser mandated **between inflate and Zod**; P3.4 names `JSON.parse`-then-`BigInt()` as a failing case. |
| B6 | MAJOR | Nothing removes a `market_orders` row for a delisted commodity — upsert-only leaves ghost supply inside the freshness window forever, correctly age-badged. | Delete-absent-commodities in the same transaction as the upsert; INV-044. |
| B7 | MAJOR | The 30-day telemetry purge ignored `processed_at`. A stalled worker turns a recoverable backlog into permanent loss — and the job **reports success**, since deleting rows is its success signal. | Purge requires `processed_at IS NOT NULL`; unprocessed >7 days alerts. |
| B8 | MAJOR | Nothing reconciled an inferred tick with the detector's later correction, and `occurredAt @unique` allowed two tick rows minutes apart — splitting one real tick, every delta against the wrong baseline. | `windowKey` is the stable identity; `occurredAt` refined **in place**, no longer unique. |

### ARCH-ADV

| # | Sev | Finding | Resolution |
|---|---|---|---|
| A1 | **BLOCKER** | The invariant gate demanded tests for all 36 invariants on every PR — **unsatisfiable from P0 until P8**. The first agent hitting red CI adds an exemption list, and the mechanism that turns invariants into enforcement dies in week one. | Machine-readable **`due:Pn`** on every invariant; CI requires tests only for those due by the current phase, fails on a missing marker or past-due gap, and reports not-yet-due as a **count, never a pass**. |
| A2 | **BLOCKER** | `best_trades` at market-pair × commodity grain with **no cardinality bound** — ~25M pairs — rebuilt in full every 15 min on the same 4 vCPU as the collector. First symptom is EDDN lag, which the runbook misdiagnoses as upstream. | Three bounds (top 20 per origin, 100 ly, 1000 Cr/t); refresh cost is now a **measured** P6.3 criterion. |
| A3 | **BLOCKER** | The prefilter's third clause had **no column and no expiry job** — the tracked set is monotonic and the >95% saving decays to zero from entirely in-spec behaviour. | `lastQueriedAt` added; un-track sweep and index specified. |
| A4 | MAJOR | The Meilisearch ACL mirror had no failure alarm and feeds GSAI's BM25 leg — while the leak test asserts "by inspecting the SQL", which cannot cover a non-SQL index. | P2.5 gains P8.9's alerting plus a nightly divergence sweep; the leak test asserts **both legs independently**. |
| A5 | MAJOR | `heavyAvailable()` requires >11 GB free — but the loaded 14b *consumes* it, so it returns false for its own whole `KEEP_ALIVE` window. Overnight briefings silently `DEFER` while the dashboard shows a healthy `busy`. | A **resident-model check now precedes** the free-VRAM check. |
| A6 | MAJOR | A 500-row batch upsert with a mandatory FK is all-or-nothing, and `commodity/3` carries **no `systemAddress`** for the parent. 499 good rows lost per orphan — while `parseFailureRate` stays 0.0%. | Orphans **buffered and drained**, not dropped; `orphanBufferDepth`/`writeFailureRate` metrics; INV-045. |
| A7 | MAJOR | Staging shares the 8 GB box and **nothing allocated the RAM**. An autonomous staging deploy — the one path with no human gate — lets the OOM killer take production Postgres; auto-rollback then reverts an innocent version. | Per-service memory budget in `constraints.md`; staging capped at 1 GB and **deploy-gated on ≥1.5 GB free**; Redis `noeviction`. |
| A8 | MAJOR | The single-use 60 s nonce was **also** the credential replayed on every tool callback — mutually exclusive. The gateway burns it on arrival; a 6-step turn exceeds 60 s. Both available fixes are security regressions. | A distinct **turn credential** specified — turn-scoped, separate from the inbound nonce. |
| A9 | MINOR | Trivy was drawn **before** the build stage, so it scanned a stale image or nothing; stated serial times already exceeded the 10-minute target. | Trivy moved after `build`; `integration` and `invariants` share one DB spin-up and run in parallel. |

### Refuted

| # | Gate | Claim | Reason |
|---|---|---|---|
| N1 | ARCH-ADV | "The monorepo couples all six services; one failure blocks all deploys." | Services build and deploy independently; the monorepo shares *source*, not a deployment unit. Turborepo scopes builds to changed packages. |
| N2 | RED-TEAM | "`describePermissions` in audit rows leaks the permission model to officers." | Officers are the intended audience of the audit log, and the permission model is documented in the SSOT rather than secret. Obscurity is not a control here. |

### Merge

- Schema re-validated on Prisma 6.19.3 and re-formatted; `permissions.ts` re-typechecked strict with 5 new status-gate assertions passing
- Invariants: 36 → **45**, every one carrying a `due:Pn` marker
- Unresolved BLOCKER/MAJOR: **0**
- **Autonomous merge NOT taken.** An SSOT change touching security controls is tier 3 (ADR-021). Recorded here for the human.
