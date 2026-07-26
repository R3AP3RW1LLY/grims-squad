# REVIEW LOG

Every adversarial review gate records its outcome here (ADR-017). In **local mode** this file also carries the PR body for each merge (`git-workflow.md`).

**Zero BLOCKER/MAJOR across an entire phase is automatically flagged** — it is evidence the adversarial stance may have decayed into rubber-stamping, not evidence of flawless code.

---

## Summary

| Phase | DESIGN-ADV | ARCH-ADV | RED-TEAM | DATA-INTEGRITY-ADV | UX-ADV | OPS-ADV |
|---|---|---|---|---|---|---|
| SSOT bootstrap | — | 2 findings | 3 findings | 2 findings | — | — |
| P0 | pending | pending | n/a | n/a | pending | pending |
| P1 | pending | pending | pending | n/a | pending | pending |

---

## 2026-07-25 — SSOT bootstrap, part 1: authoring self-review

**Subject:** the `ssot/` directory itself, before any code exists.
**Rationale:** a specification is a design, and designs are what DESIGN-ADV and ARCH-ADV exist to attack. Finding these in P4 would cost weeks.

> **Provenance, stated honestly:** these findings came from the authoring agent's own adversarial pass while transforming the spec — **not** from an independent panel. Under ADR-017 that does not satisfy a gate ("no self-approval"), so it is recorded as *self-review* and the independent panel is logged separately in part 2 below. The findings are real and the resolutions are in the SSOT; the process caveat is that the same party found and fixed them.

### Findings

| # | Gate | Severity | Finding | Verdict | Resolution |
|---|---|---|---|---|---|
| B1 | DATA-INTEGRITY-ADV | **BLOCKER** | `knowledge_chunks.embedding` is declared `vector(1024)` while the pinned embedder `nomic-embed-text` emits **768** dimensions. Every insert would fail, and the mismatch is only discovered at P8.9 after the schema is long since migrated. | CONFIRMED | Cannot be resolved by the agent without inventing a decision the spec does not make. Recorded as **decision D16** in `STATUS.md`, flagged in `schema.prisma`, `models.md`, `rag.md` and `indexes.md`, and made a blocker on P8.9. |
| B2 | ARCH-ADV | **MAJOR** | The spec's illustrative route SQL (§7.4) computes distance with an inline `sqrt(power(...))` expression, which **cannot use the GiST index** on `cube(ARRAY[x,y,z])`. Copying it verbatim yields a sequential scan over every system and misses the <2 s acceptance criterion by an order of magnitude. | CONFIRMED | `03-data/indexes.md` now states the cube-operator form explicitly and calls out the spec's version as non-indexable. P6.3 acceptance requires `EXPLAIN ANALYZE` to show no sequential scan. |
| B3 | RED-TEAM | **MAJOR** | Prisma's `@@unique([factionId, systemAddress, tickId])` does **not** constrain rows where `tickId IS NULL`, because Postgres treats NULLs as distinct. Unassociated snapshots could therefore be inserted repeatedly and INV-019 would fail **silently**. | CONFIRMED | Partial unique index added to `03-data/indexes.md` covering the NULL-tick case, and referenced from the schema comment and the ERD. |
| B4 | RED-TEAM | **MAJOR** | A long-lived WebSocket authorises its channels **at connect time**. A member demoted in Discord would keep receiving Ring 1 events for the life of the socket — the HTTP path busts the permission cache, the socket does not. | CONFIRMED | `04-contracts/websocket-events.md` now requires mask re-evaluation on `perm:{userId}` bust and channel drop within the same 5 s window as HTTP. Added to the must-have test corpus in `test-strategy.md`. |
| B5 | RED-TEAM | MAJOR | The three-value `visibility` enum on `knowledge_chunks` cannot express a category gated on a **custom** permission mask (e.g. BGS Intelligence on `BGS_REPORT`). A design relying on the enum alone would leak the moment such a category was indexed. | CONFIRMED | `06-ai/rag.md` now states the enum is a coarse pre-filter only, and that the category's `viewPerm` is carried in chunk `metadata` with a mask test added to the retrieval predicate. |
| B6 | DATA-INTEGRITY-ADV | MAJOR | Spec §8.4 marks four mutating AI tools as not requiring confirmation, which **directly contradicts** `AGENTS.md` §3.4 and INV-014. Left unresolved, an implementer would follow whichever document they read last. | CONFIRMED | Resolved in favour of the constitution (`AGENTS.md` §1 — it outranks the spec). All 11 write tools carry `confirmation: required` or `two_step`; the divergence and its reasoning are documented explicitly in `06-ai/guardrails.md`. |
| B7 | ARCH-ADV | MINOR | The spec's `market_history` design has no foreign key and no stated partitioning, while also being the highest-volume table. Unbounded growth is the failure mode. | CONFIRMED | 90-day retention documented in `03-data/retention.md` with an enforcing job and an alert; the absent FK is now a stated deliberate choice (batch-write performance) rather than an omission. |
| B8 | RED-TEAM | MINOR | `text.dim`, `brand.orangeDim` and `semantic.hostile`-on-`panelHover` all fail WCAG AA for normal text — while the spec's stated concern (`brand.orange`) actually **passes** at 5.95–7.31 against our surfaces. Following the spec's rule of thumb would have restricted a compliant colour and permitted three non-compliant ones. | CONFIRMED | All ratios computed rather than asserted; the three failures are listed as **forbidden combinations** in `07-design/accessibility.md`, with required substitutions. A CI contrast check now blocks a regression. |
| B9 | DATA-INTEGRITY-ADV | MINOR | Nothing in the spec states what happens to the RAG index after a **database restore**. A restored `knowledge_chunks` table predating an ACL change re-introduces exactly the leak INV-003 prevents. | CONFIRMED | `09-runbooks/backup-restore.md` now lists `rag:reindex` as a **security step** in the restore procedure, not a convenience, with the reasoning stated. |

### Not accepted

| # | Gate | Finding | Verdict | Reason |
|---|---|---|---|---|
| N1 | ARCH-ADV | "The monorepo couples all six services; a failure in one blocks all deploys." | REFUTED | Services build and deploy independently; the monorepo shares *source*, not a deployment unit. Turborepo scopes builds to changed packages. |
| N2 | RED-TEAM | "`describePermissions` in audit rows leaks the permission model to officers." | REFUTED | Officers are the intended audience of the audit log, and the permission model is documented in the SSOT rather than being a secret. Obscurity is not a control here. |

### Outcome
**9 findings accepted and resolved in the SSOT; 2 refuted.** One (B1) could not be resolved without inventing a decision the spec does not make, and was correctly escalated to the human as decision D16 rather than guessed at.

---

## Template for future entries

```markdown
## <ISO date> — <phase>.<task> <name>

**Risk tier:** <1|2|3>
**Gates run:** <list>
**Reviewers:** independent, no shared findings before submission

### Findings
| # | Gate | Severity | Finding | Verdict | Resolution |
|---|---|---|---|---|---|

### Merge
- CI: <result>
- Unresolved BLOCKER/MAJOR: <count — must be 0 to merge>
- Autonomous merge: <permitted | HUMAN REQUIRED, with the reason>
- Merge commit: <sha>
```
