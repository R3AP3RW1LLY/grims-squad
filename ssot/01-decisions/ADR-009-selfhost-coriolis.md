# ADR-009 — Self-host Coriolis; build the Locker around it, not an outfitting UI

**Status:** Accepted · **Date:** 2026-07-25 · **Spec origin:** §2.6, §7.3, §17

## Context

Members need somewhere to build ships. Writing an outfitting tool means modelling every ship, every module, every engineering blueprint and every stacking rule in the game, then tracking Frontier's additions forever. Coriolis already does this, is MIT-licensed, and ships a documented Docker build.

What Coriolis does *not* do is remember which builds belong to which member, which builds an officer has blessed as doctrine, or which ships in the squadron can make a 60 ly jump. That gap is where the actual squadron value is.

## Decision

**Run Coriolis unmodified at `shipyard.<domain>`; build the Loadout Locker as our own service around it.**

### (a) Coriolis
- Docker build from `EDCD/coriolis` with `EDCD/coriolis-data` as a build context, per `05-integrations/coriolis.md`.
- **Pin the upstream commit.** Reproducible builds; upgrades are deliberate.
- **Schedule a monthly `coriolis-data` check.** Frontier keeps adding ships (Mandalay, Cobra Mk V, Corsair, Panther Clipper and successors). **Stale module data produces confidently wrong builds, which is worse than no builds.**
- Theme to match our tokens; do not fork the logic.

### (b) Loadout Locker — ours
Save (from Coriolis URL, EDSY URL, Coriolis JSON, or the game's journal `Loadout` event — all four), auto-import from cAPI/EDMC, compute and cache stats, compare up to four builds, mark doctrine builds, check engineering requirements, plan costs, comment and version, and answer fleet queries like *"every Anaconda in the squadron with >60 ly jump range"* — the query that makes the P5 wing-composition checker possible.

### (c) Ship maths
**Ported from Coriolis into `packages/ed-domain`, with attribution**, not reinvented and not scraped from the Coriolis UI: optimal-mass FSD curves, shield booster diminishing returns, resistance stacking, thermal spread. It must live in our code because GSAI calls it directly as a tool (`calculate_jump_range`, `analyse_loadout`). Unit-tested against known-good Coriolis outputs, to within 1% on ten reference builds.

### (d) Licence conditions — binding
- Coriolis **code** is MIT: preserve copyright notices, attribute the ported formulas.
- Coriolis's bundled **game data and imagery are Frontier's IP**, used under permission **for non-commercial purposes**.
- Therefore: **no paid access, no ads, no selling anything**, and the Frontier attribution notice in the footer. This is a hard constraint on the whole project, not just the shipyard (`constraints.md`).
- **EDSY** (`edsy.org`) is supported as an import format alongside Coriolis's, because its share URLs are compact and widely used.

## Consequences

**Positive**
- A best-in-class outfitting tool for the cost of a Dockerfile.
- Effort goes into the part nobody else provides: squadron memory, doctrine, and fleet-wide queries.
- Ship maths in `packages/ed-domain` is callable by the API, the AI and the wing-composition checker without touching any UI.

**Negative / accepted costs**
- **A vendored subsystem we do not control.** Upstream changes, dependency rot, and Node-version drift are ours to absorb. Pinning makes this a scheduled chore rather than a surprise.
- Two UIs with two visual identities. Theming narrows the gap; it will not close it.
- The monthly data check is a real recurring obligation. It is in `09-runbooks/` and on the calendar because skipping it produces wrong builds silently.
- Our ported maths can drift from Coriolis's after an upstream formula change. The 1%-on-ten-builds test suite is what catches it.
- **The non-commercial condition is permanent.** Monetising the site later would require removing Coriolis and its data.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Build our own outfitting UI** | Months of work to produce something worse, plus permanent responsibility for tracking every module and ship Frontier ships. Explicitly out of scope. |
| **Link to coriolis.io and store only URLs** | Zero effort, but no offline resilience, no stats we can query, no fleet queries, no doctrine builds, and nothing for GSAI to call. The Locker's entire value disappears. |
| **Fork and modify Coriolis to add member accounts** | Turns a pinned upstream into a permanent merge burden, in someone else's codebase, to add features that belong in ours. |
| **Use EDSY instead of Coriolis** | Excellent tool, but Coriolis has the documented Docker build and the MIT-licensed data repository. We import EDSY's format rather than hosting it. |
| **Scrape build stats from the Coriolis UI** | Fragile, slow, and unusable as an AI tool. Port the formulas. |
| **Skip the monthly data check** | Stale module data silently produces wrong builds — the failure mode that destroys trust in a build tool. |
