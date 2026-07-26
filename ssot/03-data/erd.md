# ENTITY RELATIONSHIP DIAGRAMS

Split by domain — one diagram of 54 models is unreadable. `User` and `System` appear in several diagrams because they are the two hubs.

Authoritative field lists are in `schema.prisma`. These show *shape and direction*, with only the keys and the fields that carry meaning.

---

## Identity & authorization

```mermaid
erDiagram
    User ||--o| DiscordIdentity : "1:1"
    User ||--o| PrivacySetting : "1:1"
    User ||--o{ CmdrVerification : "claims over time"
    User ||--o{ UserRole : holds
    User ||--o{ RefreshTokenFamily : "sessions"
    User ||--o{ DeviceToken : "EDMC plugin"
    Role ||--o{ UserRole : "granted via"
    Role ||--o{ RoleMapping : "mapped from Discord"
    RefreshTokenFamily ||--o{ RefreshToken : "rotating chain"

    User {
        uuid id PK
        citext handle UK
        decimal deny_mask "NUMERIC(40,0) - beats every grant"
        enum status "active|inactive|banned|left"
    }
    DiscordIdentity {
        uuid user_id PK,FK
        text discord_id UK
        text_array guild_roles "needs SERVER MEMBERS intent"
        bytea refresh_token_enc "AES-256-GCM"
    }
    CmdrVerification {
        uuid id PK
        citext cmdr_name "partial-unique WHERE revoked_at IS NULL"
        enum method "fdev_capi|inara_nonce|officer_manual"
        smallint trust_tier "3|2|1"
        timestamptz expires_at "verified_at + 25d for cAPI"
        bool is_stale
    }
    Role {
        uuid id PK
        text key UK
        decimal perm_mask "NUMERIC(40,0)"
        bool is_hierarchical "false = orthogonal tag"
    }
    RoleMapping {
        text discord_role_id PK "the ONLY place a snowflake lives"
        enum sync_direction "inbound|outbound|both"
    }
    UserRole {
        enum source "discord|manual|system"
    }
    RefreshToken {
        text token_hash UK "SHA-256; reuse kills the family"
        timestamptz used_at
    }
    DeviceToken {
        text token_hash UK
        text_array scopes "telemetry:write"
    }
```

**Effective permission mask = OR(Role.perm_mask for each UserRole) AND NOT User.deny_mask.** Nothing else grants (INV-001).

---

## Forum & recruitment

```mermaid
erDiagram
    ForumCategory ||--o{ ForumCategory : "nested tree"
    ForumCategory ||--o{ ForumThread : contains
    ForumThread ||--o{ ForumPost : contains
    ForumPost ||--o{ ForumPost : "threaded replies"
    ForumPost ||--o{ ForumReaction : has
    ForumPost ||--o{ PostRevision : "edit history"
    ForumThread ||--o{ ForumSubscription : "watched via"
    ForumCategory ||--o{ ForumSubscription : "watched via"
    ForumThread ||--o| Application : "kind=application"
    ForumThread ||--o| Operation : "kind=ops"
    User ||--o{ ForumThread : authors
    User ||--o{ ForumPost : authors
    User ||--o| Application : submits

    ForumCategory {
        uuid id PK
        text slug UK
        decimal view_perm "THE ACL anchor"
        decimal post_perm
    }
    ForumThread {
        uuid id PK
        enum kind "discussion|question|poll|announcement|ops|application"
        bool is_pinned
        timestamptz deleted_at "soft delete only"
    }
    ForumPost {
        uuid id PK
        text body_md
        text body_html "sanitized server-side before storage"
        tsvector search_tsv "GENERATED ALWAYS"
        timestamptz deleted_at "soft delete only"
    }
    Application {
        uuid id PK
        enum state "submitted|interviewing|approved|rejected|withdrawn"
        json answers "structured, so the funnel is reportable"
        timestamptz probation_ends_at "decided_at + 30d"
    }
```

