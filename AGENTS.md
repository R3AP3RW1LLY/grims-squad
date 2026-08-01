# AGENTS.md — Operating Contract
### Grim's Squad Hub · read this at the start of every session

You are building **Grim's Squad Hub**, an Elite Dangerous squadron platform: public site, gated member forum, ship-build locker, trade/market terminal, BGS console, fleet-carrier operations, Discord integration, and a locally-hosted AI agent.

This file is the constitution. `ssot/` is the law. Application code is downstream of both.

> **Amendment history**
> - v1.0 — original operating contract (§1–§7).
> - v1.1 — 2026-07-25, human-directed amendment adding §8 (TDD), §9 (adversarial review gates), §10 (git, PR and autonomous-merge policy), §11 (CI/CD quality gates). §1–§7 are unchanged and remain binding.

---

## 1. THE SSOT SUPREMACY RULE

`ssot/` is the single source of truth. It outranks your training data, your instincts, this conversation, and any code already in the repo.

**Before writing any code, read:**
- `ssot/STATUS.md` — where the build actually is
- `ssot/CONVENTIONS.md` — naming, structure, style
- the ADRs in `ssot/01-decisions/` relevant to your task
- `ssot/03-data/schema.prisma` — the data model
- `ssot/04-contracts/` — API, permissions, events

**If code and SSOT disagree, the code is wrong.** Fix the code.

**If the SSOT is wrong or insufficient:** STOP. Do not improvise. Write a proposed ADR in `ssot/01-decisions/proposed/` stating the problem, at least two options with trade-offs, and your recommendation. Then ask the human. Do not proceed on the assumption it'll be approved.

---

## 2. DOMAIN FACTS YOU MUST NOT GET WRONG

Your training data contains stale and incorrect information about the Elite Dangerous third-party ecosystem. These are the corrections. They are load-bearing.

| ✗ Never | ✓ Instead |
|---|---|
| `eddb.io` / EDDB API | **EDDB shut down in 2023.** Use Ardent Insight, EDSM, Spansh, or our own EDDN mirror. |
| "Login with Inara" / Inara OAuth | **Inara has no OAuth.** It is a JSON-POST API requiring app whitelisting, ~2 req/min. Enrichment only, never in a request path. |
| Assuming cAPI is a persistent session | Frontier cAPI refresh tokens last **~25 days max**, then interactive re-auth. Verification is a recurring ceremony. Expiry surfaces as **HTTP 422**. |
| Blocking HTTP call to Spansh | Spansh is **async job-based**: submit → poll. Always via BullMQ + WebSocket push. |
| Trusting market data silently | All market data is player-reported via EDDN and may be stale. **Every price surfaced to a user carries a freshness indicator.** |
| Inventing system/station/commodity names | Look them up. A wrong system name costs a member a 40-minute round trip. |
| Hand-rolling ship-fit maths | Port from Coriolis (MIT, attribute it) into `packages/ed-domain`. |
| `localStorage` / `sessionStorage` in artifacts | Not applicable to this repo, but never assume browser storage in embedded/preview contexts. |

**Canonical naming:** commodity, module, and ship internal names come from **EDCD/FDevIDs**. Never hand-map. Never display an internal name to a user.

**System identity:** prefer `SystemAddress` (bigint) over system name as the key. ~1,300 systems have ambiguous names.

---

## 3. SECURITY INVARIANTS — non-negotiable

These are not preferences. Violating any of them is a defect regardless of whether tests pass.

1. **Authorization is enforced in the data layer, not just controllers.** A query for a Ring 0 user must be physically incapable of returning Ring 1 rows. Controller guards are the second line, not the first.
2. **`knowledge_chunks.visibility` mirrors its source's ACL, always.** Vector search filters by the caller's permission mask *before* nearest-neighbour returns. This is how an AI leaks officer-only content, and it is entirely preventable.
3. **AI tools are filtered by permission before the model sees them.** The model cannot call what it does not know exists. Permission checks live in the tool executor, never in the prompt — a successful prompt injection must still be unable to escalate.
4. **All mutating AI tools require explicit human confirmation.** No exceptions for convenience.
5. **OAuth refresh tokens and device tokens are encrypted at rest** (AES-256-GCM, key from the secret store). Never plaintext in the DB, never in logs.
6. **No secrets in the repo.** Ever. `.env.example` with placeholder values only.
7. **Telemetry is opt-in per category, defaults off**, with one-click revoke and purge. Members are sharing real gameplay data about themselves.
8. **All user HTML is sanitized server-side** (DOMPurify) and served under a strict CSP with nonces.
9. **Every mutating endpoint accepts an idempotency key.**
10. **Audit everything privileged**: role changes, moderation, BGS orders, AI tool invocations (including denied ones).

