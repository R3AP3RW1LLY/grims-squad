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

## ★ Ranks are not roles

This is the most important distinction in the squadron model, and getting it wrong would be a
security defect rather than a cosmetic one.

| | **Rank** | **Role** |
|---|---|---|
| What it is | The member's title in the squadron ladder | A bundle of permissions |
| Stored in | `squadron_ranks` / `rank_awards`, or computed from join date | `roles` / `user_roles` |
| Grants permissions? | **Only `leadership` and `reserved` ranks, via their mapped `roleKey`** | Yes, always |
| Visible as | A badge on the profile, forum posts, roster | Navigation and capability |

**Human decision, 2026-07-26: tenure and loyalty ranks are progression titles and grant nothing.**
Time served must never confer moderation power — a member of fourteen months is a *Grand Lord
General* and still cannot lock a thread. This is INV-046 and it is machine-checked.

---

## Rank ladder

### Standard ranks — automatic, by months in the squadron
Computed from `discord_identities.guildJoinedAt`. **Never stored per user**, so they cannot drift
from the truth. Cosmetic.

| Months | Rank | `order` |
|---:|---|---:|
| 1 | Sergeant | 10 |
| 2 | Master Sergeant | 20 |
| 3 | 2nd Lieutenant | 30 |
| 4 | 1st Lieutenant | 40 |
| 5 | Commander | 50 |
| 6 | Master Commander | 60 |
| 7 | General | 70 |
| 9 | Lord General | 80 |
| 12 | Grand Lord General | 90 |

> Note there is deliberately **no 8, 10 or 11-month rank** — the ladder steps 7 → 9 → 12, as
> specified. A member at 10 months holds *Lord General*.

### Loyalty ranks — officer-awarded
Granted by leadership at their discretion; **no automatic trigger**. A member holds at most one,
and awarding a higher one supersedes the lower. Recorded in `rank_awards`, audited, revocable.
Cosmetic.

| Rank | `order` |
|---|---:|
| GMSD: Loyalty I | 110 |
| GMSD: Loyalty II | 120 |
| GMSD: Loyalty III | 130 |
| GMSD: Loyalty IV | 140 |
| GMSD: Loyalty V | 150 |
| GMSD: Legend | 160 |

### Squadron leadership ranks — **permission-bearing**
Ascending: `Sector Overseer` is the entry leadership rank; `Squadron Leader` is the most senior.

| Rank | `order` | Maps to role | Ring |
|---|---:|---|---|
| 1st: Sector Overseer | 210 | `officer` | 2 |
| 2nd: First Commander | 220 | `officer` | 2 |
| 3rd: Chief Fleet Commander | 230 | `officer` | 2 |
| Squadron Leader | 240 | `commander` | 2 |

### Reserved ranks — **permission-bearing, single holder each**

| Rank | `order` | Held by | Maps to role | Ring |
|---|---:|---|---|---|
| Prime Legate | 900 | Second in command | `sysadmin` | 2+ |
| Galactic Admiral | 1000 | Grim — Community Leader | `sysadmin` | 2+ |

> **⚠ Two points to confirm — cosmetic if wrong, so not worth blocking on (decision D20).**
> 1. `Squadron Leader` is placed at the **top** of the leadership tier, above Chief Fleet
>    Commander. It was listed above the numbered ranks in the source, and "ascending" was
>    confirmed for the numbered three.
> 2. The three numbered leadership ranks all map to `officer`. If Chief Fleet Commander or First
>    Commander should additionally hold `ROLE_MANAGE`, say so — it is a one-line seed change.

---

## Internal roles

The permission bundles. **Ranks map onto these; nothing else does.** Each is editable in the
admin console. `rankOrder` here is display precedence only — **it confers nothing**.

