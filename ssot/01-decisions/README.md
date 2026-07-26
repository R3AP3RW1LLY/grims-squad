# ARCHITECTURE DECISION RECORDS

An ADR here is **settled**. Do not re-litigate it, do not work around it in code, do not "improve" it in passing. To change one: write a new ADR in `proposed/` stating the problem, at least two options with trade-offs, and a recommendation — then ask the human. An accepted ADR is never edited; it is **superseded** by a new one.

Every ADR has: Context · Decision · Consequences · Alternatives rejected (and why) · Status · Date.

## Index

| # | Title | Status | Decides | Binds phases |
|---|---|---|---|---|
| [001](ADR-001-typescript-monorepo.md) | TypeScript monorepo, pnpm + Turborepo | Accepted | Language, repo shape, package boundaries | all |
| [002](ADR-002-discord-primary-identity.md) | Discord OAuth2 is the primary identity | Accepted | Who a user is, and how roles arrive | P1 |
| [003](ADR-003-frontier-capi-verification.md) | Frontier cAPI is verification, not session | Accepted | Proof-of-CMDR as a recurring ceremony | P1, P5, P7 |
| [004](ADR-004-inara-enrichment-only.md) | Inara is enrichment only, never in a request path | Accepted | Where Inara may and may not appear | P1, P3 |
| [005](ADR-005-permission-bitmask-authz.md) | Permission bitmask + data-layer enforcement | Accepted | The entire authorization model, and its storage type | P1 onward |
| [006](ADR-006-custom-forum-not-discourse.md) | Custom forum, not Discourse SSO | Accepted | Forum ownership; thread-level Discord bridge only | P2 |
| [007](ADR-007-eddn-own-collector.md) | Run our own EDDN collector | Accepted | We own the market/system data layer | P3 |
| [008](ADR-008-ardent-primary-trade-source.md) | Ardent Insight is the primary external trade source | Accepted | Acceleration layer; hosted API in v1 | P3, P6 |
| [009](ADR-009-selfhost-coriolis.md) | Self-host Coriolis rather than build outfitting | Accepted | Shipyard strategy and its non-commercial condition | P7 |
| [010](ADR-010-vps-edge-local-ai.md) | Public edge on a VPS, AI at home | Accepted | Topology and the availability contract | P0, P8 |
| [011](ADR-011-dual-gpu-two-ollama-instances.md) | Two isolated Ollama instances, one per GPU | Accepted | GSAI runtime shape and the arbiter's existence | P8 |
| [012](ADR-012-deterministic-fast-path-before-agent.md) | Deterministic fast path is the front door | Accepted | Request routing; the agent loop is the fallback | P8 |
| [013](ADR-013-adapter-interfaces-for-all-external-apis.md) | Every external API behind an adapter interface | Accepted | Survival of the third-party ecosystem | P3 onward |
| [014](ADR-014-edmc-plugin-as-telemetry-spine.md) | The EDMC plugin is the telemetry spine | Accepted | How the site learns what CMDRs do | P3 onward |
| [015](ADR-015-acl-mirrored-in-rag-index.md) | ACLs are mirrored into the RAG index | Accepted | The AI's read boundary; the leak we exist to prevent | P8 |
| [016](ADR-016-test-driven-development.md) | Test-driven development is mandatory | Accepted | Order of work; invariant test suite | all |
| [017](ADR-017-adversarial-review-gates.md) | Adversarial review panels gate merges | Accepted | Who reviews, with what stance, and when | all |
| [018](ADR-018-trunk-based-autonomous-merge.md) | Trunk-based flow with bounded autonomous merge | Accepted | Branching, PRs, when an agent may merge alone | all |
| [019](ADR-019-cicd-quality-gates.md) | CI/CD is the enforcement mechanism | Accepted | Pipeline stages; SSOT-drift as a hard failure | all |
| [020](ADR-020-contract-first-generation.md) | Contracts generate code, not the reverse | Accepted | OpenAPI, permissions.ts, tools.yaml as sources | all |
| [021](ADR-021-risk-tiering.md) | Risk tiers scale the gates | Accepted | How much ceremony a given change gets | all |

## Proposed

`proposed/` is empty. Changes land there first, never directly in this directory.