---

## 4. DEFINITION OF DONE

A task is not done until **all** of these are true:

- [ ] **A failing test was written first** and is now passing (§8 — TDD is mandatory)
- [ ] Code compiles, typechecks strict, lints clean
- [ ] Zod schema validates every external input at the boundary
- [ ] Unit tests for business logic; integration tests for anything touching the DB
- [ ] Authorization tested with a **negative case** — prove the unauthorized user is refused
- [ ] Errors handled explicitly; no bare `catch {}` that swallows
- [ ] No `TODO`, no `any`, no commented-out code, no placeholder data left in
- [ ] Migration written and reversible if the schema changed
- [ ] Coverage gate for the touched package still passes (§11)
- [ ] `ssot/STATUS.md` updated
- [ ] Conventional commit written
- [ ] PR opened, CI green, and required review gates for the task's risk tier satisfied (§9, §10)

"It runs" is not done. "The happy path works" is not done. "I'll add tests after" is a §8 violation.

### 4a. THE FOUR CHECKS THAT TYPECHECK AND TESTS DO NOT COVER

Added 2026-08-01, after the squadron owner said: *"your building this pretty hap-hazzardly a lot of
mistakes are being made and things ignored and left out."* That was fair. Every defect listed below
passed typecheck, passed lint, and passed the full test suite.

**1. EXERCISE THE PATH A HUMAN WILL TAKE, NOT THE ONE THE COMPILER CHECKS.**

The "Run now" button was typechecked, tested and reported as working. Nobody had pressed it. There
was no process listening on the channel it published to, so it said "Requested" and did nothing —
in exactly the situation it exists for, when something is already broken.

Before reporting a user-facing feature: **use it end to end, as the member would.** A page render,
a button press, a real request. If that is impossible in this environment, say so plainly rather
than letting a green suite imply it was checked.

**2. WHEN YOU CHANGE ONE OF A PAIR, GREP FOR THE OTHER.**

The year view buckets by month. The activity query was changed; the sign-ins query was not. Both
write into the same twelve-slot array, so sign-ins drew in months that had not happened yet.

Before changing a query, an array shape, or a contract: **search for everything that writes into
the same structure.** `number[]` will not tell you that two producers disagree about what an index
means.

**3. DO NOT EDIT CODE WITH STRING REPLACEMENT.**

Three separate corruptions in one session, all from scripted find-and-replace:

- a backtick inside a comment **inside a SQL template literal**, ending the query mid-statement —
  twice, hours apart
- literal NUL bytes as a map-key separator, which made git and grep treat the file as **binary**
- an append to `.env` with no trailing newline, which **concatenated onto the Inara API key**

Use the editing tools. They fail loudly on an ambiguous match; a regex silently writes something
plausible.

**4. NEVER DISTURB A RUNNING PROCESS CASUALLY.**

Two self-inflicted outages: adding a dependency while the dev servers held stale module resolution,
and a process kill matching `*grim-squad*` that also killed a 25-minute galaxy import.

Stop what you intend to stop, by pid. After changing dependencies or a generated client,
**restart deliberately and verify the restart** before continuing.

### 4b. AND ONE ABOUT CLAIMS

State measured numbers, not inherited ones. "Embedding the galaxy takes about three weeks" sat in a
contract, was repeated as fact, and shaped the design. Measured on the actual hardware it was
**1.2 hours** — wrong by a factor of three hundred, and it had never been checked by anyone.

If a number decides an architecture, measure it before relying on it, and record the measurement
where the decision lives.

---

## 5. HOW TO BEHAVE

**Ask before assuming.** If a requirement is ambiguous, ask one specific question. Do not build both options. Do not pick silently and mention it in a comment.

**Prefer boring.** This is maintained by one or two hobbyists. Every clever abstraction is a future 2am debugging session. Choose the obvious implementation.

**Small, verifiable increments.** Complete one task, run its tests, commit, report, then take the next. Do not batch six tasks and present a wall of diff.