**Every read of a thread or post is filtered by its category's `view_perm` in the data layer, not the controller** (INV-002).

---

## Game data — our EDDN mirror

```mermaid
erDiagram
    System ||--o{ Station : contains
    Station ||--o{ MarketOrder : "current prices"
    Station ||--o| FleetCarrier : "is_carrier"
    MarketOrder }o--|| ReferenceName : "commodity internal name"

    System {
        bigint address PK "SystemAddress - THE key, not the name"
        citext name "~1300 are ambiguous"
        float x
        float y
        float z
        bool is_tracked "inside the EDDN prefilter radius"
    }
    Station {
        bigint market_id PK
        bool is_carrier "excluded from routes by default"
        float distance_to_arrival_ls "ignoring this yields 200000 Ls routes"
        smallint max_landing_pad "1|2|3"
        text_array services "GIN indexed"
    }
    MarketOrder {
        bigint market_id PK,FK
        text commodity PK "FDevIDs internal name"
        int buy_price "station sells TO you"
        int sell_price "station buys FROM you"
        timestamptz updated_at "the age every UI must show"
    }
    MarketHistory {
        bigint id PK
        timestamptz observed_at "90-day retention"
    }
    ReferenceName {
        enum kind PK "commodity|module|ship|rare_commodity"
        text internal_name PK "never shown to a user"
        text display_name
    }
```

`MarketHistory` has no foreign keys by design — it is a high-volume append-only series, and FK checks on every insert would slow the collector's batch writes.

---

## Fleet, loadouts & operations

```mermaid
erDiagram
    User ||--o{ Ship : owns
    Ship ||--o{ Loadout : "fitted with"
    Loadout ||--o{ LoadoutRevision : versions
    Loadout ||--o{ LoadoutComment : "discussed in"
    User ||--o{ FleetCarrier : owns
    User ||--o{ Operation : creates
    Operation ||--o{ OperationSignup : "filled by"
    Ship ||--o{ OperationSignup : "flown in"
    System ||--o{ Operation : "located at"
    Station ||--o{ Operation : "located at"
    FleetCarrier ||--o{ HaulingTarget : "fuel drives"
    HaulingTarget ||--o{ HaulingContribution : "delivered by"

    Ship {
        uuid id PK
        text ship_type "FDevIDs internal name"
        enum source "manual|capi|edmc"
        timestamptz synced_at "makes staleness visible"
    }
    Loadout {
        uuid id PK
        json coriolis_json "canonical build document"
        enum visibility "private|squadron|public"
        bool is_doctrine "officer-approved standard"
        json stats "cached: jump range, DPS, shields, rebuy"
    }
    FleetCarrier {
        text callsign PK "K7Q-B4X"
        int fuel_level "tritium tons"
        timestamptz next_jump_at
    }
    Operation {
        uuid id PK
        timestamptz starts_at "UTC; displayed local AND UTC"
        enum status "draft|scheduled|live|complete|cancelled"
        int capacity "overflow becomes standby"
    }
    OperationSignup {
        enum state "yes|maybe|no|standby"
        bool attended "NULL until complete"
    }
```

---

## BGS

