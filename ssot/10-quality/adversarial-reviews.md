# ADVERSARIAL REVIEW PROTOCOL

Authority: ADR-017, `AGENTS.md` §9.

## The premise

A reviewer asked *"does this look right?"* answers *"yes"*. The framing invites agreement, and agent-reviewing-agent converges on approval faster than humans do. The result is a process that produces approvals without producing findings.

**So the reviewer is not asked whether it is right. The reviewer is instructed to break it**, and given the specific way this project breaks:

- An ACL leak through a vector index — silent, nothing errors
- A market price surfaced without its age — the fastest way to lose trust
- A tick double-count — silent, cumulative, corrupts months of history
- An EDDN parser that accepts malformed input and writes garbage
- A permission check in a controller but not the data layer

None of these look wrong at a glance. All of them are found by someone trying to produce them.

## The six gates

| Gate | Runs | The reviewer's opening sentence |
|---|---|---|
| **DESIGN-ADV** | before implementing a new module | *"This design fails to meet the requirement because…"* |
| **ARCH-ADV** | before implementation, and at phase exit | *"This will not survive contact with scale, failure, or change because…"* |
| **RED-TEAM** | phase exit for anything touching auth, ACLs, telemetry, uploads, tunnel or AI | *"Here is how I get data I should not have."* |
| **DATA-INTEGRITY-ADV** | any phase touching EDDN, market, BGS or telemetry ingestion | *"Here is the input that corrupts your data silently."* |
| **UX-ADV** | any member-facing surface | *"Here is where a member is misled, blocked, or excluded."* |
| **OPS-ADV** | phase exit | *"It is 02:00 and this is broken. The runbook does not help me because…"* |
| **CONTROL-ADV** | whenever a change adds or tightens a control — CSP, rate limit, permission, quota, validation, conservative default | *"Here is the legitimate thing this control refuses."* |

Which gates apply is set by **risk tier** (ADR-021). Trivial changes do not go through six panels — the ceremony must be proportionate or it will be abandoned, and abandoned exactly when it matters.

## Reviewer briefs

Each reviewer receives the change, the relevant SSOT files, and its brief. **Nothing else — no other reviewer's findings.**

### DESIGN-ADV
> Assume this design does not meet its requirement. Find where. Read the task's acceptance criteria and `02-domain/user-journeys.md`. For each criterion, construct the case it fails. Look for: requirements silently narrowed; a journey step with no implementation; an assumption not stated; a state that cannot be reached or cannot be left; an empty/loading/error state that was never designed.

### ARCH-ADV
> Assume this will not survive scale, failure, or change. Find how. Consider: what happens at 10× the data; what happens when each dependency is slow, down, or wrong; what happens on a partial deploy; which change to a neighbouring module breaks this; where state can drift between two sources of truth; whether a failure is loud or silent. **A silent failure is worse than a loud one and should be reported as more severe.**

### RED-TEAM
> Your goal is to obtain data you are not entitled to, or to take an action you are not permitted. Attempt: reading a Ring 1 row as Ring 0 through *any* path — controller, repository, search, RAG, WebSocket, API response shape; enumerating gated resources through counts, timings or 403-vs-404; escalating through prompt injection in indexed content; replaying a token or request; keeping access after a demotion, especially on a long-lived WebSocket; exfiltrating through AI tool arguments; polyglot or EXIF-bearing uploads. **Report the exact request sequence, not the theory.**

### DATA-INTEGRITY-ADV
> Find the input that corrupts data without anyone noticing. Consider: out-of-order EDDN messages; duplicate tick reports; a replayed journal file; a schema change that parses but means something different; BigInt values above 2^53; an ambiguous system name; a stale dump overwriting fresh data; a partial batch write; a retry after a timeout that double-applies; a migration that silently truncates. **Corruption that surfaces months later is the worst kind — weight it accordingly.**

### UX-ADV
> Find where a member is misled, blocked, or excluded. Consider: a price without its age; an empty state with no explanation of *why*; an error with no next step; a colour-only signal; keyboard-unreachable functionality; a touch target under 44px; a time shown in only one zone; a hover-only affordance on mobile; an action that cannot be undone with no confirmation; jargon a new recruit will not know.

### CONTROL-ADV
> Assume the control added here is correct, and find what it breaks. A control that works perfectly and disables the feature is not a security win, it is an outage with better paperwork.
>
> For each control introduced or tightened, answer three questions with evidence:
>
> 1. **What legitimate action does it refuse?** Walk the happy path THROUGH the control, not around it. A CSP that permits `'self'` refuses a `data:` URI; a quota of five refuses a feature that needs five; a permission nobody holds refuses everybody.
> 2. **Can the safe branch be entered by accident?** A conservative default is right on bad data and catastrophic when the data is merely missing — an empty list, a failed fetch, an unloaded config. Ask what the control does when its INPUT is absent rather than hostile.
> 3. **Is the refusal audible?** A control that refuses silently is indistinguishable from a broken feature, and the member reports it as one. Every refusal needs a reason the user can read and an operator can find.
>
> These are not hypotheticals. Every one has happened here:
>
> - `connect-src 'self'` refused `fetch('data:…')`, so choosing a generated signature failed with a generic exception and nothing naming the policy.
> - `img-src` without `blob:` refused every image preview. It was reported as ".jpg uploads are broken" and cost a deep dive into file formats.
> - An artwork quota of five an hour met a feature that requests five per press. One press consumed the hour; every press after was refused before reaching the GPU. The owner reported the generator as dead.
> - The same quota counted its own REFUSALS, so each retry extended the lockout. An hour's cooldown became an hour after the member stopped trying.
> - The Discord bot treats "no viewer roles" as "do not count", which is correct for a locked channel and catastrophic when the role list simply failed to load. It failed to load once, and three days of squadron activity went unrecorded with nothing in any log after the first line.
>
> Not one of those was a bad control. Every one was a good control that nobody walked the happy path through.

