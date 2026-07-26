# SCOPE

Three lists. A feature request is resolved by finding it here. If it is not here, it is a proposed ADR, not a ticket.

---

## IN SCOPE — will be built

| Module | Phase | One-line definition of done |
|---|---|---|
| Monorepo, CI/CD, containers, deployment | P0 | A "hello CMDR" page live over HTTPS, CI blocking a bad PR |
| Discord OAuth identity + sessions | P1 | Login round-trip creates the user and their roles, rotating refresh with reuse detection |
| Permission bitmask + data-layer authorization | P1 | A Ring 0 user's repository call is physically incapable of returning a Ring 1 row |
| Discord role-sync bot + nightly reconciliation | P1 | Role change in Discord reflected on site within 5 s; drift repaired nightly |
| Member profiles, privacy toggles, device/session management | P1 | A private field is absent from the API response, not merely hidden in the UI |
| Admin console, role editor, audit log | P1 | Every privileged action has a before/after audit row |
| CMDR verification — cAPI (tier 3), Inara nonce (tier 2), officer manual (tier 1) | P1 | Verification recorded with its method and trust tier; cAPI treated as a ~25-day ceremony |
| Public landing, live stat ticker, GalNet feed, divisions | P1 | Loads <1.5 s, a11y ≥95, stats from our own DB |
| Forum: categories, threads, posts, reactions, subscriptions | P2 | Per-category `view_perm`/`post_perm`, enforced in the data layer |
| Rich editor + uploads with EXIF strip and re-encode | P2 | Polyglot upload neutralised; GPS EXIF gone |
| ACL-filtered Meilisearch | P2 | Ring 0 search for a Ring 2 term returns **zero**, not a redacted hit |
| Moderation queue, reports, auto-flags, ban/mute with appeal | P2 | Every moderation action audited |
| Recruitment pipeline, application → Discord vote → role grant → probation | P2 | Full application to Ring 1 access, end to end |
| Thread-level Discord bridge | P2 | New thread posts an embed; `/thread` creates a thread |
| ED API adapters behind interfaces (Ardent, EDSM, Spansh, GalNet, FDevIDs, Inara, cAPI) | P3 | A fake adapter swaps in for tests with zero application changes |
| EDDN collector with batching, idempotency, backpressure, radius prefilter | P3 | Stable 24 h+, lag <60 s, parse failures <0.5% |
| Seed from Spansh/Ardent dumps | P3 | Idempotent and resumable; re-running changes nothing |
| Telemetry endpoint + device tokens + per-category server-side consent | P3 | A non-consented category is **rejected**, not silently dropped |
| EDMC plugin, open source, per-category opt-in, non-blocking | P3 | Zero frame impact; network loss does not touch the game |
| System & commodity pages, forum ED embeds, freshness badges | P3 | Every displayed price carries its age |
| BGS: influence ingestion, tick detection, charts, control board | P4 | Ticks correct across 7 consecutive days; no double-counting |
| BGS orders board (`push`/`hold`/`suppress`/`ignore`) with guidance | P4 | Members see a prioritised "tonight" list on their dashboard |
| BGS activity reporting from telemetry + manual + BGS-Tally import | P4 | Auto-captured without manual entry, negatives included |
| Conflict tracker, nightly Discord digest | P4 | Digest posts post-tick with what changed and what to do |
| Operations board, signups, standby, Discord Events sync, reminders | P5 | A real op scheduled, filled, run and AAR'd on the site |
| Wing composition checker | P5 | Correct matches against real fleet data |
| Carrier registry, jump schedule, tritium tracker, market mirror | P5 | Carrier fuel tracked with no manual entry |
| Trade: commodity lookup, importer/exporter finder, freshness slider | P6 | Every row carries its data age |
| Own-DB route optimiser + materialised `best_trades` | P6 | <2 s on a populated DB; spot-checked accurate in-game |
| Spansh delegation (async job + WS push, deduped by param hash) | P6 | The browser never blocks |
| Carrier-aware routing, squadron trade board, group hauling, alerts | P6 | A real hauling op tracked to completion |
| Self-hosted Coriolis, pinned commit, themed | P7 | Live at `shipyard.<domain>`, monthly data-update check scheduled |
| Loadout Locker: 4 import formats, versioning, comments, comparison | P7 | Coriolis URL, EDSY URL, Coriolis JSON and journal `Loadout` all import |
| Ship maths in `packages/ed-domain`, ported from Coriolis with attribution | P7 | Within 1% of Coriolis on 10 test builds |
| Doctrine builds, requirements checker, fleet queries | P7 | "Every Anaconda >60 ly" returns correct results |
| GSAI: dual Ollama, arbiter, tunnel, fast path, agent loop, tools, RAG | P8 | ≥75% tool reliability, fast path ≥60%, ACL leak test passes |
| GSAI web + Discord surfaces, write tools with confirmation, audit, kill switch | P8 | Site fully functional with the local box powered off |
| P9 Tier 1 delight: business cards, "Am I needed?", achievements, onboarding checklist, PWA + push, command palette | P9 | Shipped and used |

