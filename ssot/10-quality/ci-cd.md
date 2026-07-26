# CI/CD

Authority: ADR-019, `AGENTS.md` §11.

**CI is the enforcement mechanism for §3, §4, §8 and §9 of the constitution.** Anything those sections require that a machine can check, CI checks — because rules that depend on an agent remembering them across a fresh context are rules that will be broken.

## Pull-request pipeline — every stage blocking

```
lint ──────────────────┐
typecheck (strict) ────┤                                                   ┌─▶ Trivy image scan
secret scan ───────────┼──▶ unit ──┬──▶ integration ─┬──▶ coverage ──▶ build
dependency audit ──────┤           │ (ephemeral PG,  │      (gates)
ssot-drift ────────────┤           └──▶ invariants ──┘
contract ──────────────┤             (share one DB spin-up, run in parallel)
contrast ──────────────┘
```

**Trivy runs *after* `build`** — there is no image to scan before it. Drawn earlier, the stage
either scanned a stale image from a previous run (silently passing a PR whose new dependency
introduced the CVE) or scanned nothing (ARCH-ADV A9).

**`integration` and `invariants` share one database spin-up.** Run serially with separate
spin-ups, the per-stage times above already exceeded the 10-minute target before any runner
queue or image pull — at which point this file's own rule bites: *a slower pipeline gets routed
around, and a routed-around pipeline enforces nothing.*

| Stage | Fails when | Typical |
|---|---|---|
| `lint` | ESLint or Prettier violation; `any`; cross-package relative import; a Discord snowflake literal outside fixtures | 30s |
| `typecheck` | Any type error under `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | 60s |
| `unit` | Any unit test fails | 60s |
| `integration` | Any integration test fails against ephemeral Postgres/Redis/Meilisearch | 4m |
| **`invariants`** | **Any `@INV-nnn` test fails, OR any invariant DUE BY THE CURRENT PHASE has no tagged test** — see the phasing note | 90s |
| `coverage` | Any package below its floor (`test-strategy.md`) | — |
| **`ssot-drift`** | **Any generated artefact differs from its SSOT source** | 20s |
| `contract` | OpenAPI ↔ route mismatch either way; `x-required-permission` ≠ the guard's actual permission; `tools.yaml` ↔ registry mismatch; redocly `struct` error | 40s |
| `secret-scan` | gitleaks finds anything, in the diff **or the full history** | 30s |
| `dep-audit` | A high or critical advisory with a fix available | 20s |
| `trivy` | A high or critical CVE in a built image | 90s |
| `build` | Any app fails to build | 3m |
| `contrast` | A `tokens.json` change drops a pair below its required ratio | 5s |

Target: **under 10 minutes**. A slower pipeline gets routed around, and a routed-around pipeline enforces nothing. Turborepo caching and parallel jobs are what keep it there.

## ★ The SSOT-drift check

**The mechanism the entire SSOT model depends on.** Without it, `ssot/` degrades from law to documentation, silently, in a single careless edit.

```bash
# tools/ssot-drift-check.ts
diff ssot/03-data/schema.prisma        packages/db/prisma/schema.prisma      # byte-identical
diff ssot/04-contracts/permissions.ts  packages/shared/src/permissions.ts    # byte-identical
regenerate from ssot/06-ai/tools.yaml       → diff against packages/ai-tools/src/generated/
regenerate from ssot/07-design/tokens.json  → diff against the Tailwind theme
assert every route in the API has an operation in openapi.yaml, AND vice versa
assert every INV-nnn in invariants.md has a passing tagged test
```

**The fix for a drift failure is always to change the SSOT first, then re-copy** (`AGENTS.md` §1). Editing the copy to match is the drift, not the cure.

Byte-identical comparison is deliberately strict: `prisma format` is run on the SSOT copy so both sides are canonical and the check is unambiguous. Whitespace tolerance would let a real change hide behind a formatting excuse.

**P0.6 explicitly tests that this check fails** when a copy is edited alone. A drift check that has never been observed failing is not known to work.

### Invariant phasing — why the gate is not "all 36 from day one"

An earlier revision demanded a tagged test for **every** invariant on **every** PR. That is
unsatisfiable from P0 until P8: at P0 exit there is no forum, no EDDN, no RAG and no agent, so
34 of 36 invariants have nothing to test against. A test for INV-003 ("move a thread to an
officer category, assert zero retrieval rows") cannot be written before either exists.

The predictable outcome is the one that matters: **the first agent to hit red CI on P0.1 adds an
exemption list to unblock the build, and the single mechanism that turns invariants from prose
into enforcement is neutered in week one** — silently, with every later phase inheriting a check
that reports green while proving nothing (ARCH-ADV A1).

**The fix:** every invariant declares its due phase in `invariants.md`:

```markdown
**INV-003** `SEC` `due:P8` · knowledge_chunks.visibility always equals …
```

`tools/invariant-coverage.ts` reads `due:Pn`, compares it against the current phase in
`STATUS.md`, and requires a tagged test **only for invariants due by that phase**. It fails if:

- an invariant has no `due:` marker at all — so a new one cannot slip past the system;
- an invariant is **past due** and still untested;
- the phase in `STATUS.md` advanced but the newly-due invariants have no tests.

**Not-yet-due invariants are reported as a count, never as a pass.** Every run prints
`28 due / 28 covered · 8 not yet due (P4, P6, P8)`, so the gap stays visible instead of hiding
behind an exemption file.

## `main` pipeline

```
build and push images (tagged with the commit SHA)
  → deploy staging
  → smoke tests
  → ★ MANUAL GATE ★                 ← production is never deployed autonomously
  → deploy production
  → post-deploy health verification
  → automatic rollback on failed health check
