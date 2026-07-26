# GRIM'S SQUAD — SQUADRON HUB
## Ultra-Detailed Build Specification v1.0

*Elite Dangerous squadron platform · public site + gated member area + forums + shipyard + trade terminal + BGS tracker + local AI agent*

> **Provenance note.** This is the source prose specification, preserved verbatim (encoding normalised to UTF-8) for reference and audit. **It is not the law.** `ssot/` is derived from this document and supersedes it. Where this file and `ssot/` disagree, `ssot/` wins; if you believe this file is right and `ssot/` is wrong, write a proposed ADR in `ssot/01-decisions/proposed/`.

---

## 0. READ THIS FIRST — ASSUMPTIONS & DECISION GATES

This spec is written to be **buildable as-is**. Where a decision materially changes the architecture and I didn't have your answer yet, I picked a **default**, marked it `[ASSUMED]`, and noted the alternative. Change any of these and I'll re-cut the affected sections.

| # | Assumption | Default chosen | Alternative |
|---|---|---|---|
| A1 | Squadron size | 20–150 CMDRs, <500 concurrent web users | Scale-out notes in §13 |
| A10 | Squadron profile | **CONFIRMED** — runs a player minor faction, owns fleet carriers, does combat/AX **and** trade/mining/exploration | Roadmap reordered, see §14 |
| A2 | Public edge hosting | **CONFIRMED** — cloud VPS (4 vCPU / 8 GB / 160 GB NVMe), AI at home | — |
| A3 | Primary identity | **Discord OAuth2** | Frontier cAPI as primary (worse UX) |
| A4 | Language/runtime | **TypeScript everywhere** (Next.js + NestJS) | Python/Django, Go, PHP/Laravel |
| A5 | Database | PostgreSQL 16 + Redis + Meilisearch | MySQL, SQLite (too small) |
| A6 | Forum | **Custom-built, native to the app** | Discourse SSO'd in (§7.2 alt) |
| A7 | AI runs on | **CONFIRMED** — your local box, **two Ollama instances**: RTX 3060 (primary, always-on) + RTX 5070 Ti (overflow/batch, arbiter-gated) | See §8.2 |
| A8 | Budget | ~$12–30/mo cloud + your existing hardware | $0 all-local (§13.4) |
| A9 | You have | A domain name, a Discord server with roles | — |

**The 12 questions I need answered to finalise** are in §18 and are also being asked to you interactively.

---

## 1. EXECUTIVE SUMMARY

**Grim's Squad Hub** is a single application that replaces the scattered set of tools most squadrons juggle (Discord + Inara page + Coriolis links + Spansh bookmarks + a Google Sheet).

It has three concentric rings:

```
┌─────────────────────────────────────────────────────┐
│  RING 0 — PUBLIC                                    │
│  Landing, recruitment, public forum, squadron       │
│  stats, GalNet feed, public ship builds, leaderboard│
│  ┌────────────────────────────────────────────────┐ │
│  │  RING 1 — VERIFIED MEMBER                      │ │
│  │  Private forum, ops board, fleet/carrier       │ │
│  │  tracker, BGS console, trade terminal,         │ │
│  │  loadout locker, squadron ledger, AI assistant │ │
│  │  ┌───────────────────────────────────────────┐ │ │
│  │  │  RING 2 — OFFICER / LEADERSHIP            │ │ │
│  │  │  Moderation, member management, BGS       │ │ │
│  │  │  orders, audit log, AI admin tools,       │ │ │
│  │  │  recruitment queue                        │ │ │
│  │  └───────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

Ring membership is derived from **Discord roles**, synced continuously by a bot, and optionally hardened by **Frontier cAPI CMDR verification**.

Cross-cutting all of it: **Grim's Squad AI (GSAI)** — an Ollama-hosted agent on your local machine, reachable through a secure tunnel, that can *actually operate* the site through a permissioned tool registry rather than just chatting about it.

---

## 2. REALITY CHECK — WHAT THE ED ECOSYSTEM CAN AND CANNOT DO

This is the most important section in the document. Several things you asked for are possible but not in the way you'd expect, and one is not possible at all. Getting this right up front saves weeks.

### 2.1 — There is no "Login with Inara"

Inara has **no OAuth provider and no login delegation**. Its API is a JSON-POST endpoint where you send an app key plus events. Two consequences:

- You **cannot** have members "log in with Inara."
- Your application must be **whitelisted by Inara's operator (CMDR Artie)** before the API key works at all — an unapproved app gets `400 This application has no access allowed.` Budget days-to-weeks of lead time for that approval, and request it in week 1.
- Rate limits are tight and enforced per-app. The published guidance for tool authors is on the order of **~2 requests/minute**, with harsher throttling for abusive apps. Treat Inara as a **slow enrichment source**, never as a request-path dependency.

What Inara *is* good for: `getCommanderProfile` returns a CMDR's ranks and squadron membership. That makes it a useful **corroborating signal** for "is this person actually in Grim's Squad on Inara" — run it nightly, cached, out of band.

### 2.2 — Frontier's cAPI *is* a real OAuth2 identity provider

The Frontier Companion API (cAPI) uses **OAuth2 with PKCE**, and you apply for a client at `user.frontierstore.net`. This is the only way to get a **cryptographically trustworthy** "this browser session belongs to the Frontier account that owns CMDR X."

Critical operational details that will bite you if you don't design for them:

- Access tokens are short-lived; expiry surfaces as **HTTP 422** from cAPI endpoints.
- Refresh tokens work **for at most ~25 days from the original authorization**, after which the user must re-authorize interactively.
- **Design implication:** cAPI verification is a *periodic ceremony*, not a persistent session. Store the verification result (`cmdr_name`, `verified_at`, `verification_method`) durably and let it decay into a "re-verify" nudge. Never make a page load depend on a live cAPI call.
- cAPI is also the source for the CMDR's actual in-game ship loadouts, fleet carrier state, and current market — feeding the shipyard and carrier modules with *real* data instead of hand entry.
- Approval for a cAPI client is discretionary and can take time. **Apply in week 1.**

### 2.3 — ⚠️ EDDB is dead

EDDB.io shut down in 2023. Any tutorial, plugin, or Stack Overflow answer telling you to hit `eddb.io/api` is stale. Do not build on it.

### 2.4 — EDDN is the firehose, and it's free

The **Elite Dangerous Data Network** is a ZeroMQ pub/sub relay at `tcp://eddn.edcd.io:9500` carrying live player-submitted journal events — market snapshots, outfitting, shipyard, FSS scans, docking, carrier jumps. Every major site (Inara, EDSM, Spansh, Ardent) is downstream of it.

**You should subscribe directly.** A ~150-line worker gives you your own market database with no rate limits and no dependency on anyone's uptime. This is the backbone of your trade terminal.

Caveats: it's Live-galaxy only in practice, data is only as fresh as the last CMDR who docked there, and you must handle schema versioning per message type.

### 2.5 — Ardent Insight is the best turnkey trade API

Post-EDDB, `api.ardent-insight.com` is the strongest fit for what you described:

- **Fully anonymous** — no key, no signup.
- **No rate limits currently enforced** (respectful use requested).
- 150M+ star systems, millions of live buy/sell orders.
- Endpoints that map almost 1:1 onto your feature list: commodity min/max/avg pricing, importers sorted by price paid, exporters sorted by price, nearby importers/exporters within a radius, nearest station providing a given service, whole-system commodity dumps.
- **AGPL-licensed and self-hostable**, with full database dumps available for download.

**Strategy:** use the hosted API for v1, mirror the dumps + run your own EDDN collector by v2, so Grim's Squad is never hostage to someone else's server.

Key endpoint shapes you'll be wrapping:

```
GET /v2/commodities
GET /v2/commodity/name/{commodity}
GET /v2/commodity/name/{commodity}/imports?minVolume&minPrice&fleetCarriers&maxDaysAgo
GET /v2/commodity/name/{commodity}/exports?minVolume&maxPrice&fleetCarriers&maxDaysAgo
GET /v2/system/name/{system}
GET /v2/system/name/{system}/nearby?maxDistance
GET /v2/system/name/{system}/nearest/{service}?minLandingPadSize
GET /v2/system/name/{system}/commodities
GET /v2/system/name/{system}/commodity/name/{commodity}/nearby/imports?maxDistance&minVolume
GET /v2/system/name/{system}/commodity/name/{commodity}/nearby/exports?maxDistance
GET /v2/market/{marketId}/commodity/name/{commodity}
GET /v2/stats
```

Note the `maxDaysAgo` parameter defaults to **30** — that default is doing a lot of work for data quality. Expose it in your UI as a "data freshness" slider.

Also note the system-address form (`/v2/system/address/{id}`) — use it wherever you can, because ~1,300 systems have ambiguous names.

### 2.6 — Coriolis is MIT-licensed and self-hostable

You asked for "a place members can do ship builds like coriolis.io." The correct answer is: **run Coriolis.**

- `EDCD/coriolis` — the app, MIT licensed, Node/React, with a documented Docker build.
- `EDCD/coriolis-data` — ship/module JSON, MIT licensed.
- The build is literally: clone both repos, `docker buildx build --build-context data=../coriolis-data --tag coriolis .`, `docker run -d -p 3300:3300 coriolis`.

**Important licensing nuance:** the *code* is MIT. The *game data and imagery* are Frontier's IP, used by Coriolis under permission for **non-commercial purposes**. So: keep the squadron site non-commercial, don't sell access, don't run ads against it, and carry the Frontier attribution notice. (See §17.)

Deploy it at `shipyard.grimssquad.example`, skin it to your theme, and wrap it with your own **Loadout Locker** service (§7.3) that stores builds against member accounts with comments and approval workflow — the thing Coriolis itself doesn't do.

Alternative/complement: **EDSY** (edsy.org) is the other major outfitting tool and produces very compact shareable build URLs; support importing both formats.

### 2.7 — Spansh for heavy route computation

Spansh runs the de-facto route planners (neutron, galaxy plotter with refuelling, Road to Riches, trade router, fleet carrier router, tourist/"visit these places", body & system search) and publishes **nightly full-galaxy dumps** plus daily/weekly/monthly deltas at `spansh.co.uk/dumps`.

Its API is **asynchronous job-based**: you POST a job, receive a job ID, then poll a results endpoint until complete. Long routes legitimately take tens of seconds. **Design implication:** every Spansh call in your system goes through a job queue with a status row in Postgres and a WebSocket push on completion — never a blocking HTTP request from the browser.

Confirm exact current endpoint paths and etiquette against Spansh's own docs before coding; they're a one-person operation and worth being polite to (cache aggressively, dedupe identical jobs, back off).

### 2.8 Other sources worth wiring

| Source | Use for | Notes |
|---|---|---|
| **EDSM** (`edsm.net/en/api-v1`) | System coordinates, bodies, traffic/deaths stats, station lists | Free, generous, no key for most endpoints |
| **EDCD/FDevIDs** | Canonical internal→display name mapping for commodities, modules, ships | Essential. Everything else is inconsistent. |
| **GalNet JSON feed** | In-universe news on your landing page | Great flavour, near-zero effort |
| **EDMC** (EDCD/EDMarketConnector) | The client your members already run | Ship them a **custom EDMC plugin** (§7.12) — this is the single highest-leverage thing on this list |
| **BGS-Tally** | Existing BGS/Powerplay/Colonisation tracker plugin | Either integrate or borrow the data model |

### 2.9 The strategic conclusion

> **Discord is your identity layer. cAPI is your proof-of-CMDR layer. EDDN is your data layer. Ardent/Spansh/EDSM are your acceleration layer. Inara is a nightly cross-check. Coriolis is a self-hosted subsystem. A custom EDMC plugin is your live-telemetry layer.**

Everything below builds on that sentence.

---

## 3. SYSTEM ARCHITECTURE

### 3.1 Topology

```
                        ┌────────────────────────┐
                        │      Cloudflare        │
                        │  DNS · WAF · CDN · TLS │
                        │  Turnstile · Tunnel    │
                        └───────────┬────────────┘
                                    │
        ┌───────────────────────────┼──────────────────────────┐
        │                           │                          │
┌───────┴────────┐        ┌─────────┴──────────┐    ┌──────────┴──────────┐
│   PUBLIC VPS   │        │  YOUR LOCAL BOX    │    │  DISCORD / EXTERNAL │
│  (edge, 24/7)  │        │  (AI, tunnel-only) │    │                     │
├────────────────┤        ├────────────────────┤    ├─────────────────────┤
│ Caddy/Traefik  │        │ cloudflared        │    │ Discord Gateway     │
│ web  (Next.js) │───────▶│ gsai-gateway       │    │ Frontier cAPI       │
│ api  (NestJS)  │  mTLS  │ Ollama (LLM)       │    │ Inara API           │
│ bot  (disc.js) │        │ Whisper/Piper opt. │    │ Ardent / Spansh     │
│ worker (BullMQ)│        │ pgvector or Qdrant │    │ EDSM / EDDN (ZMQ)   │
│ eddn-collector │        │ tool-executor      │    │ GalNet feed         │
│ Postgres 16    │        └────────────────────┘    └─────────────────────┘
│ Redis 7        │
│ Meilisearch    │        ┌────────────────────┐
│ MinIO / R2     │        │ coriolis (docker)  │
│ Coriolis       │        │ shipyard.<domain>  │
└────────────────┘        └────────────────────┘
```

### 3.2 Service inventory

| Service | Runtime | Responsibility | Scaling |
|---|---|---|---|
| `web` | Next.js 15 (App Router, RSC) | SSR/ISR public pages, authed SPA shell | Stateless, N replicas |
| `api` | NestJS + Fastify adapter | REST + WebSocket, all business logic, authz | Stateless, N replicas |
| `bot` | discord.js v14 | Role sync, slash commands, AI relay, event notices | **Singleton** (or shard-aware) |
| `worker` | BullMQ on Redis | Spansh jobs, Inara sync, cAPI refresh, digests, image processing | Horizontal by queue |
| `eddn-collector` | Node + zeromq | EDDN firehose → Postgres | **Singleton**, idempotent writes |
| `gsai-gateway` | Fastify (your box) | Auth'd bridge from `api` → agent loop | Singleton |
| `gsai-agent` | Node/Python + Ollama SDK | Plan → tool-call → observe loop | Concurrency-capped |
| `coriolis` | Docker, upstream image | Ship outfitting UI | Stateless |
| `postgres` | PG 16 + pgvector + TimescaleDB (opt.) | Everything relational + embeddings | Primary + streaming replica |
| `redis` | Redis 7 | Queues, cache, rate limits, WS pub/sub, sessions | Single + AOF |
| `meilisearch` | Meilisearch | Forum/wiki/build/system search | Single |
| `objectstore` | Cloudflare R2 or MinIO | Avatars, screenshots, attachments | — |

### 3.3 Why this shape

- **The public edge never depends on your home box being up.** If your PC is off, the site works perfectly; the AI panel shows "GSAI offline — queued" and processes on reconnect. This is non-negotiable for a community site.
- **The bot and the API share one database and one authorization model.** No drift between "what Discord thinks you are" and "what the site thinks you are."
- **Every external API is behind an adapter interface** (`ITradeDataProvider`, `ISystemDataProvider`, `ICmdrProfileProvider`). Ardent goes down or changes; you swap the adapter, not the app. This is how you survive the ED third-party ecosystem, which has a documented habit of disappearing.