---

## OUT OF SCOPE — deferred, not rejected

These are real features that will be built *later* or *if demand appears*. Building them early is scope creep — the project's highest-rated risk.

| Item | Earliest phase | Why not sooner |
|---|---|---|
| BGS influence projection / what-if simulation | P9 | Needs months of accumulated snapshots before any model is honest |
| Powerplay module | P9 | Separate system from BGS; adds a whole data model |
| Colonisation / system architecture tracker | P9 | Same |
| AX / Thargoid war board | P9 | Whole module of its own; only if that content is live and we run AX ops |
| Squadron ledger, treasury, bounties, loans | P9 | Loved, but nothing depends on it |
| Mining hotspot registry | P9 | Curated data, not derived — no engineering dependency |
| Materials exchange, engineering tracker | P9 | Nice-to-have; large surface for the value |
| Screenshot gallery, wiki, lore archive | P9 | Wiki feeds RAG, so it lands with or just after P8 |
| Mentor pairing, LFG board, CG tracker | P9 | Community features that need a live community first |
| 3D galaxy map with influence overlay | P9 | High effort, low daily use, mobile-hostile |
| Op replay viewer from telemetry | P9 | Superb for AARs, expensive, depends on mature telemetry |
| Inter-squadron federation | P9+ | Genuine differentiator, but needs a stable single-squadron product first |
| Voice AI (faster-whisper + Piper on Discord voice) | P9 | Stretch. Impressive, not load-bearing |
| Cloud LLM fallback | P9 | Feature-flagged, off by default, stricter redaction rules required first |
| i18n / multi-language | P9 | Scaffolding is cheap and lands early; translations only on demand |
| Native mobile app | after PWA proves demand | The PWA covers ~90% at ~5% of the cost |
| Kubernetes / k3s | if Compose is outgrown | Boring wins; Compose is sufficient at this scale |
| Multi-hop beam-search trade routing | after P6 single-hop + loops | Only if the simpler forms prove insufficient |
| TOTP 2FA | see decision D13 | Placement not yet decided by the human |

---

## EXPLICITLY REJECTED — will not be built

Recorded so no future session proposes them again. Reopening one requires a proposed ADR that beats the stated reason.

| Item | Why rejected |
|---|---|
| **Anything built on `eddb.io`** | EDDB shut down in 2023. Tutorials referencing it are stale. |
| **"Login with Inara"** | Inara has no OAuth and no login delegation. It is technically impossible, not merely inadvisable. |
| **Frontier cAPI as the primary identity layer** | Worse UX than Discord, ~25-day token lifetime makes it a recurring ceremony, and approval is discretionary. It is a *verification* layer (ADR-002, ADR-003). |
| **Bidirectional message-level Discord ↔ forum mirroring** | Permanent support burden with no proportional payoff. Thread-level bridging only (ADR-006). |
| **A web galaxy map replicating the in-game one** | Enormous effort, guaranteed to be worse than the original. |
| **Real-time voice transcription of every op** | Privacy nightmare, low payoff, and we have under-18 members to consider. |
| **A general Elite Dangerous wiki** | The community has several. Link them. |
| **Cryptocurrency / NFT / token anything** | No. |
| **Paid memberships, ads, or selling access** | Would forfeit the non-commercial basis on which Frontier's IP and Coriolis's data are used (`constraints.md`, §17 of the spec). |
| **Ripping Frontier HUD assets directly** | IP violation. The aesthetic is recreated from tokens, not extracted from the game. |
| **One Ollama instance spanning both GPUs** | Mixed-generation feature downgrade plus PCIe activation shuttling. Two isolated instances (ADR-011). |
| **Permission checks living in the AI system prompt** | One prompt injection away from privilege escalation. Enforcement is in the executor (ADR-015, INV-011). |
| **String role checks scattered through controllers** | Replaced by a permission bitmask plus data-layer filters (ADR-005). |
| **Password authentication** | OAuth-only. No password store, no reset flow, no credential-stuffing surface. |
| **Blocking HTTP calls to Spansh from a request path** | Async job + poll + WebSocket push only (ADR-013, INV-016). |
| **Storing a market price without its observation time** | Would violate INV-004 and is the fastest way to lose member trust. |
