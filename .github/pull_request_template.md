<!--
  Required by ssot/10-quality/git-workflow.md.
  Every section below is load-bearing. A PR that leaves one blank cannot be
  merged autonomously (ADR-018).
-->

## Task

<!-- e.g. P2.5 — ACL-filtered search · ssot/08-plan/tasks.yaml -->

**Risk tier:** <!-- 1 | 2 | 3 — see ADR-021. Tier 3 ALWAYS requires a human. -->

## Acceptance → test

<!-- Every acceptance criterion from tasks.yaml maps to a NAMED TEST.
     Criteria are test names, not aspirations (ADR-016). -->

| Criterion | Test | Status |
| --- | --- | --- |
|  |  |  |

## TDD evidence

<!-- The red/green commit pair from this branch. Squash-merging is fine; the
     branch history is the evidence. A commit whose test file is newer than its
     implementation is a §8 violation. -->

```
<sha> test(scope): [Pn.m] … — red
<sha> feat(scope): [Pn.m] … — green
```

## Review gates

<!-- Which panels ran, per the risk tier (ADR-017/ADR-021).
     A finding without a concrete failure scenario is a NIT by definition.
     Unresolved BLOCKER/MAJOR blocks the merge. -->

| Gate | Findings | Resolution |
| --- | --- | --- |
| DESIGN-ADV |  |  |
| ARCH-ADV |  |  |
| RED-TEAM |  |  |
| DATA-INTEGRITY-ADV |  |  |
| UX-ADV |  |  |
| OPS-ADV |  |  |

## Test evidence

```
pnpm lint          →
pnpm -r typecheck  →
pnpm test          →
pnpm ssot:check    →
pnpm invariants:check →
```

## SSOT touched

<!-- Files under ssot/ changed by this PR. STATUS.md at minimum. -->

## Merge authorisation

<!-- Autonomous merge requires ALL SEVEN conditions in git-workflow.md.
     If any is false, say so and leave it for a human. -->

- [ ] CI fully green
- [ ] Required review gates passed, zero unresolved BLOCKER/MAJOR
- [ ] `ssot/STATUS.md` updated
- [ ] No destructive migration
- [ ] No security-control, secret, infrastructure or recurring-cost change
- [ ] Inside the current phase's SCOPE — IN
- [ ] Risk tier 1 or 2

**Decision:** <!-- "Merging autonomously" or "HUMAN REQUIRED — <reason>" -->
