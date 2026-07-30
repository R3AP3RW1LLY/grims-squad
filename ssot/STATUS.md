# BUILD STATUS
_Last updated: 2026-07-29 by agent (deployed to production)_

## Current position
Phase: **P2 — Forums, IN_PROGRESS.** P1 closed 2026-07-29.

        ★ THE PHASE LINE IS LOAD-BEARING, NOT PROSE. `tools/ssot-drift-check.ts` parses it.
        `P2` makes every P0 and P1 invariant a HARD failure if untested, and `IN_PROGRESS`
        keeps P2's own three outstanding-but-not-failing — because on the day a phase starts
        none of its invariants can have tests yet, and a permanently red gate is a gate
        somebody switches off. Removing `IN_PROGRESS` is what tightens it at P2 exit.

        **P1 — Identity & shell: DONE (2026-07-29).** All 11 tasks plus P0.7, deployed and
        live-verified. The adversarial panel ran against the DEPLOYED system and its one
        blocking finding — INV-002, the unenforced data-layer ACL — was closed the same day.
        18 due invariants, 18 covered.

Next:   **P2 — Forums.** P2.0 existed to bind the ACL and is now **DONE ahead of the phase**,
        so P2.1 (category and thread CRUD) can start against a client that already filters.
        The promotion dry run
        has been run (2026-07-29): it reports nobody eligible, 3 of 107 members considered,
        and the earliest possible promotion is **1 September** — August is the first month
        that can qualify.

★ **THE P2 ENTRY GATE IS CLEARED.** INV-002 is enforced: `AclDbService` binds a principal
resolved from the session, a static guard fails the build if anything reads an ACL-bearing
model through the plain client, and removing the binding was PROVEN to fail 6 tests rather
than assumed to. P2.1 starts against a client that already filters — the thing P2.0 was
written to guarantee.

★ **THE REAL BOTTLENECK IS NOT SOFTWARE.** 107 guild members, 53 of whom sent a message
this month, and **3 website accounts**. The promotion engine considers 3 people and 2 of
those are already at the top of the ladder. Adoption is the constraint on the squadron's
headline feature, and no amount of code moves it.

★ **PRODUCTION IS LIVE.** `https://45-63-35-93.sslip.io`, commit `b8572f6`, all seven
containers healthy. Deployed with a health-gated rolling swap and automatic rollback
(`infra/scripts/deploy.sh`). Measured over 900 one-second samples from outside the
server across a deploy: **web 900/900 at HTTP 200; the API 899/900**, the single miss
being one sample during its container swap, with zero 502/503/504 recorded by Caddy.
True zero downtime for the API needs a second replica — recorded as debt below.

★ **THE PRODUCTION ADDRESS IS `https://45-63-35-93.sslip.io`, AND THAT IS DELIBERATE.**
Squadron owner, 2026-07-29: **the domain is not owned yet.** Adoption is being driven to
the sslip.io address until it is acquired, and the owner will say when that happens.

Correcting my own error from earlier the same day: I recorded `grims-squad.com` as
"registered". It is not — `nslookup` returns NXDOMAIN for A, NS and SOA, so the name is
not in the DNS at all. D1 chose a NAME; it never recorded an acquisition, and I read the
one as the other. Nothing is blocked by this: Caddy holds a valid Let's Encrypt
certificate for the sslip.io name.

★ **FRONTIER cAPI IS OFF THE CRITICAL PATH, PERMANENTLY** (ADR-022, 2026-07-27).
Journals give us everything it would, in real time, with no discretionary approval.
P1.8 is marked `superseded` rather than deleted — it would still be a genuine upgrade
if approval ever arrived, but nothing waits on it. Verification is now the member's own
Inara API key (tier 2) or an officer (tier 1).

