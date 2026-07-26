# BUILD STATUS
_Last updated: 2026-07-25 by agent (SSOT bootstrap)_

## Current position
Phase: **pre-P0** — SSOT bootstrapped, awaiting human review
Task:  none in flight
Blocked on: human review of `ssot/`, then the D-series decisions below that are marked `BLOCKS P0/P1`

## Phase completion
| Phase | Name | Status | Completed |
|-------|------|--------|-----------|
| P0 | Foundations | NOT_STARTED | — |
| P1 | Identity & shell | NOT_STARTED | — |
| P2 | Forums | NOT_STARTED | — |
| P3 | Telemetry spine | NOT_STARTED | — |
| P4 | BGS console | NOT_STARTED | — |
| P5 | Ops & carriers | NOT_STARTED | — |
| P6 | Trade terminal | NOT_STARTED | — |
| P7 | Shipyard | NOT_STARTED | — |
| P8 | Grim's Squad AI | NOT_STARTED | — |
| P9 | Polish & delight | NOT_STARTED | — |

Status values: `NOT_STARTED | IN_PROGRESS | BLOCKED | REVIEW | DONE`.

## External dependencies — LEAD TIME CRITICAL
| Item | Status | Requested | Notes |
|------|--------|-----------|-------|
| Frontier cAPI developer access | NOT_REQUESTED | — | BLOCKS P1.8 verification (`trust_tier` 3). Apply day 1 at `user.frontierstore.net`. Discretionary approval, days-to-weeks. Fallback path (P1.8b, Inara nonce + officer manual) ships regardless. |
| Inara API app whitelisting | NOT_REQUESTED | — | Blocks enrichment only (nightly cross-check). Apply day 1 — PM CMDR Artie with app name, purpose, expected volume, non-commercial status. Unapproved key returns `400 This application has no access allowed.` |
| Domain registered | NOT_STARTED | — | BLOCKS P0.7. See decision D1. |
| VPS provisioned (4 vCPU / 8 GB / 160 GB NVMe) | NOT_STARTED | — | BLOCKS P0.7. Harden on provision: SSH keys only, fail2ban, ufw, unattended-upgrades. |
| Cloudflare account + DNS delegated | NOT_STARTED | — | BLOCKS P0.7 (TLS, Turnstile, Access, Tunnel). |
| Discord app + bot created | NOT_STARTED | — | BLOCKS P1.1. **Must enable the SERVER MEMBERS privileged intent** or `guild_roles` is silently empty. |
| Object storage bucket | NOT_STARTED | — | BLOCKS P2.3. See decision D5. |
| Git remote | NOT_STARTED | — | Human will advise location. Until then git is local-only; `10-quality/git-workflow.md` §"Local mode" applies. |
| NVIDIA driver 580+ on the AI box | NOT_STARTED | — | BLOCKS P8.1. Verify both GPUs enumerate before anything else. |
| Ollama models pulled + benchmarked | NOT_STARTED | — | BLOCKS P8.2. ≥75% tool-call reliability required before building on it. |

## Unverified external contracts
_Adapters written from documentation, not yet tested against the live API. Every row must reach `Verified: YES` before its phase can exit._

| Adapter | Endpoint group | Written | Verified | Phase |
|---------|----------------|---------|----------|-------|
| Ardent | `/v2/commodities`, `/v2/commodity/*` | NO | NO | P3.2 |
| Ardent | `/v2/system/*` (prefer `/address/`) | NO | NO | P3.2 |
| Ardent | `/v2/market/*`, `/v2/stats` | NO | NO | P3.2 |
| EDSM | `api-v1/system`, `api-system-v1/*` | NO | NO | P3.3 |
| GalNet | JSON feed | NO | NO | P3.3 |
| FDevIDs | CSV releases | NO | NO | P3.3 |
| EDDN | `tcp://eddn.edcd.io:9500` | NO | NO | P3.4 |
| Spansh | job submit + poll, dumps | NO | NO | P3.6 |
| Frontier cAPI | OAuth2 PKCE + `/profile` | NO | NO | P1.8 |
| Inara | `getCommanderProfile` | NO | NO | P1.8b |
| Discord | OAuth2 + Gateway + REST | NO | NO | P1.1 |

