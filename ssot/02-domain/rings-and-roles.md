# RINGS, ROLES AND PERMISSIONS

## Rings are shorthand, not storage

"Ring 0/1/2" names a permission threshold for humans talking about the product. **It is never a stored value and never a check in code.** Every access decision is a permission-mask test (ADR-005, INV-001). If you find yourself writing `if (user.ring >= 1)`, you have made an error.

| Ring | Who | Reached by holding |
|---|---|---|
| 0 | Anonymous public | nothing |
| 0.5 | Applicant | `FORUM_VIEW_PUBLIC` + `FORUM_POST_PUBLIC` and an open application |
| 1 | Verified member | `FORUM_VIEW_MEMBER` |
| 1.5 | Wing lead | Ring 1 + `OPS_CREATE` |
| 2 | Officer / leadership | `FORUM_VIEW_OFFICER` |
| 2+ | Sysadmin | `SITE_CONFIG` |

## Internal roles

Hierarchical roles. Each is a named bundle of permissions, editable in the admin console. `rankOrder` is display and precedence only — **it confers nothing**.

| Key | Name | Rank | Ring | Purpose |
|---|---|---|---|---|
| `guest` | Guest | 0 | 0 | The unauthenticated baseline. Not stored against a user; it is the empty-mask default. |
| `applicant` | Recruit | 10 | 0.5 | Application in flight. Public forum, own application thread, nothing else. |
| `member` | Squadron Member | 20 | 1 | The main body. Everything the squadron does day to day. |
| `wing_lead` | Wing Leader | 30 | 1.5 | Member plus the ability to create and run operations. |
| `officer` | Officer | 40 | 2 | Moderation, member management, BGS orders, audit visibility. |
| `commander` | Squadron Leader | 50 | 2 | Officer plus role management. |
| `sysadmin` | Admin | 60 | 2+ | Site configuration, integration keys, the AI kill switch. |

## Orthogonal tags

Non-hierarchical (`isHierarchical = false`). They grant specific permissions and drive notification routing and ops matchmaking. **They never imply rank** — a `carrier_owner` who is an `applicant` is still an applicant.

| Key | Name | Grants | Also used for |
|---|---|---|---|
| `bgs_team` | BGS Team | `BGS_REPORT` + post rights in BGS Intelligence | Tick digest routing, BGS order consultation |
| `carrier_owner` | Carrier Owner | `CARRIER_MANAGE` for owned carriers | Jump-schedule notifications, cAPI carrier import |
| `miner` | Miner | — | Ops matchmaking, mining op notifications |
| `combat_wing` | Combat Wing | — | CZ/AX op matchmaking |
| `explorer` | Explorer | — | Exploration op matchmaking, codex features |

Ownership scoping (`CARRIER_MANAGE` applying only to carriers you own) is a **row-level ownership predicate in the data layer**, not a separate permission. The mask says "may manage carriers"; the repository says "these carriers".

## Discord mapping

`role_mappings` maps Discord role IDs to internal roles. **It is data, not code** (INV-008) — no Discord snowflake appears in application source.

| Internal role | Typical Discord role | Sync direction |
|---|---|---|
| `applicant` | `@Recruit` | both |
| `member` | `@Squadron Member` | both |
| `wing_lead` | `@Wing Leader` | inbound |
| `officer` | `@Officer` | inbound |
| `commander` | `@Squadron Leader` | inbound |
| `sysadmin` | `@Admin` | inbound |
| `bgs_team` | `@BGS Team` | both |
| `carrier_owner` | `@Carrier Owner` | both |
| `miner` | `@Miner` | both |
| `combat_wing` | `@Combat Wing` | both |
| `explorer` | `@Explorer` | both |

`sync_direction`: `inbound` — Discord is authoritative, site changes do not push back. `outbound` — site is authoritative. `both` — either surface may grant, and the bot reconciles.

Rank-conferring roles default to `inbound` so that promotion happens in Discord, where officers already work. Tags are `both` so a member can self-select an interest on the site.

> **⚠ These Discord role names are the spec's *examples*, not the squadron's actual structure.** The real names and IDs are decision **D2** in `STATUS.md` and must be supplied before P1.3. Seeding this table with guessed IDs would silently grant or withhold access.

## Permission bundles per role

Authoritative form is `ROLE_PRESETS` in `04-contracts/permissions.ts`. This table is the human-readable mirror; if they disagree, the TypeScript wins.

