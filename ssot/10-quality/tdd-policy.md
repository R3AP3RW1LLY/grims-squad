# TDD POLICY

Authority: ADR-016, `AGENTS.md` §8. This file is the operational detail.

## Why this is strict here specifically

Most of this system is built by agents across many sessions, each with a fresh context. Two consequences follow, and both are the reason the rule admits no exceptions:

1. **Tests are the only durable statement of intent.** A future session reads the test to learn what the code is supposed to do. Prose in a PR description is gone.
2. **Agents are systematically optimistic.** Code that *looks* correct gets reported as working. A test written *after* the implementation asserts what the code does, not what the requirement was — which is worth very little.

Plus: 36 invariants that are load-bearing security properties. An untested invariant is a comment.

## The cycle

```
RED     Write the test. RUN IT. WATCH IT FAIL.
        A test that passes before the implementation exists is testing nothing.
        Commit: test(scope): [Pn.m] <behaviour> — red

GREEN   Write the SIMPLEST implementation that passes. Not the elegant one.
        Commit: feat(scope): [Pn.m] <behaviour> — green

REFACTOR Improve with the tests green. Behaviour must not change.
        Commit: refactor(scope): [Pn.m] <what improved>
```

**Observing the failure is the part people skip, and it is the part that catches a test asserting nothing.** A test that passes against an empty implementation is not a test.

## Evidence

The branch history is the evidence; the PR body cites it. Squash-merging is fine — `main` stays readable and the branch carries the proof.

```
p2/p2-5-acl-filtered-search
  a1b2c3d  test(api): [P2.5] Ring 0 search for a Ring 2 term returns zero — red
  d4e5f6a  feat(api): [P2.5] apply the ACL filter in the Meilisearch query — green
  b7c8d9e  test(api): [P2.5] facet counts reveal nothing about gated matches — red
  f0a1b2c  feat(api): [P2.5] filter facets with the same expression — green
  c3d4e5f  refactor(api): [P2.5] extract buildAclFilter
```

**A commit whose test file is newer than its implementation file is evidence of a violation.** CI does not currently enforce commit ordering — it is a review-gate check, and reviewers are instructed to look.

## Acceptance criteria are test names

Every criterion in `08-plan/tasks.yaml` maps to a named test. The PR body carries the mapping:

| Acceptance criterion | Test |
|---|---|
| "A Ring 0 user searching a Ring 2 term gets zero results" | `search.acl.int.spec.ts › returns zero for a gated term` |
| "Facet counts reveal nothing" | `search.acl.int.spec.ts › facet counts exclude gated matches` |

**A criterion with no test means the task is not done**, regardless of whether the feature appears to work.

## Invariants

Every numbered invariant in `02-domain/invariants.md` has at least one test tagged `@INV-nnn`:

```ts
it('@INV-002 a Ring 0 principal cannot retrieve a Ring 1 row via the repository', async () => {
  const repo = makeRepo({ principal: ring0Principal });   // no controller, no guard
  const rows = await repo.forumThread.findMany({ where: { categoryId: ring1CategoryId } });
  expect(rows).toHaveLength(0);
});
```

- `pnpm test:invariants` runs only these. **Required, blocking CI job.**
- `tools/invariant-coverage.ts` parses `invariants.md`, collects every `INV-nnn`, and **fails if any has no passing tagged test.**
- Adding an invariant without a test breaks the build. That is intended: it is how an invariant becomes real rather than aspirational.

## Authorization work — the negative test is the test

```ts
it('officer can set a BGS order', ...)           // necessary
it('member CANNOT set a BGS order', ...)         // ← the one that matters
it('member attempt produces a denied audit row', ...)
```

**The negative test ships in the same commit as the positive one.** Proving access works is half a test; the half that matters is proving it is refused, and that the refusal is recorded.

## Bugs

```
1. Reproduce in a FAILING test. Do not fix anything yet.
2. Commit the failing test:  test(scope): reproduce <bug> — red
3. Fix.
4. Commit:                   fix(scope): <what> — green
```

**No fix lands without the test that would have caught it.** A bug that recurs after being "fixed" means step 1 was skipped.

## Exceptions — there are three, and they are narrow

| Situation | Rule |
|---|---|
| **Exploratory spike** | A time-boxed spike branch is permitted for genuinely unknown territory — tuning the intent classifier, discovering EDDN's real message shapes, benchmarking a model. **The spike is THROWN AWAY. It is never merged.** The work is then redone test-first with what was learned. |
| **Infrastructure config** | A Caddyfile or a systemd unit is verified by a smoke test rather than a unit test. The smoke test is still written first. |
| **Generated code** | Generated output is not hand-tested; **the generator is**, and the drift check proves the output matches its source. |

**"It's just a small change" is not on the list.** Neither is "the deadline".

## Anti-patterns — review-blocking defects

| Anti-pattern | Why it is a defect |
|---|---|
| Assertion-free test that only executes code | Moves coverage without verifying anything. **Reviewers are explicitly instructed to look for this** (ADR-017). |
| Test written after, back-dated | Defeats the entire mechanism. |
| Mocking the thing under test | Tests the mock. |
| Mocking the database in an authorization test | **The primary control lives in the data layer.** A mocked database cannot prove INV-002. |
| One test with fifteen assertions | A failure tells you nothing about which behaviour broke. |
| Testing implementation rather than behaviour | Breaks on every refactor and blocks the refactor step. |
| `expect(true).toBe(true)` as a placeholder | Delete it. |
| Skipping a test to get green | A skipped test is a failing test with the alarm disconnected. **CI fails on `.skip` outside an explicitly-quarantined list.** |

## The one-sentence version

**Write the test. Watch it fail. Then make it pass.**
