# KEY SCREENS

Each entry: purpose, layout, the states that must be designed (**empty, loading, error and degraded are not optional**), and the phase that ships it.

Mobile priority, since ~40% of traffic is phones on a second screen mid-session:
**High** — dashboard, ops signup, forum reading, trade lookup, GSAI chat.
**Low** — galaxy map, loadout editor, BGS charts.

---

## 1. Dashboard — `/` (authenticated) · P1 → P4 → P5

**The retention screen.** A member opens it to find out what to do tonight. If it does not answer that in three seconds, they go back to Discord.

```
┌──────────────────────────────────────────────────────────────┐
│ AM I NEEDED?   ← one line, the single most important thing    │
├───────────────────────────────┬──────────────────────────────┤
│ TONIGHT'S BGS ORDERS          │ NEXT OPERATION               │
│ 1. Ross 128    PUSH           │ Mining · 20:00 UTC / 21:00 BST│
│    "massacre missions, not    │ 6/8 signed up                 │
│     bounties"                 │ ✓ your Python qualifies       │
│ 2. Eravate     HOLD           │ [ Sign up ]                   │
│ Last tick 17:04 UTC           │                               │
├───────────────────────────────┼──────────────────────────────┤
│ YOUR SHIP · YOUR SYSTEM       │ CARRIER · K7Q-B4X            │
│ Python "Grim Hauler"          │ Shinrarta Dezhra              │
│ Shinrarta Dezhra              │ ⚠ 8,000 t short for Saturday  │
├───────────────────────────────┴──────────────────────────────┤
│ UNREAD · 3 threads                    [ ⌘K  Ask GSAI ]        │
└──────────────────────────────────────────────────────────────┘
```

| State | Behaviour |
|---|---|
| Empty | "Nothing specific needed tonight" — **a real answer, not a blank panel** |
| No verified CMDR | Prominent "verify your CMDR" card explaining what it unlocks |
| Tick not yet detected | "Awaiting tick" — **never show a stale delta as current** |
| Telemetry not connected | One-line prompt with the value proposition, dismissible |
| GSAI offline | Prompt bar still present, labelled `OFFLINE`, falls back to templated answers |

---

## 2. Public landing — `/` (anonymous) · P1

Full-bleed hero with a starfield (CSS/canvas parallax on mobile, Three.js on desktop), motto, and a live stat ticker from **our own database**:

```
▸ 47 COMMANDERS   ▸ 3 FLEET CARRIERS   ▸ 128.4 Bn CR EARNED
▸ 1,204 SYSTEMS VISITED   ▸ 61.2% INFLUENCE IN SHINRARTA   ▸ NEXT OP 19:30 UTC
```

Sections: who we are · factions & territory (public-safe granularity) · divisions with per-division apply CTAs · GalNet feed in-universe styled · public leaderboard (**opt-in per member**) · squadron log · live activity ticker (**opt-in, privacy-toggled**).

| State | Behaviour |
|---|---|
| Empty stats (fresh install) | Show the sections; suppress zeroed counters rather than displaying "0 COMMANDERS" |
| GalNet unavailable | Section omitted entirely, not a broken panel |
| Reduced motion | Static hero, no parallax, no boot sequence |

**Performance budget: <1.5 s load, Lighthouse a11y ≥95.** This is the recruitment funnel's front door.

---

## 3. Forum — `/forum` · P2

Category tree → thread list → thread. **~70ch reading measure.** Sticky reply composer. Rich ED embeds fill the P2.9 extension point in P3.

| State | Behaviour |
|---|---|
| Ring 0 viewer | **Gated categories are absent — not greyed, not counted.** A Ring 0 user must be unable to infer they exist (INV-002) |
| Search, zero results | "No matching posts" — identical whether nothing matched or matches were inaccessible (INV-024) |
| Deleted post | Moderator sees a tombstone with the reason; everyone else sees nothing |
| Locked thread | Composer replaced by the lock reason |
| Upload failed | The specific reason (`too_large`, `polyglot_detected`), never a generic failure |

---

## 4. Trade terminal — `/trade` · P6

Split pane: filters left, results right, route detail in a bottom drawer.

Filters: origin · jump range · cargo · credits · min pad · max Ls · max ly · include carriers · **data-age slider** · avoid anarchy · avoid permit-locked · end at one of our carriers.

**Every result row carries a freshness badge** — icon, colour and literal age.

| State | Behaviour |
|---|---|
| **No routes** | Name the **binding constraint** and suggest a relaxation. "No results" alone is a dead end. |
| All data stale | Show it in `stale` red with the age — **never hide it** |
| Spansh job running | Inline progress; **the UI never blocks** (INV-032) |
| Spansh unavailable | Job queued, status honest, own-DB routes still work |
| Mobile | Filters collapse to a sheet; results become cards; the table scrolls in its own container |

---

## 5. BGS console — `/bgs` · P4

Influence time-series with tick markers · sortable system grid (our influence, top competitor, delta, states, conflict) · orders sidebar.