```mermaid
erDiagram
    TrackedFaction ||--o{ FactionInfluenceSnapshot : "measured by"
    System ||--o{ FactionInfluenceSnapshot : "measured in"
    BgsTick ||--o{ FactionInfluenceSnapshot : "associated to"
    BgsTick ||--o{ BgsActivityReport : "associated to"
    TrackedFaction ||--o{ BgsOrder : "targeted by"
    System ||--o{ BgsOrder : "targeted in"
    User ||--o{ BgsOrder : sets
    User ||--o{ BgsActivityReport : contributes
    TrackedFaction ||--o{ BgsActivityReport : "credited to"

    TrackedFaction {
        uuid id PK
        text name UK
        bool is_ours "our player minor faction"
    }
    BgsTick {
        uuid id PK
        timestamptz occurred_at UK
        enum source "community_detector|inferred|manual"
        float confidence "inferred ticks must be labelled"
    }
    FactionInfluenceSnapshot {
        uuid id PK
        float influence "0.0-1.0"
        text_array pending_states
        text_array recovering_states
    }
    BgsOrder {
        uuid id PK
        enum directive "push|hold|suppress|ignore"
        smallint priority "1 = highest"
        text guidance_md "the officer's actual instruction"
    }
    BgsActivityReport {
        uuid id PK
        enum activity_type "includes murders and failed_missions"
        bigint value_cr
        text source_event_id "idempotency for telemetry"
    }
```

**`FactionInfluenceSnapshot` is unique on `(faction, system, tick)`** — plus a partial unique index for the NULL-tick case. Multiple EDDN reports of one tick deduplicate; they are never summed (INV-019). Getting this wrong corrupts every chart and every officer decision downstream.

---

## AI & telemetry

```mermaid
erDiagram
    User ||--o{ AiConversation : has
    AiConversation ||--o{ AiMessage : contains
    AiConversation ||--o{ AiToolInvocation : "produced"
    User ||--o{ AiToolInvocation : "invoked as"
    User ||--o{ TelemetryEvent : generates
    DeviceToken ||--o{ TelemetryEvent : "authenticated by"

    AiConversation {
        uuid id PK
        text channel "web|discord"
        timestamptz created_at "90-day retention"
    }
    AiMessage {
        enum role "system|user|assistant|tool"
        text served_by "interactive|heavy|fast_path"
    }
    AiToolInvocation {
        uuid id PK
        json args
        decimal permission_checked "which gate ran"
        enum outcome "ok|denied|error|needs_confirmation|cancelled"
    }
    KnowledgeChunk {
        uuid id PK
        enum source_type "forum_post|wiki|doctrine|loadout|guide|galnet|aar"
        uuid source_id "re-index target on ACL change"
        enum visibility "SECURITY CONTROL - mirrors source ACL"
        vector embedding "HNSW, cosine"
    }
    TelemetryEvent {
        bigint id PK
        enum category "opt-in, server-enforced"
        timestamptz occurred_at "journal time, not receipt time"
        text event_key UK "idempotency"
    }
```

**`KnowledgeChunk` has no foreign key to its source** — sources are polymorphic across seven types. That makes the re-index-on-ACL-change job (INV-003) a *hand-written correctness obligation* rather than something the database enforces, which is exactly why it has a dedicated test and a tier-3 risk classification.

**`AiToolInvocation` rows are written for denials too.** A `denied` row is the evidence the boundary held, not an error to suppress (INV-009).

---

## Cross-cutting

```mermaid
erDiagram
    User ||--o{ AuditLog : "actor of"
    User ||--o{ Notification : receives
    User ||--o{ RouteJob : submits
    User ||--o{ SavedRoute : keeps
    User ||--o{ TradeAlert : sets
    User ||--o{ TradeBoardOffer : posts
    User ||--o{ AchievementAward : earns
    Achievement ||--o{ AchievementAward : "awarded as"

    AuditLog {
        bigint id PK
        enum actor_type "user|bot|ai|system"
        json before
        json after
        text ip_hash "hashed, never plaintext"
    }
    RouteJob {
        uuid id PK
        text param_hash "dedupe: one upstream job per question"
        enum status "queued|submitted|polling|complete|failed|cancelled"
        text result_key "object storage, not Postgres"
    }
    IdempotencyKey {
        text key PK
        text request_hash "same key + different body = conflict"
        json response_body
    }
    SiteConfig {
        text key PK
        json value "includes the AI kill switches"
    }
```

`AuditLog` is append-only. `IdempotencyKey` and `SiteConfig` have no relations by design — they are infrastructure, not domain.
