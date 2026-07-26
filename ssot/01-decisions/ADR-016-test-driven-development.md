# ADR-016 — Test-driven development is mandatory

**Status:** Accepted · **Date:** 2026-07-25 · **Origin:** human directive, 2026-07-25 ("it must be TDD driven")

## Context

Most of this system is built by agents across many sessions, each with a fresh context and no memory of the last. Two consequences follow.

First, **tests are the only durable statement of intent.** A future session reads the test to learn what the code is supposed to do; prose in a PR description is gone. Second, **agents are systematically optimistic** — code that looks correct gets reported as working. A test written *after* the implementation tends to assert what the code does rather than what the requirement was, which is worth very little.

The project also carries 30+ security and domain invariants (`02-domain/invariants.md`). An invariant nobody tests is a comment.

## Decision

**Red → Green → Refactor, per task, without exception.**

1. **The failing test is written and observed failing before the implementation exists.** Not "tests in the same PR" — tests *first*.
2. **The branch history must show it.** Each task produces at least two commits: `test(scope): [Pn.m] <behaviour> — red`, then `feat(scope): [Pn.m] <behaviour> — green`. Squash-merging the PR is fine; the branch is the evidence and the PR body records it.
3. **Every acceptance criterion in `08-plan/tasks.yaml` maps to a named test.** Acceptance criteria are test names, not aspirations. A task with an untested acceptance criterion is not done.
4. **Every invariant has a test tagged `@INV-nnn`.** `pnpm test:invariants` runs that suite alone and is a required CI job. An invariant without a passing tagged test is an unbuilt invariant.
5. **Authorization work requires the negative test in the same commit as the positive one.** Proving access works is half a test; the half that matters is proving it is refused.
6. **Bugs get a regression test first.** Reproduce in a failing test, then fix. No fix lands without the test that would have caught it.
7. **Test pyramid** per `10-quality/test-strategy.md`: many unit tests (pure logic, `packages/*`), a substantial integration layer against ephemeral Postgres/Redis/Meilisearch (anything touching the database — because the primary authorization control *is* in the data layer and cannot be unit-tested), a thin e2e layer for the critical journeys.
8. **Coverage is a floor, not a goal.** Gates are per-package in `10-quality/test-strategy.md`. **Assertion-free tests written to move a coverage number are a review-blocking defect**, and the adversarial reviewers are instructed to look for them.
9. **External services are never contacted in tests.** Every adapter has a fake (ADR-013). Contract fidelity is checked separately by explicitly-run live verification, tracked in `STATUS.md`.

## Consequences

**Positive**
- Requirements survive context loss, because they are executable.
- The invariant suite makes the security model continuously verified rather than aspirational.
- Refactoring is safe, which matters over a 9–11 month build.
- "Done" becomes machine-checkable, which is what makes bounded autonomous merge (ADR-018) defensible at all.

**Negative / accepted costs**
- **Measurably slower per task.** Accepted deliberately: the alternative is faster delivery of work that cannot be verified and will be rewritten.
- Integration tests need real infrastructure, so CI must spin up Postgres, Redis and Meilisearch. Slower pipeline, and worth it — the authorization control lives in the data layer.
- UI tests are brittle. Mitigated by testing behaviour and accessible roles rather than DOM structure, and by keeping e2e coverage thin and focused on journeys.
- TDD is awkward for exploratory work (tuning the intent classifier, EDDN parser discovery). Permitted route: a time-boxed spike branch that is **thrown away**, then the work is redone test-first. A spike is never merged.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Tests after implementation** | They assert what the code does, not what was required, and they are the first thing dropped under time pressure. Given agent optimism, this is close to no verification at all. |
| **"Tests in the same PR", order unspecified** | Unenforceable and indistinguishable from tests-after in practice. The commit pair is the enforcement mechanism. |
| **Coverage threshold with no ordering requirement** | Directly incentivises assertion-free tests that execute code without checking it. |
| **TDD only for security-critical code** | The boundary is not knowable in advance — a forum query is security-critical because of ADR-005. Uniform rules survive; conditional ones erode. |
| **BDD/Gherkin throughout** | A translation layer and a second vocabulary for a one-to-two-person team. Descriptive test names achieve the same readability. "Prefer boring." |
| **100% coverage requirement** | Drives effort into trivial getters and generated code while the hard paths stay under-tested. Floors plus mandatory invariant and negative-authorization tests target the risk directly. |