| State | Behaviour |
|---|---|
| **Inferred tick** | Marker rendered **provisional** with `confidence` shown. A guessed tick presented as certain poisons every delta. |
| Insufficient history | Chart shows what exists; **no extrapolation** |
| No orders set | Officers see "set orders"; members see "nothing specific tonight" |
| Colour-blind | Delta arrows and signed numbers, never colour alone |

---

## 6. Ops board — `/ops` · P5

Month / week / agenda views. **Every time in local and UTC** (INV-025). Signup panel with ship selection from the member's **actual fleet**. Wing-composition widget: *"needs 2 more shieldless miners; 3 members have a qualifying build."*

| State | Behaviour |
|---|---|
| At capacity | Signup becomes **standby with a position**, never a rejection |
| Member has no ships | "Add a ship" or "connect EDMC", not an empty dropdown |
| Stale fleet data | `synced_at` shown so a member notices they might pick a ship they sold |
| Op cancelled | Struck through with the reason, retained in the calendar |

---

## 7. Loadout Locker — `/shipyard` · P7

Card grid → detail with a stat radar chart and comparison mode (up to four, delta-highlighted). Doctrine builds badged and pinned.

| State | Behaviour |
|---|---|
| Import failed | Which of the four formats was attempted and why it failed |
| Coriolis container down | Stored builds, stats and comparison **all still work** — only new building stops |
| Private build | Absent from listings entirely, not shown-and-locked |
| Stats stale after edit | Recomputed on save; a pending recompute is shown as pending, not as old numbers |

---

## 8. GSAI panel — ⌘K, every page · P8

Slide-over. Page context injected — on a system page, *"what's the market here"* needs no system name. Streaming tokens, tool calls as collapsible cards, confirmations as inline buttons.

| State | Behaviour |
|---|---|
| Fast path | Answer in <200 ms with **no "thinking" indicator** — it did not think |
| Agent loop | Tool cards appear as they run: "Checking market data…" |
| **Confirmation required** | Inline preview + confirm/cancel. **Never auto-executes** (INV-014) |
| **Denied** | States the permission needed and who can grant it. **The denial is shown, not hidden** |
| `DEGRADED` | Queue position and an honest estimate |
| `OFFLINE` | Says so. Read queries return templated answers; chat queues with "we'll DM you on Discord" |
| Step limit | Honest partial answer, never a fabricated summary |
| Every message | Feedback control — a wrong answer is reported in one click |

---

## 9. Member profile — `/members/:handle` · P1, P8

CMDR dossier: verified name and trust tier · ranks · Powerplay · division · playstyle tags · fleet · builds · ops attended · BGS contribution · GitHub-style activity heatmap · achievements.

| State | Behaviour |
|---|---|
| **Private fields** | **Absent from the response and the page** — not greyed out, which would confirm they exist (INV-027) |
| Unverified CMDR | Badge shows the tier; no dossier fabricated from a Discord nickname |
| Own profile | Privacy toggles inline, with a plain-English statement of what each shares |
| Former member | Content retained and attributed to "former member"; profile is a tombstone |

---

## 10. Admin console — `/admin` · P1, P11

Member management · role/permission editor with a **live "who does this affect?" preview** · Discord mapping editor · moderation queue · audit log with diffs · feature flags · site config · **health dashboard** (EDDN lag, adapter latency, queue depth, GSAI status, DB size, disk) · backup status.

| State | Behaviour |
|---|---|
| Role edit | Preview lists **exactly which members gain or lose which permissions** before saving |
| Mapping missing | Prominent warning — unmapped Discord roles silently grant nothing |
| Adapter circuit open | Named in the health panel with the last error, not just red |
| Retention job failed | Surfaced — **a silently failing retention job is invisible until the disk is full** |

---

## 11. Recruitment application — `/apply` · P2

Turnstile-protected, single page, progress indicator. Fields per `04-contracts/openapi.yaml` `ApplicationRequest`.

| State | Behaviour |
|---|---|
| Submitted | What happens next and roughly when — **silence is how applicants drift away** |
| Duplicate | "You already have an application in progress", with its status |
| Turnstile failed | Retry, never a dead end |
| Rejected | Handled privately, never a public state |

---

## 12. Galaxy map — `/map` · P9

3D sphere of influence, coloured by influence %, clickable systems. **2D fallback for low-end devices, and deprioritised on mobile.** Explicitly not an attempt to replicate the in-game map (`scope.md`).

---

## Cross-cutting requirements

| Requirement | Applies to |
|---|---|
| **Empty, loading, error and degraded states designed** | every screen — they are the majority of a real session |
| **Copy-to-clipboard on every system name** | everywhere |
| **Local + UTC on every timestamp** | everywhere (INV-025) |
| **Freshness badge on every market value** | everywhere (INV-004) |
| **Keyboard reachable, visible focus** | everywhere |
| **44px touch targets** | everywhere |
| **Tabular figures on every number** | everywhere |
| **Frontier attribution in the footer** | every page (INV-029) |
| **⌘K command palette** | every page |