**Report honestly.** If something is half-working, say so. If you couldn't verify an external API's behaviour, say so and flag it for human testing. Never claim a phase is complete when a task inside it is stubbed.

**Never fabricate.** No invented API endpoints, no invented response shapes, no invented game data. If you don't know an external contract, write the adapter against the documented shape, mark it `@unverified`, and list it in the phase report for human testing against the live API.

**Respect the phase boundary.** Do not build Phase 5 features while in Phase 3, however tempting. Scope creep is the #1 project-killer identified in the spec.

---

## 6. CODE CONVENTIONS

```
Runtime      Node 24 LTS · TypeScript strict
Monorepo     pnpm workspaces + Turborepo
Backend      NestJS (Fastify adapter)
Frontend     Next.js 15 App Router · React 19 · Tailwind v4
DB           PostgreSQL 16 + pgvector · Prisma
Queue        BullMQ on Redis
Validation   Zod — schemas live in packages/shared, used by BOTH ends
Search       Meilisearch
Logging      Pino, structured JSON, request-ID correlated
```

**Naming:** `snake_case` in SQL, `camelCase` in TS, `PascalCase` for types/components, `SCREAMING_SNAKE` for env vars. Files `kebab-case.ts`. Booleans read as assertions (`isVerified`, `hasCarrier`).

**Imports:** workspace packages via `@grims/shared`, `@grims/db`, `@grims/ed-clients`, `@grims/ed-domain`, `@grims/ai-tools`, `@grims/ui`.

**Every external API sits behind an adapter interface** in `packages/ed-clients` (`ITradeDataProvider`, `ISystemDataProvider`, `ICmdrProfileProvider`). The ED third-party ecosystem has a documented habit of disappearing — EDDB is the proof. Application code never imports a vendor SDK directly.

**Commits:** Conventional Commits. `feat(forum): add thread subscriptions`. Reference the phase and task: `[P2.4]`.

---

## 7. WHEN YOU FINISH A WORK BLOCK

Report in this format. Nothing else.

```
## [P<n>.<task>] <name>

DONE
- <what now demonstrably works>

VERIFIED BY
- <command run, test that passed, what you observed>

NOT DONE / DEFERRED
- <anything incomplete, and why>

UNVERIFIED EXTERNAL CONTRACTS
- <adapters written against docs but not tested live>

DECISIONS NEEDED FROM YOU
- <specific questions, or "none">

NEXT
- <the single next task>
```

---

## 8. TEST-DRIVEN DEVELOPMENT — MANDATORY

Authoritative detail: `ssot/10-quality/tdd-policy.md`. The rules, in short:

1. **Red → Green → Refactor, per task, without exception.** The failing test is written and observed failing *before* the implementation exists. A commit whose test file is newer than its implementation file is evidence of a violation.
2. **The commit trail must show it.** Each task produces at least two commits: `test(scope): [Pn.m] <behaviour> — red` then `feat(scope): [Pn.m] <behaviour> — green`. Squash-merging the PR is fine; the branch history is the evidence.
3. **Every SSOT invariant in `ssot/02-domain/invariants.md` has a test that proves it**, tagged `@INV-nnn`. `pnpm test:invariants` runs that suite alone. An invariant without a passing tagged test is an unbuilt invariant.
4. **Every acceptance criterion in `ssot/08-plan/tasks.yaml` maps to a named test.** Acceptance criteria are test names, not aspirations.
5. **Bugs get a regression test first.** Reproduce in a failing test, then fix. No fix lands without the test that would have caught it.
6. **Authorization work requires a negative test in the same commit as the positive one.** Proving access works is half a test.
7. **Coverage is a floor, not a goal.** Gates in `ssot/10-quality/test-strategy.md`. Gaming coverage with assertion-free tests is a review-blocking defect.

---

## 9. ADVERSARIAL REVIEW GATES — MANDATORY

Authoritative detail: `ssot/10-quality/adversarial-reviews.md`. Every phase and every risk-tier-2+ task passes through review panels whose reviewers are instructed to **attack, not approve**. A reviewer who returns "looks good" without having tried to break the thing has not reviewed it.

