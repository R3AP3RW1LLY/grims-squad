# PHASE PROMPTS P0 → P9
### One phase per fresh context. In order. No skipping.

> **Provenance note.** Original phase-prompt document, preserved for reference.
> The **authoritative** machine-readable plan is `ssot/08-plan/roadmap.yaml` and `ssot/08-plan/tasks.yaml`; the authoritative quality gates are `ssot/10-quality/`. Where this file and `ssot/` disagree, `ssot/` wins.
> Since v1.1 of `AGENTS.md`, every phase additionally carries the TDD requirement (§8), the adversarial review gates (§9), the git/PR policy (§10) and the CI gates (§11). Those apply on top of everything below.

---

## THE UNIVERSAL PREAMBLE

Every phase prompt begins with this block. Paste it, then the phase body.

```
Read AGENTS.md. Read ssot/STATUS.md. Read ssot/CONVENTIONS.md.
Read ssot/08-plan/tasks.yaml and locate the tasks for this phase.
Read ssot/10-quality/tdd-policy.md and ssot/10-quality/adversarial-reviews.md.
Read the ssot/ files this phase's tasks reference.

Confirm the ENTRY CRITERIA below are met. If any are not, STOP and tell me
which — do not begin work.

Work one task at a time: branch → failing test → implement → green → refactor
→ review gates → PR → merge → report → next.
Do not batch tasks. Do not build anything listed under SCOPE — OUT.
When the phase's EXIT CRITERIA are all met, run the demo script, run the
phase-exit review panel, update ssot/STATUS.md, and stop for review.
```

---
---

# P0 — FOUNDATIONS
**Goal: a deployed "hello CMDR" page with CI, so every later phase has rails.**
**Duration: 1–2 sessions · Blocks: everything**

### ENTRY CRITERIA
- [ ] `ssot/` exists and has been human-reviewed
- [ ] Human has answered any blocking questions from the bootstrap report

### SCOPE — IN
Repo scaffold, tooling, CI, containers, DB running with migrations, one deployed page.

### SCOPE — OUT
Auth. Forum. Any game data. Any UI beyond one page. **Especially: no feature work.**

### TASKS

**P0.1 — Monorepo skeleton**
- pnpm workspaces + Turborepo per `ssot/CONVENTIONS.md`
- Create every `apps/*` and `packages/*` directory from the spec layout, each with a `package.json` and an index that exports nothing yet
- Root `tsconfig.json` with `strict: true`, `noUncheckedIndexedAccess: true`, project references
- ESLint + Prettier, shared config package
- `.gitignore`, `.env.example` (placeholders only — see AGENTS.md §3.6)
- **Verify:** `pnpm install && pnpm -r typecheck` passes on an empty tree

**P0.2 — Database up**
- `infra/docker/compose.dev.yml`: postgres (pgvector image), redis, meilisearch
- `packages/db`: Prisma client, `schema.prisma` **copied from `ssot/03-data/schema.prisma`** — do not rewrite it, copy it
- Generate the initial migration
- **Verify:** `pnpm db:migrate:dev` creates every table; `psql -c '\dt'` lists them; paste the list

**P0.3 — Shared contracts package**
- `packages/shared`: copy `ssot/04-contracts/permissions.ts` verbatim
- Zod schemas for the common DTOs referenced in `openapi.yaml`
- Shared enums, error taxonomy from `ssot/04-contracts/errors.md`
- **Verify:** `hasPermission()` unit tests, including a bitmask above 64 bits

**P0.4 — API skeleton**
- NestJS + Fastify adapter, Pino logging with request-ID correlation
- `GET /v1/health` returning `{ status, version, db, redis, meilisearch }` with real connectivity checks
- Global exception filter emitting the error envelope from the SSOT
- Global Zod validation pipe
- **Verify:** `curl /v1/health` shows all dependencies `ok`; kill redis, confirm it reports `degraded` not `500`

**P0.5 — Web skeleton**
- Next.js 15 App Router, Tailwind v4 configured from `ssot/07-design/tokens.json`
- One page: the landing hero, static, no data
- **Verify:** renders; Lighthouse a11y ≥ 95; `prefers-reduced-motion` respected

**P0.6 — CI**
- GitHub Actions: lint → typecheck → test → build → Trivy scan on PR
- On `main`: build and push images
- **Verify:** open a deliberately-failing PR, confirm CI blocks it