---

## 4. TECHNOLOGY STACK

### 4.1 Chosen stack `[ASSUMED — A4]`

```
Frontend    Next.js 15 · React 19 · TypeScript · Tailwind v4 · shadcn/ui
            TanStack Query · Zustand · Framer Motion
            Deck.gl or Three.js (galaxy map) · Recharts (analytics)
            Tiptap (rich text) · socket.io-client

Backend     Node 22 LTS · NestJS 10 (Fastify) · TypeScript
            Prisma or Drizzle ORM · Zod (validation, shared with FE)
            BullMQ · socket.io · Passport (Discord + custom cAPI strategy)
            Pino (logs) · OpenTelemetry

Bot         discord.js v14 · same Prisma client · shared authz module

Data        PostgreSQL 16 (+pgvector, +TimescaleDB for market history)
            Redis 7 · Meilisearch 1.x · Cloudflare R2

AI          Ollama · Qwen3 (see §8.2) · pgvector or Qdrant
            optional: faster-whisper (STT), Piper (TTS)

Infra       Docker Compose (v1) → Kubernetes/k3s (only if you outgrow it)
            Caddy or Traefik · Cloudflare Tunnel · GitHub Actions
            Grafana + Prometheus + Loki · Sentry
```

### 4.2 Monorepo layout

```
grims-squad/
├── apps/
│   ├── web/                  # Next.js
│   ├── api/                  # NestJS
│   ├── bot/                  # Discord bot
│   ├── worker/               # BullMQ processors
│   ├── eddn-collector/       # ZeroMQ subscriber
│   └── gsai/                 # AI gateway + agent (deploys to local box)
├── packages/
│   ├── db/                   # Prisma schema, migrations, seed
│   ├── shared/               # Zod schemas, DTOs, enums, permission bitmasks
│   ├── ed-clients/           # Ardent, Spansh, EDSM, Inara, cAPI, GalNet adapters
│   ├── ed-domain/            # Ship/module maths, FDevIDs mapping, jump-range calc
│   ├── ui/                   # Design system components
│   └── ai-tools/             # Tool registry: schema + handler + permission
├── infra/
│   ├── docker/               # Compose files, Dockerfiles
│   ├── tunnel/               # cloudflared config
│   └── grafana/
├── plugins/
│   └── edmc-grimssquad/      # Python EDMC plugin
└── docs/
```

Use **pnpm workspaces + Turborepo**. The `shared` package containing Zod schemas used by both FE and BE is the single biggest quality-of-life win here.

---

## 5. IDENTITY, AUTHENTICATION & AUTHORIZATION

### 5.1 The three-token model

| Layer | Mechanism | Answers | Required? |
|---|---|---|---|
| **Identity** | Discord OAuth2 (`identify`, `email`, `guilds.members.read`) | "Who is this person, and what roles do they hold in our server?" | Yes |
| **Verification** | Frontier cAPI OAuth2 + PKCE | "Do they provably own CMDR X?" | For Ring 1+ |
| **Enrichment** | Inara `getCommanderProfile`, EDSM, EDMC plugin | "What are their ranks/squadron/current system?" | Optional |

### 5.2 Discord OAuth flow

```
1. GET  /auth/discord              → 302 to Discord authorize
2. GET  /auth/discord/callback     → exchange code, fetch:
                                       - /users/@me
                                       - /users/@me/guilds/{GUILD_ID}/member
3. Upsert `users` + `discord_identities`
4. Map guild role IDs → internal roles via `role_mappings`
5. Issue app session:
     - Access JWT   (15 min, HttpOnly, SameSite=Lax, __Host- prefix)
     - Refresh JWT  (30 d, rotating, family-tracked for reuse detection)
6. Redirect to intended destination
```

**Why `guilds.members.read` and not just `guilds`:** the former returns the actual role ID array for your specific guild. That is the whole ballgame for role-gating.

**Belt and braces:** the browser flow gives you roles at login. The bot gives you roles in real time via `guildMemberUpdate`. Use both — bot events for freshness, OAuth for correctness on login, and a nightly full reconciliation job for drift.

### 5.3 Frontier cAPI verification flow

```
1. User clicks "Verify CMDR" in profile
2. api generates code_verifier + code_challenge (S256), stores verifier in Redis (10 min TTL)
3. 302 → Frontier authorize endpoint (scope: auth capi)
4. Callback → exchange code + verifier → access_token + refresh_token
5. GET cAPI /profile → authoritative commander name
6. Write cmdr_verifications { user_id, cmdr_name, verified_at, expires_at = now + 25d }
7. Encrypt refresh_token at rest (AES-256-GCM, key in env/KMS — NEVER plaintext in DB)
8. Grant `cmdr_verified` flag → unlocks Ring 1
```

**Token lifecycle worker** (`worker`, hourly):
- Refresh access tokens approaching expiry.
- At `verified_at + 20d`, DM the member via the bot: "Your CMDR verification expires in 5 days, re-verify here."
- At expiry, downgrade to `cmdr_verified: stale` — keep read access, revoke write-to-fleet-data actions. Don't hard-kick people; that's how you lose members to friction.

**Fallback verification** (for members who won't or can't do cAPI): a **claim-and-attest** flow —
1. Member enters CMDR name → site generates a nonce like `GRIM-7X2Q`.
2. Member sets that string in their **Inara bio** (or posts an in-game screenshot to a Discord verification channel).
3. Worker polls Inara `getCommanderProfile`, or an officer approves the screenshot.
4. Marked `verification_method: 'inara_nonce' | 'officer_manual'` — lower trust tier, recorded as such.

### 5.4 Authorization model

Do **not** use string role checks scattered through controllers. Use a **permission bitmask + policy layer**.

```ts
// packages/shared/permissions.ts
export const Permission = {
  // Forum
  FORUM_VIEW_PUBLIC:        1n << 0n,
  FORUM_POST_PUBLIC:        1n << 1n,
  FORUM_VIEW_MEMBER:        1n << 2n,
  FORUM_POST_MEMBER:        1n << 3n,
  FORUM_VIEW_OFFICER:       1n << 4n,
  FORUM_MODERATE:           1n << 5n,
  // Ops
  OPS_VIEW:                 1n << 10n,
  OPS_SIGNUP:               1n << 11n,
  OPS_CREATE:               1n << 12n,
  OPS_MANAGE:               1n << 13n,
  // Fleet & carriers
  FLEET_VIEW:               1n << 20n,
  FLEET_EDIT_OWN:           1n << 21n,
  CARRIER_VIEW:             1n << 22n,
  CARRIER_MANAGE:           1n << 23n,
  // BGS
  BGS_VIEW:                 1n << 30n,
  BGS_REPORT:               1n << 31n,
  BGS_SET_ORDERS:           1n << 32n,
  // Trade / market
  TRADE_QUERY:              1n << 40n,
  TRADE_SAVE_ROUTE:         1n << 41n,
  // AI
  AI_CHAT:                  1n << 50n,
  AI_TOOLS_READ:            1n << 51n,
  AI_TOOLS_WRITE:           1n << 52n,
  AI_TOOLS_ADMIN:           1n << 53n,
  // Admin
  MEMBER_MANAGE:            1n << 60n,
  ROLE_MANAGE:              1n << 61n,
  AUDIT_VIEW:               1n << 62n,
  SITE_CONFIG:              1n << 63n,
} as const;
```

Roles are **named bundles** of permissions, editable in the admin UI, mapped to Discord role IDs:

| Internal role | Typical Discord role | Ring |
|---|---|---|
| `guest` | *(none — unauthenticated)* | 0 |
| `applicant` | `@Recruit` | 0.5 |
| `member` | `@Squadron Member` | 1 |
| `wing_lead` | `@Wing Leader` | 1.5 |
| `officer` | `@Officer` | 2 |
| `commander` | `@Squadron Leader` | 2 |
| `sysadmin` | `@Admin` | 2+ |

Additional **orthogonal tags** that are not hierarchical — `@BGS Team`, `@Carrier Owner`, `@Miner`, `@Combat Wing`, `@Explorer` — grant specific permissions and drive notification routing and ops matchmaking.

Effective permissions = `OR` of all mapped role bitmasks, `AND NOT` any explicit user-level deny mask. Cache the computed mask in Redis keyed by `perm:{userId}`, TTL 5 min, and **bust on `guildMemberUpdate`**.

Enforce with a NestJS guard, and — critically — with **row-level filters in the data layer**, so a forum query for a Ring 0 user physically cannot return Ring 1 rows even if a controller check is forgotten. Defence in depth.

### 5.5 Discord bot role sync

```ts
// Events the bot listens to
guildMemberAdd     → create/link user, assign `applicant`, post to #recruitment
guildMemberUpdate  → diff roles, recompute permissions, bust cache, audit log
guildMemberRemove  → soft-deactivate account, revoke sessions, keep content
roleUpdate         → if a mapped role is renamed/deleted, alert admins
```

Plus a **nightly reconciliation**: full guild member fetch, diff against DB, fix drift, report anomalies to `#site-admin`. Gateway events get dropped during outages; reconciliation is what keeps you honest.

**Bidirectional sync** (opt-in per role): site-side role grants push back to Discord via `PUT /guilds/{g}/members/{u}/roles/{r}`. Useful so officers can promote from either surface.

### 5.6 Session, CSRF, and hardening

- Access JWT 15 min; refresh 30 d, **rotating**, with reuse detection (if an old refresh token is presented, kill the whole token family and force re-login — this is how you detect theft).
- Cookies: `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix.
- CSRF: double-submit token for all state-changing routes.
- Device/session list in profile with individual revoke.
- Optional TOTP 2FA, **mandatory for `officer` and above**.
- Cloudflare Turnstile on registration, public forum posting, and contact forms.

---

## 6. DATA LAYER

### 6.1 Core schema (abridged but real)

```sql
-- ============ IDENTITY ============
CREATE TABLE users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle              CITEXT UNIQUE NOT NULL,
  display_name        TEXT NOT NULL,
  email               CITEXT UNIQUE,
  avatar_url          TEXT,
  bio                 TEXT,
  timezone            TEXT DEFAULT 'UTC',
  status              TEXT NOT NULL DEFAULT 'active',   -- active|inactive|banned|left
  joined_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ,
  deny_mask           NUMERIC(40,0) NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE discord_identities (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  discord_id          TEXT UNIQUE NOT NULL,
  username            TEXT NOT NULL,
  global_name         TEXT,
  guild_nick          TEXT,
  guild_roles         TEXT[] NOT NULL DEFAULT '{}',
  guild_joined_at     TIMESTAMPTZ,
  access_token_enc    BYTEA,
  refresh_token_enc   BYTEA,
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cmdr_verifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cmdr_name           CITEXT NOT NULL,
  method              TEXT NOT NULL,        -- fdev_capi|inara_nonce|officer_manual
  trust_tier          SMALLINT NOT NULL,    -- 3=capi, 2=inara, 1=manual
  verified_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ,
  fdev_refresh_enc    BYTEA,
  fdev_access_enc     BYTEA,
  fdev_expires_at     TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  UNIQUE (cmdr_name) WHERE revoked_at IS NULL
);

CREATE TABLE roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  colour        TEXT,
  rank_order    INT NOT NULL DEFAULT 100,
  perm_mask     NUMERIC(40,0) NOT NULL DEFAULT 0,
  is_hierarchical BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE role_mappings (
  role_id           UUID REFERENCES roles(id) ON DELETE CASCADE,
  discord_role_id   TEXT NOT NULL,
  sync_direction    TEXT NOT NULL DEFAULT 'inbound',  -- inbound|outbound|both
  PRIMARY KEY (role_id, discord_role_id)
);

CREATE TABLE user_roles (
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  role_id     UUID REFERENCES roles(id) ON DELETE CASCADE,
  source      TEXT NOT NULL DEFAULT 'discord',  -- discord|manual|system
  granted_by  UUID REFERENCES users(id),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

-- ============ FORUM ============
CREATE TABLE forum_categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id       UUID REFERENCES forum_categories(id) ON DELETE CASCADE,
  slug            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  icon            TEXT,
  position        INT NOT NULL DEFAULT 0,
  visibility      TEXT NOT NULL DEFAULT 'public',  -- public|member|officer|custom
  view_perm       NUMERIC(40,0),
  post_perm       NUMERIC(40,0),
  is_locked       BOOLEAN NOT NULL DEFAULT false,
  discord_channel_id TEXT       -- optional two-way bridge
);

CREATE TABLE forum_threads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     UUID NOT NULL REFERENCES forum_categories(id) ON DELETE CASCADE,
  author_id       UUID NOT NULL REFERENCES users(id),
  slug            TEXT NOT NULL,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'discussion', -- discussion|question|poll|announcement|ops|application
  is_pinned       BOOLEAN NOT NULL DEFAULT false,
  is_locked       BOOLEAN NOT NULL DEFAULT false,
  answer_post_id  UUID,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  view_count      INT NOT NULL DEFAULT 0,
  post_count      INT NOT NULL DEFAULT 0,
  last_post_at    TIMESTAMPTZ,
  last_post_by    UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (category_id, slug)
);
CREATE INDEX ON forum_threads (category_id, is_pinned DESC, last_post_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE forum_posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       UUID NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  author_id       UUID NOT NULL REFERENCES users(id),
  reply_to_id     UUID REFERENCES forum_posts(id),
  body_md         TEXT NOT NULL,
  body_html       TEXT NOT NULL,          -- pre-rendered + sanitized
  edited_at       TIMESTAMPTZ,
  edit_count      INT NOT NULL DEFAULT 0,
  is_solution     BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  search_tsv      TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', body_md)) STORED
);
CREATE INDEX ON forum_posts USING GIN (search_tsv);

CREATE TABLE forum_reactions (
  post_id   UUID REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  emoji     TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id, emoji)
);

CREATE TABLE forum_subscriptions (
  user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES forum_threads(id) ON DELETE CASCADE,
  level     TEXT NOT NULL DEFAULT 'watching',  -- watching|tracking|muted
  PRIMARY KEY (user_id, thread_id)
);

