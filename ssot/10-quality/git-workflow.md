# GIT WORKFLOW

Authority: ADR-018, `AGENTS.md` §10.

## Branches

```
main                              always deployable, always protected
  p<n>/<task-id-kebab>-<slug>     one task, one branch
```

```
p0/p0-2-database-up
p1/p1-3-permission-engine
p2/p2-5-acl-filtered-search
p8/p8-9-rag-acl-mirroring
fix/p4-2-tick-dedupe-regression   bug fix, referencing the task it regressed
```

- **No direct commits to `main`**, by human or agent.
- **One task per PR.** A PR touching two task IDs is split — this keeps the review gates and the revert unit aligned with the unit of work.
- Branch deleted on merge. Long-lived branches defeat trunk-based flow at this team size.

## Commits

Conventional Commits, task-tagged (`CONVENTIONS.md`):

```
<type>(<scope>): [P<n>.<m>] <imperative subject>
```

TDD produces a pair (ADR-016):
```
test(api): [P1.2] refresh-token reuse revokes the family — red
feat(api): [P1.2] refresh-token reuse revokes the family — green
```

Footers:
```
SSOT: ssot/STATUS.md, ssot/08-plan/tasks.yaml
BREAKING CHANGE: <what and the migration path>     # requires an ADR
Refs: ADR-005, INV-002
```

## PR body — required sections

```markdown
## Task
P2.5 — ACL-filtered search · risk tier 3 · ssot/08-plan/tasks.yaml

## Acceptance → test
| Criterion | Test | Status |
|---|---|---|
| Ring 0 search for a Ring 2 term returns zero | `search.acl.int.spec.ts › returns zero for a gated term` | ✅ |
| Facet counts reveal nothing | `search.acl.int.spec.ts › facet counts exclude gated matches` | ✅ |

## TDD evidence
a1b2c3d test(api): [P2.5] … — red
d4e5f6a feat(api): [P2.5] … — green

## Review gates
| Gate | Findings | Resolution |
|---|---|---|
| DESIGN-ADV | 0 BLOCKER, 1 MINOR | logged as debt |
| ARCH-ADV | 0 | — |
| RED-TEAM | 1 BLOCKER (CONFIRMED) | fixed in f0a1b2c |
| UX-ADV | 0 BLOCKER, 2 NIT | ignored |

## Test evidence
pnpm test → 412 passed
pnpm test:invariants → 36/36 invariants covered
pnpm ssot:check → clean

## SSOT touched
ssot/STATUS.md

## Merge authorisation
Tier 3 → HUMAN REQUIRED. Not merging autonomously.
```

## ★ Autonomous merge

An agent **may** merge when **all seven** hold:

1. CI fully green — including `ssot:check`, the invariant suite and the coverage gate
2. Every review gate for the risk tier passed, with **zero unresolved BLOCKER or MAJOR**
3. `ssot/STATUS.md` updated, plus any `ssot_updates` the task lists
4. **No destructive migration** — no `DROP`, no non-additive column change, no data-losing backfill
5. **No change to a security control, a secret, infrastructure, or anything with a recurring cost**
6. The task is inside the current phase's **SCOPE — IN**
7. **Risk tier 1 or 2**

An agent **must not** merge, and asks the human, for:

- Destructive or non-reversible migrations
- Anything in `ssot/01-decisions/` other than adding a file to `proposed/`
- Authentication, authorization, encryption, the tunnel, telemetry consent, or the RAG ACL path
- First production deployment of a new external integration
- **Any phase-exit merge** — a phase boundary is a human checkpoint by construction
- Anything increasing recurring cost
- **Anything the agent is unsure about. Uncertainty resolves to asking.**

CI enforces a **path-based tier floor**: a tier-1 claim on `apps/api/src/auth/**`, `apps/api/src/authz/**`, `packages/db/prisma/migrations/**`, `apps/gsai/src/security/**` or `ssot/01-decisions/**` is rejected. **An agent cannot tier-down its way past a gate** (ADR-021).

## Remote — live since 2026-07-26

**`github.com/R3AP3RW1LLY/grims-squad`, public.** Local mode is superseded; the section below is
retained only to explain why the transition cost nothing.

### Configured state — verified, not assumed

| Setting | Value | Why |
|---|---|---|
| Visibility | **public** | Human decision. See the outside-PR guard below. |
| Merge method | **squash only** | Merge commits and rebase are disabled; `main` stays a readable changelog. |
| Squash commit message | PR title + body | So the conventional-commit subject and the review-gate table land on `main`. |
| Branch deleted on merge | yes | Long-lived branches defeat trunk-based flow. |
| Required approvals | **0** | A PR is required, but no human approval is. **This is what makes autonomous merge possible** (ADR-018). |
| `enforce_admins` | **false** | The owner is never locked out of their own repository in an emergency. |
| Force push to `main` | **blocked** | |
| Deleting `main` | **blocked** | |
| Linear history | **required** | Enforces squash-only mechanically. |
| Required status checks | **none yet** | ⚠ CI does not exist until P0.6. Adding required checks now would block every PR on a check that never runs. **P0.6 must add them** — see below. |
| Workflow permissions | write, may approve PRs | So CI can label, comment and auto-close. |
| Issues | enabled | The route for outside bug reports. |
| Wiki / Projects | disabled | The SSOT is the documentation. |