**P0.7 — Deploy**
- `infra/docker/compose.prod.yml`, Caddy with automatic TLS
- Deploy to the VPS, DNS through Cloudflare
- **Verify:** the landing page loads over HTTPS at the real domain

### EXIT CRITERIA
- [ ] `pnpm install && pnpm build && pnpm test` green from a clean clone
- [ ] Every SSOT table exists in the dev database
- [ ] `/v1/health` returns all-green in production
- [ ] Landing page live over HTTPS
- [ ] CI blocks a failing PR

### DEMO SCRIPT
```bash
git clone <repo> fresh && cd fresh
pnpm install && pnpm build && pnpm test
docker compose -f infra/docker/compose.dev.yml up -d
pnpm db:migrate:dev
curl -s localhost:3000/v1/health | jq
curl -sI https://<domain> | head -1
```

### COMMON FAILURES
- Rewriting `schema.prisma` instead of copying it — immediate SSOT drift. **Copy it.**
- Skipping strict TS "for now" — thousands of `any` by P4.
- Deploying before CI works — no safety net for the whole project.

---
---

# P1 — IDENTITY & SHELL
**Goal: members log in with Discord and see role-appropriate navigation.**
**Duration: 3–5 sessions · Depends: P0**

### ENTRY CRITERIA
- [ ] P0 exit criteria all met
- [ ] Discord application created, bot token in hand, **SERVER MEMBERS intent enabled**
- [ ] Existing Discord role structure documented in `ssot/02-domain/rings-and-roles.md`

### SCOPE — IN
Discord OAuth, sessions, permission engine, role sync bot, member profiles, admin console v1, audit log, public landing.

### SCOPE — OUT
Frontier cAPI verification (**deferred to P1.8, gated on approval arriving** — build everything else without it). Forum. Game data. AI.

### TASKS

**P1.1 — Discord OAuth**
- Passport Discord strategy, scopes `identify email guilds.members.read`
- Callback fetches `/users/@me` and `/users/@me/guilds/{GUILD_ID}/member`
- Upsert `users` + `discord_identities` including `guild_roles[]`
- **Verify:** integration test with a mocked Discord API; manual round-trip against the real one