-- ============ GAME DATA (local mirror from EDDN) ============
CREATE TABLE systems (
  address       BIGINT PRIMARY KEY,          -- SystemAddress, canonical
  name          CITEXT NOT NULL,
  x             DOUBLE PRECISION NOT NULL,
  y             DOUBLE PRECISION NOT NULL,
  z             DOUBLE PRECISION NOT NULL,
  allegiance    TEXT,
  government    TEXT,
  security      TEXT,
  economy       TEXT,
  secondary_economy TEXT,
  population    BIGINT,
  controlling_faction TEXT,
  power         TEXT,
  power_state   TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON systems (name);
-- Spatial index for radius queries (the workhorse for "nearby X")
CREATE INDEX systems_xyz_idx ON systems USING GIST (
  cube(ARRAY[x, y, z])
);

CREATE TABLE stations (
  market_id       BIGINT PRIMARY KEY,
  system_address  BIGINT NOT NULL REFERENCES systems(address),
  name            TEXT NOT NULL,
  type            TEXT,                     -- Coriolis|Orbis|Outpost|FleetCarrier|Settlement...
  is_carrier      BOOLEAN NOT NULL DEFAULT false,
  distance_to_arrival DOUBLE PRECISION,
  max_landing_pad SMALLINT,
  services        TEXT[] NOT NULL DEFAULT '{}',
  economies       JSONB,
  controlling_faction TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON stations (system_address);
CREATE INDEX ON stations USING GIN (services);

CREATE TABLE market_orders (
  market_id     BIGINT NOT NULL REFERENCES stations(market_id) ON DELETE CASCADE,
  commodity     TEXT NOT NULL,              -- FDevID internal name
  buy_price     INT NOT NULL DEFAULT 0,     -- price station sells TO you
  sell_price    INT NOT NULL DEFAULT 0,     -- price station buys FROM you
  demand        INT NOT NULL DEFAULT 0,
  stock         INT NOT NULL DEFAULT 0,
  stock_bracket SMALLINT,
  demand_bracket SMALLINT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (market_id, commodity)
);
CREATE INDEX ON market_orders (commodity, sell_price DESC) WHERE demand > 0;
CREATE INDEX ON market_orders (commodity, buy_price ASC)  WHERE stock  > 0;
CREATE INDEX ON market_orders (updated_at DESC);

-- Optional: TimescaleDB hypertable for price history / charts
CREATE TABLE market_history (
  market_id   BIGINT NOT NULL,
  commodity   TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  buy_price   INT, sell_price INT, demand INT, stock INT
);
-- SELECT create_hypertable('market_history', 'observed_at');

CREATE TABLE commodities (
  internal_name TEXT PRIMARY KEY,           -- from EDCD/FDevIDs
  display_name  TEXT NOT NULL,
  category      TEXT NOT NULL,
  is_rare       BOOLEAN NOT NULL DEFAULT false,
  avg_price     INT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ SQUADRON OPS ============
CREATE TABLE ships (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ship_type     TEXT NOT NULL,
  ship_name     TEXT,
  ship_ident    TEXT,
  role_tag      TEXT,                       -- combat|mining|trade|explore|rescue|bgs
  current_system BIGINT REFERENCES systems(address),
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  source        TEXT NOT NULL DEFAULT 'manual', -- manual|capi|edmc
  synced_at     TIMESTAMPTZ
);

CREATE TABLE loadouts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ship_id       UUID REFERENCES ships(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL REFERENCES users(id),
  name          TEXT NOT NULL,
  ship_type     TEXT NOT NULL,
  role_tag      TEXT,
  coriolis_json JSONB NOT NULL,             -- canonical Coriolis/journal Loadout
  coriolis_url  TEXT,
  edsy_url      TEXT,
  visibility    TEXT NOT NULL DEFAULT 'squadron', -- private|squadron|public
  is_doctrine   BOOLEAN NOT NULL DEFAULT false,   -- officer-approved standard build
  approved_by   UUID REFERENCES users(id),
  stats         JSONB,                      -- cached: jump range, DPS, shields, cost
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fleet_carriers (
  callsign        TEXT PRIMARY KEY,         -- e.g. K7Q-B4X
  market_id       BIGINT UNIQUE,
  name            TEXT,
  owner_user_id   UUID REFERENCES users(id),
  current_system  BIGINT REFERENCES systems(address),
  docking_access  TEXT,
  allow_notorious BOOLEAN,
  fuel_level      INT,
  services        JSONB,
  next_jump_system BIGINT,
  next_jump_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE operations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    UUID NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,
  description_md TEXT,
  op_type       TEXT NOT NULL,   -- bgs|combat|mining|trade|exploration|rescue|social|training
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ,
  system_address BIGINT REFERENCES systems(address),
  station_market_id BIGINT REFERENCES stations(market_id),
  min_roles     TEXT[],
  required_ship_roles TEXT[],
  capacity      INT,
  status        TEXT NOT NULL DEFAULT 'scheduled', -- draft|scheduled|live|complete|cancelled
  discord_event_id TEXT,
  discord_message_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE operation_signups (
  operation_id  UUID REFERENCES operations(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  ship_id       UUID REFERENCES ships(id),
  state         TEXT NOT NULL DEFAULT 'yes',  -- yes|maybe|no|standby
  role_tag      TEXT,
  note          TEXT,
  signed_up_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  attended      BOOLEAN,
  PRIMARY KEY (operation_id, user_id)
);

-- ============ BGS ============
CREATE TABLE tracked_factions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT UNIQUE NOT NULL,
  is_ours       BOOLEAN NOT NULL DEFAULT false,
  home_system   BIGINT REFERENCES systems(address),
  notes_md      TEXT
);

CREATE TABLE faction_influence_snapshots (
  faction_id      UUID NOT NULL REFERENCES tracked_factions(id) ON DELETE CASCADE,
  system_address  BIGINT NOT NULL REFERENCES systems(address),
  observed_at     TIMESTAMPTZ NOT NULL,
  influence       DOUBLE PRECISION NOT NULL,
  state           TEXT,
  pending_states  TEXT[],
  recovering_states TEXT[],
  happiness       TEXT,
  source          TEXT NOT NULL DEFAULT 'eddn',
  PRIMARY KEY (faction_id, system_address, observed_at)
);

CREATE TABLE bgs_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_address BIGINT NOT NULL REFERENCES systems(address),
  faction_id    UUID REFERENCES tracked_factions(id),
  directive     TEXT NOT NULL,     -- push|hold|suppress|ignore
  priority      SMALLINT NOT NULL DEFAULT 3,
  guidance_md   TEXT,
  set_by        UUID NOT NULL REFERENCES users(id),
  active_from   TIMESTAMPTZ NOT NULL DEFAULT now(),
  active_until  TIMESTAMPTZ
);

CREATE TABLE bgs_activity_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  system_address BIGINT NOT NULL REFERENCES systems(address),
  faction_id    UUID REFERENCES tracked_factions(id),
  activity_type TEXT NOT NULL,   -- missions|bounties|cartographics|trade|bonds|murders|failed
  value_cr      BIGINT,
  count         INT,
  tick_id       UUID,
  reported_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  source        TEXT NOT NULL DEFAULT 'manual'  -- manual|edmc|bgstally
);

-- ============ AI ============
CREATE TABLE ai_conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL DEFAULT 'web',  -- web|discord
  title         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at   TIMESTAMPTZ
);

CREATE TABLE ai_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,   -- system|user|assistant|tool
  content       TEXT,
  tool_name     TEXT,
  tool_args     JSONB,
  tool_result   JSONB,
  tokens_in     INT, tokens_out INT, latency_ms INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_tool_invocations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  conversation_id UUID REFERENCES ai_conversations(id),
  tool_name     TEXT NOT NULL,
  args          JSONB NOT NULL,
  permission_checked NUMERIC(40,0),
  outcome       TEXT NOT NULL,   -- ok|denied|error|needs_confirmation|cancelled
  error         TEXT,
  duration_ms   INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON ai_tool_invocations (created_at DESC);

CREATE TABLE knowledge_chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type   TEXT NOT NULL,   -- forum_post|wiki|doctrine|loadout|guide|galnet
  source_id     UUID,
  visibility    TEXT NOT NULL DEFAULT 'public',  -- MUST mirror source ACL
  title         TEXT,
  content       TEXT NOT NULL,
  embedding     VECTOR(1024),
  metadata      JSONB,
  indexed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON knowledge_chunks (visibility);

-- ============ AUDIT ============
CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  actor_id      UUID REFERENCES users(id),
  actor_type    TEXT NOT NULL DEFAULT 'user',  -- user|bot|ai|system
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  before        JSONB,
  after         JSONB,
  ip_hash       TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (created_at DESC);
CREATE INDEX ON audit_log (actor_id, created_at DESC);
```

### 6.2 The `knowledge_chunks.visibility` column is a security control

Read that column again. **If your RAG index doesn't carry the ACL of the source document, your AI will happily leak officer-only forum content to a recruit.** Every vector query must be filtered by the requesting user's permission mask *before* the nearest-neighbour search returns, not after. This is the single most common way self-hosted AI assistants leak private data, and it is entirely preventable.

### 6.3 EDDN collector design

```ts
// apps/eddn-collector — the shape of it
import zmq from 'zeromq';
import zlib from 'node:zlib';

const RELAY = 'tcp://eddn.edcd.io:9500';

const sock = new zmq.Subscriber();
sock.connect(RELAY);
sock.subscribe('');            // all schemas
sock.receiveTimeout = 60_000;  // reconnect on silence

for await (const [msg] of sock) {
  const payload = JSON.parse(zlib.inflateSync(msg).toString('utf8'));
  const { $schemaRef: schema, header, message } = payload;

  // Drop non-Live galaxy and beta/alpha builds
  if (header.gameversion?.startsWith('4.') === false) continue;

  switch (true) {
    case schema.includes('/commodity/'):   await onCommodity(message, header); break;
    case schema.includes('/journal/'):     await onJournal(message, header);   break;
    case schema.includes('/outfitting/'):  await onOutfitting(message);        break;
    case schema.includes('/shipyard/'):    await onShipyard(message);          break;
    case schema.includes('/fcmaterials'):  await onCarrierMaterials(message);  break;
  }
}
```

**Volume expectations:** the firehose is busy — think hundreds of thousands of trade updates per day and millions per week across the galaxy. Handle it properly:

- **Batch writes.** Accumulate 500 rows or 2 seconds, whichever first, then a single `INSERT ... ON CONFLICT DO UPDATE`.
- **Idempotency.** Every upsert keyed on `(market_id, commodity)`; ignore messages older than the stored `updated_at`.
- **Backpressure.** If the write queue exceeds N, drop low-value schemas (outfitting) before high-value ones (commodity).
- **Prefilter.** For v1 you may not want the whole galaxy. Filter to systems within X ly of your squadron's home + your BGS systems + anything a member has queried in the last 30 days. Cuts storage by 95%+.
- **Retention.** `market_orders` keeps current state only. `market_history` gets a 90-day retention policy (or Timescale compression). Full galaxy market history will eat disk without limit.
- **Seed from dumps.** Don't wait weeks to accumulate coverage — bootstrap from Spansh's galaxy dump and/or Ardent's database downloads, then let EDDN keep it fresh.

### 6.4 Caching strategy

| Data | Store | TTL | Invalidation |
|---|---|---|---|
| Permission masks | Redis | 5 min | `guildMemberUpdate` |
| Ardent commodity summary | Redis | 6 h | Scheduled refresh |
| System lookup | Redis + PG | 24 h / persistent | EDDN write |
| Market orders | PG | live | EDDN write |
| Spansh job results | PG + R2 | 7 d | Job dedupe by param hash |
| Inara profiles | PG | 24 h | Nightly worker |
| GalNet | Redis | 1 h | — |
| Rendered forum HTML | PG column | persistent | On edit |
| Session/JWT denylist | Redis | token TTL | On logout/revoke |

---

## 7. FEATURE MODULES

### 7.1 M1 — Public face & recruitment

**Landing page.** Full-bleed hero, animated starfield/nebula (Three.js, or a cheap CSS/canvas parallax for mobile), squadron motto, live stat ticker pulled from your own DB:

```
▸ 47 COMMANDERS       ▸ 3 FLEET CARRIERS      ▸ 128.4 Bn CR EARNED
▸ 1,204 SYSTEMS VISITED   ▸ 61.2% INFLUENCE IN SHINRARTA   ▸ NEXT OP: 19:30 UTC
```

**Sections:**
- **Who we are** — CMDR-written, editable in the admin CMS.
- **Our factions & territory** — live BGS map (see §7.6) with public-safe granularity.
- **Divisions** — Combat Wing / Mining Ops / Exploration Corps / BGS Cell / Logistics, each with a lead, a description, and an "apply to this division" CTA.
- **GalNet feed** — pull the GalNet JSON feed, render in-universe styling. Cheap, high flavour.
- **Public leaderboard** — opt-in per member, with an explicit privacy toggle.
- **Squadron log** — public after-action reports promoted from the private forum by an officer.
- **Live activity ticker** — "CMDR Grimshaw docked at Jameson Memorial 4m ago" (from the EDMC plugin, opt-in, with a privacy toggle — see §11.3).

**Recruitment pipeline** — a real workflow, not a mailto link:

```
Applicant submits form (Turnstile-protected)
  →  creates forum_thread kind='application' in a Ring-2 category
  →  bot posts an embed in #recruitment with Approve/Reject/Interview buttons
  →  officers vote/comment; applicant can be invited to a limited thread to answer questions
  →  Approve → Discord role granted → site role syncs → welcome DM + onboarding checklist
  →  30-day probation timer → automatic officer review prompt
```

Form fields: CMDR name, Discord handle, timezone, hours/week, playstyle checkboxes, ships owned, engineering progress, previous squadrons, "why us", how they found you, referral. Store as structured JSONB so you can report on your funnel.

### 7.2 M2 — Forums (public + gated)

You asked for both, in one place. This is the core social object of the site.

**Category tree (suggested):**

```
PUBLIC
├── Announcements                         [view: all,     post: officer]
├── Recruitment & Introductions           [view: all,     post: all]
├── Open Comms (general ED chat)          [view: all,     post: verified]
├── Guides & Tutorials                    [view: all,     post: member]
└── Squadron Log (after-action reports)   [view: all,     post: officer]

MEMBERS ONLY
├── Squadron Hall (general)               [view: member,  post: member]
├── Operations Planning                   [view: member,  post: member]
├── BGS Intelligence                      [view: member,  post: bgs_team]
├── Shipyard & Loadouts                   [view: member,  post: member]
├── Trade Intel & Route Sharing           [view: member,  post: member]
├── Carrier Services                      [view: member,  post: member]
├── Exploration Logs                      [view: member,  post: member]
└── Off-Topic / The Bar                   [view: member,  post: member]

OFFICERS
├── Command Deck                          [view: officer, post: officer]
├── Applications                          [view: officer, post: officer]
├── Member Concerns                       [view: officer, post: officer]
└── Site & Infrastructure                 [view: sysadmin,post: sysadmin]
```

**Features:**
- Markdown + rich editor (Tiptap), drag-drop image upload to R2 with EXIF stripping.
- **ED-specific embeds** — paste a Coriolis/EDSY URL → renders a live build card with jump range, DPS, shield HP, cost. Paste a system name in `[[Sol]]` syntax → hover card with allegiance, economy, distance from home, station list. Paste a commodity → current best buy/sell.
- Threaded replies, per-post reactions, quote-reply, mentions with autocomplete.
- Polls with role-restricted voting (officer-only polls, squadron-wide polls).
- Post kinds: Question (with accepted-answer marking), Announcement (pinned + Discord broadcast), Ops (auto-creates an operation record).
- Subscriptions: watch/track/mute per thread and per category; digest email + Discord DM options.
- Full-text search via Meilisearch (typo tolerance, faceting by category/author/tag), **ACL-filtered at query time**.
- Draft autosave, edit history, soft delete with a moderator-visible tombstone.
- Reputation: post count, solutions accepted, reactions received → badges. Keep it light; heavy gamification breeds noise.

**Discord bridge (optional, per category):**
- Site → Discord: new thread posts an embed with a jump link.
- Discord → site: a `/thread` slash command creates a forum thread from the current channel context; mirroring individual messages both ways is a support nightmare — don't.

**Alternative `[A6]`:** if you'd rather not maintain forum software, run **Discourse** and SSO it via your API acting as the SSO provider, mapping your permission masks to Discourse groups. You lose the deep ED-native embeds and the unified AI index; you gain a mature, battle-tested forum. My recommendation is custom, because the embeds and the AI's ability to search everything are exactly what makes this "the hub" rather than "a forum next to some tools."

### 7.3 M3 — Shipyard & Loadout Locker

**Two components:**

**(a) Self-hosted Coriolis** at `shipyard.<domain>`, in Docker, theme-matched.

```yaml
# infra/docker/coriolis.yml
services:
  coriolis:
    build:
      context: ./vendor/coriolis
      additional_contexts:
        data: ./vendor/coriolis-data
    ports: ["3300:3300"]
    restart: unless-stopped
```

Pin the upstream commit, and schedule a monthly check for `coriolis-data` updates — Frontier keeps adding ships (Mandalay, Cobra Mk V, Corsair, Panther Clipper class additions and so on), and stale module data produces wrong builds, which is worse than no builds.

**(b) Loadout Locker** — your own service, which is where the real value is. Coriolis makes builds; the Locker makes them *squadron knowledge*.

| Feature | Detail |
|---|---|
| Save build | Import from Coriolis URL, EDSY URL, Coriolis JSON, or the game's journal `Loadout` event |
| Auto-import | Pull real fleet from cAPI `/profile`, or live from the EDMC plugin |
| Compute & cache | Jump range (laden/unladen/max), DPS by damage type, effective shield/armour HP, thermal load, cargo, fuel scoop rate, rebuy, total cost |
| Compare | Side-by-side up to 4 builds with delta highlighting |
| Doctrine builds | Officers mark a build `is_doctrine` for a role — "this is our standard BGS conflict-zone Krait" |
| Requirements check | "You need Grade 5 Dirty Drive Tuning + Guardian FSD Booster" — links to engineer locations via Ardent's `nearest/technology-broker` and EDSM engineer data |
| Cost planner | Total credits, plus a materials shopping list for the engineering |
| Comments & versioning | Every build is a first-class commentable object; diff between versions |
| Fleet view | "Show me every Anaconda in the squadron with >60 ly jump range" — this is the query that makes ops planning actually work |
| Public gallery | Opt-in showcase builds on the public site with a share image |

**Ship-fit maths** lives in `packages/ed-domain` so the AI can call it directly without scraping the UI. Port the formulas from Coriolis (MIT — attribute it) rather than reinventing: optimal mass FSD curves, shield boosters' diminishing returns, resistance stacking, thermal spread.

### 7.4 M4 — Trade & Market Terminal

This is the "do what Inara does" module. Build it in three layers.

**Layer 1 — Commodity lookup**
- Search any commodity → current galactic min/max/avg buy and sell, total stock and demand.
- "Where can I sell this?" → importer list sorted by price paid, with `minVolume`, `fleetCarriers`, and `maxDaysAgo` filters exposed as UI controls.
- "Where can I buy this?" → exporter list sorted by price.
- Price history sparkline from `market_history`.
- Data-freshness badge on every row: green <24 h, amber <7 d, red older. **Do this.** Stale market data is the #1 source of "your site lied to me."

**Layer 2 — Route finder (your own)**

The single-hop A→B optimiser, computed locally against your own `market_orders`:

```sql
-- Best round-trip loop within N ly of origin, given cargo & pad size
WITH origin AS (SELECT x,y,z FROM systems WHERE address = $originAddr),
buy AS (
  SELECT mo.market_id, mo.commodity, mo.buy_price, mo.stock,
         st.system_address, st.max_landing_pad, st.distance_to_arrival,
         sqrt(power(s.x-o.x,2)+power(s.y-o.y,2)+power(s.z-o.z,2)) AS ly
  FROM market_orders mo
  JOIN stations st ON st.market_id = mo.market_id
  JOIN systems  s  ON s.address    = st.system_address
  CROSS JOIN origin o
  WHERE mo.stock >= $minStock
    AND mo.buy_price > 0
    AND mo.updated_at > now() - ($maxAge || ' days')::interval
    AND st.max_landing_pad >= $padSize
    AND ($includeCarriers OR NOT st.is_carrier)
    AND st.distance_to_arrival <= $maxLs
),
sell AS ( /* symmetric, on sell_price and demand */ )
SELECT b.commodity,
       b.market_id AS from_market, s.market_id AS to_market,
       (s.sell_price - b.buy_price)                     AS profit_per_ton,
       (s.sell_price - b.buy_price) * LEAST(b.stock, $cargo) AS profit_per_run,
       b.ly AS out_ly, s.ly AS back_ly
FROM buy b
JOIN sell s ON s.commodity = b.commodity AND s.market_id <> b.market_id
WHERE s.sell_price > b.buy_price
ORDER BY profit_per_run DESC
LIMIT 100;
```

Extend to loops (A→B→A with different commodities each leg), and to multi-hop chains with a bounded beam search. Materialise a `best_trades` view refreshed every 15 minutes so the common query is instant.

Inputs the UI must collect: origin system, jump range, cargo capacity, available credits, min landing pad, max distance to arrival (ls), max system distance, include/exclude fleet carriers, max data age, avoid-anarchy toggle, permit-locked toggle.

**Layer 3 — Spansh delegation**

For the heavy planners (galaxy plotter with refuelling, neutron routing, Road to Riches, fleet carrier routing, tourist/multi-stop), submit an async job:

```
POST /api/trade/plot   { type: 'neutron', from, to, range, efficiency }
  → creates route_jobs row (status='queued'), enqueues BullMQ job
worker → POST Spansh job endpoint → receives job id → polls results with backoff
  → on complete: store result JSON in R2, update row, emit WS event
  → client receives push, renders waypoint list with copy-to-clipboard per hop
```

Cache by a hash of the parameters. Two members asking for Sol→Colonia at 60 ly should cost you one upstream job, not two.

**Layer 4 — Squadron-specific value adds** (this is what Inara *can't* do for you)
- **Carrier-aware routing.** "Best route that ends at one of *our* fleet carriers."
- **Squadron trade board.** Members post "I have 15,000 t of Tritium at X" / "Buying Void Opals at 10% over market."
- **Group hauling ops.** A shared cargo target with per-member contribution tracking, live progress bar, auto-updated from the EDMC plugin. Perfect for community goals and carrier fuel drives.
- **Mining hotspot registry.** Squadron-curated overlaps (Platinum/Painite/LTD triple hotspots) with quality ratings.
- **Alerts.** "Notify me on Discord if Tritium anywhere within 50 ly of our carrier drops below 40,000 cr/t."

### 7.5 M5 — Fleet & Carrier Operations

- **Carrier registry** — callsign, name, owner, current system, docking access, services, fuel level, next scheduled jump with countdown.
- **Jump schedule board** — a shared calendar of carrier movements so three carriers don't all leave the staging system at once.
- **Carrier market mirror** — what each carrier is buying/selling, from cAPI (the owner's token) or from EDDN carrier messages.
- **Tritium tracker** — burn rate, jumps remaining, "we need 12,000 t before Saturday" with a contribution ledger.
- **Cargo manifest** — what's in the hold, who owns it, reserved vs available.
- **Taxi/logistics requests** — "need a lift to Colonia."
- **Shipyard/outfitting stock** on each carrier, so members stop asking in Discord.

### 7.6 M6 — BGS Console

For a squadron that runs a minor faction, this is often the killer feature.

- **Influence charts** — per system, per faction, over time, with **tick markers**. Wire in a BGS-tick detection source (community tick detectors exist) or infer ticks from the clustering of EDDN faction-state updates.
- **System control board** — every system in your sphere: your influence, top competitor, delta since last tick, active states, pending states, conflict status.
- **Orders board** — officers set `push` / `hold` / `suppress` / `ignore` per system with written guidance. Members see a prioritised "what should I do tonight" list on their dashboard. This one feature converts casual players into effective BGS contributors.
- **Activity reporting** — manual form, plus automatic ingest from the EDMC plugin, plus optional BGS-Tally import. Track missions completed, bounty vouchers, cartographic data, trade profit, combat bonds, and negatives (murders, failed missions) per faction per system.
- **Conflict tracker** — wars/elections with day-by-day win counts and required daily wins.
- **What-if projection** — rough influence modelling: "at last tick's rate, we flip Ross 128 in 4 days."
- **Expansion/retreat watch** — alert when a faction is in an expansion or retreat state.

### 7.7 M7 — Operations Board & Calendar

- Month/week/agenda views, all times rendered in each viewer's local timezone with a UTC anchor shown (Elite runs on UTC/game time — display both).
- Op types with distinct visual treatments; recurring ops ("Thursday BGS push").
- Signup with ship selection from the member's actual fleet, role assignment (tank/DPS/support for CZs; hauler/prospector/limpet-monkey for mining), and standby list when at capacity.
- **Wing composition checker** — "this op needs 2 more shieldless miners; 3 members have a qualifying build."
- **Auto-sync to Discord Scheduled Events** + reminder DMs at T-24 h, T-1 h, T-10 min.
- Post-op: attendance marking, AAR thread auto-created in Squadron Log, contribution stats.

### 7.8 M8 — Member profiles & progression

- **CMDR dossier** — verified CMDR name, ranks (combat/trade/explore/CQC/exobiology/soldier/mercenary), Powerplay pledge and rank, squadron join date, timezone, playstyle tags, division, fleet, favourite builds, forum activity, ops attended, BGS contribution.
- Inara / EDSM / Frontier profile links.
- **Squadron achievements** — custom badges you define and award: "Colonia Run," "First Thargoid Kill," "1,000 t Hauled for the Cause," "Survived a Wing Interdiction," "10 Ops Attended." Manual award by officers + automatic triggers from telemetry. Cheap to build, wildly effective for retention.
- **Activity graph** — GitHub-style contribution heatmap of ops attended, BGS reports, forum posts.
- **Privacy controls** — granular: who can see my location, my credits, my fleet, my activity. Default to conservative.

### 7.9 M9 — Squadron ledger & economy (optional but loved)

- Squadron treasury (a shared credit pool, tracked honour-system).
- Bounties/contracts: "500 M CR to whoever hauls 20,000 t of Tritium to K7Q-B4X by Friday."
- Loan/grant requests for new members needing a starter ship.
- Contribution leaderboards by category.
- Payout ledger with officer approval.

### 7.10 M10 — Media, wiki & lore

- **Screenshot gallery** — R2-backed, EXIF-stripped, tagged by system/ship/event, monthly contest with voting.
- **Squadron wiki** — versioned markdown pages for SOPs, doctrine, engineering guides, new-member handbook. Feeds the AI's RAG index.
- **Lore & RP archive** — in-universe fiction, CMDR logbooks, squadron history timeline.
- **Video/stream integration** — Twitch/YouTube embeds; bot announces when a member goes live.

### 7.11 M11 — Admin console

- Member management: search, filter, bulk role changes, notes, probation timers, inactivity flags.
- Role and permission editor (with a live "who does this affect?" preview before saving).
- Discord mapping editor.
- Moderation queue: reports, auto-flagged content, ban/mute with duration and reason.
- Audit log viewer, filterable by actor / action / target / date, with diffs.
- Feature flags per module.
- Site config: theme, branding, motto, home system, tracked factions, integration keys.
- Health dashboard: EDDN lag, Ardent latency, Spansh queue depth, GSAI status, DB size.
- Backup status and one-click restore test.

### 7.12 M12 — The EDMC plugin (do not skip this)

**This is the highest-leverage item in the entire spec relative to effort.** Your members already run EDMC. A Python plugin (~300–500 lines) that posts selected journal events to your API gives you, in real time and with zero member effort:

- Live location and ship for the activity ticker and ops coordination.
- Automatic BGS activity capture (missions, bounties, bonds, cartographics, per-faction).
- Automatic loadout sync into the Locker on every `Loadout` event.
- Cargo/hauling progress for group ops.
- Carrier jump and market updates from owners.
- Exploration and exobiology logs for the public feed.

```python
# plugins/edmc-grimssquad/load.py (skeleton)
import requests, queue, threading, json

API = "https://api.grimssquad.example/v1/telemetry"
WANTED = {
    "Location","FSDJump","Docked","Undocked","Loadout","MissionCompleted",
    "RedeemVoucher","MultiSellExplorationData","SellExplorationData",
    "MarketSell","MarketBuy","CarrierJump","CarrierJumpRequest",
    "FactionKillBond","Bounty","SellOrganicData",
}
_q = queue.Queue()

def plugin_start3(plugin_dir):
    threading.Thread(target=_sender, daemon=True).start()
    return "GrimsSquad"

def journal_entry(cmdr, is_beta, system, station, entry, state):
    if is_beta or entry.get("event") not in WANTED:
        return
    _q.put({
        "cmdr": cmdr, "system": system, "station": station,
        "event": entry, "ship": state.get("ShipType"),
        "shipId": state.get("ShipID"),
    })

def _sender():
    token = _load_token()      # device token issued by the site, per member
    batch = []
    while True:
        batch.append(_q.get())
        while not _q.empty() and len(batch) < 25:
            batch.append(_q.get_nowait())
        try:
            requests.post(API, json={"events": batch},
                          headers={"Authorization": f"Bearer {token}"}, timeout=10)
            batch.clear()
        except Exception:
            pass   # retry next loop; never block the user's game session
```

**Rules for this plugin, non-negotiable:**
1. **Opt-in per event category**, with a settings panel. Members choose whether to share location, finances, combat, exploration.
2. **Never block or slow the game.** All I/O off the main thread, always fail silently.
3. **Device tokens**, not passwords. Issued from the member's profile page, individually revocable, scoped to `telemetry:write`.
4. **Publish the source.** Members are installing code that reads their game journal. Open the repo, let them read it. A closed-source plugin asking for journal access is a trust disaster.
5. Also **forward to EDDN** if the member isn't already — good citizenship, and it improves everyone's data including yours.

---

## 8. GRIM'S SQUAD AI (GSAI) — LOCAL AGENT

### 8.1 Design goals

1. Runs entirely on **your machine**, via **Ollama** — no per-token cost, no data leaving your control.
2. Reachable from the public website through a **secure tunnel**, with the site never trusting the tunnel blindly.
3. Can **actually do things** — search, plot, book, post, query — through a permissioned tool registry, not just talk.
4. **Degrades gracefully.** Box off → the site is unaffected; requests queue or fall back.
5. **Inherits the caller's permissions exactly.** The AI is never more privileged than the person asking.

### 8.2 Model selection — **dual-GPU build: RTX 3060 (primary) + RTX 5070 Ti (overflow)** `[CONFIRMED]`

Local tool-calling *reliability*, not benchmark score, is what matters. A model that writes beautiful prose but emits tool calls as prose inside `content` instead of a structured `tool_calls` array is useless here.

#### 8.2.1 Your hardware, and why "3060 primary" is the correct call

| | RTX 3060 12 GB | RTX 5070 Ti |
|---|---|---|
| Architecture | Ampere (GA106), CC **8.6** | Blackwell (GB203), CC **12.0** |
| VRAM | 12 GB GDDR6 | 16 GB GDDR7 |
| **Memory bandwidth** | **360 GB/s** | **896 GB/s** |
| TGP | 170 W | 300 W |

Memory bandwidth is the dominant factor in token generation speed — roughly, `tokens/sec ≈ bandwidth ÷ model size in bytes`. The 5070 Ti is about **2.5× faster** for inference. On raw performance it should be primary.

**It shouldn't be, and here's why:** the 5070 Ti is almost certainly the card you play Elite Dangerous on. An LLM resident in VRAM while you're in a conflict zone means either stuttering frames or a model that gets evicted mid-request. GSAI is an **always-on service** for your whole squadron; the 3060 gives it a card nobody is fighting over. **Availability beats throughput for a service other people depend on.** Keep the 3060 primary.

*Flip this only if* the 5070 Ti sits in a headless box that never games — then make it primary and demote the 3060 to batch work.

#### 8.2.2 Check this first — 12 GB or 8 GB?

The RTX 3060 shipped in both 12 GB (192-bit, 360 GB/s) and 8 GB (128-bit, 240 GB/s) variants, and the 3060 **Ti** is 8 GB. This changes your model tier, so confirm it:

```bash
nvidia-smi --query-gpu=index,name,memory.total,uuid --format=csv
```

Everything below assumes **3060 12 GB**. If it reports ~8 GB, use the 8 GB column in §8.2.4 instead.

#### 8.2.3 Architecture: two Ollama instances, one per card — **not** one instance across both

This is the key decision, and it goes against the obvious approach.

Ollama *can* pool both cards and split a model's layers across them. **Don't.** Two documented problems bite this exact pairing:

1. **Mixed-generation feature downgrade.** With Ampere (CC 8.6) and Blackwell (CC 12.0) in one instance, Ollama aligns to the *lower* generation's feature set — you lose Blackwell-specific tensor-core optimisations on the card that has them. You'd pay for a 5070 Ti and run it like a 3060.
2. **Blackwell detection.** RTX 50-series cards aren't always auto-detected by Ollama's scheduler (a known issue), needing explicit UUID pinning and `OLLAMA_SCHED_SPREAD` to place layers at all.

Plus, layer-splitting shuttles activations across PCIe on every forward pass. Splitting a model that would fit on one card is strictly slower.

**Run two isolated instances instead.** Each sees exactly one GPU, so neither problem can occur:

```
┌──────────────────────────────────────────────────────────────┐
│ GSAI-INTERACTIVE          RTX 3060 12 GB     :11434          │
│ qwen3:8b Q4_K_M · num_ctx 16384 · resident 24/7              │
│ → every live member request, web + Discord                   │
│ → ~35–45 tok/s. Never unloaded. Never contended.             │
├──────────────────────────────────────────────────────────────┤
│ GSAI-HEAVY                RTX 5070 Ti        :11435          │
│ qwen3:14b Q4_K_M (or gpt-oss:20b) · num_ctx 16384            │
│ → GATED BY THE ARBITER: only runs when no game is detected   │
│ → nightly BGS digest · weekly forum summaries · batch        │
│   embedding backfill · complex multi-step planning ·         │
│   overflow when the 3060's queue is deep                     │
│ → ~45–60 tok/s when available. Unloads on game launch.       │
└──────────────────────────────────────────────────────────────┘
```

```bash
# Get stable UUIDs — numeric indices reorder across reboots
nvidia-smi --query-gpu=index,name,uuid --format=csv

# --- Instance A: interactive, pinned to the 3060 ---
# /etc/systemd/system/ollama-interactive.service
Environment="CUDA_VISIBLE_DEVICES=GPU-<3060-uuid>"
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="OLLAMA_MODELS=/var/lib/ollama/models"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Environment="OLLAMA_KEEP_ALIVE=-1"        # never unload. this is the point.
Environment="OLLAMA_NUM_PARALLEL=2"
Environment="OLLAMA_MAX_LOADED_MODELS=2"  # 8b + embedder co-resident

# --- Instance B: heavy, pinned to the 5070 Ti ---
# /etc/systemd/system/ollama-heavy.service
Environment="CUDA_VISIBLE_DEVICES=GPU-<5070ti-uuid>"
Environment="OLLAMA_HOST=127.0.0.1:11435"
Environment="OLLAMA_MODELS=/var/lib/ollama/models"   # shared blob store, no duplication
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Environment="OLLAMA_KEEP_ALIVE=5m"        # release VRAM promptly when you want to play
Environment="OLLAMA_NUM_PARALLEL=1"
```

Point both at the same `OLLAMA_MODELS` directory — the blob store is content-addressed, so shared models are stored once.

**Driver requirement:** Ollama needs **550+**, and Blackwell wants newer still. Run **580+** and verify both cards appear before troubleshooting anything else.

#### 8.2.4 Model assignment

| Slot | 3060 **12 GB** | 3060 **8 GB** (fallback) | 5070 Ti 16 GB |
|---|---|---|---|
| Agent | `qwen3:8b` Q4_K_M — 4.9 GB | `qwen3:8b` Q4_K_M — 4.9 GB | `qwen3:14b` Q4_K_M — 9.0 GB |
| Context | `num_ctx: 16384` — 2.4 GB KV | `num_ctx: 8192` — 1.2 GB KV | `num_ctx: 16384` — 3.1 GB KV |
| Embedder | `nomic-embed-text` — 0.3 GB, co-resident | **CPU instance** — no VRAM | (batch backfill only) |
| **Total** | **~7.6 GB / 12 GB** — comfortable | **~6.1 GB / 8 GB** — tight, headless only | **~12.1 GB / 16 GB** |

```bash
ollama pull qwen3:8b nomic-embed-text                    # instance A
OLLAMA_HOST=127.0.0.1:11435 ollama pull qwen3:14b        # instance B

# Verify full GPU residency — size_vram MUST equal size
ollama ps
OLLAMA_HOST=127.0.0.1:11435 ollama ps
```

If `size_vram` is lower than `size`, you're partially offloaded to CPU and generation will crawl. Drop `num_ctx` before accepting it.

**Why `qwen3:8b` on the primary rather than 14b, when 12 GB could hold 14b?** Because 14b on a 360 GB/s card generates at roughly 18–22 tok/s versus 35–45 for the 8b. For an interactive assistant, halving latency beats a marginal quality gain — and the 14b is available on the 5070 Ti anyway for the requests that genuinely need it. **Fast on the primary, smart on the secondary.**

**Alternative for instance B:** `gpt-oss:20b` is a mixture-of-experts model sized to fit 16 GB and is strong on multi-step tool chains. Benchmark it against `qwen3:14b` (§8.2.7) and keep whichever wins on *your* tool schemas. `qwen3:32b` does **not** fit in 16 GB at Q4 — don't bother.

#### 8.2.5 The GPU arbiter

A small service that decides whether instance B is usable. ~60 lines.

```ts
// apps/gsai/arbiter.ts
const GAME_PROCESSES = ['EliteDangerous64', 'EliteDangerous32'];

async function heavyAvailable(): Promise<boolean> {
  const { stdout } = await exec(
    'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader'
  );
  const gaming = GAME_PROCESSES.some(p => stdout.includes(p));
  if (gaming) return false;

  const free = await freeVramMb(HEAVY_GPU_UUID);
  return free > 11_000;                      // need ~11 GB headroom for the 14b
}

// Routing decision, evaluated per request
export async function pickInstance(req: AiRequest) {
  if (req.kind === 'batch' || req.kind === 'scheduled')
    return (await heavyAvailable()) ? HEAVY : DEFER;   // batch waits; it isn't urgent
  if (req.complexityHint === 'high' && await heavyAvailable())
    return HEAVY;
  if (queueDepth(INTERACTIVE) > 3 && await heavyAvailable())
    return HEAVY;                                       // genuine overflow
  return INTERACTIVE;                                   // the default path
}
```

Poll every 15 s, cache the result, and expose it on the admin health dashboard as `GSAI-HEAVY: available | gaming | busy`. When you launch Elite, `KEEP_ALIVE=5m` means instance B releases its VRAM within five minutes on its own; the arbiter stops routing to it immediately.

**Scheduled jobs go to instance B overnight** — nightly BGS digest, weekly forum summaries, embedding backfill. You're asleep, the card is free, and members wake up to a briefing generated by the better model.

#### 8.2.6 Design constraints that still apply

Two cards raises the ceiling; it doesn't repeal the fundamentals.

**Do deterministic work in code, not in the model.** Still the most important architectural point in this section. The correct design is *not* "LLM plans everything":

```
User message
  → cheap intent classifier (embedding similarity vs ~40 canned intents, no LLM)
  → HIGH CONFIDENCE (~70% of traffic):
       call the tool directly, render a templated response. LLM never runs.
       "what's tritium selling for near Sol" is a database query, not a reasoning task.
  → otherwise: hand to the agent loop, routed by the arbiter
```

That fast path answers most queries in under 200 ms with zero GPU load and zero hallucination risk, and reserves inference for questions that actually need reasoning. **Build the fast path first.** The agent loop is the fallback, not the front door.

**Still true regardless of VRAM:**
- **Pre-filter tool schemas.** Send the 8–10 most plausible tools, not all 30. Saves ~1,200 tokens per turn and measurably improves selection accuracy on 8B-class models.
- **Truncate tool results** to ~2,500 characters. Return the top 5 trade routes, not 100. Summarise server-side.
- **`MAX_STEPS: 6`** on the 8b, 8 on the 14b. Beyond that a small model is usually looping, not progressing.
- **Roll conversation history** — system prompt + last 4 exchanges + a running summary.

**Rate limits** (relaxed from the 8 GB plan, given `NUM_PARALLEL=2` plus overflow): **20 messages/hour, 80/day** for members; higher for officers.

**Power.** 170 W + 300 W under simultaneous load, plus CPU and drives. Check your PSU has genuine headroom — a **750 W minimum, 850 W comfortable**. If instance B ever runs while you're gaming, both cards draw peak together. And put the box on a UPS: a mid-inference power cut during a `pg_dump` is how you discover your backups were untested.

**Thermals.** Two cards in one case means the 3060 is likely breathing the 5070 Ti's exhaust. It's the card that runs 24/7. Check its sustained temperature under an hour of continuous inference, and add a `nvidia-smi` temperature guard to the arbiter that sheds to DEGRADED above ~83 °C.

#### 8.2.7 Benchmark before committing

Ollama natively supports **tool calling with streaming** and **structured outputs constrained by JSON Schema**. Use structured outputs for anything you parse. Never regex model prose.

Run this against both instances before you build on either:

```
20 identical tool-call requests, using YOUR actual tool schemas
→ measure: % returning valid structured tool_calls with correct arguments
→ measure: time-to-first-token, and total wall time per request
→ below ~75% reliability, change model or quantisation
```

An agent that fumbles one call in three is worse than no agent. Test with your real schemas, not generic ones — reliability varies with schema complexity, and yours are not simple.

**The embedding model is pinned forever.** Changing it invalidates every vector in `knowledge_chunks` and forces a full re-index.

**Upgrade path:** if GSAI outgrows this, the next step isn't a third card — it's making the 5070 Ti primary in a headless box and moving your gaming to the 3060, or a single 24 GB card that runs `qwen3:32b` at full speed. Nothing in the architecture changes; you repoint two env vars.

### 8.3 Architecture

```
Browser / Discord
      │  WSS
      ▼
┌─────────────────────────────────────────────┐
│ api (VPS)                                   │
│  · authn/authz, rate limit, redact PII      │
│  · builds AiRequest{userId, permMask, msgs} │
│  · signs it (HMAC, short-lived nonce)       │
└────────────────┬────────────────────────────┘
                 │  mTLS over Cloudflare Tunnel
                 ▼
┌─────────────────────────────────────────────┐
│ gsai-gateway (your box)                     │
│  · verifies signature + nonce (replay guard)│
│  · concurrency semaphore, per-user quota    │
│  · hands to agent loop                      │
└────────────────┬────────────────────────────┘
                 ▼
┌─────────────────────────────────────────────┐
│ gsai-agent                                  │
│                                             │
│  ┌────────────┐   ┌──────────────────────┐  │
│  │ Planner    │──▶│ Ollama (tool model)  │  │
│  └──────┬─────┘   └──────────────────────┘  │
│         │ tool_calls[]                      │
│  ┌──────▼──────────────────────────────────┐│
│  │ Tool Executor                           ││
│  │  1. schema-validate args (Zod)          ││
│  │  2. permission gate vs caller's mask    ││
│  │  3. confirmation gate for writes        ││
│  │  4. execute (→ back over tunnel to api, ││
│  │     or direct to Ardent/Spansh/EDSM)    ││
│  │  5. truncate + audit result             ││
│  └──────┬──────────────────────────────────┘│
│         │ tool results                      │
│  ┌──────▼─────┐                             │
│  │ Loop (≤8)  │ → final answer + citations  │
│  └────────────┘                             │
│                                             │
│  RAG: pgvector, ACL-filtered by permMask    │
└─────────────────────────────────────────────┘
```

**Critical inversion to note:** tools that touch squadron data do **not** run against a local copy of the database. The agent calls **back** through the tunnel to the `api` service, presenting the *same* signed user context. That means the API's existing authorization guards enforce everything, once, in one place. The AI physically cannot bypass them because it has no other route to the data.

### 8.4 Tool registry

Every tool = `{ name, description, JSON Schema, requiredPermission, mutating: bool, handler }`. Registered in `packages/ai-tools` and shared with the API so a tool can also be exposed as a REST endpoint and a slash command from the same definition.

**Read tools (Ring 0/1):**

| Tool | Purpose |
|---|---|
| `search_forums` | ACL-filtered semantic + keyword search over threads/posts |
| `search_wiki` | Squadron docs, SOPs, doctrine |
| `get_system_info` | Ardent/EDSM — allegiance, economy, stations, security, powers |
| `find_commodity_prices` | Galactic min/max/avg, supply, demand |
| `find_best_sell` / `find_best_buy` | Importers/exporters near a system, filtered |
| `find_trade_route` | Own DB route optimiser (§7.4) |
| `plot_route` | Spansh async job (neutron/galaxy/carrier/riches) |
| `find_nearest_service` | Interstellar factors, material trader, tech broker, black market, shipyard, outfitting, universal cartographics |
| `get_squadron_stats` | Membership, activity, treasury, territory |
| `get_member_profile` | Respecting that member's privacy settings |
| `list_operations` | Upcoming ops, filterable |
| `get_bgs_status` | Influence, states, conflicts, current orders |
| `get_carrier_status` | Location, fuel, services, next jump |
| `search_loadouts` | "Find our doctrine mining Python" |
| `analyse_loadout` | Compute stats, spot weaknesses, suggest swaps |
| `get_galnet` | Recent in-universe news |
| `get_engineer_info` | Engineer location, unlock requirements, blueprints |
| `calculate_jump_range` | Ship maths from `ed-domain` |

**Write tools (Ring 1+, gated by permission AND confirmation):**

| Tool | Permission | Confirm? |
|---|---|---|
| `create_forum_post` | `FORUM_POST_*` | Yes — show a preview first |
| `create_operation` | `OPS_CREATE` | Yes |
| `signup_for_operation` | `OPS_SIGNUP` | No (trivially reversible) |
| `save_loadout` | `FLEET_EDIT_OWN` | No |
| `save_trade_route` | `TRADE_SAVE_ROUTE` | No |
| `report_bgs_activity` | `BGS_REPORT` | No |
| `set_bgs_order` | `BGS_SET_ORDERS` | **Yes** |
| `post_announcement` | `FORUM_MODERATE` | **Yes** |
| `send_discord_message` | `OPS_MANAGE` | **Yes** |
| `grant_role` | `ROLE_MANAGE` | **Yes, two-step** |
| `moderate_content` | `FORUM_MODERATE` | **Yes** |

**Example definition:**

```ts
export const findTradeRoute = defineTool({
  name: 'find_trade_route',
  description:
    'Find profitable trade routes from a starting system. Returns commodity, ' +
    'buy station, sell station, profit per ton and per full hold. Use when a ' +
    'CMDR asks where to trade, what to haul, or how to make credits hauling.',
  permission: Permission.TRADE_QUERY,
  mutating: false,
  schema: z.object({
    origin_system:    z.string().describe('Starting system, e.g. "Shinrarta Dezhra"'),
    cargo_capacity:   z.number().int().min(1).max(794),
    max_distance_ly:  z.number().min(1).max(500).default(50),
    max_station_ls:   z.number().min(0).default(5000),
    min_landing_pad:  z.enum(['small','medium','large']).default('large'),
    max_price_cr:     z.number().int().optional().describe('Credits available'),
    include_carriers: z.boolean().default(false),
    max_data_age_days:z.number().int().min(1).max(90).default(7),
    limit:            z.number().int().min(1).max(20).default(5),
  }),
  handler: async (args, ctx) => {
    const routes = await ctx.api.post('/v1/trade/routes', args);
    return {
      routes: routes.slice(0, args.limit).map(r => ({
        commodity: r.commodityDisplay,
        buy_at:  `${r.fromStation} (${r.fromSystem})`,
        buy_price: r.buyPrice,
        sell_at: `${r.toStation} (${r.toSystem})`,
        sell_price: r.sellPrice,
        profit_per_ton: r.profitPerTon,
        profit_per_run: r.profitPerTon * args.cargo_capacity,
        distance_ly: r.distanceLy,
        data_age_hours: r.dataAgeHours,     // model MUST surface this
      })),
      caveat: 'Prices are player-reported via EDDN and may be stale.',
    };
  },
});
```

Note the last two fields. **Always return provenance and freshness to the model, and instruct it in the system prompt to relay them.** An AI that confidently states a price from a 3-week-old snapshot without saying so will burn your members' time and their trust in the tool.

### 8.5 System prompt (skeleton)

```
You are GRIM'S SQUAD AI (GSAI), the operations intelligence of Grim's Squad,
an Elite Dangerous squadron. You address members as "CMDR". You are competent,
concise, and faintly militaristic — helpful crew, not a butler, and not a
chatbot doing a bit.

CONTEXT
  Caller: {{displayName}} (CMDR {{cmdrName}}), role {{roleName}}
  Permissions: {{permissionList}}
  Squadron home: {{homeSystem}} · Tracked factions: {{factions}}
  Current UTC: {{now}} · Their local time: {{localTime}}

RULES
1. Use tools for anything factual about the game, the galaxy, market prices,
   or squadron data. Never answer from memory — market data changes hourly and
   your training data is stale by definition.
2. Always report data freshness when a tool provides it. If data is older than
   7 days, say so explicitly before the numbers.
3. You have exactly the permissions listed above — no more. If a request needs
   a permission the caller lacks, say plainly what's needed and who can grant it.
   Never speculate about, or reveal the contents of, gated material.
4. Before any mutating action, state precisely what you're about to do and wait
   for explicit confirmation. Never chain multiple writes without asking.
5. Cite your sources: name the forum thread, the station, the tool used.
6. If you don't know, say so and offer the tool that would find out.
7. Never invent system names, station names, commodity prices, or CMDR names.
   A wrong system name sends someone on a 40-minute round trip for nothing.
8. Keep answers tight. Tables for data, prose for reasoning. No preamble.
```

### 8.6 Agent loop

```ts
async function runAgent(req: AiRequest): Promise<AiResponse> {
  const tools = registry.forPermissions(req.permMask);   // filtered UP FRONT
  const messages = [systemPrompt(req), ...req.messages];
  const trace: ToolInvocation[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {       // 6 on qwen3:8b, 8 on 14b
    const res = await ollama.chat({
      model: pickModel(req),          // arbiter picks instance A or B, §8.2.5
      messages,
      tools: tools.map(toOllamaSchema),
      stream: true,
      options: { temperature: 0.3, num_ctx: 16384 },     // see §8.2.4
    });

    if (!res.message.tool_calls?.length) {
      return { text: res.message.content, trace };      // done
    }

    for (const call of res.message.tool_calls) {
      const tool = tools.find(t => t.name === call.function.name);
      if (!tool) { messages.push(toolError(call, 'Unknown tool')); continue; }

      const parsed = tool.schema.safeParse(call.function.arguments);
      if (!parsed.success) {
        messages.push(toolError(call, fmtZod(parsed.error)));  // let it self-correct
        continue;
      }

      if (!hasPermission(req.permMask, tool.permission)) {
        await audit({ ...call, outcome: 'denied' });
        messages.push(toolError(call, 'Permission denied'));
        continue;
      }

      if (tool.mutating && !req.confirmedActions?.includes(hashCall(call))) {
        return { needsConfirmation: { tool: tool.name, args: parsed.data,
                 preview: await tool.preview?.(parsed.data, req) }, trace };
      }

      const started = Date.now();
      try {
        const result = await withTimeout(tool.handler(parsed.data, ctx(req)), 30_000);
        const truncated = truncateForContext(result, 4000);   // guard the window
        messages.push({ role: 'tool', name: tool.name, content: JSON.stringify(truncated) });
        trace.push({ ...call, outcome: 'ok', ms: Date.now() - started });
      } catch (e) {
        messages.push(toolError(call, String(e)));
        trace.push({ ...call, outcome: 'error', ms: Date.now() - started });
      }
      await audit(trace.at(-1)!);
    }
  }
  return { text: 'I hit my step limit on that one, CMDR. Try narrowing it down.', trace };
}
```

**Details that matter:** tools filtered by permission *before* the model ever sees them (the model can't call what it doesn't know exists); Zod errors fed back so the model self-corrects rather than failing; every tool result truncated before it enters context; every invocation audited whether it succeeded, failed, or was denied.

### 8.7 RAG pipeline

```
Content created/edited (forum post, wiki page, loadout, guide, AAR)
  → BullMQ job
  → chunk (600 tokens, 80 overlap, respect markdown headings)
  → embed via Ollama (nomic-embed-text)
  → upsert into knowledge_chunks WITH the source's visibility value
  → on source deletion or ACL change: delete/update chunks (CRITICAL)
```

Retrieval:
```sql
SELECT id, title, content, source_type, source_id,
       1 - (embedding <=> $queryEmbedding) AS similarity
FROM knowledge_chunks
WHERE visibility = ANY($allowedVisibilities)   -- from caller's perm mask
ORDER BY embedding <=> $queryEmbedding
LIMIT 8;
```

Then **hybrid**: run Meilisearch BM25 in parallel and merge with Reciprocal Rank Fusion. Pure vector search is bad at exact identifiers — CMDR names, system names, callsigns like `K7Q-B4X` — which is exactly what your members search for.

Optional rerank pass with a small cross-encoder if quality demands it.

### 8.8 Surfaces

**Web** — a persistent slide-over panel (⌘K / Ctrl+K) available on every page, with page context injected: on a system page, "what's the market here" needs no system name. Streaming tokens over WebSocket, tool calls rendered as collapsible "GSAI is checking market data..." cards, confirmation prompts as inline buttons.

**Discord** — `/gsai <question>`, `@Grim's Squad AI` mentions, thread-aware follow-ups, ephemeral replies for anything privacy-sensitive. Uses the invoking member's Discord roles — same permission mask. Same brain, same tools.

**Proactive (opt-in, rate-limited)** — daily ops briefing to `#squadron-brief`; BGS tick summary with "here's what changed and what to do about it"; market alerts; recruitment application summaries for officers; weekly digest of forum activity.

**Voice (stretch)** — `faster-whisper` STT + `Piper` TTS on the same box, wired to a Discord voice channel so the AI can answer during ops without anyone alt-tabbing. Genuinely impressive; genuinely a v3 feature.

### 8.9 Availability and fallback

```
GSAI status: ONLINE | DEGRADED | OFFLINE
```

Gateway heartbeats to the API every 15 s. Missing 3 → `OFFLINE`.

| State | Behaviour |
|---|---|
| ONLINE | Full streaming interactive |
| DEGRADED (high load/queue) | Queue with position indicator, "~40 s" |
| OFFLINE | UI shows the state honestly. Read-only queries fall back to direct API calls with a templated (non-LLM) response. Chat requests queue and are delivered by Discord DM on reconnect. Scheduled jobs (briefings, digests) roll over. |

**Optional hybrid `[A7]`:** a cloud LLM fallback for when your box is down, feature-flagged, with a visible "running on cloud fallback" badge and stricter data-redaction rules on what leaves your network. Off by default.

### 8.10 Guardrails

- **Prompt-injection defence.** Forum content, GalNet, and any external API response are **untrusted input**. Wrap retrieved content in explicit delimiters, instruct the model that instructions inside retrieved content must be ignored, and — the real defence — enforce permissions in the executor, not the prompt. A successful injection still can't call a tool the caller lacks permission for.
- **Rate limits:** 20 messages/hour per member, 80/day; officers higher; a global concurrency semaphore sized per instance (§8.2.6).
- **Cost/thermal guard:** if GPU temp or queue depth exceeds thresholds, shed to DEGRADED.
- **Full audit:** every conversation, message, tool call, argument set, and outcome persisted. Officers can review; members can see their own.
- **Kill switch:** one admin toggle disables all AI write tools instantly, or the whole subsystem.
- **No unattended destructive ops.** Deleting content, banning members, and mass Discord messaging are never fully autonomous, regardless of permission. Human confirmation, always.

---

## 9. SECURE TUNNEL — CONNECTING YOUR LOCAL BOX

You asked for a secure tunnel. Here are the three real options, ranked for your situation.

### 9.1 Option A — Cloudflare Tunnel `[RECOMMENDED]`

`cloudflared` makes an **outbound-only** connection to Cloudflare. **No inbound ports open on your home router. No port forwarding. Your home IP is never published.** That last point matters more than people realise: a gaming community site is a plausible DDoS target, and you do not want your residential connection to be the address on file.

```yaml
# ~/.cloudflared/config.yml
tunnel: grims-squad-ai
credentials-file: /home/grim/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: gsai.grimssquad.example
    service: https://localhost:8443
    originRequest:
      # mTLS from tunnel to local service — defence in depth
      caPool:       /etc/gsai/ca.pem
      originServerName: gsai.internal
      noTLSVerify:  false
      connectTimeout: 10s
      keepAliveTimeout: 90s
  - service: http_status:404
```

Layer **Cloudflare Access** (Zero Trust) in front of that hostname with a **service token** issued only to your VPS. Then:

```
Public internet → hostname exists but every request without the service token
                  is rejected at Cloudflare's edge, before it ever reaches you.
VPS `api`      → presents CF-Access-Client-Id + CF-Access-Client-Secret
               → plus mTLS client cert
               → plus HMAC-signed request body with nonce
```

Three independent layers. Any one of them failing doesn't expose the agent.

**Pros:** free tier is generous; no open ports; DDoS absorbed upstream; trivial to set up.
**Cons:** you depend on Cloudflare; traffic is decrypted at their edge unless you're on a plan supporting keyless/E2E — hence the mTLS + payload signing beneath it.

### 9.2 Option B — WireGuard mesh (Tailscale/Netbird/Headscale)

Put the VPS and your box on a private mesh. The gateway binds only to the mesh interface (`100.x.x.x`) and is completely unreachable from the public internet.

```ini
[Interface]
PrivateKey = <local box key>
Address    = 10.44.0.2/24

[Peer]
PublicKey  = <VPS key>
AllowedIPs = 10.44.0.1/32
Endpoint   = vps.example:51820
PersistentKeepalive = 25
```

**Pros:** end-to-end encrypted with no third party terminating TLS; lowest latency; conceptually simplest trust model.
**Cons:** the VPS must reach your box (works fine with keepalive behind NAT); no edge DDoS protection (though nothing is exposed to DDoS); you manage keys.

**Best answer: do both.** WireGuard for the API↔GSAI control plane. Cloudflare Tunnel only if you ever want to expose something directly.

### 9.3 Option C — Reverse SSH tunnel

`ssh -N -R 8443:localhost:8443 user@vps` with `autossh`. Works, costs nothing, but it's brittle and you'll be babysitting it. Fine as an emergency fallback, not as the design.

### 9.4 If you'd rather host *everything* at home `[A2 alternative]`

Possible, with real trade-offs:
- Everything behind one Cloudflare Tunnel; `cloudflared` proxies `web`, `api`, `shipyard`.
- **Requires:** UPS, a proper backup strategy, and acceptance that a power cut or ISP outage takes the squadron site down.
- Residential upload bandwidth becomes your ceiling.
- Some ISPs prohibit hosting services on residential connections — check your ToS.

My recommendation stands: **public services on a cheap VPS, AI at home.** ~$25/mo buys you a site that doesn't go down when you reboot your gaming rig.

### 9.5 Threat model for the tunnel

| Threat | Mitigation |
|---|---|
| Attacker discovers the GSAI hostname | Cloudflare Access rejects at edge without service token |
| Compromised VPS pivots to your LAN | Gateway binds to one interface, runs as an unprivileged user, in Docker with `--network` restricted; **no route from the container to your LAN**; nftables egress allowlist |
| Replay of a captured request | HMAC signature + single-use nonce in Redis + 60 s timestamp window |
| Prompt injection escalates privileges | Permission enforcement is in the executor and the API, not the prompt |
| Tunnel credential leak | Rotate quarterly; scope the service token to one hostname; alert on unusual source ASNs |
| Model exfiltrates data via tool args | Egress allowlist on the agent container (Ollama localhost + your API + the whitelisted ED APIs, nothing else) |

---

## 10. SECURITY & PRIVACY

### 10.1 Application security baseline
- Every input validated with Zod at the boundary; parameterised queries only (Prisma/Drizzle).
- Output encoding + DOMPurify server-side on all user HTML; strict CSP with nonces, `frame-ancestors 'none'`.
- Rate limits per IP and per user, tiered by endpoint sensitivity.
- Argon2id if you ever add password auth (you shouldn't — stay OAuth-only).
- Secrets in a real store (Doppler/Infisical/SOPS), never in the repo. Rotate on schedule.
- Dependabot/Renovate + `npm audit` in CI; container image scanning (Trivy).
- Uploads: MIME sniffing, size caps, image re-encoding (strips EXIF *and* neutralises polyglot files), served from a separate origin.
- Idempotency keys on all mutating API endpoints.

### 10.2 Data protection
- TLS 1.3 everywhere including internal hops.
- Encrypt at rest: all OAuth refresh tokens, device tokens, and the AI conversation store (AES-256-GCM, key from the secret store).
- Backups: nightly `pg_dump` + WAL archiving to object storage, 30-day retention, **restore tested monthly** (an untested backup is a rumour).
- Retention: audit logs 1 year; AI conversations 90 days by default with user-controlled deletion; telemetry raw events 30 days, aggregates indefinite.

### 10.3 Member privacy — the part squadrons get wrong

You are collecting real-time location data about real people's gameplay, plus their Discord identity, plus their in-game finances. Treat it seriously:

- **Everything is opt-in**, per category, defaulting to off. Location sharing especially.
- **Visible indicator** when telemetry is being received ("EDMC connected — sharing: location, BGS").
- **One-click revoke** of the device token and purge of collected data.
- **Never publish** a member's credit balance, exact location, or fleet publicly without an explicit per-field opt-in.
- **Data export** — a member can download everything you hold on them, as JSON.
- **Deletion on departure** — when someone leaves, offer full purge; anonymise their forum posts rather than deleting them (preserves thread coherence) unless they ask otherwise.
- **Publish a plain-English privacy policy.** If you have EU or UK members, GDPR applies to you regardless of your being a hobbyist. It's not onerous at this scale, but "we didn't know" isn't a defence.

### 10.4 Moderation & safety
- Report button on all user content, routed to a moderation queue with Discord notification.
- Automated flags: link spam, new-account posting velocity, banned-phrase list.
- Ban/mute with duration, reason, and appeal thread.
- **Under-18 members:** many ED squadrons have teenage members. Don't collect birthdates you don't need; keep the private forum's culture appropriate to who's actually in it; make sure officers know that DM-based recruitment of minors into voice channels is a moderation topic, not just a social one.

---

## 11. DESIGN SYSTEM & UX

### 11.1 Visual direction

Elite Dangerous has one of the strongest UI identities in gaming. Lean into it *without* directly ripping HUD assets (Frontier's IP — see §17).

```css
:root {
  /* Core — the ED orange, but disciplined */
  --ed-orange:        #ff7100;
  --ed-orange-bright: #ff9d3f;
  --ed-orange-dim:    #b34f00;
  --ed-cyan:          #00c8ff;   /* accents, links, "friendly" */
  --ed-red:           #ff2b2b;   /* hostile, alerts, destructive */
  --ed-green:         #3dff8f;   /* success, fresh data */
  --ed-amber:         #ffc400;   /* warning, stale data */

  /* Surfaces — deep space, not pure black */
  --bg-void:          #05070a;
  --bg-panel:         #0b0f14;
  --bg-panel-raised:  #121820;
  --bg-panel-hover:   #18202a;
  --border-hairline:  rgba(255,113,0,0.18);
  --border-active:    rgba(255,113,0,0.55);

  --text-primary:     #e8eef5;
  --text-secondary:   #93a4b8;
  --text-dim:         #5b6b7d;

  --glow-orange:      0 0 12px rgba(255,113,0,0.35);
  --scanline:         repeating-linear-gradient(
                        0deg, transparent 0 2px,
                        rgba(255,255,255,0.012) 2px 3px);
}
```

**Typography:** a squared-off technical face for headings and numerals (Orbitron, Chakra Petch, or Michroma), a highly legible sans for body (Inter, IBM Plex Sans), and a monospace for data tables (JetBrains Mono). Tabular figures on every number — misaligned credit columns look amateurish instantly.

**Motion:** panel edges that draw in on mount, a subtle scanline overlay at ~1.2% opacity, cyan hover glow, a "system boot" sequence on first load (once per session, skippable — charming once, infuriating on the fifth page view).

**Layout:** dense information panels with hairline borders and corner cuts, in the spirit of the in-game cockpit UI. Data tables are first-class citizens — sortable, filterable, virtualised, keyboard-navigable.

### 11.2 Accessibility — non-negotiable

The ED aesthetic fights you here. Fight back:
- Orange-on-black at small sizes often fails WCAG AA. Use `--ed-orange-bright` for small text, reserve pure `--ed-orange` for large text and accents. **Test every combination** with a contrast checker.
- Ship a **high-contrast theme** and a **reduced-motion theme**; respect `prefers-reduced-motion` and `prefers-contrast` automatically.
- Never encode meaning in colour alone (add icons/labels to influence deltas, data freshness, hostile/friendly).
- Full keyboard navigation, visible focus rings, proper ARIA on the custom data grids, semantic landmarks.
- Colour-blind-safe palette option — deuteranopia makes the standard orange/red distinction nearly invisible, and red/green is your BGS delta indicator.

### 11.3 Key screens

1. **Dashboard** — personalised: next op with countdown, BGS orders for tonight, unread forum activity, carrier status, GSAI prompt bar, "your ship, your system" card.
2. **Galaxy Map** — 3D (Three.js/Deck.gl) of your sphere of influence, coloured by influence %, clickable systems, with a 2D fallback for low-end devices.
3. **Trade Terminal** — split pane: filters left, results right, route detail bottom drawer, freshness badges throughout.
4. **BGS Console** — influence time-series with tick markers, system grid with sortable deltas, orders sidebar.
5. **Forum** — comfortable reading measure (~70ch), rich embeds, sticky reply composer.
6. **Loadout Locker** — card grid → detail view with stat radar chart and comparison mode.
7. **Ops Board** — calendar + signup panel + wing composition widget.
8. **GSAI panel** — slide-over, streaming, tool-call cards, citations.

**Mobile:** ~40% of your traffic will be phones, often *during* play sessions on a second screen. Prioritise: dashboard, ops signup, forum reading, trade lookup, GSAI chat. Deprioritise: galaxy map, loadout editor, BGS charts. Build it as a PWA with push notifications for ops reminders — this covers 90% of what an app would give you at 5% of the effort.

---

## 12. THE SITE'S OWN API

Version everything at `/v1`. This API serves the web app, the Discord bot, the EDMC plugin, GSAI, and any future member-built tool.

```
AUTH
  GET    /v1/auth/discord                     → 302
  GET    /v1/auth/discord/callback
  POST   /v1/auth/refresh
  POST   /v1/auth/logout
  GET    /v1/auth/frontier                    → cAPI PKCE start
  GET    /v1/auth/frontier/callback
  GET    /v1/me
  GET    /v1/me/permissions
  POST   /v1/me/device-tokens                 → for EDMC plugin
  DELETE /v1/me/device-tokens/:id

FORUM
  GET    /v1/forum/categories
  GET    /v1/forum/categories/:slug/threads    ?page&sort&tag
  POST   /v1/forum/categories/:slug/threads
  GET    /v1/forum/threads/:id                 ?page
  POST   /v1/forum/threads/:id/posts
  PATCH  /v1/forum/posts/:id
  DELETE /v1/forum/posts/:id
  POST   /v1/forum/posts/:id/reactions
  POST   /v1/forum/threads/:id/subscribe
  GET    /v1/forum/search                      ?q&category&author

GAME DATA
  GET    /v1/systems/search                    ?q
  GET    /v1/systems/:address
  GET    /v1/systems/:address/stations
  GET    /v1/systems/:address/nearby           ?maxLy
  GET    /v1/systems/:address/nearest/:service ?minPad
  GET    /v1/commodities
  GET    /v1/commodities/:name
  GET    /v1/commodities/:name/imports         ?near&maxLy&minVolume&maxAge
  GET    /v1/commodities/:name/exports
  GET    /v1/stations/:marketId/market

TRADE
  POST   /v1/trade/routes                      → sync, own DB
  POST   /v1/trade/plot                        → async job (Spansh)
  GET    /v1/trade/jobs/:id
  GET    /v1/trade/saved
  POST   /v1/trade/alerts

FLEET
  GET    /v1/fleet                             ?owner&shipType&minJump
  POST   /v1/fleet/ships
  GET    /v1/loadouts                          ?role&doctrine&author
  POST   /v1/loadouts
  POST   /v1/loadouts/import                   { coriolisUrl | edsyUrl | journalLoadout }
  GET    /v1/loadouts/:id/analysis
  POST   /v1/loadouts/compare
  GET    /v1/carriers
  PATCH  /v1/carriers/:callsign

OPS
  GET    /v1/operations                        ?from&to&type&status
  POST   /v1/operations
  POST   /v1/operations/:id/signup
  POST   /v1/operations/:id/attendance
  GET    /v1/operations/:id/composition

BGS
  GET    /v1/bgs/systems
  GET    /v1/bgs/systems/:address/influence    ?since
  GET    /v1/bgs/orders
  POST   /v1/bgs/orders
  POST   /v1/bgs/reports
  GET    /v1/bgs/ticks

MEMBERS
  GET    /v1/members                           ?role&active&division
  GET    /v1/members/:id
  PATCH  /v1/members/:id/roles
  GET    /v1/members/:id/stats

TELEMETRY (EDMC plugin, device-token auth)
  POST   /v1/telemetry                         { events: [...] }

AI
  POST   /v1/ai/conversations
  POST   /v1/ai/conversations/:id/messages     → SSE/WS stream
  POST   /v1/ai/confirm                        { invocationId }
  GET    /v1/ai/status
  GET    /v1/ai/tools                          → what the caller may invoke

ADMIN
  GET    /v1/admin/audit                       ?actor&action&from&to
  GET    /v1/admin/health
  PATCH  /v1/admin/config
  GET    /v1/admin/roles  ·  POST /v1/admin/roles  ·  PATCH /v1/admin/role-mappings

WEBSOCKET  wss://api.<domain>/v1/ws
  channels: notifications:{userId} · ops:{opId} · ai:{conversationId}
            bgs:updates · carriers:{callsign} · presence:squadron
```

---

## 13. INFRASTRUCTURE & DEPLOYMENT

### 13.1 Environments

| Env | Purpose | Hosting |
|---|---|---|
| `local` | Dev | Docker Compose, seeded fixtures |
| `staging` | Pre-prod, officer testing | Same VPS, separate compose project + DB |
| `production` | Live | VPS + your box |

### 13.2 Compose sketch (production edge)

```yaml
services:
  caddy:      { image: caddy:2, ports: ["80:80","443:443"], volumes: [caddy_data:/data] }
  web:        { build: apps/web,  environment: [NEXT_PUBLIC_API_URL], depends_on: [api] }
  api:        { build: apps/api,  depends_on: [postgres, redis, meilisearch] }
  bot:        { build: apps/bot,  depends_on: [postgres, redis], restart: unless-stopped }
  worker:     { build: apps/worker, depends_on: [postgres, redis], deploy: { replicas: 2 } }
  eddn:       { build: apps/eddn-collector, depends_on: [postgres] }
  coriolis:   { build: { context: vendor/coriolis } }
  postgres:   { image: pgvector/pgvector:pg16, volumes: [pgdata:/var/lib/postgresql/data] }
  redis:      { image: redis:7-alpine, command: redis-server --appendonly yes }
  meilisearch:{ image: getmeili/meilisearch:v1.11 }
  wireguard:  { image: linuxserver/wireguard, cap_add: [NET_ADMIN] }
```

### 13.3 CI/CD (GitHub Actions)

```
PR       → lint · typecheck · unit tests · build · Trivy scan
main     → integration tests (ephemeral PG/Redis) → build+push images
           → deploy staging → smoke tests → manual gate → deploy production
migrate  → Prisma migrate deploy, expand/contract pattern, always backwards-compatible
rollback → previous image tag + down-migration, one command
```

Zero-downtime: rolling replace of `web`/`api`/`worker`. `bot` and `eddn-collector` are singletons — accept a few seconds of gap, and make both resumable.

### 13.4 Cost estimate

| Item | Monthly |
|---|---|
| VPS (4 vCPU / 8 GB / 160 GB NVMe — Hetzner CX32 class) | ~$8–15 |
| Domain | ~$1–3 |
| Cloudflare (Free tier covers DNS/CDN/Tunnel/Turnstile/Access for small teams) | $0 |
| R2 object storage (~50 GB) | ~$1 |
| Backups (S3-compatible, 100 GB) | ~$2 |
| Sentry / Grafana Cloud free tiers | $0 |
| Email (Resend/Postmark, low volume) | $0–10 |
| **AI inference** | **$0 — your hardware** |
| Electricity for the AI box | 3060 idle-to-load ≈ 20–170 W continuous; 5070 Ti only when batching |
| **Total** | **≈ $12–30/mo** |

Storage note: full-galaxy EDDN retention will grow past 160 GB. With the prefilter in §6.3 you'll sit comfortably under 50 GB. Plan a volume upgrade path.

### 13.5 Observability

- **Metrics** (Prometheus): request rate/latency/errors by route; EDDN messages/sec and lag; queue depth by queue; Ollama tokens/sec and GPU utilisation; DB connections and slow queries; tunnel health.
- **Logs** (Loki + Pino): structured JSON, request-ID correlation across web→api→gsai.
- **Traces** (OpenTelemetry): full span for an AI request including every tool call — invaluable when someone says "the AI gave me a bad route."
- **Errors** (Sentry): FE and BE, release-tagged.
- **Uptime** (UptimeRobot/BetterStack): public site, API health, GSAI heartbeat.
- **Dashboards:** Squadron Activity, System Health, AI Performance, Data Freshness.
- **Alerts → Discord `#site-alerts`:** API 5xx > 1%; EDDN silent > 10 min; queue depth > 500; disk > 80%; GSAI offline > 15 min; failed backup.

---

## 14. BUILD ROADMAP

Estimates assume one competent full-stack developer working steadily. Halve them with a small team; double them if this is your first project of this size. **Ship each phase to real members before starting the next** — feedback beats planning.

### Phase 0 — Foundations (Week 1–2)
- [ ] Register domain, VPS, Cloudflare
- [ ] **Apply for Frontier cAPI developer access** — do this on day one, it's the long pole
- [ ] **Request Inara API app whitelisting** — also day one
- [ ] Monorepo, CI, Docker Compose, Postgres + migrations
- [ ] Discord app + bot registration
- [ ] Design tokens, base component library
- **Deliverable:** "Hello CMDR" page deployed with CI

### Phase 1 — Identity & shell (Week 3–5)
- [ ] Discord OAuth, sessions, refresh rotation
- [ ] Permission bitmask, roles, mappings, guards
- [ ] Bot role sync + nightly reconciliation
- [ ] Member profiles, admin console v1, audit log
- [ ] Public landing page
- **Deliverable:** members log in with Discord, see role-appropriate navigation

### Phase 2 — Forums (Week 6–9)
- [ ] Categories, threads, posts, reactions, subscriptions
- [ ] Editor, uploads, ACL-filtered Meilisearch
- [ ] Moderation queue, Discord bridge
- [ ] Recruitment pipeline
- **Deliverable:** the community can move in. **This is the point of no return — get people using it.**

### Phase 3 — Telemetry spine (Week 10–13) `[MOVED UP]`

You selected **all four** activity profiles, so nothing can be deprioritised by focus. The way out is to build the thing that serves all of them at once: **the EDMC plugin and the game-data layer feed BGS, ops, carriers, and trade simultaneously.** Build the pipe before the four taps.

- [ ] `ed-clients` adapters (Ardent, EDSM, Spansh, GalNet)
- [ ] EDDN collector, seeded from Spansh/Ardent dumps
- [ ] Systems/stations/market schema + spatial indexes
- [ ] FDevIDs name mapping
- [ ] **EDMC plugin v1 + `/v1/telemetry` endpoint + device tokens** — the keystone
- [ ] System & commodity pages, forum embeds
- **Deliverable:** the site knows about the galaxy *and* about what your CMDRs are actually doing in it

### Phase 4 — BGS console (Week 14–18) `[MOVED UP — you run a faction]`
- [ ] Influence charts with tick markers, system control board
- [ ] Orders board (`push`/`hold`/`suppress`) with officer guidance
- [ ] Activity reporting — automatic from the plugin, manual form as fallback
- [ ] Conflict tracker, expansion/retreat alerts
- [ ] Nightly BGS digest to Discord
- **Deliverable:** members open the site to find out what to do tonight. This is the retention hook for a faction-running squadron.

### Phase 5 — Ops board & carriers (Week 19–22)
- [ ] Operations board, signups, Discord Scheduled Events sync, reminder DMs
- [ ] **Wing composition checker** — matters more for you than most squadrons, because you run CZs *and* mining *and* hauling ops off the same roster
- [ ] Carrier registry, jump schedule board, tritium tracker with contribution ledger
- [ ] Carrier market mirror
- **Deliverable:** ops and carrier logistics run through the site

### Phase 6 — Trade terminal (Week 23–26)
- [ ] Commodity lookup, importer/exporter finder, freshness badges
- [ ] Own-DB route optimiser + materialised view
- [ ] Spansh job queue + WS push
- [ ] Carrier-aware routing, squadron trade board, group hauling targets
- **Deliverable:** "where do I make credits tonight" answered on your site

### Phase 7 — Shipyard (Week 27–29)
- [ ] Coriolis Docker deploy + theming
- [ ] Loadout Locker: import, store, compute, compare
- [ ] **Doctrine builds per role** — with combat/AX *and* mining *and* trade in scope, a curated set of approved builds per activity is high value
- [ ] cAPI fleet import, fleet queries
- **Deliverable:** ship builds live at home

### Phase 8 — GSAI (Week 30–36) `[MOVED LAST — deliberately]`
- [ ] Dual Ollama instances per §8.2.3, UUID pinning, driver 580+, reliability benchmark
- [ ] GPU arbiter + game detection (§8.2.5)
- [ ] Tunnel + mTLS + request signing
- [ ] **Deterministic fast path first** (intent classifier → direct tool → template)
- [ ] Gateway, agent loop, read-tool registry with schema pre-filtering
- [ ] RAG pipeline with ACL-aware chunks, CPU embedder
- [ ] Web panel + Discord surface
- [ ] Write tools with confirmation flow, audit UI, kill switch
- **Deliverable:** GSAI online

### Phase 9 — Polish & delight (Week 37+)
- [ ] AX/Thargoid war board, Powerplay module, galaxy map
- [ ] Achievements, gallery, wiki, PWA + push
- [ ] Load testing, a11y audit, security review, docs

**Realistic total for the full vision: 9–11 months solo, part-time.** A genuinely useful v1 — Phases 0–2 plus the EDMC plugin — is **8–10 weeks** and is the right thing to aim at first.

**Why GSAI moved to Phase 8.** It's the feature you're most excited about, and it's the one that depends on everything else existing. An agent with no forum to search, no BGS data to report, and no ops to book is a chatbot. Built last, it has 20 real tools and becomes the thing you pitched. Built first on 8 GB, it's a slow chatbot that hallucinates market prices, and it will define members' first impression of the whole site. Resist.

---

## 15. ADDITIONAL FEATURES — THE FULL WISHLIST

You asked for every recommendation. Here they are, sorted by value-to-effort.

### 15.1 High value, low effort ★★★
- **CMDR business cards** — auto-generated shareable PNG with CMDR name, ranks, squadron, ship. People post these everywhere; free marketing.
- **"Am I needed?" widget** — one glance: tonight's BGS priority, ops needing signups, carrier fuel shortfall.
- **Copy-to-clipboard everywhere** — system names, one-click, so members can paste straight into the galaxy map. Sounds trivial; used constantly.
- **Timezone-aware everything** with a UTC anchor.
- **Discord rich presence links** — site URLs unfurl as proper embeds in Discord.
- **Squadron milestone bot posts** — "50th member!", "1 trillion credits earned!"
- **Dark/darker/high-contrast theme switcher.**
- **Keyboard command palette** (⌘K) for navigation and GSAI.
- **New member onboarding checklist** with progress bar — verify CMDR, install EDMC plugin, join a wing, attend an op, post an intro. Measurably improves retention.

### 15.2 High value, medium effort ★★
- **Mentor pairing** — auto-match new CMDRs to veterans by timezone and playstyle.
- **Wing finder / LFG board** — "3 CMDRs at HIP 22460, need a 4th for CZs, 1 slot" with a Discord ping.
- **Engineering tracker** — per-member unlock progress across all engineers, with "who can help me unlock Palin" queries.
- **Materials exchange** — the squadron-internal version of the material trader.
- **Community Goal tracker** — current CGs with squadron participation and tier progress.
- **Thargoid / AX war board** — if that content is live and you run AX ops, this is a whole module of its own.
- **Powerplay module** — pledge tracking, merit contributions, fortification/undermining targets.
- **Colonisation / system architecture tracker** — build progress, hauling requirements, contribution ledger.
- **Exploration codex** — first discoveries, exobiology finds, distance-travelled leaderboards, a "furthest CMDR" hall of fame.
- **Rescue/Fuel Rats-style dispatch** — internal SOS board.
- **Squadron radio** — shared playlist / SomaFM-style embedded stream for ops nights.
- **Anniversary & birthday bot** — joins, milestones, retention through recognition.
- **Multi-language support** — ED has a large non-English playerbase; i18n scaffolding from day one costs little, retrofitting costs a lot.

### 15.3 High value, high effort ★
- **3D galaxy map** with influence overlay and route visualisation.
- **Full BGS simulation/projection engine.**
- **Replay viewer** — reconstruct an op from telemetry as an animated timeline. Superb for AARs and recruitment videos.
- **Native mobile app** (only after the PWA proves demand).
- **Inter-squadron federation** — shared BGS intel, joint ops calendars, diplomatic status board with allied squadrons. Nobody does this well. It's a genuine differentiator.
- **Squadron-vs-squadron leaderboards** and tournament brackets for PvP/racing.

### 15.4 Fun and flavour
- **In-universe framing** — call the AI panel "SHIP COMPUTER," the forum "COMMS ARRAY," the trade terminal "COMMODITIES MARKET." Consistent diegetic naming makes the whole thing feel like part of the game.
- **Boot sequence** on first load (skippable).
- **Sound design** — subtle UI clicks and confirmation tones, off by default, toggleable.
- **Easter eggs** — a Konami code that spawns a Thargoid interdiction overlay; "It's just a flesh wound" on the rebuy screen.
- **Randomised in-universe loading messages.**
- **Seasonal themes** — Frontier's anniversary, Christmas at Jameson Memorial.

### 15.5 Ideas worth explicitly *not* building
- **A web-based galaxy map that tries to replicate the in-game one.** Enormous effort, worse than the original.
- **Real-time voice transcription of every op.** Privacy nightmare, low payoff.
- **Cryptocurrency/NFT anything.** No.
- **A full ED wiki.** The community already has several. Link them.
- **Bidirectional message-level Discord↔forum mirroring.** Sounds great, is a permanent support burden. Thread-level bridging only.

---

## 16. RISKS & MITIGATIONS

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Frontier denies/delays cAPI access | Medium | High | Apply week 1; ship the Inara-nonce + officer-manual verification path as the fallback; design so cAPI is an upgrade, not a dependency |
| Inara denies API whitelisting | Medium | Low | Inara is enrichment only; nothing critical depends on it |
| A third-party API shuts down (see: EDDB) | **Likely over 2+ years** | Medium | Adapter interfaces everywhere; own EDDN collector; own seeded database. This is *why* §3.3 insists on adapters |
| EDDN schema changes break the collector | Medium | Medium | Version-tolerant parsing, dead-letter queue, alerting on parse-failure rate |
| Frontier objects to asset/data usage | Low | High | Non-commercial only, no direct asset ripping, prominent attribution, comply immediately if contacted (§17) |
| Your box is offline when members need GSAI | **High** | Low | Fully designed for: §8.9 |
| Prompt injection via forum content | Medium | Medium | Permission enforcement outside the prompt; egress allowlist; audit |
| AI gives confidently wrong game info | **High** | Medium | Tools mandatory for facts; freshness surfaced; "sourced from X, N hours old" on every data answer; feedback button on every AI message |
| Scope creep kills the project | **Very high** | **Very high** | The single biggest risk here. Phase gates. Ship Phase 2 before touching Phase 7. A live forum beats a beautiful spec |
| Solo maintainer burnout / bus factor | High | High | Document as you go; get a second admin with credentials; automate ops; keep the stack boring |
| Low adoption — members stay in Discord | **High** | High | Meet them where they are: Discord bot surfaces *everything*; make the site the place where things Discord can't do happen (trade, BGS, builds, ops) |
| Data breach of member info | Low | High | §10; minimise what you collect; encrypt tokens; test restores |

**On that adoption risk** — it's the one that actually kills squadron sites. The failure mode is a gorgeous site nobody visits because Discord is already open. The counter is the bot: every ops announcement, BGS order, AI answer, and forum notification appears in Discord with a link. The site becomes the substrate, Discord stays the interface, and people click through when they need depth.

---

## 17. LEGAL & COMPLIANCE

- **Frontier IP.** Elite Dangerous, its ships, imagery, and data are Frontier Developments' property. Third-party tools operate under Frontier's community developer goodwill, and the standard disclaimer is essentially: *"created using assets and imagery from Elite: Dangerous, with the permission of Frontier Developments plc, for non-commercial purposes. Not endorsed by Frontier; no Frontier employee was involved."* Put a version of that in your footer.
- **Keep it non-commercial.** No paid memberships, no ads, no selling access. Donations to cover hosting are the accepted norm; be transparent about what they fund.
- **Licence compliance.**
  - Coriolis / coriolis-data — MIT. Preserve copyright notices.
  - Ardent (API, collector, www) — **AGPL-3.0.** If you self-host a *modified* Ardent and expose it over a network, AGPL requires you to offer your modified source to users. Either run it unmodified, keep your fork public, or use only the hosted API (which imposes nothing on you).
  - EDCD tooling — check each repo individually.
  - Elite Dangerous Wiki text — CC BY-SA; attribute and share-alike if you reuse it.
- **GDPR/UK GDPR** — applies if you have EU/UK members: privacy policy, lawful basis (consent for telemetry), data export, deletion on request, breach notification. At your scale this is a page of text and two API endpoints, not a compliance programme.
- **Discord ToS** — bots must not scrape or store more than necessary; respect rate limits.
- **Terms of service & code of conduct** for your own site, with the moderation and appeals process written down *before* you need it.

---

## 18. OPEN QUESTIONS FOR YOU

These are the answers that would let me lock the spec down and start producing actual code, schema, and configs.

**Infrastructure & scope**
1. Do you have a VPS/cloud budget, or must everything run on your local machine?
2. What are your local machine's specs — GPU, VRAM, RAM? This determines the GSAI model tier directly.
3. Is the machine on 24/7, or does it sleep/reboot regularly?
4. Do you already own a domain?

**Squadron context**
5. How many members, roughly? And what's your Discord role structure today?
6. Do you run a player minor faction? (If yes, the BGS console jumps up the priority list.)
7. Do members own fleet carriers?
8. What's your squadron's primary focus — BGS, combat, mining, exploration, PvP, social?

**Build approach**
9. Are you building this yourself, hiring, or is this a spec for a team? What's your comfort level with TypeScript/Node vs Python vs something else?
10. Timeline — is there a date this needs to be live?
11. Custom forum, or Discourse with SSO?
12. Would you rather have a **narrow v1 that ships in 6 weeks** (auth + forum + trade lookup) and grows, or the full build attempted at once?

**Nice to confirm**
13. Do you have an existing Inara squadron page or website to migrate content from?
14. Any hard requirements I've missed — a specific feature, an existing tool you want integrated, a visual reference you want matched?

---

## APPENDIX A — REFERENCE LINKS

| Resource | URL |
|---|---|
| EDCD (community developers) | https://edcd.github.io/ |
| EDDN relay | `tcp://eddn.edcd.io:9500` |
| EDDN schemas | https://github.com/EDCD/EDDN |
| EDMarketConnector | https://github.com/EDCD/EDMarketConnector |
| FDevIDs (name mapping) | https://github.com/EDCD/FDevIDs |
| Coriolis (app) | https://github.com/EDCD/coriolis |
| Coriolis (data) | https://github.com/EDCD/coriolis-data |
| Ardent API | https://github.com/iaincollins/ardent-api |
| Ardent Collector | https://github.com/iaincollins/ardent-collector |
| Ardent Auth (cAPI reference impl) | https://github.com/iaincollins/ardent-auth |
| Ardent data dumps | https://ardent-insight.com/downloads |
| Spansh | https://spansh.co.uk/ · dumps at `/dumps` |
| EDSM API | https://www.edsm.net/en/api-v1 |
| Inara API docs | https://inara.cz/elite/inara-api-docs/ |
| Inara dev guide | https://inara.cz/elite/inara-api-devguide/ |
| Frontier cAPI OAuth2 notes | https://github.com/Athanasius/fd-api |
| Frontier developer portal | https://user.frontierstore.net/ |
| EDSY (alt shipyard) | https://edsy.org/ |
| EDCodex tool directory | https://edcodex.info/?m=api |
| Ollama | https://ollama.com/ |

---

## APPENDIX B — WEEK ONE CHECKLIST

Ordered by what unblocks the most downstream work.

```
[ ] Apply for Frontier cAPI developer access at user.frontierstore.net
[ ] PM Inara (CMDR Artie) requesting API app whitelisting — include app name,
    purpose, expected request volume, and that it's a non-commercial squadron site
[ ] Register domain + point DNS at Cloudflare
[ ] Provision VPS, harden (SSH keys only, fail2ban, ufw, unattended-upgrades)
[ ] Create Discord application + bot; enable the SERVER MEMBERS privileged intent
[ ] Audit and document your current Discord role structure
[ ] Init monorepo, CI pipeline, Docker Compose, first migration
[ ] `ollama pull qwen3:8b` (or your tier) + `nomic-embed-text`; run the
    20-request tool-call reliability benchmark from §8.2 before committing
[ ] Stand up the EDDN collector against a throwaway DB just to watch the firehose —
    it makes the data volume real and shapes every decision that follows
[ ] Write the squadron's code of conduct and privacy policy (yes, now — it's
    much easier before you have data and disputes)
```

---

*Grim's Squad Hub build specification v1.0 · Prepared 25 July 2026*
*Fly safe, CMDR. o7*
