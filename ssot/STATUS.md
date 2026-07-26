# BUILD STATUS
_Last updated: 2026-07-25 by agent (SSOT bootstrap)_

## Current position
Phase: **P0 — Foundations, IN PROGRESS**
Done:  P0.1 · P0.2 · P0.3 · P0.6 · P0.8
Next:  **P0.4** — API skeleton with `/v1/health`
Then:  P0.5 — web skeleton and design tokens
Blocked: **P0.7** (production deploy) — needs the Vultr API key and DNS pointed at Cloudflare (D22)

## Phase completion
| Phase | Name | Status | Completed |
|-------|------|--------|-----------|
| P0 | Foundations | **IN_PROGRESS** | 5 of 8 tasks |
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
| Domain registered | **CONFIRMED** | 2026-07-26 | **`grims-squad.com`**. Still to do: point DNS at Cloudflare. |
| VPS provisioned (4 vCPU / 8 GB / 160 GB NVMe) | NOT_STARTED | — | BLOCKS P0.7. Harden on provision: SSH keys only, fail2ban, ufw, unattended-upgrades. |
| Cloudflare account + DNS delegated | NOT_STARTED | — | BLOCKS P0.7 (TLS, Turnstile, Access, Tunnel). |
| Discord app + bot created | NOT_STARTED | — | BLOCKS P1.1. Guild ID known (`801929816596152320`). **Must enable the SERVER MEMBERS privileged intent** or `guild_roles` is silently empty. Role IDs still needed — see D2. |
| Object storage bucket | NOT_STARTED | — | BLOCKS P2.3. See decision D5. |
| Git remote | **CREATED** | 2026-07-26 | `github.com/R3AP3RW1LLY/grims-squad`, **public**. Branch protection configured; outside PRs auto-closed by workflow. Local mode no longer applies. |
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
| ~~D1~~ | ~~Real domain name~~ — **RESOLVED 2026-07-26: `grims-squad.com`.** | ~~P0.7~~ | closed |
| D2 | **PARTIALLY RESOLVED 2026-07-26.** Guild ID confirmed: `801929816596152320`. **Still needed: the Discord ROLE IDs.** A guild ID alone cannot map roles. Once the bot is in the server I can read them myself — or run `Server Settings → Roles → right-click a role → Copy Role ID` (Developer Mode on) for each of: the four leadership ranks, the two reserved ranks, and whatever role marks a plain member. Tenure and loyalty ranks need **no** Discord mapping, since they grant nothing. | P1.3, P1.4 | 2026-07-25 |
| D3 | **PARTIALLY RESOLVED 2026-07-26.** Home system: **Hyades Sector AV-W b2-4**, `SystemAddress` **9467852891473**, coords `(67.4375, 23.3125, -216.5)`, Federation/Democracy, pop 680,227,079 — resolved from EDSM and seeded. **Still needed: which minor faction is OURS.** Three factions control stations in the home system (Blood Brothers from Alrai, Lords of Kamil, Explorers of the Anarchy) and *two* stations carry the squadron's name under *different* factions, so this cannot be inferred safely — a wrong `is_ours` poisons every BGS number the site produces. Tracked in `TODO.local.md` §1. | P3.4, P4.1 | 2026-07-25 |
| ~~D4~~ | ~~EDDN prefilter radius~~ — **RESOLVED 2026-07-26: 500 ly** around `Hyades Sector AV-W b2-4`. ⚠ This is the wide option: ~60–110 GB of game data before indexes, which does **not** fit the 4 vCPU / 8 GB / 160 GB box the original budget assumed. Rolled into the Vultr sizing (D22). | ~~P3.4~~ | closed |
| ~~D5~~ | ~~Object storage~~ — **RESOLVED 2026-07-26: Vultr Object Storage** (S3-compatible, same provider as the VPS). The `IObjectStore` adapter is S3-API based, so this is a config choice rather than a code one. | ~~P2.3~~ | closed |
| ~~D6~~ | ~~Secret store~~ — **RESOLVED 2026-07-26: a root-owned `.env` on the VPS, mode `0600`, never in git.** No external service, no new code, no new attack surface — the right answer at one-server scale. Explicitly considered and rejected: building a bespoke secrets manager (security-critical code with a key-bootstrap problem) and SOPS-in-repo (the repo is public, so ciphertext would be permanently archived by third parties). `09-runbooks/secrets-rotation.md` already describes manual rotation, which is now the operative procedure. | ~~P0.7~~ | closed |
| ~~D7~~ | ~~BGS tick detection source~~ — **RESOLVED 2026-07-26: community detector as primary, EDDN-clustering inference as fallback.** Inferred ticks carry `confidence < 1` and are rendered **provisional** everywhere they surface — charts, the nightly digest and GSAI answers alike. The specific community feed is still to be named (`TODO.local.md`); until then the adapter is written against the inference path and the feed is added as primary when chosen. P4.2's validation against 7 days of known ticks is unchanged and remains mandatory. | ~~P4.2~~ | closed |
| ~~D8~~ | ~~RTX 3060 VRAM~~ — **RESOLVED 2026-07-26: 12 GB.** The 12 GB column in `06-ai/models.md` holds as written: `qwen3:8b` Q4_K_M at `num_ctx 16384` with `nomic-embed-text` co-resident, ~7.6 / 12 GB. GPU UUIDs still needed at P8.1 for pinning (`TODO.local.md` §3). | ~~P8.1~~ | closed |
| D9 | Instance B model: `qwen3:14b` or `gpt-oss:20b`. Spec says benchmark both against our real tool schemas and keep the winner — so this resolves at P8.2, not before. | P8.2 | 2026-07-25 |
| ~~D10~~ | ~~TimescaleDB for `market_history`~~ — **RESOLVED 2026-07-26: ADOPT IT.** `market_history` becomes a hypertable with 7-day compression and a 90-day retention policy. At a 500 ly prefilter the compression is what makes three months of history affordable. **One operational consequence:** the Postgres image must be **`timescale/timescaledb-ha:pg16`**, which bundles both TimescaleDB and pgvector — stock `pgvector/pgvector` has no Timescale and stock `timescaledb` has no pgvector. The Timescale retention policy **replaces** the `retention:market` job; running both would race. | ~~P3.4~~ | closed |
| ~~D11~~ | ~~Transactional email provider~~ — **RESOLVED 2026-07-26: NO EMAIL AT ALL.** Notifications are `in_app` + `discord_dm` only, and `email` is removed from the `NotificationChannel` enum. This deletes a paid service, DNS records on the domain, bounce and complaint handling, and unsubscribe compliance — for a channel nobody asked for, in a squadron that already lives in Discord. Re-adding the enum value later is a trivial additive migration. | ~~P2.4~~ | closed |
| ~~D12~~ | ~~Squadron display identity~~ — **RESOLVED 2026-07-26.** Name: **Grim's Squad**. Tagline: **"No Quarter in the Void"**. Divisions authored from the squadron's actual game loops: **Iron Legion** (combat/CZ/bounty), **Xeno Interdiction Corps** (AX), **Sable Directorate** (BGS), **Vanguard Survey** (exploration/exobiology), **Void Logistics** (trade/hauling), **Deepcore Prospectors** (mining), **Carrier Command** (fleet carrier ops). Division names are pending a keep/rename/cut pass (`TODO.local.md` §5) but are not blocking. | ~~P1.9~~ | closed |
| ~~D13~~ | ~~Mandatory TOTP 2FA for officers~~ — **RESOLVED 2026-07-26: build it in P1** as new task **P1.10** (6h, tier 3). Officers can moderate, set BGS orders, manage members and read the audit log; Discord OAuth alone means a compromised Discord account is a compromised officer account. Includes forced enrolment, hashed single-use recovery codes, step-up on tier-3 actions, rate limiting and replay rejection. | ~~P1.6~~ | closed |
| ~~D14~~ | ~~Squadron size~~ — **RESOLVED 2026-07-26: 150–400 CMDRs.** ⚠ **Above the spec's A1 assumption of 20–150.** Consequences now tracked under D22: pgbouncer is required rather than optional, Meilisearch's index approaches ~1 GB, the AI concurrency semaphore and 20/hr rate limit will actually bite on an ops night, and the `constraints.md` memory budget needs recomputing. | ~~P0.2~~ | closed |
| ~~D15~~ | ~~Under-18 members~~ — **RESOLVED 2026-07-26: YES, the squadron includes minors.** Protective defaults now binding — see `00-charter/constraints.md` § "Minors". This is a real constraint on the product, not a checkbox: the public activity ticker ships **off by default**, location consent carries additional plain-English warning copy, no birthdate is collected anywhere, and DM-based recruitment of minors into voice is written into the officer handbook as a moderation topic before P2 exit. | ~~P2.6~~ | closed |
| ~~D16~~ | ~~Embedding dimension conflict~~ — **RESOLVED 2026-07-26: `vector(768)` with `nomic-embed-text`.** The spec's `vector(1024)` against a 768-dimension model would have failed on every insert. Schema, `indexes.md`, `models.md` and `rag.md` all corrected. Model and dimension are pinned together and effectively immutable — changing either forces a full re-index. | ~~P8.9~~ | closed |
| D22 | **Vultr sizing and the budget ceiling — I provision, you approve.** You'll supply a Vultr API key and I provision infrastructure with your approval at P0.7. **Two things that must be settled at that moment, not after:** (a) The `constraints.md` ceiling of ~$30/mo assumed a Hetzner CX32-class box; Vultr costs materially more for equivalent specs, so the ceiling needs a new number from you. (b) **500 ly + 150–400 members does not fit 4 vCPU / 8 GB / 160 GB** — game data alone is ~60–110 GB before indexes, and Postgres's working set grows with membership. I will size it properly and tell you the cost **before** anything is provisioned. Nothing before P0.7 needs the key. | P0.7 | 2026-07-26 |
| ~~D21~~ | ~~Licence for a public repository~~ — **RESOLVED 2026-07-26: no LICENSE file, all rights reserved.** The repository is readable and studyable but not legally reusable. This is the reversible choice — a licence can be added later, but not easily withdrawn. **Still outstanding at P3.8:** the EDMC plugin must ship from a repo with public, readable source (ADR-014), which means splitting it into its own repository with its own licence rather than licensing the monorepo. | ~~P3.8~~ | closed |
| ~~D17~~ | ~~Prisma major version~~ — **RESOLVED 2026-07-26: pin `prisma@6`.** The SSOT schema validates clean on 6.19.3 as written. A Prisma 7 migration is a deliberate future task, not something mixed into P0. | ~~P0.2~~ | closed |
| ~~D18~~ | ~~Two review findings needing a squadron-process answer~~ — **BOTH APPROVED 2026-07-26.** (a) The recruitment application is split into an officer-only `deliberationThread` and an applicant-visible `applicantThread`, so officers have somewhere the applicant provably cannot read. (b) Staging is capped at 1 GB and its deploy refuses below 1.5 GB free — a staging run is skipped rather than risking production Postgres. Note (b) may become moot once D22 sizes the box properly. | ~~P2.7, P0.7~~ | closed |