### ★ P0.6 must close the status-check gap

Right now branch protection requires a PR but **checks nothing**, because no CI exists. That is the
correct state for a repository with no pipeline — but it means protection is currently procedural,
not mechanical.

**When P0.6 lands the pipeline, it must also run:**

```bash
gh api -X PATCH repos/R3AP3RW1LLY/grims-squad/branches/main/protection/required_status_checks \
  -F strict=true \
  -f 'contexts[]=lint' -f 'contexts[]=typecheck' -f 'contexts[]=unit' \
  -f 'contexts[]=integration' -f 'contexts[]=invariants' -f 'contexts[]=coverage' \
  -f 'contexts[]=ssot-drift' -f 'contexts[]=contract' -f 'contexts[]=secret-scan' \
  -f 'contexts[]=build' -f 'contexts[]=trivy'
```

This is an acceptance criterion on P0.6, not a footnote — until it runs, "CI green" is not a
merge precondition, it is a convention.

### Outside pull requests

The repository is public, so **anyone can fork it and open a PR — GitHub provides no setting that
prevents this.** `.github/workflows/close-outside-prs.yml` closes any PR from a non-collaborator
with an explanatory comment, allowing only Dependabot, Renovate and `github-actions[bot]` through.

**Honest limitation:** the PR is publicly visible for the seconds before the workflow runs. That is
inherent to a public repository and is the trade accepted in decision D19.

The workflow uses `pull_request_target`, which runs with the base repository's write token. It
therefore **never checks out or executes code from the PR head** — doing so would hand a fork's
code our token. It reads metadata only.

## Local mode — superseded, retained for the record

Before the remote existed, "PR" meant a local branch plus a `review-log.md` entry plus a `--no-ff`
merge. **The workflow did not change when the remote arrived; only the transport did.** That was
the point of specifying it: adopting an ad-hoc process and rewriting it later is exactly how a
workflow ends up not existing.

| Remote workflow | Local equivalent |
|---|---|
| Push a branch | Create the branch locally |
| Open a PR | Write the PR body as a dated entry in `10-quality/review-log.md` |
| CI runs | Run the pipeline locally: `pnpm ci:local` |
| Reviews | Same panels, findings recorded in the same log entry |
| Squash merge | `git merge --no-ff` into `main` with the squashed conventional subject |
| Branch deleted | `git branch -d` |

```bash
git switch -c p2/p2-5-acl-filtered-search
# … red/green commits …
pnpm ci:local                       # must be fully green
# … run the review gates, record findings in review-log.md …
git switch main
git merge --no-ff p2/p2-5-acl-filtered-search \
  -m "feat(api): [P2.5] ACL-filtered search

Acceptance criteria met, review gates passed (see review-log.md 2026-08-14).

SSOT: ssot/STATUS.md"
git branch -d p2/p2-5-acl-filtered-search
```

**`--no-ff` is deliberate: the merge commit is the audit record that a gate was passed.** An absent merge commit is visible in `git log` and is the local-mode equivalent of a bypassed branch protection.

When the remote arrives: `git remote add origin <url>` and push. History is preserved intact, and branch protection then enforces mechanically what the convention enforced by discipline.

## Revert

**A revert never needs permission.** If `main` is suspected broken:

```bash
git revert -m 1 <merge-sha>
```

Revert first, diagnose after. `main` staying green outranks any individual change. Then write the regression test *before* re-landing (ADR-016).

## Branch protection — configure the moment a remote exists

- [ ] Require a PR; no direct pushes to `main`
- [ ] Require all status checks to pass
- [ ] Require branches to be up to date before merging
- [ ] Squash merge only; delete branch on merge
- [ ] No force push, no deletion of `main`
- [ ] Include administrators — **the rules apply to the human too**
- [ ] Signed commits, if the maintainer uses signing

## Hygiene

| Rule | Why |
|---|---|
| **Never `--no-verify`** | It bypasses the hooks that catch secrets and drift. If a hook is wrong, fix the hook. |
| **Never force-push a shared branch** | |
| **Never commit a secret**, even in a branch you intend to delete | Git history is distributed. Rotate if it happens. |
| **Never commit generated output out of sync with its source** | `ssot:check` fails, and it should |
| **Rebase your own branch freely** before merging | Clean history helps the next session |
| **Never rewrite `main`'s history** | |
| `.gitattributes` normalises line endings to LF | The maintainer is on Windows; the VPS is not |
