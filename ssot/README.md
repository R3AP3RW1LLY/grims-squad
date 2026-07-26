# SSOT — Single Source of Truth

`ssot/` is the law for Grim's Squad Hub. `AGENTS.md` is the constitution. Application code is downstream of both. If code and `ssot/` disagree, **the code is wrong**.

## Read order for a new session

1. `STATUS.md` — where the build actually is. Always first.
2. `CONVENTIONS.md` — naming, structure, commit format.
3. `08-plan/tasks.yaml` — the task for this session, its deps and acceptance criteria.
4. `10-quality/tdd-policy.md` + `10-quality/adversarial-reviews.md` — how work is done and gated.
5. Whatever the task references.

## Map

| Dir | Authoritative for | Change requires |
|---|---|---|
| `00-charter/` | Mission, scope boundary, hard constraints | Human |
| `01-decisions/` | Settled architectural decisions (ADRs) | New ADR in `proposed/` + human |
| `02-domain/` | Entities, rings/roles, invariants, journeys | ADR if invariants change |
| `03-data/` | `schema.prisma` — **the** data model, indexes, retention | ADR + migration plan |
| `04-contracts/` | OpenAPI, permission bitmask, errors, WS events, telemetry | ADR if breaking |
| `05-integrations/` | Every external service: endpoints, limits, failure modes | Update on live verification |
| `06-ai/` | GSAI architecture, tool registry, models, prompts, RAG, guardrails | ADR for architecture |
| `07-design/` | Design tokens, a11y contrast pairs, screens | Designer/human |
| `08-plan/` | Roadmap, task graph, risk register | Agent may update task state |
| `09-runbooks/` | Operational procedures | Agent may improve after an incident |
| `10-quality/` | TDD policy, review gates, CI/CD, git workflow, review log | Human |

## Generated-from relationships — drift is a CI failure

| SSOT file | Generates / must equal | Checked by |
|---|---|---|
| `03-data/schema.prisma` | `packages/db/prisma/schema.prisma` | `ci:ssot-drift` |
| `04-contracts/permissions.ts` | `packages/shared/src/permissions.ts` | `ci:ssot-drift` |
| `04-contracts/openapi.yaml` | generated client types + route coverage test | `ci:contract` |
| `06-ai/tools.yaml` | `packages/ai-tools` registry | `ci:ssot-drift` |
| `07-design/tokens.json` | Tailwind theme in `apps/web` | `ci:ssot-drift` |
| `02-domain/invariants.md` | one tagged test per `INV-nnn` | `ci:invariants` |

## Rules

- **Never fill a gap with a guess.** If the SSOT is silent, add a row to `STATUS.md → Open decisions awaiting human` and stop on that point.
- **Never edit an accepted ADR.** Supersede it with a new one.
- **`STATUS.md` is updated by every session that does work.** It is the handoff.
