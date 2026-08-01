# ADR-017 — Adversarial review panels gate merges

**Status:** Accepted · **Date:** 2026-07-25 · **Origin:** human directive, 2026-07-25 ("adversarial reviews in Design, Architecture, and red-team")

## Context

Ordinary code review, especially when performed by an agent reviewing agent-written code, converges on agreement. A reviewer asked "does this look right?" answers "yes" — the framing invites confirmation. The result is a review process that produces approvals without producing findings.

This project has specific failure modes that a confirmatory review will not catch: an ACL leak through a vector index, a market price surfaced without its age, a tick double-count that silently corrupts months of influence history, an EDDN parser that accepts malformed input and writes garbage. All of these look fine at a glance and are only found by someone actively trying to produce them.

Additionally, autonomous merge (ADR-018) requires something stronger than CI to justify it.

## Decision

**Reviews are adversarial by instruction. The reviewer's job is to break the thing, not to approve it.**

### The six gates

| Gate | Runs | Stance the reviewer is given |
|---|---|---|
| **DESIGN-ADV** | Before implementing a new module | "This design fails to meet the requirement because…" |
| **ARCH-ADV** | Before implementation, and at phase exit | "This will not survive contact with scale, failure, or change because…" |
| **RED-TEAM** | Phase exit for anything touching auth, ACLs, telemetry, uploads, tunnel or AI | "Here is how I get data I should not have." |
| **DATA-INTEGRITY-ADV** | Any phase touching EDDN, market, BGS or telemetry ingestion | "Here is the input that corrupts your data silently." |
| **UX-ADV** | Any member-facing surface | "Here is where a member is misled, blocked, or excluded." |
| **OPS-ADV** | Phase exit | "It is 02:00 and this is broken. The runbook does not help me because…" |

Which gates apply to a given change is set by its **risk tier** (ADR-021). Full protocol, prompts and finding format in `10-quality/adversarial-reviews.md`.

### Rules that make it work

1. **Independence.** Reviewers do not see each other's findings until all are submitted. Sequential review converges; parallel review diverges, and divergence is the point.
2. **A finding without a concrete failure scenario is a NIT by definition.** Severity `BLOCKER | MAJOR | MINOR | NIT` must be justified by inputs and state that produce a wrong result. "This could be cleaner" is not a finding.
3. **Findings are verified before they are acted on.** A second pass attempts to *refute* each finding. This is deliberate symmetry: adversarial finders over-report, so adversarial verification is required to keep the signal usable. Unrefuted BLOCKER and MAJOR findings are fixed, or converted into a written accepted risk in `08-plan/risks.md` with human sign-off.
4. **No self-approval.** The agent that wrote the code does not clear its own gate.
5. **Diversity over redundancy.** Where a change can fail in several ways, reviewers get *different lenses* (correctness / security / operability) rather than three copies of the same question.
6. **Every gate outcome is recorded** in `10-quality/review-log.md`: phase, task, gate, findings by severity, resolution. An empty finding list is a legitimate result and is recorded as such — but a gate that has *never* produced a BLOCKER or MAJOR across a whole phase is itself evidence the stance is not being applied, and is flagged.

## Consequences

**Positive**
- Failure modes are found by someone looking for them, before members find them.
- Autonomous merge becomes defensible: a machine-checkable pipeline plus a human-adversarial-equivalent gate.
- The review log becomes an institutional memory of what was attacked and survived — valuable to a future session and to the human.

**Negative / accepted costs**
- **Substantially more work per change.** Contained by risk tiering (ADR-021) so trivial changes are not put through six panels.
- **False positives are guaranteed** — that is the price of the stance, and the reason the refutation pass exists.
- Reviewer independence costs wall-clock time and coordination.
- Gates can become theatre if the stance decays into "looks good". The empty-findings audit above is the countermeasure, and the human should spot-check the log.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Conventional "does this look right?" review** | Framing invites agreement. Produces approvals, not findings. The precise problem this ADR addresses. |
| **CI checks alone** | CI catches what someone thought to encode. It will never notice that a tick can be double-counted or that a stale price is presented as current. |
| **A single generalist adversarial reviewer** | One lens misses the others. A security reviewer does not think about tick double-counting; a data reviewer does not think about prompt injection. |
| **Sequential review (each sees the last)** | Anchoring. The second reviewer validates the first instead of finding something new. |
| **Findings acted on without verification** | Adversarial reviewers over-report by design. Without refutation, the team spends its time on non-problems and learns to ignore findings. |
| **The author clears their own gate** | Not a review. |
| **Six gates on every change** | Unaffordable and would be abandoned within a week. Risk tiering keeps it survivable. |


## Amendment — 2026-08-01: CONTROL-ADV

Six gates all asked variations of *"what gets through that should not?"*. None asked *"what is refused that should not be?"* — and that is the failure this project actually kept having.

Five incidents, all the same shape: a correct control, correctly implemented, silently refusing something legitimate. A CSP that refused a `data:` URI so a member could not choose a generated signature. A CSP that refused `blob:` so no image preview worked, reported as ".jpg uploads are broken". An artwork quota of five an hour against a feature that requests five per press, which the owner reported as the generator being dead. That same quota counting its own refusals, so retrying extended the lockout. And a bot that treats "no viewer roles" as "do not count" — right for a locked channel, catastrophic when the role list merely failed to load, which cost three days of unrecorded squadron activity with nothing in the logs.

None was a bad control. Every one was a good control nobody walked the happy path through.

So a seventh gate, and a rule that binds all seven: **a finding whose fix is a new or tighter control is incomplete until the reviewer states what that control does to the legitimate path.** A reviewer who cannot name the request it now refuses has not finished the finding.

The severity table changes with it: a control that silently disables a working feature is a BLOCKER, ranked alongside a leak. Availability is a security property, and a member who cannot use the site has not been protected from anything.

This does not weaken any existing gate. RED-TEAM still opens with *"here is how I get data I should not have."* CONTROL-ADV is the other half of the same question, asked by somebody else.