| Permission | guest | applicant | member | wing_lead | officer | commander | sysadmin |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `FORUM_VIEW_PUBLIC` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `FORUM_POST_PUBLIC` | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `FORUM_VIEW_MEMBER` | | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `FORUM_POST_MEMBER` | | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `FORUM_VIEW_OFFICER` | | | | | ✓ | ✓ | ✓ |
| `FORUM_POST_OFFICER` | | | | | ✓ | ✓ | ✓ |
| `FORUM_MODERATE` | | | | | ✓ | ✓ | ✓ |
| `OPS_VIEW` | | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `OPS_SIGNUP` | | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `OPS_CREATE` | | | | ✓ | ✓ | ✓ | ✓ |
| `OPS_MANAGE` | | | | | ✓ | ✓ | ✓ |
| `FLEET_VIEW` | | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `FLEET_EDIT_OWN` | | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `FLEET_APPROVE_DOCTRINE` | | | | | ✓ | ✓ | ✓ |
| `CARRIER_VIEW` | | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `CARRIER_MANAGE` | | | | | ✓ | ✓ | ✓ |
| `BGS_VIEW` | | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `BGS_REPORT` | | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `BGS_SET_ORDERS` | | | | | ✓ | ✓ | ✓ |
| `TRADE_QUERY` | | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `TRADE_SAVE_ROUTE` | | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `TRADE_MANAGE_ALERTS` | | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `AI_CHAT` | | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `AI_TOOLS_READ` | | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `AI_TOOLS_WRITE` | | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `AI_TOOLS_ADMIN` | | | | | | | ✓ |
| `MEMBER_MANAGE` | | | | | ✓ | ✓ | ✓ |
| `ROLE_MANAGE` | | | | | | ✓ | ✓ |
| `AUDIT_VIEW` | | | | | ✓ | ✓ | ✓ |
| `SITE_CONFIG` | | | | | | | ✓ |
| `TELEMETRY_WRITE` | | | ✓ | ✓ | ✓ | ✓ | ✓ |

Notes on non-obvious placements:
- **`AI_TOOLS_WRITE` is a member permission.** It gates *whether the AI may attempt* a mutating tool at all; the tool's own permission (e.g. `BGS_SET_ORDERS`) still gates the action, and confirmation is still required (INV-014). A member can therefore have the AI sign them up for an op but not set a BGS order.
- **`FORUM_POST_OFFICER` and `FLEET_APPROVE_DOCTRINE` and `TRADE_MANAGE_ALERTS` are additions to the spec's list**, needed because the spec describes officer-only posting, doctrine approval and per-member alerts as behaviours without naming permissions for them. Recorded here so the addition is visible rather than silent.
- **`applicant` gets no `FORUM_VIEW_MEMBER`.** Recruits see the public forum and their own application thread. That thread is reachable through a row-level ownership predicate, not a permission.
- **`guest` holds only `FORUM_VIEW_PUBLIC`** and is never persisted as a role row.

## Forum category tree and its permissions

Enforced through `forumCategory.viewPerm` / `postPerm` and the ADR-005 data layer.

```
PUBLIC
├── Announcements                        view: FORUM_VIEW_PUBLIC   post: FORUM_MODERATE
├── Recruitment & Introductions          view: FORUM_VIEW_PUBLIC   post: FORUM_POST_PUBLIC
├── Open Comms (general ED chat)         view: FORUM_VIEW_PUBLIC   post: FORUM_POST_PUBLIC
├── Guides & Tutorials                   view: FORUM_VIEW_PUBLIC   post: FORUM_POST_MEMBER
└── Squadron Log (AARs)                  view: FORUM_VIEW_PUBLIC   post: FORUM_POST_OFFICER

MEMBERS ONLY
├── Squadron Hall                        view: FORUM_VIEW_MEMBER   post: FORUM_POST_MEMBER
├── Operations Planning                  view: FORUM_VIEW_MEMBER   post: FORUM_POST_MEMBER
├── BGS Intelligence                     view: FORUM_VIEW_MEMBER   post: BGS_REPORT
├── Shipyard & Loadouts                  view: FORUM_VIEW_MEMBER   post: FORUM_POST_MEMBER
├── Trade Intel & Route Sharing          view: FORUM_VIEW_MEMBER   post: FORUM_POST_MEMBER
├── Carrier Services                     view: FORUM_VIEW_MEMBER   post: FORUM_POST_MEMBER
├── Exploration Logs                     view: FORUM_VIEW_MEMBER   post: FORUM_POST_MEMBER
└── Off-Topic / The Bar                  view: FORUM_VIEW_MEMBER   post: FORUM_POST_MEMBER

OFFICERS
├── Command Deck                         view: FORUM_VIEW_OFFICER  post: FORUM_POST_OFFICER
├── Applications                         view: FORUM_VIEW_OFFICER  post: FORUM_POST_OFFICER
├── Member Concerns                      view: FORUM_VIEW_OFFICER  post: FORUM_POST_OFFICER
└── Site & Infrastructure                view: SITE_CONFIG         post: SITE_CONFIG
```

"Open Comms — post: verified" in the spec is implemented as `FORUM_POST_PUBLIC`, which applicants hold; CMDR verification is surfaced as a badge rather than a posting gate, since gating general chat on a ~25-day cAPI ceremony would be hostile. If the squadron wants a hard verification gate there, that is a permission change plus a seed change, not a code change.

## Permission cache

Computed mask cached in Redis at `perm:{userId}`, TTL 5 minutes. **Busted on:** `guildMemberUpdate`, any `user_roles` change, any `roles.permMask` change, any `role_mappings` change, and any `users.denyMask` change. A stale mask that grants too much is a security defect, so every one of those paths must bust; the nightly reconciliation is the backstop for a missed gateway event.
