# ADR-018 — Trunk-based flow with bounded autonomous merge

**Status:** Accepted · **Date:** 2026-07-25 · **Origin:** human directive, 2026-07-25 ("you may autonomously merge and PR"; "for now track git locally")

## Context

The human has authorised agents to open and merge pull requests without waiting for review. This is necessary — a one-to-two-person team cannot be a synchronous approval bottleneck across a nine-month build, and an agent blocked on a merge click wastes a whole session.

It is also the single most dangerous authority in this document. An agent that can merge to `main` can, without any individual step looking wrong, ship a destructive migration, weaken a security control, or drift the codebase away from the SSOT.

Additionally, no git remote exists yet — the human will provide one later. The workflow must be identical before and after that, or it will be rewritten (badly) at the transition.

## Decision

**Trunk-based development, one task per PR, with autonomous merge permitted only inside an explicit boundary.**

### Flow
- `main` is always deployable and always protected. **No direct commits to `main`, by human or agent.**
- Branch per task: `p<n>/<task-id-kebab>-<slug>`, e.g. `p2/p2-4-reactions-subscriptions`.
- **One task per PR.** A PR touching two task IDs is split. This keeps the review gates and the revert unit aligned with the unit of work.
- Squash merge. Subject = the conventional-commit subject including the task ID. The PR body carries the acceptance-criteria checklist, the review-gate table, and the test evidence.
- Branch deleted on merge. Long-lived branches are forbidden — they defeat the point of trunk-based flow at this team size.

### Autonomous merge is permitted only when **all** hold
1. CI fully green, including the SSOT-drift check and the invariant suite (ADR-019).
2. Every review gate required by the change's risk tier passed, with **zero unresolved BLOCKER or MAJOR** findings (ADR-017, ADR-021).
3. `ssot/STATUS.md` updated, and any other SSOT files the task's `ssot_updates` lists.
4. **No destructive migration** — no `DROP`, no non-additive column change, no data-losing backfill.
5. **No change to a security control, a secret, infrastructure, or anything with a recurring cost.**
6. The task is inside the **current phase's SCOPE — IN**.
7. Risk tier 1 or 2. **Tier 3 always requires a human.**

### Autonomous merge is forbidden, and the human is asked, for
- Destructive or non-reversible migrations
- Anything in `ssot/01-decisions/` other than adding a file to `proposed/`
- Changes to authorization, authentication, encryption, the tunnel, telemetry consent, or the RAG ACL path
- First production deployment of a new external integration
- **Any phase-exit merge** — a phase boundary is a human checkpoint by construction
- Anything that increases recurring cost
- Anything the agent is unsure about. **Uncertainty resolves to asking.**

### Local mode — until a remote exists
The workflow does not change; only the transport does.
- "Open a PR" = create the branch, push nothing, write the PR body to `10-quality/review-log.md` as a dated entry.
- "Merge" = `git merge --no-ff` into `main` with the squashed subject, so the merge commit records the task and the gate outcomes.
- `--no-ff` deliberately: the merge commit is the audit record of a gate having been passed.
- When the remote arrives, the same branch names, the same PR bodies, and the same rules apply through GitHub. History is preserved and pushed as-is.

### Revert policy
A revert never needs permission. If `main` is suspected broken, revert first and diagnose after. `main` staying green outranks any individual change.

## Consequences

**Positive**
- Agents work end-to-end without a human in the loop for routine changes, which is what makes a nine-month part-time build feasible.
- The boundary is explicit, so "may I merge this?" has a checkable answer rather than a judgement call.
- One task per PR makes revert precise and the review gates meaningfully scoped.
- Local mode means no throwaway process and no migration cost when the remote appears.

**Negative / accepted costs**
- **Autonomous merge is a real risk and is accepted knowingly.** It is bounded by the seven conditions, by risk tiering, by the review gates, and by CI. Bounded, not eliminated.
- The human reviews `main` after the fact rather than before. The review log and `STATUS.md` handoff notes exist to make that review cheap.
- Local mode's "PR" is a convention, not an enforced control — nothing stops a careless agent from merging without the ceremony. Mitigated by the merge commit being the record: an absent record is visible in `git log`.
- Squash merge loses the red/green commit pair on `main`. Deliberate: the pair lives on the branch and is cited in the PR body, and `main` stays readable.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Every merge requires human approval** | The human explicitly asked for autonomy, and a synchronous approval bottleneck stalls a part-time project indefinitely. |
| **Unrestricted autonomous merge** | An agent could ship a destructive migration or weaken a security control with every individual step looking reasonable. The boundary is the whole point. |
| **Git flow (develop + release branches)** | Ceremony for a two-person team with continuous deployment. Long-lived branches accumulate conflicts nobody has time to resolve. |
| **Direct commits to `main`, no branches** | No pre-merge gate can exist, so the review gates and CI become advisory. |
| **Merge commits (no squash)** | `main` fills with red/green pairs and fixup commits, and `git log --oneline` stops being a usable changelog. |
| **Rebase-and-fast-forward** | Loses the merge commit that records which gates were passed — the audit trail that justifies autonomous merge in the first place. |
| **Waiting for the remote before adopting a workflow** | Guarantees an ad-hoc process now and a disruptive change later. |
| **Trunk-based with feature flags instead of branches** | Adds a flag lifecycle to manage for a team with no need for parallel release trains. |
