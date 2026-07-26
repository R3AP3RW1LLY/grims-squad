# DOMAIN ENTITIES

One entry per entity: what it is, what owns it, and the invariants it must satisfy. The authoritative field list is `03-data/schema.prisma`; this file explains *why* each entity exists and what must never be true of it.

---

## Identity

**User** — a person. Created on first Discord login, never by hand. Holds display identity, timezone, privacy settings and the `denyMask`. Deactivated (not deleted) when someone leaves Discord, so their content stays coherent.
*Invariants:* `handle` unique, case-insensitive · status ∈ `active|inactive|banned|left` · effective permissions derive only from roles minus `denyMask` (INV-001) · privacy defaults conservative (INV-027).

**DiscordIdentity** — the 1:1 link to a Discord account, carrying `discordId`, guild nickname and `guildRoles[]`. The freshness of `guildRoles` is what the whole authorization model rests on.
*Invariants:* `discordId` unique · tokens encrypted at rest (INV-012) · `guildRoles` refreshed by OAuth callback, gateway events **and** nightly reconciliation, because any single source drops events.

**CmdrVerification** — a claim that a user owns a CMDR, with the method and trust tier that proved it. Multiple rows per user over time; at most one active per CMDR name.
*Invariants:* `cmdrName` unique across non-revoked rows (INV-005) · `trustTier` 3/2/1 for cAPI/Inara/manual, recorded never inferred · `expiresAt = verifiedAt + 25d` for cAPI · Frontier tokens encrypted (INV-012) · expiry downgrades to stale, never revokes read access.

**Role** — a named permission bundle with a `permMask`. Editable data, not code.
*Invariants:* `key` unique · `permMask` stored `NUMERIC(40,0)`, never truncated (INV-006) · `isHierarchical=false` marks orthogonal tags, which confer no rank.

**RoleMapping** — Discord role ID → internal role, with a sync direction.
*Invariants:* no Discord snowflake in application code (INV-008) · deleting a mapped Discord role alerts admins rather than silently stripping permissions.

**UserRole** — a grant, with its source (`discord|manual|system`) and grantor. The source matters: a manual grant must survive the nightly Discord reconciliation, a `discord`-sourced grant must not.
*Invariants:* every change busts `perm:{userId}` and writes an audit row (INV-009).

**Session / RefreshTokenFamily** — an issued session and its rotating refresh chain. Reuse of a spent refresh token is treated as theft: the entire family is revoked.
*Invariants:* access 15 min, refresh 30 d rotating · replaying a used token kills the family · revocable individually from the profile's device list.

**DeviceToken** — a per-member bearer token for the EDMC plugin, scoped `telemetry:write`.
*Invariants:* encrypted at rest (INV-012) · individually revocable with a data purge offer · never a password, never reused across devices.

---

## Forum

**ForumCategory** — a node in the category tree carrying `viewPerm` and `postPerm` masks. **The ACL anchor for everything beneath it.**
*Invariants:* a user whose mask fails `viewPerm` must be unable to see, count or infer the category's existence (INV-002, INV-024) · `slug` unique.

**ForumThread** — a conversation, with a `kind` that makes it a domain object: `discussion|question|poll|announcement|ops|application`. An `ops` thread creates an operation; an `application` thread drives recruitment.
*Invariants:* `(categoryId, slug)` unique · soft-deleted only (INV-022) · inherits its category's ACL, and moving a thread re-indexes its RAG chunks (INV-003).

**ForumPost** — a message. Stores markdown **and** pre-rendered sanitized HTML, so rendering cost is paid once and sanitisation cannot be skipped at read time.
*Invariants:* HTML sanitized server-side before storage (INV-035) · soft delete with moderator tombstone (INV-022) · edits tracked with count and timestamp · every create/edit/delete enqueues a RAG re-index.

**ForumReaction / ForumSubscription** — per-user reactions and watch/track/mute levels per thread or category. Subscriptions drive notification fan-out to in-app, Discord DM and optional digest email.

**Report / ModerationAction** — a member-raised report and the officer action taken, with duration, reason and appeal thread.
*Invariants:* every moderation action audited (INV-009) · a ban carries a reason and an appeal route.

**Application** — the recruitment record: structured JSONB answers, state machine `submitted → interviewing → approved|rejected`, a 30-day probation timer on approval.
*Invariants:* lives in a Ring 2 category · the applicant can reach their own thread by ownership predicate, not by permission · approval grants the Discord role, and the site role follows from the sync.

---

## Game data — our mirror

**System** — a star system, keyed by `SystemAddress` (BigInt). Coordinates drive every "nearby" query.
*Invariants:* address is the key; names are display and search only (INV-018) · ambiguous names return candidates, never a guess · spatial index on (x,y,z) is not optional — it is the workhorse.

**Station** — a docking location, keyed by `marketId`. Includes fleet carriers, flagged `isCarrier`.
*Invariants:* `distanceToArrivalLs` and `maxLandingPad` are load-bearing for routing (INV-026) · carriers excluded from route results by default.