## Adversarial review log
See `10-quality/review-log.md`. Summary:

| Phase | DESIGN-ADV | ARCH-ADV | RED-TEAM | DATA-INTEGRITY-ADV | UX-ADV | OPS-ADV |
|---|---|---|---|---|---|---|
| SSOT bootstrap — self-review | — | 2 findings | 3 findings | 2 findings | — | — |
| **SSOT bootstrap — independent panel** | — | **9 (3 BLOCKER)** | **8 (4 BLOCKER)** | **8 (3 BLOCKER)** | — | — |
| P0 | pending | pending | n/a | n/a | pending | pending |

**Independent panel, 2026-07-25: 25 findings — 10 BLOCKER, 12 MAJOR, 3 MINOR. All confirmed, all
resolved in the SSOT, 0 unresolved.** Three independent agents, run in parallel, none of them the
authoring agent. Full detail in `10-quality/review-log.md`. The headline defects were an ACL leak
through custom permission masks in the RAG index, a departed officer retaining their permission
mask indefinitely, a telemetry idempotency key that silently swallowed BGS activity, and an
invariant gate that would have been switched off in week one.

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

- **2026-07-26 · agent** — P0 started and 5 of 8 tasks completed (P0.1, P0.2, P0.3, P0.6, P0.8), merged as PR #7 with all 5 CI jobs green. Node pinned to 24 LTS. Database live with 56 tables, TimescaleDB hypertable and every hand-written index. 35 tests passing. The SSOT drift check is proven to fail on an edited copy, not merely assumed to. **P0.4 (API) and P0.5 (web) remain; P0.7 (deploy) is blocked on the Vultr key.**
- **2026-07-25 · agent** — SSOT bootstrapped from `docs/grims-squad-build-spec.md`. 21 ADRs, 45 invariants, validated schema, contracts and a 90-task graph. **Then subjected to an independent three-panel adversarial review (ARCH-ADV, RED-TEAM, DATA-INTEGRITY-ADV): 25 findings, 10 of them blockers, all confirmed and all resolved** — see `10-quality/review-log.md`. Schema, permissions and invariants changed materially as a result; re-validated after. Nothing built. P0 not started — awaiting human review and the D-series answers marked `BLOCKS P0`.