Done:   **P1.1 Discord OAuth** — VERIFIED LIVE against the real Discord API on 2026-07-26.
        **P1.2 Sessions** — rotating refresh, reuse detection, CSRF, idempotency namespacing.
        **P1.3 Permission engine** — including the MANDATORY data-layer ACL (INV-002).
        **P1.4 Role-sync bot** — activity recording across message, forum and voice.
        **P1.5 Nightly reconciliation** — refuses to act on an empty or failed guild fetch.
        **P1.6 Member profiles and privacy** — INV-027, sessions list, revoke, data export.
        **P1.7 Admin console** — activity, members, audit log with filters, the role
        editor with a mandatory impact preview, and the Discord mapping editor.
        **P1.8b CMDR verification** — THREE paths: officer-manual (tier 1), the
        Inara nonce, and the member's own Inara API key (tier 2). The key is the
        primary route: the commander name comes back FROM Inara, so it is proof
        rather than a claim, and there is deliberately no field anywhere to type
        a name into.
        **Rank ladder** — all ten ranks seeded as roles with mask 0 (INV-046) and
        mapped to their Discord roles. A live promotion now changes Discord too,
        or `single_rank` would break on the next reconciliation.
        **Discord nickname sync** — set when the Inara key is first added,
        re-checked on every Inara call, self-healing if a member renames
        themselves.
        **P1.9 Public landing with live stats** — from our own database.
        **P1.10 TOTP** — forced enrolment, single-use codes, step-up on the admin console.
        **P1.11 Electron companion app** — journal ingest, device pairing, telemetry
        consent, and as of 0.3.0 it reports its own version so the website can stop
        offering an update to somebody who already installed it (D30, D31).
        **P0.7 Production deploy** — zero-downtime script with a 17-variable preflight,
        pre-migration backup, health-gated swap and automatic rollback.
        **Live event stream** — SSE, plus a Redis pub/sub bridge so the scheduled jobs
        in the worker container can reach a browser (D29). Verified in production:
        `grims-live-bridge` subscribed, a real event delivered, malformed ones dropped
        without touching the API.
        **Voice presence** — the bot records who is in a voice channel now, clearing
        every row at startup because Discord keeps no occupancy history.
        **Encrypted offsite backups, actually verified** — twice daily, and the object
        is now read back from the bucket and its size compared (D33).

Blocked: **P1.8 Frontier cAPI** — the application to Frontier has never been submitted.
        See `CAPI-APPLICATION.local.md`. Weeks of lead time, discretionary approval.

★ **PROMOTIONS ARE FLOORED AT 2026-08-01T00:00:00Z.** Non-negotiable human instruction,
enforced by a coded guard (`packages/shared/src/promotion-floor.ts`) with tests at the exact
millisecond boundary — NOT by a cron expression that happens not to fire yet. Verified
2026-07-29 that the guard is actually CALLED (`promotion-run.ts:126`), which is the failure
this codebase has produced repeatedly: written, documented, tested and never wired.

**Three days out, here is exactly what will happen on 1 August, and it is probably not
what you would assume.**

The production cron is `0 0 1 * *` and it invokes `promote.js` **without `--live`**. The
engine's `dryRun` defaults to TRUE. So at 00:00 on 1 August it will write a REPORT to
`/var/log/grims-promote.log` and **promote nobody.** A live run requires somebody to pass
`--live` by hand, and the floor guard then has to agree on the date.

That is the safe arrangement and it matches the standing instruction that a dry run be
reviewed before the first live run. It is recorded here in plain terms because "promotions
unlock on 1 August" and "promotions happen on 1 August" are different statements, and only
the first is true.

**Outstanding, and time-boxed:** run the dry run against production data NOW, while there
are still days to fix whatever it reveals. See "What to pick up next".

## P1 exit gaps — what is NOT done
_Recorded so the phase is not claimed complete on partial work._

_Four rows below were stale on 2026-07-27 — they listed work the Done section above
already claimed. Corrected 2026-07-29; a gap table that disagrees with the Done list
is worse than no gap table._

| Task | Missing | Why it matters |
|------|---------|----------------|
| ~~P1.7~~ | ~~Role editor with a "who does this affect" preview~~ | **DONE** — save is disabled until the preview runs. |
| ~~P1.7~~ | ~~Discord mapping editor~~ | **DONE** — snowflake validation, duplicate refusal. |
| ~~P1.7~~ | ~~Audit log filters~~ | **DONE** — server-side, by actor / action / target / date. |
| ~~P1.8b~~ | ~~Inara nonce path (`trust_tier` 2)~~ | **DONE** — global 2/min limiter, `eventStatus` checked. |
| P1.8 | Frontier cAPI entirely | Blocked externally, and **superseded** by ADR-022. Ships as an upgrade, never a dependency. |
| ~~ALL~~ | ~~Live verification~~ | **DONE 2026-07-29** — Discord, Inara and the whole stack verified in production. |
| ~~ALL~~ | ~~Deploy~~ | **DONE 2026-07-29** — P0.7 closed. |
| ~~P1 exit~~ | ~~The exit review itself~~ | **DONE 2026-07-29** — six gates against the deployed system; 3 findings, 3 refuted. |
| ~~INV-002~~ | ~~The data-layer ACL is not applied~~ | **CLOSED 2026-07-29**, the same day it was found. |
| **API** | **A second API replica** | One container means a ~12s gap on every deploy while it swaps. Web is unaffected (Caddy holds the old container until the new one is healthy). Nobody saw a 5xx, but "zero downtime" is not literally true for the API until there are two. |

> **P0 IS NOW FORMALLY EXITED (2026-07-29).** Both criteria that required P0.7 are met:
> the landing page loads over HTTPS, and `/v1/health` returns all-green in production
> (`db`, `redis`, `meilisearch` all `ok`). Verified from outside the server, not from
> inside the container. One criterion is met in spirit rather than to the letter: the
> page loads over HTTPS at the **sslip.io** address, not at "the real domain", because
> `grims-squad.com` has never been pointed at the box.

