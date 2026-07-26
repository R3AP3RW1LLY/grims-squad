# ADR-019 — CI/CD is the enforcement mechanism, and SSOT drift is a hard failure

**Status:** Accepted · **Date:** 2026-07-25 · **Origin:** human directive ("it must utilize full ci/cd") · **Spec origin:** §13.3

## Context

`AGENTS.md` and `ssot/` state many rules: strict types, no `any`, Zod at every boundary, negative authorization tests, encrypted tokens, no secrets in the repo, invariants tested, the schema copied rather than rewritten. Rules that depend on an agent remembering them across a fresh context are rules that will be broken.

The most dangerous class is **SSOT drift**. `ssot/03-data/schema.prisma`, `ssot/04-contracts/permissions.ts` and `ssot/06-ai/tools.yaml` are copied or generated into the codebase. The moment someone edits the copy instead of the source, the SSOT stops being the single source of truth and becomes documentation — and nothing announces it.

Autonomous merge (ADR-018) raises the stakes: CI is the only gate that runs on every change without exception.

## Decision

**Anything the SSOT requires that a machine can check, CI checks. A failing check blocks the merge; there is no override for agents.**

### Pull-request pipeline — all stages blocking
```
lint
typecheck (strict, all packages)
unit tests
integration tests (ephemeral Postgres + Redis + Meilisearch)
invariant suite (pnpm test:invariants — every @INV-nnn tagged test)
coverage gate (per-package floors)
SSOT-drift check
contract check (OpenAPI ↔ routes, tools.yaml ↔ registry, permissions parity)
secret scan (gitleaks)
dependency audit
Trivy image scan
build
```

### The SSOT-drift check — specific to this project, non-negotiable
CI fails if any of these differ from their SSOT source:

| SSOT source | Must equal |
|---|---|
| `ssot/03-data/schema.prisma` | `packages/db/prisma/schema.prisma` (byte-identical) |
| `ssot/04-contracts/permissions.ts` | `packages/shared/src/permissions.ts` (byte-identical) |
| `ssot/06-ai/tools.yaml` | regenerated `packages/ai-tools` registry (regenerate, diff, fail on delta) |
| `ssot/07-design/tokens.json` | the Tailwind theme in `apps/web` |
| `ssot/02-domain/invariants.md` | one passing `@INV-nnn` test per numbered invariant |
| `ssot/04-contracts/openapi.yaml` | every route the API registers, and vice versa |

**The fix for a drift failure is always to change the SSOT first**, then re-copy — never to edit the copy (`AGENTS.md` §1).

### `main` pipeline
```
build and push images
→ deploy staging
→ smoke tests
→ MANUAL GATE (human)          ← production is never deployed autonomously
→ deploy production
→ post-deploy health verification
→ automatic rollback on failed health check
```

### Migrations
Expand/contract, always backwards-compatible, deployed with `prisma migrate deploy`. **A migration that is not reversible cannot be merged autonomously** (ADR-018). Rollback is a previous image tag plus a down-migration, in one command.

### Zero-downtime
Rolling replace for `web`, `api`, `worker`. `bot` and `eddn-collector` are singletons: a few seconds of gap is accepted, and **both must be resumable**.

### Secrets
Never in the repo (`AGENTS.md` §3.6). `.env.example` holds placeholders only. gitleaks runs on every PR and on the full history. CI secrets come from the platform's secret store; the deployment secrets come from the store chosen in decision D6.

## Consequences

**Positive**
- The SSOT stays true by mechanism rather than by discipline — the failure mode that would otherwise be inevitable across many sessions.
- Autonomous merge becomes defensible, because "CI green" is a strong statement.
- A regression in a security invariant fails the build, not a member's privacy.
- Rollback is routine, so reverting is cheap and nobody argues about it.

**Negative / accepted costs**
- **A slow pipeline.** Integration tests need real services. Mitigated by Turborepo caching, parallel jobs, and running the heaviest scans only where relevant.
- CI infrastructure is itself a maintenance burden, on a hobbyist budget.
- Byte-identical drift checks are strict: formatting differences fail the build. Deliberate — `prisma format` is run on the SSOT copy, so both sides are canonical and the check is unambiguous.
- Ephemeral service containers make CI runs non-trivial to reproduce locally. `09-runbooks/local-dev.md` documents the same compose stack so local and CI match.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Convention and code review instead of automated checks** | Conventions do not survive fresh contexts. This is the exact assumption that produces drift. |
| **Drift check as a warning** | Warnings are ignored, and drift is silent by nature. It must break the build. |
| **Generating `schema.prisma` into the SSOT from the codebase** | Inverts the authority relationship. The SSOT would then document the code rather than govern it (ADR-020). |
| **Autonomous production deploys** | Loses the last human checkpoint before members are affected. Staging is autonomous; production is not. |
| **Unit tests only in CI** | The primary authorization control lives in the *data layer* (ADR-005) and cannot be unit-tested. Integration tests are where the security model is actually verified. |
| **Skipping container scanning to speed the pipeline** | The whole stack is self-hosted containers on a single VPS; an unpatched base image is the most likely breach path. |
| **A single monolithic CI job** | One failure gives no signal about what broke and re-runs everything. |
