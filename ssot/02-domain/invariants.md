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

> ✅ **ENFORCED AS OF 2026-07-29.** Closed the same day it was found (panel finding P1-1).
>
> `AclDbService` (`apps/api/src/authz/acl-db.service.ts`) is the enforcement point:
> `forCaller(userId)` resolves the mask from the SESSION through `PermissionService`,
> resolves the visible-id set, and returns a `withPrincipal`-bound client. `forSystem(reason)`
> is the deliberate bypass for background work and requires a stated reason — there is no
> default.
>
> **Tested through the APPLICATION, not the extension.** The original test called
> `withPrincipal` directly, which proved the extension works when applied and said nothing
> about whether anything applied it — which is exactly how this was reported as covered
> while unenforced. `acl-db.service.spec.ts` starts from the object a route holds.
>
> **Proven, not assumed:** removing the binding was tried, and 6 of 8 tests failed. A static
> guard (`acl-usage.spec.ts`) fails the build if any file outside `AclDbService` reads an
> ACL-bearing accessor, and it was proven to fire by feeding it the offending shape.
>
> **Known scope limit:** the static guard covers `apps/api` only. The worker and bot hold
> their own clients and legitimately operate across all members; a future worker job reading
> a gated table would not be caught. Recorded rather than papered over.

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