**Live verification is done.** Discord OAuth and guild reads, Inara `getCommanderProfile`
and the squadron check have all run against the real APIs in production. What Inara does
NOT provide was established the same way: it has no squadron join date, so tenure comes
from Discord's `guildJoinedAt` (INV-047).

Local dev: `docker compose -f infra/docker/compose.dev.yml up -d`, then `pnpm dev`.
**Website: http://localhost:5000** · API: http://localhost:5001/v1/health

## Phase completion
| Phase | Name | Status | Completed |
|-------|------|--------|-----------|
| P0 | Foundations | **DONE** | 8 of 8 · 2026-07-29 |
| P1 | Identity & shell | **DONE** | 2026-07-29. 11 tasks + P0.7, deployed and live-verified, panel run, INV-002 closed. |
| P2 | Forums | **IN_PROGRESS** | P2.0 (bind the data-layer ACL) DONE 2026-07-29, ahead of the phase. |
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
| Domain acquired | **NOT OWNED** | — | `grims-squad.com` is the CHOSEN name (D1) and has **not been bought** — NXDOMAIN on A, NS and SOA. Squadron owner, 2026-07-29: adoption runs on `https://45-63-35-93.sslip.io` until acquisition, and the owner will advise. Not blocking: Caddy has a valid certificate for the sslip.io name. |
| VPS provisioned | **DONE** | 2026-07-29 | Vultr, `45.63.35.93`, hostname `grims-squad-hub`. SSH keys only. ⚠ The workstation's public IP rotates and the Vultr firewall allowlists it — a timeout means the allowlist, a permission-denied means the wrong key. |
| Cloudflare account + DNS delegated | NOT_STARTED | — | No longer blocks anything: Caddy obtains certificates directly from Let's Encrypt for the sslip.io name. Needed for the real domain, Turnstile and Access. |
| Discord app + bot created | **DONE** | — | Bot `Grim's Squad HQ Bot#9619` connected, 1 guild, 44 roles, 109 members cached. SERVER MEMBERS intent enabled. |
| Object storage bucket | **DONE** | — | Two buckets, deliberately separate: `grims-squad-media` (avatars, and companion installers under `companion/`) and a distinct vault bucket for database dumps. The squadron owner required that backups not share storage with media. |
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
| Discord | `oauth2/token`, `/users/@me` | **YES** | **YES** (2026-07-26) | P1.1 |
| Discord | `/users/@me/guilds/{id}/member` | **YES** | **YES** (2026-07-26) | P1.1 |
| Inara | `getCommanderProfile` | **YES** | **YES** (2026-07-29) | P1.8b |
| Discord | OAuth2 + Gateway + REST | **YES** | **YES** (2026-07-29) | P1.1 |

## Open decisions awaiting human
| # | Question | Blocking | Asked |
|---|----------|----------|-------|
| D1 | **Domain NAME chosen (`grims-squad.com`), domain NOT ACQUIRED.** Reopened 2026-07-29: the original entry read as though the name had been secured, and it has not been bought. The squadron owner is driving adoption on `https://45-63-35-93.sslip.io` and will advise on acquisition. Nothing is blocked — every URL in the app comes from `PUBLIC_SITE_URL` / `SITE_HOSTNAMES`, so acquiring it later is a config change and a Caddy reload. | nothing | reopened 2026-07-29 |
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
| **P1 exit (2026-07-29, against the DEPLOYED system)** | 1 MINOR | **1 BLOCKER (latent), 1 MAJOR** | **0 findings** (24 live probes) | 0 new | 0 | 0, one gap named |

**P1 exit panel: 3 confirmed (1 latent BLOCKER, 1 MAJOR, 1 MINOR), 3 claims refuted.** Two of the
three findings are invisible in source review — one needed 24 live probes to rule out, the other
only appears when a background process dies. The refutations are recorded too, including one where
my own probe was wrong rather than the code.

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

