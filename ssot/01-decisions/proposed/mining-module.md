# The Mining Module — design, for approval before any of it is built

**Status:** proposed. Nothing here is implemented.
**Asked for:** 2026-08-06 — *"our own version of EDminer ... gamified leaderboard ... on refined
materials ... ultra feature rich ... add our AI into this ... available in our companion app ...
its own overlays ... theme, brand and styles must also match."*

---

## 1. What already exists, and what does not

This matters more than any feature list, because it decides what is a week and what is an evening.

| | state |
|---|---|
| `MiningRefined` events | **already collected — 11,258 in production today** |
| Fields kept from them | `Type`, `Type_Localised` only |
| `ProspectedAsteroid` | **not collected. Not in the events map at all.** |
| `AsteroidCracked`, `LaunchDrone`, `MiningRefined` rate | not collected |
| Leaderboard machinery | exists: `LEADERBOARDS`, `TIER_LADDERS`, `leaderboard_events`, badge sweep |
| Overlay machinery | exists: four panels, per-panel fields, style, placement, lock, `auto`/`over-game`/`detached` |
| AI retrieval legs | exist: `semantic`, `names`, `market`, `near`, `fit` — grammar decides, never the model |

**The leaderboard can be backfilled the day it ships.** Eleven thousand refined units are already in
the database. Nobody starts at zero, which is the difference between a board people check and a
board people ignore.

**Everything that makes it EDMiner rather than a scoreboard needs a new event.**
`ProspectedAsteroid` is what carries "this rock is 38.4% Platinum" — it is the single most valuable
thing a mining tool shows, and we do not have one row of it.

---

## 2. The one decision I need from you

`ProspectedAsteroid` fires **every time a prospector limpet hits a rock** — a busy hour of core
mining is several hundred events, against maybe twenty `MiningRefined`. It is by far the highest
volume event this platform would ever collect.

Three ways to handle it, and they lead to genuinely different products:

**(a) Collect it in full, under a new `mining` consent category.** Every prospected rock, its
material percentages, its motherlode. Gives the complete EDMiner experience *and* squadron-wide
intelligence — "which rings are actually paying this week" — which no single-player tool can do.
Costs: real event volume, and a new toggle members must be told about.

**(b) Collect it summarised on the member's machine.** The app watches every rock and sends a
rolled-up session: rocks prospected, best percentage seen, hit rate, yield per hour. The overlay and
the live tools work identically because they read the local file; the hub gets one row per session
instead of hundreds. Costs: no squadron-wide ring intelligence, because we never see individual
rocks.

**(c) Do not collect it. Overlay only.** The app shows everything live and locally; the hub only
ever sees `MiningRefined`, exactly as today. Leaderboard works, EDMiner-equivalent works, and no new
data leaves anybody's machine.

I would choose **(b)**: it gives the member the full tool, keeps the leaderboard honest, and asks
for a fraction of the data. But (a) is the only one that answers "where should the squadron mine
tonight", which is the sort of thing this platform is *for* — and you have consistently chosen the
richer squadron feature when I have offered you the smaller one.

**Everything below is written for (b), and notes where (a) would add more.**

---

## 3. The leaderboard: Deep Core

Fourth board, alongside Data Runners, Colony Builders and Trade Barons. Same shape, same page, same
badge sweep — it slots into `LEADERBOARDS` and `TIER_LADDERS` and needs no new presentation code.

### Scoring

**A point per tonne refined, weighted by what it was.** Not by credits: prices move, and a board
that reranks itself when the market shifts is not a record of what anybody did.

```
points = tonnes × RARITY[commodity]
```

| tier | examples | weight | why |
|---|---|---|---|
| Core-only | Void Opal, Alexandrite, Monazite, Musgravite | **×8** | Requires seismic charges, a specific ship, and skill |
| Laser premium | Painite, Platinum, Rhodplumite | **×4** | The classic grind, still deliberate work |
| Laser common | Bertrandite, Gold, Silver, Osmium | **×2** | Volume mining |
| Everything else | Bauxite, Rutile, ... | **×1** | Incidental |

Weights live in `packages/shared/src/mining.ts` beside the leaderboard constants, printed on the
page exactly as `COLONY_PRIORITY_MULTIPLIER` and `TRADE_CREDITS_PER_POINT` are — a member should be
able to read what a point costs without reading the source.

### Why refined and not sold

`MiningRefined` fires when the refinery finishes a tonne. It is the moment the work happened. Selling
is a separate skill already scored by Trade Barons, and paying twice for one tonne would let a miner
farm both boards with one action.

### Tiers

Named to the board, same four rungs, thresholds tuned to what a point costs here. A solid core
session is ~40 t of opals ≈ 320 pts; a dedicated week is a few thousand.

| tier | name | lifetime points |
|---|---|---|
| 🥉 bronze | Rock Hopper | 2,000 |
| 🥈 silver | Seam Runner | 20,000 |
| 🥇 gold | Core Breaker | 100,000 |
| 🏆 platinum | Deep Core | 400,000 |

Keys stay `mining-bronze` … `mining-platinum` for ever, per the existing rule that renaming a rank
must never strand an award.

### Achievements

Beside the tiers, in the same `BadgeDef` shape:

| badge | earned by |
|---|---|
| 💎 **First Light** | First tonne of any core-only material |
| 🥚 **Motherlode** | A rock over 50% of one material |
| 🧨 **Clean Break** | Ten cores cracked with no charge wasted *(needs (a) or (b))* |
| ⛏️ **Grindstone** | 1,000 t refined in one calendar month |
| 🌌 **Void Prospector** | Refined every core-only material at least once |

---

## 4. The mining tool — the EDMiner part

Three surfaces, all fed by the same local fold, none of which need the hub to be reachable.

### 4.1 Prospector overlay — the one that matters

The panel a miner actually stares at. Fires on `ProspectedAsteroid`, replaces itself each rock.

```
┌─ PROSPECTOR ──────────────── ⛏ ─┐
│  ● PLATINUM          38.4%      │   ← bar, coloured by threshold
│    Painite           12.1%      │
│    Bertrandite        4.0%      │
│                                 │
│  MOTHERLODE · Platinum          │   ← only when present
│  Content: High                  │
│                                 │
│  Rock 47 · 11 hits · 23%        │   ← session hit rate
└─────────────────────────────────┘
```

- **A threshold the member sets.** Above it the bar turns squadron cyan and the panel flashes once;
  below it stays dim. The whole skill of laser mining is deciding whether to shoot a rock in the two
  seconds before it drifts, and this is that decision rendered.
- **Motherlode called out loudly** — it is the only thing that changes what you do next.
- **Hit rate** across the session, because it is how a miner knows the ring is worth staying in.

### 4.2 Refinery overlay

```
┌─ REFINERY ────────────────── ⛏ ─┐
│  Platinum      ████████░░  24 t │
│  Painite       ███░░░░░░░   9 t │
│                                 │
│  Session   33 t · 1h 12m        │
│  Rate      27 t/h               │
│  Points    +264 Deep Core       │   ← live, matching the board's own maths
└─────────────────────────────────┘
```

Points shown live and computed with the same shared weights the hub uses — the number a member
watches must be the number that lands.

### 4.3 The `/mining` page and companion section

Mirroring the website exactly, per the standing rule:

- **This ring** — what the squadron has refined here, hit rates, best rocks *(needs (a))*
- **My sessions** — history, tonnage, rate, points per session
- **Deep Core board** — season and all-time, sitting with the other three
- **Ring finder** — hotspots by material, from the galaxy data we already hold
- **Loadout check** — the fitting engine already exists; ask it whether a ship is fit to mine

---

## 5. Where the AI genuinely helps

The rule in this codebase is that grammar decides and the model never calls tools. Mining fits that
model well, as a new retrieval leg beside `market`, `near` and `fit`.

**A `mining` leg on `Plan`**, triggered by questions of the shape *"where should I mine platinum"*,
*"is this ring any good"*, *"what should I fly for core mining"*:

```ts
readonly mining: {
  readonly material: string | null;
  readonly near: { system: string; radiusLy: number } | null;
  readonly style: 'core' | 'laser' | null;
} | null;
```

It retrieves FACTs — hotspot rings within range, what the squadron has actually refined there
recently *(with (a))*, and a computed mining loadout from the existing fitter — and the model writes
the sentence. Same discipline as everything else: if the FACTs do not answer it, it says so.

**What it should NOT do:** decide whether to shoot a rock. That is a threshold and a percentage, it
must answer in milliseconds while the rock drifts, and a language model is the wrong instrument
entirely. The overlay does that with arithmetic.

**One genuinely novel thing it could do**, given (a): *"the squadron's last 400 rocks in Borann say
the A2 ring is running 22% hit rate this week, down from 31%."* No single-player tool can say that,
because no single player has 400 rocks of data.

---

## 6. Theme

Nothing new. Squadron cyan `#3fd0d4` is already the overlay accent constant; the panels use the
existing `Section`/`Card`/`Stat` primitives, the same `Outline` icon component and Heroicons
geometry, and the same tier icons 🥉🥈🥇🏆 the other three boards use. The mining icon would be
Heroicons' `CubeTransparentIcon` — a crystal, matching the existing outline set.

---

## 7. What I would build, in order

Each step is useful on its own and shippable without the next.

1. **Deep Core leaderboard, backfilled.** `MiningRefined` is already collected. Add the weights, the
   board, the tiers, the scorer, and a backfill over the 11,258 existing rows. *An evening, and it
   lands with real standings on day one.*
2. **Refinery overlay.** Local fold, no new collection. Session tonnage, rate, live points.
3. **Prospector overlay.** Needs the `ProspectedAsteroid` decision. This is the EDMiner moment.
4. **`/mining` page + companion section.** History, board, ring finder.
5. **AI mining leg.** Once there is data worth asking about.
6. **Squadron ring intelligence.** Only exists under (a).

---

## 8. What I need before writing any code

1. **The collection decision in §2** — (a), (b) or (c). It changes steps 3 and 6 entirely.
2. **Weights and thresholds sane?** §3 is my proposal, not arithmetic you have to accept. The tier
   numbers in particular are a guess at what a serious month looks like for this squadron.
3. **Anything from EDMiner you specifically want** that is not here. I have designed against what the
   tool does; you may use it differently.