### OPS-ADV
> It is 02:00, this is broken, and you have only the runbooks. Find where you get stuck. Consider: an alert that does not say what to do; a failure mode with no runbook; a runbook step that assumes knowledge you do not have; a metric that would not have caught this; a restart that loses data; a rollback that does not work; a secret you cannot reach; a silent failure with no alert at all.

## Process

```
1. The change is frozen — no edits during review.
2. Each reviewer for the risk tier gets the change, the SSOT context, and its brief.
   ★ INDEPENDENTLY. No reviewer sees another's findings. ★
3. Each returns findings in the format below.
4. VERIFY: a separate pass tries to REFUTE each finding.
5. Unrefuted BLOCKER and MAJOR findings are fixed, or become an accepted risk in
   08-plan/risks.md with the maintainer's sign-off.
6. Outcomes recorded in review-log.md.
```

**Independence is what produces divergence, and divergence is the point.** Sequential review anchors the second reviewer on the first.

**Verification exists because adversarial reviewers over-report by design.** Without a refutation pass, the team spends its time on non-problems and learns to ignore findings — which destroys the gate more thoroughly than not having it.

**No self-approval.** The agent that wrote the code does not clear its own gate.

### A finding that proposes a control must exercise it

> **Any finding whose fix is a new or tighter control is incomplete until the reviewer has stated what the control does to the legitimate path.**

Not "this should be tightened" — what breaks when it is. A reviewer who cannot say which legitimate request the control now refuses has not finished the finding, and it is downgraded to MINOR until they can.

This is the single cheapest defence against the failure mode above, because the person proposing the control is the person best placed to know what it touches, and the least likely to be asked.

**"Secure yes, crippled no."** A platform that cannot perform its function is not a secure platform; it is an unavailable one, and availability is a security property. The gates exist to protect members, and a member who cannot use the site has not been protected from anything.

## Finding format

```yaml
- gate: RED-TEAM
  severity: BLOCKER          # BLOCKER | MAJOR | MINOR | NIT
  category: acl-leak
  file: apps/api/src/search/meilisearch.service.ts
  line: 84
  summary: One sentence stating the defect.
  failure_scenario: |
    CONCRETE inputs and state producing a wrong result.
    1. Officer creates a thread in "Command Deck" containing "zephyrquark".
    2. Ring 0 anonymous user calls GET /v1/forum/search?q=zephyrquark
    3. Response has hits: [] but estimatedTotalHits: 1
    → The existence of gated content is disclosed through the count.
  verdict: null              # set by the verification pass
```

**A finding without a concrete failure scenario is a NIT by definition.** "This could be cleaner" is not a finding. This rule is what keeps the gates from degenerating into style commentary.

## Severity

| Severity | Meaning | Blocks merge |
|---|---|---|
| **BLOCKER** | Security defect, data corruption, invariant violation, a member is actively misled, **or a control silently disables a working feature** | **yes** |
| **MAJOR** | Will fail under realistic conditions; a runbook gap for a likely incident | **yes** |
| **MINOR** | Real but low-impact; degrades under unusual conditions | no — logged as debt |
| **NIT** | Style, naming, preference | no |

## Verification pass

Each BLOCKER and MAJOR gets a refutation attempt:

> Try to prove this finding wrong. Read the code and the tests. Does the failure scenario actually occur? Is it already prevented elsewhere — a guard, a constraint, a test? Is the severity justified? **Default to REFUTED if you cannot reproduce the scenario as described.**

| Verdict | Meaning |
|---|---|
| `CONFIRMED` | Reproduced. Fix or accept as a written risk. |
| `PLAUSIBLE` | Cannot reproduce, cannot dismiss. **Treat as confirmed for BLOCKER; log as debt for MAJOR.** |
| `REFUTED` | Prevented elsewhere, or the scenario does not occur. Recorded with the reason. |

## Gate decay — the failure mode of this whole protocol

**A gate that has never produced a BLOCKER or MAJOR across an entire phase is evidence the adversarial stance has decayed into rubber-stamping**, not evidence that the code is flawless.

`review-log.md` tracks findings per gate per phase. Zero BLOCKER/MAJOR across a phase is **automatically flagged** for the maintainer to spot-check. It is not proof of a problem — a genuinely small phase may produce none — but it is the signal worth looking at.

The maintainer should periodically read a review's findings and ask whether they read like someone trying to break the thing, or like someone confirming it works.

## Applying to the SSOT itself

The SSOT was subjected to ARCH-ADV, RED-TEAM and DATA-INTEGRITY-ADV at bootstrap, before any code existed. Findings and resolutions are in `review-log.md`. A specification is a design, and designs are exactly what DESIGN-ADV and ARCH-ADV exist to attack — reviewing it before implementation is far cheaper than discovering the same problems in P4.