| Key | Name | Order | Ring | Held by which rank | Purpose |
|---|---|---|---|---|---|
| `guest` | Guest | 0 | 0 | — | Unauthenticated baseline. Never stored against a user. |
| `applicant` | Recruit | 10 | 0.5 | — | Application in flight. Public forum and their own applicant thread. |
| `member` | Squadron Member | 20 | 1 | **every tenure and loyalty rank** | The main body. Everything the squadron does day to day. |
| `wing_lead` | Wing Leader | 30 | 1.5 | *(orthogonal — see below)* | Member plus creating and running operations. |
| `officer` | Officer | 40 | 2 | Sector Overseer · First Commander · Chief Fleet Commander | Moderation, member management, BGS orders, audit visibility. |
| `commander` | Command | 50 | 2 | Squadron Leader | Officer plus role management. |
| `sysadmin` | Admin | 60 | 2+ | Prime Legate · Galactic Admiral | Site configuration, integration keys, the AI kill switch. |

**`wing_lead` is not a rank.** It is an appointment — a member trusted to run ops — and is granted
independently of the ladder. A *Sergeant* can be a wing lead; a *Grand Lord General* need not be.
The role's name was `commander` in the original model and is renamed **`command`** in display
only, because *Commander* is now a five-month tenure rank and the collision would be actively
confusing on a profile page.

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

## Founding standing

Non-hierarchical, and **`permMask` is zero on every one of them**. Founding standing is honour, not
authority: every holder already has whatever they may do through a Discord rank or the `webmaster`
role, and a title that quietly granted permissions would be a privilege escalation dressed as a
roster tab.

Squadron owner, 2026-08-04: a Founders tab on `/roster`, a founding title on the card in place of
the site ones, and a fixed order at the top of the roster.

| Key | Name | Order | On the Founders tab | Purpose |
|---|---|---|---|---|
| `founder` | Founder | 800 | yes | Founded the squadron. The #1 spot on the roster, outright. |
| `co_founder` | Co-Founder | 810 | yes | Co-founded the squadron. Directly after the founder. |
| `hub_founder` | Founder | 820 | **no** | Founding standing on the hub, titled Founder. Pinned directly after the squadron's founders. |

**Ascending, like the leadership tier** — the lowest number is the most senior, and the reverse of
the tenure ladder. The 800s are their own band so the roles console can group them: the 900s are
"everyone who holds no ladder rank", which the founders are not, and the 1000s are website roles
that "confer every permission on this site and no standing in the squadron whatsoever", which is
the opposite of what these are.

**`hub_founder` exists because the owner's instruction holds two facts at once.** Pebblemerchant's
card "should say founder", and the tab gets "only these people" — four names, theirs not among
them — with Pebblemerchant placed *after* the founders. One role could carry only one of those.

**No `role_mappings` row for any of them.** There is no Discord role behind founding standing, so
role sync can neither grant nor revoke it; the grants carry source `system` and survive the nightly
reconciliation. Seeded and granted by `20260805180000_founding_roles`; the title is `roles.name` and
the roster order is `roles.rank_order`, so both are edited on the roles console rather than deployed.
What lives in source is only the set of **keys** — `apps/api/src/members/founding.ts`.

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
- **`applicant` gets no `FORUM_VIEW_MEMBER`.** Recruits see the public forum and *their own application conversation*.

  > **That conversation is a SEPARATE thread in a separate category, and the distinction is a
  > security control.** An earlier revision gave the applicant an ownership-predicate hole
  > through the Ring 2 *Applications* category — which is exactly where officers conduct candid
  > deliberation, at thread granularity with no post-level scoping. The applicant would have read
  > the officers' assessment of their own application, and INV-002's "physically incapable"
  > guarantee would have acquired an unbounded carve-out that a second and third feature would
  > copy (RED-TEAM R2).
  >
  > **The model instead:** `Application` links **two** threads. `deliberationThreadId` lives in
  > Ring 2 Applications and the applicant can never see it. `applicantThreadId` lives in a
  > dedicated public-tier *Application Conversation* category whose rows are scoped by an
  > ownership predicate. Officers post to whichever they intend; nothing bridges them
  > automatically.
- **`guest` holds only `FORUM_VIEW_PUBLIC`** and is never persisted as a role row.
- **No tenure or loyalty rank appears in this table at all**, and that is the point. Every member
  from *Sergeant* to *Grand Lord General* to *GMSD: Legend* holds exactly the `member` bundle.
  Their rank changes their badge, their sort order on the roster and nothing else (INV-046).

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