**P1.2 — Sessions**
- Access JWT 15min, refresh 30d **rotating with family tracking**
- Cookies `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix
- CSRF double-submit on all mutations
- **Verify:** a test that replays an already-used refresh token and asserts the entire family is revoked. This test is mandatory.

**P1.3 — Permission engine**
- Compute effective mask = OR(role masks) AND NOT deny_mask
- Redis cache `perm:{userId}`, TTL 5min
- NestJS `@RequiresPermission()` guard
- **Data-layer enforcement** — a Prisma extension or repository wrapper that applies visibility filters. Per INV-002, controller guards alone are insufficient.
- **Verify:** negative tests for every ring boundary. Prove a Ring 0 user cannot read a Ring 1 row *even calling the repository directly*.

**P1.4 — Role sync bot**
- discord.js v14, shares `packages/db`
- Handlers: `guildMemberAdd`, `guildMemberUpdate`, `guildMemberRemove`, `roleUpdate`
- Every change busts the Redis permission cache and writes to `audit_log`
- **Verify:** change a role in Discord, assert the site reflects it within 5s

**P1.5 — Nightly reconciliation**
- Full guild member fetch, diff vs DB, repair drift, report anomalies to a Discord admin channel
- **Verify:** manually corrupt a `guild_roles` row, run the job, confirm repair + report

**P1.6 — Member profiles**
- Profile page, editable fields, privacy toggles (defaults conservative per AGENTS.md §3.7)
- Session/device list with individual revoke
- **Verify:** a privacy toggle set to private is genuinely absent from the public API response, not just hidden in the UI

**P1.7 — Admin console v1**
- Member list with filters, role assignment, role/permission editor with a live "who does this affect" preview, Discord role mapping editor, audit log viewer with diffs
- **Verify:** every admin action appears in `audit_log` with before/after

**P1.8 — Frontier cAPI verification** *(only if approval has arrived)*
- OAuth2 **PKCE** flow, verifier in Redis 10min TTL
- `/profile` → authoritative CMDR name → `cmdr_verifications` row, `trust_tier: 3`
- Refresh tokens **encrypted at rest**
- Expiry worker: refresh proactively; DM at day 20; downgrade to `stale` at day 25
- **Verify:** full round trip with a real Frontier account; confirm the encrypted column is unreadable as plaintext
- **If approval has NOT arrived:** implement the fallback verification path instead (Inara nonce + officer manual approval, `trust_tier` 2 and 1), log it in STATUS.md as deferred, and move on. Do not block the phase.

**P1.9 — Public landing**
- Hero, live stat ticker (from your own DB), divisions, GalNet feed, recruitment CTA
- **Verify:** loads in <1.5s; a11y ≥ 95

### EXIT CRITERIA
- [ ] Discord login works end to end in production
- [ ] Role change in Discord reflects on the site within 5s
- [ ] Negative authorization tests pass at every ring boundary, at the data layer
- [ ] Refresh-token-reuse revokes the family (test passes)
- [ ] Admin can change roles; every change is audited
- [ ] Landing page live with real stats

### DEMO SCRIPT
1. Log in with Discord as a `@Recruit` → see Ring 0 nav only
2. Officer promotes you to `@Squadron Member` in Discord
3. Refresh → Ring 1 nav appears without re-login
4. Attempt a Ring 2 API route directly with curl → 403, and it's in the audit log
5. Revoke your session from another device → next request 401

### COMMON FAILURES
- Enforcing authz only in controllers — the exact leak INV-002 exists to prevent
- Forgetting the SERVER MEMBERS intent — `guild_roles` silently empty
- Storing Frontier refresh tokens unencrypted — security invariant violated
- Blocking the phase waiting for cAPI approval — build the fallback and move on

---
---

# P2 — FORUMS
**Goal: the community moves in. This is the point of no return.**
**Duration: 4–6 sessions · Depends: P1**

### ENTRY CRITERIA
- [ ] P1 exit criteria met
- [ ] Category tree confirmed by the human against `ssot/02-domain/rings-and-roles.md`

### SCOPE — IN
Categories, threads, posts, reactions, subscriptions, editor, uploads, ACL-filtered search, moderation, recruitment pipeline, Discord thread bridge.

### SCOPE — OUT
ED-specific embeds (needs P3 game data — build the extension point, not the feature). AI search. Wiki.

### TASKS

**P2.1 — Category & thread CRUD**
- Nested categories with per-category `view_perm` / `post_perm`
- **All queries go through the P1.3 data-layer filter.** No exceptions.
- **Verify:** a Ring 0 user listing categories cannot see, count, or infer the existence of Ring 1 categories

**P2.2 — Posts**
- Markdown storage + pre-rendered sanitized HTML column
- Threaded replies, edit history, soft delete with moderator tombstone
- **Verify:** XSS test suite — script tags, event handlers, `javascript:` URLs, SVG payloads, all neutralised

**P2.3 — Editor & uploads**
- Tiptap, drag-drop to R2/MinIO, **EXIF stripped, image re-encoded** (kills polyglot files)
- Served from a separate origin
- **Verify:** upload a JPEG with GPS EXIF, confirm stripped; upload a polyglot, confirm neutralised

**P2.4 — Reactions & subscriptions**
- Per-post reactions; watch/track/mute per thread and category
- Notification fan-out: in-app + Discord DM + optional digest email
- **Verify:** subscribe, have someone reply, receive the notification

**P2.5 — Search**
- Meilisearch index, **ACL filter applied at query time from the caller's mask**
- Facets: category, author, tag, date
- **Verify:** a Ring 0 user searching a term that appears *only* in a Ring 2 post gets zero results — not a redacted result, zero

**P2.6 — Moderation**
- Report button → queue → Discord notification
- Lock, pin, move, delete, ban/mute with duration + reason
- Auto-flags: link spam, new-account velocity, banned phrases
- **Verify:** every moderation action audited

**P2.7 — Recruitment pipeline**
- Public application form (Turnstile) → thread in Ring 2 category → Discord embed with Approve/Reject/Interview buttons → approval grants Discord role → welcome DM + onboarding checklist → 30-day probation timer
- Store answers as structured JSONB for funnel reporting
- **Verify:** full application → approval → role grant → Ring 1 access, end to end

**P2.8 — Discord bridge**
- Site → Discord: new thread posts an embed with a jump link
- Discord → site: `/thread` slash command creates a thread
- **Explicitly NOT message-level mirroring** (ADR-006 / spec §15.5)

**P2.9 — Embed extension point**
- Define the renderer interface for future ED embeds. Register a no-op. P3 fills it.

### EXIT CRITERIA
- [ ] Ring 0 / 1 / 2 categories enforce correctly, including in search
- [ ] XSS suite passes
- [ ] A real application flows to approval and grants access
- [ ] Notifications reach Discord
- [ ] **Real members are using it** — this is the actual exit criterion

### DEMO SCRIPT
1. Anonymous → sees public categories only
2. Search a Ring 2 term as Ring 0 → zero results
3. Post with an image, confirm EXIF stripped
4. Report it, moderate it, check the audit log
5. Submit an application, approve from Discord, confirm access

### COMMON FAILURES
- Filtering search results *after* retrieval — leaks via result counts and pagination
- Building message-level Discord mirroring — permanent support burden, explicitly rejected
- Shipping without real users — you've built a forum nobody has tested

---
---

# P3 — TELEMETRY SPINE
**Goal: the site knows the galaxy AND what your CMDRs are doing in it.**
**Duration: 5–7 sessions · Depends: P2 · THE KEYSTONE PHASE**

### ENTRY CRITERIA
- [ ] P2 exit criteria met, forum in real use
- [ ] Object storage provisioned
- [ ] Disk headroom confirmed for EDDN data (see `ssot/05-integrations/eddn.md` prefilter plan)

### SCOPE — IN
All ED API adapters, EDDN collector, game-data schema populated, FDevIDs mapping, EDMC plugin, telemetry endpoint, system/commodity pages, forum embeds.

### SCOPE — OUT
Trade route optimisation (P6). BGS analysis (P4). Loadout tooling (P7).

### TASKS

**P3.1 — Adapter interfaces**
- `packages/ed-clients`: `ISystemDataProvider`, `ITradeDataProvider`, `ICmdrProfileProvider`, `IRoutePlanner`
- Per ADR-013, **no application code imports a vendor SDK directly**
- Each adapter: typed, retrying with backoff, circuit-breaking, cached per the SSOT caching table
- **Verify:** a fake adapter can be swapped in for tests with no application changes

**P3.2 — Ardent adapter**
- Every endpoint in `ssot/05-integrations/ardent.md`
- **Prefer `/system/address/` over `/system/name/`** — ambiguous names
- Expose `maxDaysAgo` (default 30) as a first-class parameter
- **Every response carries a computed `dataAgeHours`.** Non-negotiable per INV-004.
- **Verify:** live calls, real responses, mark `@verified` in STATUS.md

**P3.3 — EDSM + GalNet + FDevIDs adapters**
- EDSM for coordinates, bodies, traffic
- GalNet feed for the landing page
- **FDevIDs: build the canonical internal→display mapping. Never hand-map. Never show an internal name to a user.**
- **Verify:** every commodity in the DB resolves to a display name

**P3.4 — EDDN collector**
- ZeroMQ subscriber, zlib inflate, schema-routed handlers
- **Batch writes** (500 rows / 2s), **idempotent upserts**, ignore stale timestamps
- **Backpressure:** shed low-value schemas before high-value ones
- **Prefilter by radius** per the SSOT plan — this is a 95% storage saving
- Dead-letter queue for parse failures + alert on failure rate
- **Verify:** run 1 hour, report messages/sec, rows written, parse-failure rate, disk delta

**P3.5 — Seed from dumps**
- Bootstrap systems/stations from Spansh or Ardent dumps rather than waiting weeks for EDDN coverage
- Idempotent and resumable
- **Verify:** row counts vs. the dump; re-running changes nothing

**P3.6 — Spansh adapter**
- **Async job pattern only**: submit → job row → BullMQ poll with backoff → result to object storage → WebSocket push
- Dedupe by parameter hash
- **Verify:** submit a long route, confirm the browser never blocks and the push arrives

**P3.7 — Telemetry endpoint**
- `POST /v1/telemetry`, device-token auth, scoped `telemetry:write`
- Device token issuance + revocation in member profile
- Batch accept, validate every event against `ssot/04-contracts/telemetry-contract.md`
- **Per-category opt-in enforced server-side** — reject categories the member hasn't consented to, don't just ignore them
- **Verify:** replay a real journal file; confirm non-consented categories are rejected with a clear error

**P3.8 — EDMC plugin**
- Python plugin in `plugins/edmc-grimssquad/`, **public source** (AGENTS.md — members are installing code that reads their game journal)
- Settings panel with per-category toggles
- **All I/O off the main thread. Never blocks or slows the game. Fails silently.**
- Optional EDDN forwarding for members not already contributing
- **Verify:** run alongside a real session; confirm zero frame impact; kill the network mid-session and confirm the game is unaffected

**P3.9 — System & commodity pages + forum embeds**
- System page: allegiance, economy, security, stations, services, distance from home
- Commodity page: price ranges, best buy/sell, history sparkline, **freshness badge**
- Fill the P2.9 extension point: `[[Sol]]` hover cards, Coriolis/EDSY URL cards, commodity mentions
- **Verify:** every displayed price shows its age

### EXIT CRITERIA
- [ ] EDDN collector stable 24h+, lag < 60s, parse-failure rate < 0.5%
- [ ] Systems and stations seeded; commodity display names resolve via FDevIDs
- [ ] EDMC plugin installed by ≥3 real members, telemetry arriving
- [ ] Spansh jobs complete asynchronously with push
- [ ] Every price in the UI carries a freshness indicator
- [ ] All adapters marked verified-or-unverified in STATUS.md

### DEMO SCRIPT
```bash
curl -s localhost:3000/v1/admin/health | jq '.eddn'
curl -s localhost:3000/v1/systems/search?q=Shinrarta | jq '.[0]'
curl -s localhost:3000/v1/commodities/tritium | jq '.dataAgeHours'
```
Then: dock in-game with the plugin running → confirm the event lands within 30s.

### COMMON FAILURES
- Single-row inserts from the firehose — the DB falls behind within an hour
- Skipping the prefilter — unbounded disk growth
- Blocking Spansh calls — timeouts and a frozen UI
- A plugin that stutters the game — members uninstall it and you lose the spine
- Displaying prices without age — the #1 way to lose member trust

---
---

# P4 — BGS CONSOLE
**Goal: members open the site to find out what to do tonight.**
**Duration: 4–6 sessions · Depends: P3**

### ENTRY CRITERIA
- [ ] P3 exit criteria met, telemetry flowing from real members
- [ ] Tracked factions and systems confirmed by the human
- [ ] BGS tick detection source chosen

### SCOPE — IN
Influence tracking, tick detection, control board, orders board, activity reporting, conflict tracking, digests.

### SCOPE — OUT
Influence *projection/simulation* (P9 — the model needs months of data first). Powerplay. Colonisation.

### TASKS

**P4.1 — Influence ingestion** — extract faction states from EDDN journal messages into `faction_influence_snapshots`; handle multiple reports per tick without double-counting.
**P4.2 — Tick detection** — integrate a community tick source and/or infer from update clustering; every snapshot associates to a `tick_id`. **Verify against 7 days of known ticks.**
**P4.3 — Influence charts** — per system, per faction, over time, with tick markers. Delta since last tick, prominent.
**P4.4 — System control board** — sortable grid: our influence, top competitor, delta, active states, pending states, conflicts.
**P4.5 — Orders board** — officers set `push`/`hold`/`suppress`/`ignore` with priority + written guidance. **Members see a prioritised "tonight" list on their dashboard.** This single feature converts casual players into effective contributors — get the UX right.
**P4.6 — Activity reporting** — automatic from telemetry (missions, bounties, bonds, cartographics, trade), manual form fallback, optional BGS-Tally import. Track negatives too (murders, failed missions).
**P4.7 — Conflict tracker** — wars/elections, day-by-day win counts, required daily wins.
**P4.8 — Nightly digest** — post-tick summary to Discord: what changed, what it means, what to do about it.

### EXIT CRITERIA
- [ ] Influence charts match independent sources for the same systems
- [ ] Ticks correctly identified across 7 consecutive days
- [ ] Officers can set orders; members see them on their dashboard
- [ ] Activity auto-captured from telemetry without manual entry
- [ ] Nightly digest posts to Discord

### COMMON FAILURES
- Double-counting multiple EDDN reports of the same tick — wrong influence, destroyed trust
- Naive tick inference — everything downstream is wrong; validate against known ticks
- Building the orders board without talking to your BGS lead — it won't match how you actually operate

---
---

# P5 — OPS & CARRIERS
**Goal: operations and carrier logistics run through the site.**
**Duration: 3–5 sessions · Depends: P4**

### SCOPE — IN
Operations board, signups, Discord Events sync, reminders, wing composition, carrier registry, jump schedule, tritium tracking, carrier markets.
### SCOPE — OUT
Squadron ledger/economy (P9). Replay viewer (P9).

**P5.1 — Operations CRUD** — types, recurrence, capacity, required roles, timezone-correct display (local **and** UTC — Elite runs on game time).
**P5.2 — Signups** — yes/maybe/no/standby, ship selection **from the member's actual fleet**, role assignment, standby promotion.
**P5.3 — Discord Events sync** — bidirectional where sane; reminder DMs at T-24h / T-1h / T-10m.
**P5.4 — Wing composition checker** — "this op needs 2 more shieldless miners; 3 members have a qualifying build." You run combat *and* mining *and* hauling off one roster; this is why it matters.
**P5.5 — Carrier registry** — callsign, owner, location, access, services, fuel; from cAPI (owner token) and EDDN carrier messages.
**P5.6 — Jump schedule board** — shared calendar so three carriers don't leave staging simultaneously.
**P5.7 — Tritium tracker** — burn rate, jumps remaining, target with contribution ledger, auto-updated from telemetry.
**P5.8 — Carrier market mirror** — what each carrier buys/sells, so members stop asking in Discord.
**P5.9 — Post-op** — attendance marking, AAR thread auto-created in Squadron Log, contribution stats.

### EXIT CRITERIA
- [ ] A real op is scheduled, filled, run and AAR'd through the site
- [ ] Times correct for members in ≥3 timezones
- [ ] Carrier fuel tracked without manual entry
- [ ] Wing composition checker returns correct matches against real fleet data

---
---

# P6 — TRADE TERMINAL
**Goal: "where do I make credits tonight" is answered on your site.**
**Duration: 4–5 sessions · Depends: P3**

### SCOPE — IN
Commodity lookup, importer/exporter finder, own-DB route optimiser, Spansh delegation, carrier-aware routing, squadron trade board, group hauling, alerts.
### SCOPE — OUT
Mining hotspot registry (P9). Materials exchange (P9).

**P6.1 — Commodity lookup UI** — search, galactic ranges, supply/demand, history sparkline, **freshness badge on every row**, data-age slider bound to `maxDaysAgo`.
**P6.2 — Importer/exporter finder** — sorted by price, with `minVolume` / `fleetCarriers` / pad size / max-ls filters.
**P6.3 — Route optimiser** — the SQL from spec §7.4 against your own `market_orders`. Single-hop first, then loops, then bounded multi-hop beam search. **Materialise `best_trades`, refresh every 15 min.**
**P6.4 — Route UI** — collect origin, jump range, cargo, credits, pad, max ls, max ly, carriers, data age. Results with per-hop copy-to-clipboard.
**P6.5 — Spansh delegation** — neutron, galaxy w/ refuelling, Road to Riches, carrier router, tourist. Async, cached by param hash.
**P6.6 — Carrier-aware routing** — "best route ending at one of *our* carriers." This is what Inara can't do for you.
**P6.7 — Squadron trade board** — members post supply/demand offers.
**P6.8 — Group hauling ops** — shared cargo target, per-member contribution, live progress from telemetry. Built for community goals and carrier fuel drives.
**P6.9 — Alerts** — "notify me if Tritium within 50 ly of our carrier drops below 40k/t."

### EXIT CRITERIA
- [ ] Route query on a populated DB returns in <2s
- [ ] Routes spot-checked in-game and found accurate
- [ ] Every price shows its age
- [ ] Spansh jobs never block the UI
- [ ] A real group hauling op tracked to completion

### COMMON FAILURES
- Unindexed route queries — 30s response times. Check the SSOT partial indexes exist.
- Ignoring `distance_to_arrival` — "profitable" routes with a 200,000 ls supercruise
- Forgetting carrier exclusion — carrier prices distort everything

---
---

# P7 — SHIPYARD
**Goal: ship builds live at home.**
**Duration: 2–4 sessions · Depends: P3**

### SCOPE — IN
Self-hosted Coriolis, Loadout Locker, doctrine builds, fleet queries, cAPI fleet import.
### SCOPE — OUT
Building an outfitting UI from scratch. **Run Coriolis.**

**P7.1 — Coriolis deploy** — Docker per `ssot/05-integrations/coriolis.md`, **pin the upstream commit**, theme to match, at `shipyard.<domain>`. Schedule a monthly `coriolis-data` check — Frontier keeps adding ships and stale module data produces wrong builds.
**P7.2 — Build import** — Coriolis URL, EDSY URL, Coriolis JSON, journal `Loadout` event. All four.
**P7.3 — Ship maths** — port from Coriolis (MIT, **attribute it**) into `packages/ed-domain`: jump range laden/unladen/max, DPS by damage type, effective shield/armour HP, thermal load, cargo, scoop rate, rebuy, cost. **Unit-test against known-good Coriolis outputs.**
**P7.4 — Locker CRUD** — save, version, comment, visibility (private/squadron/public), cached stats.
**P7.5 — Comparison** — side-by-side up to 4 with delta highlighting.
**P7.6 — Doctrine builds** — officers mark approved standard builds per role.
**P7.7 — Requirements checker** — engineering needed, engineer locations via `nearest/technology-broker` + EDSM, materials shopping list.
**P7.8 — Fleet queries** — "every Anaconda in the squadron with >60 ly jump range." This is the query that makes P5.4 work.
**P7.9 — cAPI fleet import** — real fleet from `/profile`, respecting the ~25-day token reality.

### EXIT CRITERIA
- [ ] Coriolis live and themed
- [ ] All four import formats work
- [ ] Ship maths match Coriolis within 1% on 10 test builds
- [ ] Fleet queries return correct results
- [ ] Doctrine builds visible to members

---
---

# P8 — GRIM'S SQUAD AI
**Goal: GSAI online — and useful, because everything it operates now exists.**
**Duration: 6–10 sessions · Depends: P2, P3, P4, P5, P6, P7**

### ENTRY CRITERIA
- [ ] **All prior phases complete.** GSAI built earlier is a chatbot with nothing to do.
- [ ] Both GPUs present; NVIDIA driver **580+**; GPU UUIDs recorded
- [ ] Tunnel between VPS and local box established and tested

### SCOPE — IN
Dual Ollama instances, arbiter, tunnel security, deterministic fast path, agent loop, tool registry, RAG, web + Discord surfaces, write tools, audit, kill switch.
### SCOPE — OUT
Voice (P9). Cloud fallback (feature-flagged, off).

**P8.1 — Ollama dual instance** — two systemd units per `ssot/06-ai/models.md`, **UUID-pinned**, shared model store. Instance A (3060): `qwen3:8b`, `num_ctx 16384`, `KEEP_ALIVE=-1`. Instance B (5070 Ti): `qwen3:14b`, `KEEP_ALIVE=5m`. **Verify `ollama ps` shows `size_vram == size` on both** — if not, you're CPU-offloaded and it will crawl.

**P8.2 — Reliability benchmark** — 20 identical tool-call requests **using your real tool schemas**, per instance. Measure valid-structured-`tool_calls` rate, TTFT, wall time. **Below 75%, change model or quant before building anything on top.** Record results in STATUS.md.

**P8.3 — Tunnel security** — WireGuard control plane and/or Cloudflare Tunnel + Access service token, **plus mTLS, plus HMAC request signing with single-use nonce and 60s window**. Egress allowlist on the agent container: Ollama localhost, your API, whitelisted ED APIs, nothing else. **Verify:** from an arbitrary internet host, the gateway is unreachable; a replayed request is rejected.

**P8.4 — Gateway** — signature + nonce verification, concurrency semaphore, per-user quota, heartbeat to the API every 15s.

**P8.5 — GPU arbiter** — `nvidia-smi` polling, `EliteDangerous64` detection, VRAM headroom check, temperature guard shedding to DEGRADED above ~83°C. Routing per `ssot/06-ai/architecture.md`. **Verify:** launch Elite, confirm instance B stops receiving work and releases VRAM.

**P8.6 — Deterministic fast path** *(build this BEFORE the agent loop)* — embedding-similarity classifier over ~40 canned intents → direct tool call → templated response, **no LLM**. Target: ~70% of traffic, <200ms, zero hallucination risk. Per ADR-012 this is the front door; the agent loop is the fallback.

**P8.7 — Tool registry** — generate from `ssot/06-ai/tools.yaml`. Each: Zod schema, permission, mutating flag, handler, optional preview. **Tools that touch squadron data call BACK through the tunnel to the API with the same signed user context** — so the API's existing guards enforce everything, once. The agent must have no other route to the data.

**P8.8 — Agent loop** — `MAX_STEPS` 6 (8b) / 8 (14b). **Tools filtered by permission before the model sees them.** Zod errors fed back for self-correction. Results truncated to ~2500 chars. Every invocation audited including denials.

**P8.9 — RAG** — chunk 600/80 respecting headings; embed; **upsert with the source's visibility value**; hybrid vector + Meilisearch BM25 merged by RRF (pure vector fails on CMDR names, system names, callsigns like `K7Q-B4X`). **ACL filter applied before nearest-neighbour returns.** Re-index or delete on source ACL change.
**Verify — this test is mandatory:** a Ring 0 user asks GSAI about content that exists only in a Ring 2 thread. Assert the answer contains nothing from it and the retrieval returned zero rows.

**P8.10 — Web surface** — ⌘K slide-over on every page with page context injected, streaming over WebSocket, tool calls as collapsible cards, confirmations as inline buttons.

**P8.11 — Discord surface** — `/gsai`, mentions, thread-aware, ephemeral for anything private. Same permission mask from the invoker's roles.

**P8.12 — Write tools** — with confirmation gates per `tools.yaml`. **Two-step for `grant_role`. No unattended destructive operations, regardless of permission.**

**P8.13 — Fallback states** — ONLINE / DEGRADED / OFFLINE surfaced honestly in the UI. Offline: read queries fall back to templated non-LLM responses; chat queues and delivers by Discord DM on reconnect.

**P8.14 — Proactive** — daily briefing, BGS tick summary, market alerts, weekly digest. **Run on instance B overnight** while you sleep and the card is free.

**P8.15 — Audit UI & kill switch** — officers review all conversations and tool calls; members see their own. One admin toggle disables all write tools instantly; another disables GSAI entirely.

### EXIT CRITERIA
- [ ] Both instances resident, benchmark ≥75% tool-call reliability, recorded
- [ ] Fast path handles ≥60% of real queries without the LLM
- [ ] **ACL leak test passes** (P8.9)
- [ ] Prompt-injection attempt via forum content cannot invoke an unpermitted tool
- [ ] Gateway unreachable from the public internet; replay rejected
- [ ] Arbiter correctly yields when Elite is running
- [ ] Every tool call audited, including denials
- [ ] Kill switch works
- [ ] Site fully functional with the local box powered off

### COMMON FAILURES
- Letting one Ollama instance span both GPUs — Blackwell features lost to Ampere alignment
- Building the agent loop before the fast path — slow, expensive, and hallucination-prone by default
- RAG chunks without visibility — **the leak this whole design exists to prevent**
- Permission checks in the system prompt — one injection away from escalation
- Claiming the phase is done without running the ACL leak test

---
---

# P9 — POLISH & DELIGHT
**Goal: the things that make it *epic* rather than merely functional.**
**Duration: ongoing · Depends: P8**

Pull from `ssot/08-plan/tasks.yaml` P9 tasks. Suggested order by value-to-effort:

**Tier 1 (do these)** — CMDR business cards · "Am I needed?" widget · copy-to-clipboard everywhere · achievements & badges · onboarding checklist · PWA + push for ops reminders · command palette · squadron milestone bot posts

**Tier 2** — Mentor pairing · LFG board · engineering tracker · materials exchange · Community Goal tracker · mining hotspot registry · screenshot gallery + monthly contest · squadron wiki · AX/Thargoid war board · Powerplay module · colonisation tracker · squadron ledger

**Tier 3** — 3D galaxy map · BGS projection engine · op replay viewer · voice AI (Whisper + Piper) · inter-squadron federation · i18n

**Always** — load testing · full a11y audit · security review · runbook completeness · restore test

### STANDING EXIT CRITERIA
- [ ] Monthly restore test passes
- [ ] a11y audit ≥95 on all key screens, high-contrast theme shipped
- [ ] All runbooks current
- [ ] Backups verified within the last 30 days

---
---

## APPENDIX — WHEN THINGS GO WRONG

**Agent contradicts the SSOT** — stop it. `"That contradicts ssot/<file>. Re-read it and correct the implementation, or write a proposed ADR if you believe the SSOT is wrong."`

**Agent invents an API endpoint** — `"You've invented that endpoint. Show me where it's documented in ssot/05-integrations/, or mark the adapter @unverified and list it in STATUS.md."`

**Agent drifts into a later phase** — `"That's P<n>, out of scope. Note it in ssot/08-plan/tasks.yaml and return to P<current>."`

**Context is full mid-phase** — new session, then: `"Read AGENTS.md, ssot/STATUS.md, and ssot/08-plan/tasks.yaml. Resume P<n> at task <id>."`

**A phase is taking far too long** — its scope grew. Re-read SCOPE — OUT, cut back to it, move the rest to `tasks.yaml`.

**You disagree with the SSOT** — change the SSOT first, via an ADR, then let the code follow. Never patch around it in code.