```

Migrations run via `prisma migrate deploy` **before** the new image serves traffic — hence expand/contract and backwards compatibility (`09-runbooks/deploy.md`).

## Local parity

```bash
pnpm ci:local      # runs the full PR pipeline locally
```

**Required before any merge in local mode** (`git-workflow.md`), and worth running before pushing once a remote exists. Local and CI use the same compose stack so "works locally" means the same thing in both places.

## Scheduled jobs

| Job | Cadence | Purpose |
|---|---|---|
| Dependency update PRs | weekly | Renovate/Dependabot, grouped |
| Full-history secret scan | weekly | Catches a secret introduced before gitleaks was added |
| **Restore test reminder** | monthly | Fails if the last recorded restore test is >30 days old |
| `coriolis-data` + FDevIDs check | monthly | **Stale module data produces wrong builds** |
| Trivy re-scan of running images | daily | A CVE published after a deploy |
| Certificate expiry check | daily | Alerts 30 days out — an expired mTLS cert presents as "GSAI offline" |
| Invariant coverage report | weekly | Trend, not just pass/fail |

## Quality gates by risk tier

| | Tier 1 | Tier 2 | Tier 3 |
|---|:---:|:---:|:---:|
| Full CI | ✓ | ✓ | ✓ |
| Coverage floor | ✓ | ✓ | ✓ |
| Invariant suite | ✓ | ✓ | ✓ |
| Review gates | — | per ADR-021 | **all applicable** |
| Negative authz test | — | if authz involved | **always** |
| **Autonomous merge** | **allowed** | **allowed** | **never** |

CI enforces the **path-based tier floor** — a tier-1 claim on a tier-3 path is rejected (ADR-021). This is what makes tier self-assignment safe.

## What CI cannot check

Recorded so nobody mistakes a green pipeline for a complete review:

| Not checkable | Caught by |
|---|---|
| Whether the test was written first | Review gate, branch history |
| Whether a test asserts anything meaningful | Review gate — reviewers are explicitly instructed to look for assertion-free tests |
| Whether the design meets the requirement | DESIGN-ADV |
| Whether a runbook actually helps at 02:00 | OPS-ADV |
| Whether a member is misled by the UI | UX-ADV |
| Whether an external contract matches reality | **Live verification, tracked as `@unverified` in `STATUS.md`** |
| Whether the orders board matches how the squadron operates | Asking the BGS lead |

**A green pipeline means "nothing known-checkable is broken", not "this is correct".** The review gates exist for the rest.

## Failure policy

| Situation | Response |
|---|---|
| A stage fails | Fix it. **Never `--no-verify`, never skip a test to get green.** |
| A flaky test | Quarantine it explicitly with an issue and a deadline. `.skip` outside the quarantine list fails the build. |
| The pipeline exceeds 15 minutes | Optimise it. A slow pipeline gets routed around. |
| A drift check fails | **Change the SSOT, then re-copy.** Never edit the copy. |
| A dependency advisory has no fix | Document as an accepted risk with an expiry date, and re-review at that date. |
| CI itself is broken | Fixing CI takes precedence over feature work — it is the only gate that runs on everything. |
