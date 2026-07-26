# RISK REGISTER

Every risk has an **owner**, a **trigger** (the observable condition that means it is happening, not a feeling), and a **response**. A risk with no trigger is a worry, not a risk.

Owner is a role: **maintainer** (the human), **agent** (whichever session is working), **officers** (the squadron's leadership).

Review at every phase exit. A risk whose trigger has fired and whose response was not executed is escalated to the maintainer.

---

## Top risks — ordered by expected damage

### R1 — Scope creep kills the project
**Likelihood: Very high · Impact: Very high · Owner: maintainer**

The single biggest risk here, and the spec says so explicitly. A nine-month part-time build with an enthusiastic maintainer and a wishlist of forty features has one obvious failure mode.

| Trigger | Response |
|---|---|
| A phase runs more than 1.5× its session estimate | Re-read SCOPE — OUT. Cut back to it. Move the rest to `tasks.yaml`. |
| A PR touches a task ID outside the current phase | Reject. Note it in `tasks.yaml`; return to the current phase. |
| A "quick addition" appears mid-phase | It is a task, in a phase, with acceptance criteria — or it does not exist. |
| The maintainer is excited about P8 during P3 | That excitement is the mechanism of this risk. GSAI is in P8 for documented reasons (ADR-012, roadmap). |

**Structural mitigations already in place:** phase gates with human sign-off; `scope.md`'s three lists including EXPLICITLY REJECTED; one task per PR; CI rejecting a tier-1 claim on a tier-3 path.

---

### R2 — Low adoption: members stay in Discord
**Likelihood: High · Impact: High · Owner: maintainer + officers**

**The risk that actually kills squadron sites.** The failure mode is a gorgeous site nobody visits because Discord is already open.

| Trigger | Response |
|---|---|
| <60% of active members post or react within 30 days of P2 exit | Stop feature work. Find out why by asking, not guessing. |
| The BGS orders board is viewed by <50% of active members in the week after a tick | The orders board does not match how the squadron actually operates — talk to the BGS lead. |
| Fewer than 3 members install the EDMC plugin by P3 exit | The install is too hard, or the value is not obvious. Both are fixable; neither fixes itself. |

**The counter, and it is structural:** every ops announcement, BGS order, AI answer and forum notification appears **in Discord with a link**. The site becomes the substrate; Discord stays the interface; people click through when they need depth. **Never build a feature that is only reachable on the site if Discord could surface it.**

---

### R3 — Solo maintainer burnout / bus factor
**Likelihood: High · Impact: High · Owner: maintainer**

| Trigger | Response |
|---|---|
| No commits for 3 weeks during an active phase | Reassess scope. Shipping P0–P2 and stopping is a legitimate, successful outcome. |
| Only one person holds production credentials | **Get a second admin. This is the mitigation, and it is not optional.** |
| A runbook is out of date when needed | Fix it in the same session as the incident. |
| The maintainer is doing manual ops work weekly | Automate it or delete the feature that needs it. |

Mitigations: document as you go (`ssot/` is the mechanism); keep the stack boring (`constraints.md`); autonomous agent merge for routine work so the human is not a bottleneck (ADR-018).

---

### R4 — AI gives confidently wrong game information
**Likelihood: High · Impact: Medium · Owner: agent**

**The AI's most likely real-world harm is not a data leak — it is costing a member their evening.**

| Trigger | Response |
|---|---|
| A member reports a wrong price, route or system | The feedback button routes it to officers. Reproduce, then fix the tool, not the prompt. |
| Benchmark reliability drops below 75% | Change model or quantisation (P8.2 gate). |
| Any market value surfaces without `dataAgeHours` | INV-004 violation. Blocking defect. |
| The fast-path classifier produces a confidently wrong answer | Raise the confidence threshold. **A miss costs a second; a false positive costs trust.** |

Mitigations: tools mandatory for facts; freshness surfaced everywhere; inferred ticks labelled provisional; step-limit honesty; a feedback control on every AI message.

---

### R5 — Third-party API disappears
**Likelihood: Likely over 2+ years · Impact: Medium · Owner: agent**

**EDDB.io — the community's default data source — shut down in 2023 and broke every tool built on it.** Ardent and Spansh are each maintained by one person.

| Trigger | Response |
|---|---|
| An adapter's circuit breaker opens repeatedly over a week | Investigate. Consider promoting our own EDDN data as the primary implementation. |
| A maintainer announces a shutdown | Swap the adapter implementation. **The interface does not change** (ADR-013). |
| A 404 on a previously-working endpoint | Alert loudly — most likely for Spansh, which is not formally versioned. |

Mitigations: adapter interfaces everywhere; our own EDDN collector; our own seeded database; fakes so tests never depend on a third party. **This is precisely why ADR-013 exists.**

---

### R6 — Frontier cAPI approval never arrives
**Likelihood: Medium · Impact: High if depended on, Low as designed · Owner: maintainer**

| Trigger | Response |
|---|---|
| No response 4 weeks after applying | Follow up. **Continue building.** |
| P1 approaches exit with no approval | Ship P1.8b (Inara nonce + officer manual) and record P1.8 as deferred. **Do not block the phase.** |
| Approval is refused outright | Trust tier 3 is unavailable. Tiers 2 and 1 carry the product. Fleet and carrier import become manual or EDMC-sourced. |

**Structural mitigation:** cAPI is an *upgrade*, never a dependency (ADR-003). The fallback path ships regardless.

---

### R7 — EDDN data volume exceeds the disk
**Likelihood: Medium (High without the prefilter) · Impact: High · Owner: agent**

| Trigger | Response |
|---|---|
| **Disk usage > 80%** | Alert. **Act at 80%, not 95% — a full disk also fails the restart.** |
| `market_history` row count grows >20% week-on-week | The prefilter has been widened or bypassed. Investigate. |
| A retention job fails | **Alert. A silently failing retention job is invisible until the disk is full.** |

Mitigations: the radius prefilter (>95% saving, decision D4); 90-day `market_history` retention; `market_orders` holding current state only; alerting at 80%.

---

### R8 — ACL leak through the RAG index
**Likelihood: Low as designed, High if the design is not followed · Impact: Very high · Owner: agent**

**The single failure this whole AI design exists to prevent.** A recruit receiving a summary of an officer-only thread. It fails *silently* — nothing errors.

| Trigger | Response |
|---|---|
| The mandatory ACL leak test fails | **P8 cannot exit. Not negotiable.** |
| A re-index job fails after an ACL change | **Treat as a potential leak until re-run.** Alert immediately. |
| A new content type is added without a re-index handler | CI fails the enumeration test. |
| A `visibility` value does not match its source | Nightly consistency sweep alerts. |

Mitigations: `knowledge_chunks.visibility` mirrors the source; filtering in the query before nearest-neighbour returns; re-index on every ACL change, never nightly; tier-3 classification on the whole path.

---

### R9 — Tick double-counting corrupts BGS history
**Likelihood: Medium · Impact: High · Owner: agent**

Silent, cumulative, and it destroys trust in every chart and every officer decision that reads the history. **Recovering means discarding the corrupted period.**

| Trigger | Response |
|---|---|
| Influence in our charts diverges from an independent source | Stop. Audit the dedupe logic before building anything further on it. |
| More than one snapshot exists for a (faction, system, tick) | Constraint violation. The partial unique index should have prevented it. |
| Tick detection disagrees with a known tick | **Fix before P4 exit. Naive inference makes everything downstream wrong.** |

Mitigations: unique constraint plus a partial unique index for the NULL-tick case (INV-019); validation against 7 days of known ticks; inferred ticks labelled provisional.

---

### R10 — The EDMC plugin stutters the game
**Likelihood: Low · Impact: High · Owner: agent**

If the plugin affects frame times, members uninstall it — **and the telemetry spine that feeds four modules goes with it.**

| Trigger | Response |
|---|---|
| Any member reports stutter | Treat as a P1 defect. Profile immediately. |
| Plugin install count drops | Ask why before assuming. |
| The telemetry endpoint's p99 exceeds 500 ms | The plugin's queue backs up inside a member's game process. Fix the endpoint. |

Mitigations: all I/O off the main thread; bounded queue; short timeouts; silent failure; measured zero frame impact as a P3.8 acceptance criterion.

---

### R11 — Autonomous merge ships something harmful
**Likelihood: Medium · Impact: High · Owner: maintainer**

An authority the human granted deliberately (ADR-018), and the most dangerous one in this document.

| Trigger | Response |
|---|---|
| `main` is broken | **Revert first, diagnose after. A revert never needs permission.** |
| A tier-3 change merged without a human | Process failure. Audit how the tier was assigned; strengthen the CI path floor. |
| A review gate returns zero BLOCKER/MAJOR findings across a whole phase | **Evidence the adversarial stance has decayed into rubber-stamping.** Flagged automatically. |

Mitigations: seven explicit merge conditions; path-based CI tier floor that cannot be gamed; phase exits always human; review log the maintainer can audit after the fact.

---

### R12 — Data breach of member information
**Likelihood: Low · Impact: High · Owner: maintainer**

We hold Discord identities, real-time gameplay locations, in-game finances and email addresses. **GDPR applies regardless of hobbyist status.**

| Trigger | Response |
|---|---|
| Any credential appears in the repository | gitleaks blocks the PR. If it reached `main`, **rotate immediately**, then investigate. |
| Unexpected access patterns in the audit log | Investigate. Revoke sessions if uncertain. |
| A dependency CVE with a known exploit | Patch inside 48 hours. |
| A member reports account compromise | Kill every refresh family; force re-auth. |

Mitigations: minimise what is collected; encrypt tokens at rest; telemetry opt-in defaulting off; hashed IPs; tested restores; Trivy and gitleaks in CI.

---

### R13 — Frontier objects to asset or data usage
**Likelihood: Low · Impact: High · Owner: maintainer**

| Trigger | Response |
|---|---|
| Any contact from Frontier | **Comply immediately. Do not negotiate first.** |
| A proposal to monetise the site | **Refuse.** It would forfeit the non-commercial basis for Frontier's IP and Coriolis's data (`constraints.md`). |
| Direct use of a ripped HUD asset | Remove. The aesthetic comes from `tokens.json`. |

---

### R14 — Inara whitelisting denied
**Likelihood: Medium · Impact: Low · Owner: maintainer**

Deliberately low impact — Inara is enrichment only (ADR-004).

| Trigger | Response |
|---|---|
| `400 This application has no access allowed` persists | Tier-2 verification is unavailable; the UI explains why. Officer-manual (tier 1) carries it. |
| Rate limiting or a ban | The global 2/min limiter should prevent this. If it happens, the limiter is not actually global. |

---

### R15 — EDDN schema change breaks the collector
**Likelihood: Medium · Impact: Medium · Owner: agent**

| Trigger | Response |
|---|---|
| Parse-failure **rate** rises above 0.5% | Inspect the dead-letter queue, update the parser. |
| A previously-populated field becomes null | Version-tolerant parsing should absorb it. If it does not, the parser is too strict. |

Mitigations: version-tolerant parsing; dead-letter queue; alerting on rate rather than count; unknown schemas ignored-and-counted rather than erroring.

---

### R16 — Stale `coriolis-data` produces wrong builds
**Likelihood: Medium · Impact: Medium · Owner: agent**

**Wrong module stats produce a build a member actually flies.** Worse than no build, and silent until someone notices.

| Trigger | Response |
|---|---|
| The monthly check is skipped | It is calendared for this reason. |
| A member reports a missing ship or wrong stat | Update, re-pin, **re-run the 1%-on-ten-builds suite**. |
| Our ported maths drifts from Coriolis | The test suite is the tripwire. Fix ours. |

---

### R17 — GSAI local box unavailable when members want it
**Likelihood: High · Impact: Low · Owner: agent**

**High likelihood, low impact — because the design assumes it.**

| Trigger | Response |
|---|---|
| GSAI offline > 15 min | Alert. **The site is unaffected** (INV-030). |
| Any non-AI feature degrades when the box is off | **INV-030 violation. Blocking defect.** |

---

## Accepted risks

Risks knowingly accepted rather than mitigated. Each needs the maintainer's sign-off to be added.

| # | Risk | Why accepted |
|---|---|---|
| A1 | Discord outage prevents new logins | Existing sessions survive; the alternative is a second identity system with its own roster to maintain. |
| A2 | GSAI answer quality varies between the 8b and the 14b | Facts come from tools, so the difference is reasoning depth, not correctness. Availability beats throughput. |
| A3 | Latency on every AI tool call that reads squadron data | The cost of a single authorization enforcement point. A second one would drift. |
| A4 | Coriolis and our UI will not look identical | Theming narrows it; forking to close it would create a permanent merge burden. |
| A5 | `bigint` ↔ `Decimal` conversion ergonomics | The mask exceeds 64 bits. Contained to `packages/shared`. |
| A6 | 65 OpenAPI operations lack enumerated 4xx responses | Tracked as a warning; closed endpoint-by-endpoint per phase; raised to error at P9. |
| A7 | Autonomous merge at tier 1 and 2 | Explicitly granted by the human, bounded by ADR-018's seven conditions. |

## Register maintenance

- Reviewed at every phase exit as part of OPS-ADV.
- A new risk needs a likelihood, an impact, an owner and a **trigger**. No trigger, no entry.
- An unrefuted BLOCKER or MAJOR review finding that is not fixed **becomes an accepted risk here, with the maintainer's sign-off** (ADR-017). It never simply disappears.
- A risk whose trigger has fired and whose response was not executed is escalated.