**MarketOrder** — current buy/sell state for one commodity at one market. Current state only; history lives elsewhere.
*Invariants:* PK `(marketId, commodity)` · upserts idempotent, older observations discarded (INV-017) · never surfaced without its age (INV-004).

**MarketHistory** — time series for sparklines. 90-day retention.
*Invariants:* append-only · retention enforced by job or Timescale (decision D10) · unbounded growth is the failure mode to prevent.

**Commodity** — the FDevIDs-sourced internal→display mapping plus category and rarity.
*Invariants:* internal names never reach a user (INV-020) · mapping comes from FDevIDs, never hand-written.

---

## Squadron operations

**Ship** — an instance of a ship owned by a member, with its role tag and current system. Sourced `manual|capi|edmc`; the source determines how much to trust it.
*Invariants:* owner-scoped writes · `synced_at` present for non-manual sources so staleness is visible.

**Loadout** — a build. Canonical form is the Coriolis/journal `Loadout` JSON; Coriolis and EDSY URLs are stored alongside. Cached computed stats make fleet queries possible.
*Invariants:* visibility `private|squadron|public` enforced in the data layer · `isDoctrine` set only by `FLEET_APPROVE_DOCTRINE` · cached stats invalidated when the build changes · public builds are opt-in.

**FleetCarrier** — a carrier keyed by callsign, with location, docking access, services, fuel and next jump.
*Invariants:* `CARRIER_MANAGE` scoped to owned carriers by row-level predicate · fuel and location sourced from cAPI (owner token) or EDDN, with `updatedAt` surfaced.

**Operation** — a scheduled activity with type, window, location, required roles and capacity.
*Invariants:* stored UTC, displayed local **and** UTC (INV-025) · capacity overflow becomes standby, never a rejection · Discord Scheduled Event kept in sync.

**OperationSignup** — a member's commitment, with ship, role and state `yes|maybe|no|standby`, and post-op attendance.
*Invariants:* PK `(operationId, userId)` · the selected ship must belong to the member · standby promotion is deterministic and ordered.

---

## BGS

**TrackedFaction** — a minor faction we care about, flagged `isOurs`.

**FactionInfluenceSnapshot** — influence and states for one faction, in one system, at one observation, associated to a tick.
*Invariants:* **one row per faction/system/tick — multiple EDDN reports of the same tick are deduplicated, never summed** (INV-019). This is the single most damaging thing to get wrong: a double-count corrupts the history that every chart, delta and decision reads.

**BgsTick** — a detected tick boundary with its source (community detector or inferred). Every snapshot associates to one.
*Invariants:* validated against 7 days of known ticks before anything is built on it · a tick that cannot be determined leaves snapshots unassociated rather than guessing.

**BgsOrder** — an officer directive per system: `push|hold|suppress|ignore`, with priority and written guidance. **The feature that converts casual players into effective contributors.**
*Invariants:* set only with `BGS_SET_ORDERS` · audited (INV-009) · time-bounded by `activeFrom`/`activeUntil`.

**BgsActivityReport** — a member's contribution: type, value, count, faction, system, tick, source `manual|edmc|bgstally`.
*Invariants:* negatives (murders, failed missions) tracked as first-class, because ignoring them makes the picture wrong · telemetry-sourced reports idempotent per journal event.

---

## AI

**AiConversation / AiMessage** — chat history per user per channel, including tool calls, arguments, results and token accounting.
*Invariants:* encrypted at rest · 90-day retention, user-deletable earlier · members see their own; officers may review.

**AiToolInvocation** — every tool call with its arguments, the permission checked and the outcome `ok|denied|error|needs_confirmation|cancelled`.
*Invariants:* **written for denials too** (INV-009) — a denial record is the evidence that the boundary held.

**KnowledgeChunk** — an embedded fragment of a source document, carrying the **source's visibility**.
*Invariants:* `visibility` is a security control, not metadata (INV-003) · filtered in the query before nearest-neighbour returns (INV-024) · re-indexed or deleted when the source's ACL changes · the embedding model is pinned forever; changing it invalidates every vector.

---

## Cross-cutting

**AuditLog** — append-only record of privileged actions with actor, action, target and before/after JSON.
*Invariants:* append-only, never updated or deleted by application code · 1-year retention · IP hashed, never plaintext.

**RouteJob** — an async Spansh job: parameters, hash, status, result location.
*Invariants:* deduped by parameter hash so two members asking the same question cost one upstream job · never awaited in a request (INV-032).

**Notification** — a fan-out record targeting in-app, Discord DM or email, with delivery state.
*Invariants:* delivery failure is retried and visible, never silently dropped.

**SiteConfig / FeatureFlag** — runtime configuration including the AI kill switches.
*Invariants:* changes require `SITE_CONFIG` and are audited · the AI write-disable and full-disable switches take effect immediately, without a deploy.