- **2026-07-29 · agent** — **DEPLOYED TO PRODUCTION.** Eight PRs (#67–#74) merged through CI,
  none pushed direct to main; `enforce_admins` enabled on `main` and it refused a merge
  mid-sequence when a check was still running, which is what it is for. Two additive
  migrations applied with the index count identical at 210 either side — every generated
  Prisma migration in this repo proposes dropping the pgvector and full-text indexes and
  must be trimmed by hand. Companion **0.3.0** published on all four platforms.
  **Shipped:** live verification across the whole app via SSE plus a Redis bridge from the
  worker (D29); voice presence on Last Seen; the privacy tab merged into Commander
  Management; homepage hero naming Blood Brothers from Alrai and linking out; coming-soon
  screens for `/ops`, `/bgs`, `/fleet`; Elite sign-ins on the activity chart; a 30-second
  refresh grace window (D28); an update banner keyed to a real version mismatch (D30, D31);
  brand-asset protection with its limits written down (D32); backups verified in-bucket
  (D33). **Bugs found that nothing would have caught:** five consecutive zero-byte backups
  reported as successful; `'0.10.0' < '0.9.0'` as strings, which would have silently stopped
  announcing updates from the tenth release; a middleware rule of mine that broke every logo
  on the site while the markup still held the right URL; a `qualifies` flag that told
  officers a Grand Master General was due a promotion the engine refuses outright.
  **Still open:** five empty backup objects await the owner's decision; the API needs a
  second replica for literal zero downtime. The domain is NOT owned — production stays on
  the sslip.io address by the owner's instruction until it is acquired.

- **2026-07-27 · agent** — cAPI dropped from the critical path (ADR-022, D27): an **Electron** companion app collects journals instead, which is what will finally move `game_activity` off `unknown` and let anyone qualify for promotion. Electron is a non-negotiable human instruction; the size/memory trade against Tauri is recorded in the ADR rather than left implicit. **The existing schema already supports the whole ingest design** — `DeviceToken` for pairing and `TelemetryEvent` with an idempotency key that already reasons about Elite's whole-second journal timestamps (INV-017, DATA-INTEGRITY B1) — so P1.11 needs no schema change. Also this session: the ten ladder ranks seeded and mapped (promotions had nothing to read before, which is why every dry run reported zero); promotion now writes to Discord as well or reconciliation would hand back the old rank; Inara API key verification with the name coming FROM Inara; nickname sync driven by Inara calls. **Three local-dev faults fixed, all of which failed silently:** the API never loaded `.env` (no `--env-file`), a production `.next` broke dev CSS, and `/v1/*` had no local proxy so sign-in and every client-side call 404'd. 597+ tests green.
- **2026-07-27 · agent** — Finished P1.7 and P1.8b, the two tasks left partial overnight. Role editor with a MANDATORY who-does-this-affect preview (save is disabled until it runs), Discord mapping editor with snowflake validation and duplicate refusal, server-side audit filters. Inara nonce path complete: global 2/min singleton limiter (INV-033), `events[0].eventStatus` checked rather than `res.ok` — Inara answers HTTP 200 for its own failures — and not-found-yet treated as a normal in-progress state. **566 tests passing, all five CI jobs green.** NonceService moved to `packages/shared` and its Prisma store to `packages/db` so the worker can use both. **Every P1 task except cAPI is now built; nothing is deployed and nothing is live-verified.**
- **2026-07-27 · agent** — P1 built out overnight, unattended. Completed P1.3 (data-layer ACL, the MANDATORY criterion), P1.5, P1.6, P1.9, P1.10, the officer-manual half of P1.8b, and the promotion engine in dry-run. **P1 invariant coverage went 10/15 → 15/15.** 460 tests passing; typecheck, lint, build, secret scan and drift check clean. PRs #40 and #41 are green and awaiting merge — the merge itself was blocked by a permission prompt, so **both are open and unmerged.** P1.7 and P1.8b are PARTIAL and P1.8 is externally blocked; see the gap table above. **Nothing has been deployed and nothing built in this session has been verified against a live external API.**
- **2026-07-26 · agent** — P0.4 and P0.5 completed. API on :5001 with a health endpoint verified against the real stack in all three states. Website live on :5000, themed from `tokens.json`, accessibility criteria asserted against the rendered HTML. **7 of 8 P0 tasks done; only P0.7 (deploy) remains, blocked on the Vultr key.**
- **2026-07-26 · agent** — P0 started and 5 of 8 tasks completed (P0.1, P0.2, P0.3, P0.6, P0.8), merged as PR #7 with all 5 CI jobs green. Node pinned to 24 LTS. Database live with 56 tables, TimescaleDB hypertable and every hand-written index. 35 tests passing. The SSOT drift check is proven to fail on an edited copy, not merely assumed to. **P0.4 (API) and P0.5 (web) remain; P0.7 (deploy) is blocked on the Vultr key.**
- **2026-07-25 · agent** — SSOT bootstrapped from `docs/grims-squad-build-spec.md`. 21 ADRs, 45 invariants, validated schema, contracts and a 90-task graph. **Then subjected to an independent three-panel adversarial review (ARCH-ADV, RED-TEAM, DATA-INTEGRITY-ADV): 25 findings, 10 of them blockers, all confirmed and all resolved** — see `10-quality/review-log.md`. Schema, permissions and invariants changed materially as a result; re-validated after. Nothing built. P0 not started — awaiting human review and the D-series answers marked `BLOCKS P0`.
