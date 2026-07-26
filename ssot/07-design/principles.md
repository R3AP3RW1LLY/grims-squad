# DESIGN PRINCIPLES

## The direction

Elite Dangerous has one of the strongest UI identities in gaming. **Lean into it without ripping HUD assets** — those are Frontier's IP (`00-charter/constraints.md`). The aesthetic is recreated from `tokens.json`, never extracted from the game client.

The reference is the **cockpit UI**: dense information panels, hairline borders, angular corner cuts, tabular numerals, orange on deep space. The reference is *not* a sci-fi movie interface — no rotating wireframes, no gratuitous readouts, nothing that looks impressive in a screenshot and is useless at 02:00 when a member wants a tritium price.

## Principles, in priority order

### 1. Information density is a feature, not a problem
Members are pilots reading instruments. They want the number, its age, and what to do about it — **not whitespace**. Data tables are first-class citizens: sortable, filterable, virtualised, keyboard-navigable, with tabular figures on every numeral.

Where a mainstream product would show three cards, show a table with twelve rows.

### 2. Every number carries its provenance
This is INV-004 expressed as a design rule. A price without an age is not a design decision, it is a defect. The freshness badge is part of the number, not decoration next to it.

The same applies to inferred BGS ticks (labelled provisional), to member data that may be stale (`synced_at` surfaced), and to AI answers (citations).

### 3. Say what is true, including when it is unwelcome
- GSAI offline → the panel says `OFFLINE`, not a spinner.
- No routes matched → say **which filter was binding**, not "no results".
- Data is 31 days old → show it in `stale` red, do not hide it.
- A tick could not be detected → say so; do not show yesterday's delta as if it were today's.

**A tool that hides its own uncertainty gets used once.**

### 4. Nothing is behind a hover
~40% of traffic is phones, often on a second screen mid-session. Hover cards are an enhancement over content that is already reachable by tap and by keyboard.

### 5. Colour is an accent, never the message
See `accessibility.md`. Deuteranopia makes the red/green BGS delta nearly invisible, and red/green *is* the delta indicator. Every colour-carried meaning is duplicated by an icon and a label.

### 6. The aesthetic yields to legibility, always
When the ED look and readability conflict, readability wins and it is not a discussion. `brand.orangeDim` is beautiful and is **banned for text** because it measures 3.16:1. The high-contrast theme is shipped, not a toggle we might add later.

### 7. Diegetic naming, sparingly
In-universe framing makes the site feel like part of the game:

| Surface | Diegetic name |
|---|---|
| GSAI panel | **SHIP COMPUTER** |
| Forum | **COMMS ARRAY** |
| Trade terminal | **COMMODITIES MARKET** |
| BGS console | **SITUATION BOARD** |
| Ops board | **OPERATIONS** |
| Loadout Locker | **SHIPYARD** |

**The limit:** navigation and error messages stay plain. A member who cannot find the forum because it is called COMMS ARRAY has been failed by the theme. Diegetic names sit as headers *above* plain-language navigation, never instead of it.

### 8. Prefer boring interactions
One or two hobbyists maintain this. Every bespoke interaction is a future bug. Use standard patterns; spend the novelty budget on the visual layer, where it is cheap and reversible.

---

## Typography

| Role | Family | Rules |
|---|---|---|
| Display | Chakra Petch / Orbitron | Headings and large numerals only. **Never body text** — squared-off faces are tiring at length. |
| Body | Inter / IBM Plex Sans | Everything readable. |
| Mono | JetBrains Mono | Data tables, credits, coordinates, callsigns, system addresses. |

**Tabular figures are mandatory on every number in a table or a stat** (`font-feature-settings: 'tnum' 1, 'lnum' 1`). Misaligned credit columns look amateurish instantly, and this is a one-line fix that most sites never make.

Forum body copy sits at a ~70ch measure. Long-form text at full container width is unreadable regardless of how good the font is.

---

## Layout

- **Angular, not rounded.** Default radius is 0; corner cuts via clip-path in the spirit of the cockpit UI. Purely decorative — never used to convey state.
- **Hairline borders** at 18% orange for panel edges. Decorative only, per `accessibility.md`.
- **Dense panels** with tight internal spacing; generous space *between* panels rather than inside them.
- **Deep space, not pure black.** `#05070a` rather than `#000000`: pure black plus glow effects causes halation on OLED and makes text edges shimmer.

## Motion

| Effect | Rule |
|---|---|
| Panel edges draw in on mount | 200ms, `enter` easing. Once per mount, never on re-render. |
| Scanline overlay | ~1.2% opacity. Texture, not pattern. Above ~3% it is a migraine trigger. |
| Cyan hover glow | 120ms. Never on touch devices. |
| Boot sequence on first load | **Once per session, skippable.** Charming once, infuriating on the fifth page view. |
| Streaming AI tokens | Natural, no artificial typing delay. |

**`prefers-reduced-motion` removes all of it automatically** — durations to zero, panel-draw, scanline, glow pulse and boot sequence gone entirely. Not a setting to find; a media query to honour.

## Sound

Subtle UI clicks and confirmation tones, **off by default**, toggleable. Nobody wants an unexpected noise from a browser tab, and members are frequently in voice comms during ops.

---

## Component rules

| Component | Rule |
|---|---|
| **Data table** | Sortable headers with `aria-sort`; virtualised beyond 100 rows; horizontal scroll in its own container so the page body never scrolls sideways; sticky header. |
| **Freshness badge** | Icon + colour + literal age. Always all three. Never colour alone. |
| **Number** | Tabular figures; thousands separators; explicit unit suffix (`Cr`, `ly`, `Ls`, `t`); never a bare figure. |
| **Timestamp** | Local **and** UTC, always (INV-025). Relative time ("in 3 hours") plus absolute on hover/focus. |
| **System name** | Copy-to-clipboard on every occurrence. Sounds trivial; used constantly — members paste straight into the galaxy map. |
| **Button** | Filled = dark-on-bright (`text.onAccent`). Never light text on an accent fill. |
| **Focus ring** | 2px `border.focus`, 2px offset, never removed. |
| **Empty state** | Explains *why* it is empty and what to do next. "No results" alone is a dead end. |
| **Destructive action** | Confirmation with the consequence stated in plain language, never just "Are you sure?". |
| **Loading** | Skeletons matching the final layout, not spinners — a spinner tells a member nothing about what is coming. |
| **Error** | The error-taxonomy `message` plus the `requestId`. The request ID is what makes a member's bug report actionable. |

## What we deliberately do not build

| Not building | Why |
|---|---|
| A web galaxy map replicating the in-game one | Enormous effort, guaranteed worse than the original (`scope.md`) |
| Animated backgrounds on data screens | Distracting where members are reading numbers |
| Custom scrollbars | Break platform conventions and accessibility for aesthetics |
| Infinite scroll on the forum | Breaks deep linking, back-button behaviour and "where was I" |
| A dashboard the member must configure before it is useful | The default must be right; customisation is a bonus |
| Modal dialogs for anything non-blocking | Interrupts; use inline expansion or a slide-over |
| Heavy gamification | The spec is explicit: reputation stays light. Heavy gamification breeds noise. |