## Open decisions awaiting human
| # | Question | Blocking | Asked |
|---|----------|----------|-------|
| D1 | What is the real domain name? (spec uses `grimssquad.example` throughout) | P0.7 | 2026-07-25 |
| D2 | Discord guild ID, and the **actual** role names/IDs in your server, mapped to the seven internal roles in `02-domain/rings-and-roles.md`. The spec lists *typical* names, not yours. | P1.3, P1.4 | 2026-07-25 |
| D3 | Home system (name + `SystemAddress`) and the list of tracked minor factions, flagged `is_ours`. | P3.4, P4.1 | 2026-07-25 |
| D4 | EDDN prefilter radius in ly around home. Spec says "within X ly" and never sets X. Recommend 250 ly to start; it is the single biggest lever on disk usage. | P3.4 | 2026-07-25 |
| D5 | Object storage: Cloudflare R2 or self-hosted MinIO on the VPS? Spec offers both, picks neither. | P2.3 | 2026-07-25 |
| D6 | Secret store: Doppler, Infisical, or SOPS-in-repo-with-age? Spec lists three. | P0.7 | 2026-07-25 |
| D7 | BGS tick detection source. Spec says "community tick detectors exist" without naming one, and offers inference-from-EDDN-clustering as an alternative. Which, or both with one as fallback? | P4.2 | 2026-07-25 |
| D8 | Confirm RTX 3060 VRAM: 12 GB or 8 GB. Run `nvidia-smi --query-gpu=index,name,memory.total,uuid --format=csv`. Changes the model tier. | P8.1 | 2026-07-25 |
| D9 | Instance B model: `qwen3:14b` or `gpt-oss:20b`. Spec says benchmark both against our real tool schemas and keep the winner — so this resolves at P8.2, not before. | P8.2 | 2026-07-25 |
| D10 | TimescaleDB for `market_history`? Spec marks it optional. Without it, a 90-day retention job is required instead. Adding it later means a data migration. | P3.4 | 2026-07-25 |
| D11 | Transactional email provider for digest emails (Resend / Postmark / none — Discord DM only). Spec offers "$0–10/mo" without choosing. | P2.4 | 2026-07-25 |
| D12 | Squadron display identity: exact squadron name as rendered, motto, and the real division list (spec's Combat Wing / Mining Ops / Exploration Corps / BGS Cell / Logistics is an example, not your structure). | P1.9 | 2026-07-25 |
| D13 | Is mandatory TOTP 2FA for `officer`+ in scope for P1, or deferred? Spec §5.6 says "optional TOTP 2FA, mandatory for officer and above" without placing it in a phase. | P1.6 | 2026-07-25 |
| D14 | Squadron size today, and expected in 12 months. A1 assumed 20–150 CMDRs; this sets connection-pool, rate-limit and Meilisearch sizing. | P0.2 | 2026-07-25 |
| D15 | Are there members under 18 in the squadron? Spec §10.4 raises this; the answer changes moderation policy and what telemetry we should collect at all. | P2.6 | 2026-07-25 |

## Adversarial review log
See `10-quality/review-log.md`. Summary:

| Phase | DESIGN-ADV | ARCH-ADV | RED-TEAM | DATA-INTEGRITY-ADV | UX-ADV | OPS-ADV |
|---|---|---|---|---|---|---|
| SSOT bootstrap | — | PASSED w/ fixes | PASSED w/ fixes | PASSED w/ fixes | — | — |
| P0 | pending | pending | n/a | n/a | pending | pending |

## Deferred / known debt
| Item | Phase deferred from | Why |
|------|---------------------|-----|
| Frontier cAPI verification (`trust_tier` 3) | P1 | Gated on external approval (see dependency table). Fallback verification path ships in its place; cAPI is an upgrade, never a dependency. |
| ED-specific forum embeds | P2 | Requires P3 game data. P2.9 ships the extension point with a no-op renderer registered. |
| Influence projection / what-if simulation | P4 | Needs months of accumulated snapshots before a model means anything. Moved to P9. |
| Squadron ledger & economy | P5 | Explicitly P9 in the roadmap. |
| Voice AI (Whisper + Piper) | P8 | P9. |
| Cloud LLM fallback | P8 | Feature-flagged, off by default, not built in P8. |
| Multi-hop beam-search routing | P6 | Single-hop then loops first; beam search only if the simpler forms prove insufficient. |
| i18n | — | Scaffolding is cheap now, retrofit is expensive — but no translations until there is demand. P9. |

## Session handoff notes
_Newest first. One line per session that changed state._

- **2026-07-25 · agent** — SSOT bootstrapped from `docs/grims-squad-build-spec.md`. 21 ADRs written, schema validated, contracts and task graph produced. Adversarial review round run against the SSOT itself; findings resolved (see `10-quality/review-log.md`). Nothing built. P0 not started — awaiting human review and the D-series answers marked `BLOCKS P0`.
