# ADR-021 — Risk tiers scale the review ceremony

**Status:** Accepted · **Date:** 2026-07-25 · **Origin:** derived from ADR-017 and ADR-018

## Context

ADR-017 defines six adversarial review gates. ADR-016 requires TDD everywhere. ADR-019 defines a twelve-stage pipeline. Applied uniformly, a typo fix in a runbook would pass through the same ceremony as a change to the RAG ACL path.

Uniform maximum ceremony is not survivable for a one-to-two-person team. It gets abandoned, and once abandoned it is abandoned for the changes that needed it. The process must be proportionate or it will not exist.

Conversely, the boundary must not be a judgement call made in the moment by whoever wants to merge.

## Decision

**Every change carries a risk tier, assigned by explicit rules, and the tier determines which gates apply and whether autonomous merge is permitted.**

### Tier assignment — highest matching rule wins

| Tier | A change is this tier if it touches… |
|---|---|
| **3 — Critical** | Authentication, authorization, the permission bitmask or its data-layer enforcement, encryption or key handling, the tunnel or its request signing, telemetry consent, the RAG ACL path, AI tool permissions or the write-tool confirmation flow, destructive migrations, secrets, production infrastructure, recurring cost, or anything in `ssot/01-decisions/` |
| **2 — Standard** | Any new feature, endpoint, schema addition, external adapter, background job, ingestion path, or member-facing surface. **This is the default for feature work.** |
| **1 — Low** | Documentation, runbooks, comments, test-only additions, formatting, dependency patch bumps, non-behavioural refactors with unchanged tests |

**When in doubt, tier up.** An agent unsure between 2 and 3 treats it as 3.

### What each tier requires

| | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| TDD (red→green commits) | if code changes | **yes** | **yes** |
| Full CI pipeline | yes | yes | yes |
| DESIGN-ADV | — | if a new module | **yes** |
| ARCH-ADV | — | if a new module or a cross-cutting change | **yes** |
| RED-TEAM | — | if it touches user data or input | **yes, always** |
| DATA-INTEGRITY-ADV | — | if it touches ingestion or derived data | **yes if data is involved** |
| UX-ADV | — | if member-facing | if member-facing |
| OPS-ADV | — | if it adds a service, job or failure mode | **yes** |
| Negative authorization test | — | if authorization is involved | **yes, always** |
| **Autonomous merge** | **permitted** | **permitted** if all ADR-018 conditions hold | **never — human required** |

### Recording
The tier and its justification go in the PR body and in `10-quality/review-log.md`. A tier-1 claim on a change that touches `apps/api/src/auth/**`, the permission engine, the RAG path or a migration is **rejected by CI**, which enforces a path-based floor — an agent cannot tier-down its way past a gate.

### Phase exits are always tier 3
Regardless of the content of the final change, a phase boundary is a human checkpoint. It runs the full panel and requires human sign-off.

## Consequences

**Positive**
- The ceremony is proportionate, so it survives contact with a part-time schedule.
- Effort concentrates where the project's real failure modes are: ACLs, ingestion integrity, the tunnel, the AI boundary.
- Tier assignment is rule-based, not a negotiation, and the highest-matching-rule form removes the "but mostly it's a refactor" argument.
- The path-based CI floor means the classification cannot be gamed, which is what makes autonomous merge safe at tier 2.

**Negative / accepted costs**
- **A misclassification can route a genuinely risky change through light review.** Mitigated by tier-up-when-unsure, the path-based floor, and the human's after-the-fact review of the log.
- Tier boundaries need occasional revision as the system grows — a new subsystem may deserve a path in the tier-3 list. That revision is itself an ADR.
- Some tier-1 changes will feel over-gated by the full CI pipeline. Accepted: CI is cheap relative to a review panel, and exempting anything from CI reintroduces the drift problem.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Uniform maximum ceremony** | Unaffordable, therefore abandoned, therefore absent exactly when it matters. |
| **Uniform minimum ceremony** | The ACL leak, the tick double-count and the tunnel bypass all ship. |
| **Reviewer decides the tier per change** | A judgement call made by the party who wants to merge. Rules plus a mechanical floor instead. |
| **Tier by lines changed** | A one-line change to a permission check is far more dangerous than a 500-line UI addition. Size is not risk. |
| **Two tiers (risky / not risky)** | Collapses "new feature" and "touches auth" into one bucket, forcing a choice between over-gating features and under-gating security. Three tiers matches the actual distribution of work. |
| **Trusting agent self-classification without a CI floor** | An agent under context pressure will find a reason its change is tier 1. The path floor removes the option. |