| Gate | When | Reviewer stance |
|---|---|---|
| **DESIGN-ADV** | Before implementation of any new module | "This design fails to meet the requirement because…" |
| **ARCH-ADV** | Before implementation, and at phase exit | "This will not survive contact with scale, failure, or change because…" |
| **RED-TEAM** | Phase exit for any phase touching auth, ACLs, telemetry, uploads, tunnel or AI | "Here is how I get data I should not have." |
| **DATA-INTEGRITY-ADV** | Any phase touching EDDN, market, BGS or telemetry ingestion | "Here is the input that corrupts your data silently." |
| **UX-ADV** | Any member-facing surface | "Here is where a member is misled, blocked, or excluded." |
| **OPS-ADV** | Phase exit | "It is 02:00 and this is broken. The runbook does not help me because…" |
| **CONTROL-ADV** | Whenever a change adds or tightens a control: CSP, rate limit, permission, quota, validation, conservative default | "Here is the legitimate thing this control refuses." |

**Rules:**
- **A finding whose fix is a new or tighter control is incomplete until the reviewer states what that control does to the legitimate path.** Not "this should be tightened" — what breaks when it is. A reviewer who cannot name the request it now refuses has not finished the finding, and it is downgraded to MINOR until they can. Five real outages here were caused by correct controls nobody walked the happy path through; see the CONTROL-ADV brief for the list.
- **Secure yes, crippled no.** A control that silently disables a working feature is a BLOCKER, ranked alongside a leak. Availability is a security property: a member who cannot use the site has not been protected from anything.
- Reviews are **independent**: a reviewer does not see another reviewer's findings until all are submitted.
- Each panel produces findings with severity `BLOCKER | MAJOR | MINOR | NIT` and a **concrete failure scenario** — inputs and state that produce a wrong result. A finding without a failure scenario is a NIT by definition.
- Findings are **verified before action**: a second pass tries to refute each one. Unrefuted BLOCKER and MAJOR findings must be fixed or converted into a written, accepted risk in `ssot/08-plan/risks.md` signed off by the human.
- **No self-approval.** The agent that wrote the code does not clear its own review gate.
- Review outcomes are recorded in `ssot/10-quality/review-log.md` with the phase, gate, findings count by severity, and resolution.

---

## 10. GIT, PR AND AUTONOMOUS MERGE POLICY

Authoritative detail: `ssot/10-quality/git-workflow.md`. Summary:

- **Trunk-based.** `main` is always deployable and always protected. No direct commits to `main`, by human or agent.
- **Branch per task:** `p<n>/<task-id>-<kebab-slug>`, e.g. `p2/p2-4-reactions-subscriptions`.
- **One task per PR.** A PR that touches two task IDs is split.
- **Autonomous merge is authorized** for a PR that satisfies *all* of: CI fully green; every §9 gate required for its risk tier passed with zero unresolved BLOCKER/MAJOR; the SSOT updated; no schema-destructive migration; no secret-, infra-, or cost-affecting change; the task is inside the current phase's SCOPE — IN.
- **Autonomous merge is forbidden**, and the human is asked, for: schema-destructive migrations, anything in `ssot/01-decisions/` other than adding to `proposed/`, security-control changes, production deploy of a new external integration, and any phase-exit merge.
- **Merge style:** squash, with the conventional-commit subject and the task ID. The PR body carries the review-gate table and the test evidence.
- **Until a remote is configured**, "PR" is a local branch plus a `ssot/10-quality/review-log.md` entry plus a `--no-ff` merge into `main`. The workflow does not change when the remote arrives; only the transport does.

---

## 11. CI/CD QUALITY GATES

Authoritative detail: `ssot/10-quality/ci-cd.md`. The pipeline is the enforcement mechanism for §3, §4, §8 and §9 — anything those sections require that a machine can check, CI checks.

Pull request pipeline, all blocking:
`lint → typecheck (strict) → unit → integration (ephemeral PG/Redis/Meili) → invariant suite → coverage gate → SSOT-drift check → schema/OpenAPI/tools.yaml contract check → secret scan → dependency audit → Trivy image scan → build`

`main` pipeline: build and push images → deploy staging → smoke tests → **manual gate for production** → deploy production → post-deploy health verification → automatic rollback on failed health check.

**The SSOT-drift check is non-negotiable and specific to this project:** CI fails if `packages/db/prisma/schema.prisma` differs from `ssot/03-data/schema.prisma`, if `packages/shared/src/permissions.ts` differs from `ssot/04-contracts/permissions.ts`, or if the generated tool registry differs from `ssot/06-ai/tools.yaml`. Drift is caught by a machine, not by hope.
