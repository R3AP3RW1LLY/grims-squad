# Raven import, shared plans, the nexus, and the map

Four features asked for on 2026-08-24, to start once the current colonisation queue is finished.
The four rulings below are the owner's own answers and are not open questions.

---

## The finding that changes an earlier conclusion

An earlier session verified across 101 journals that **Elite never emits architect-view slot
counts** — every `Slot` field belongs to `ModuleBuy` / `ModuleRetrieve` / `ModuleSell`. That is
still true, and the conclusion drawn from it ("manual slot entry cannot be eliminated") is written
into code comments.

A Raven Colonial export **does** carry them:

```json
"slots": {"1":[1,-1],"9":[1,-1],"17":[1,2],"18":[3,2],"100100":[1,-1]}
```

Keyed by body number, valued `[orbital, surface]`, with `-1` meaning "not applicable" — the two
`-1` bodies above are a star and a gas giant, and the two with real surface numbers are landable.
Only bodies the architect has actually opened appear.

So the limit is narrower than recorded: **the journal cannot supply slot counts; an import can.**
Manual entry stays as the fallback for members with no Raven file.

---

## A — Import a Raven Colonial export

**Ruling: the import wins over typed slot numbers, and says so.** The file comes from the architect
view; typed numbers were always a best guess. Overwrite, and mark the body as import-sourced with a
date so nobody thinks the platform invented the figure.

### What the file gives us

Verified against `backup_Col 285 Sector GL-W c2-12_#6_PebbleMerchant.json` (v6, rev 6):

| Field | Use |
|---|---|
| `name`, `id64`, `pos` | System identity and real galactic coordinates — feeds **D** |
| `architect` | Who claimed it |
| `reserveLevel` | `pristine` etc. — mining value, feeds **C** |
| `bodies[]` | `num`, `parents[]`, `type` (`st`/`gg`/`ib`/`ac`/`bc`), `subType`, `features[]` (`landable`, `rings`, `volcanism`, `geo`, `tidal`, `atmosphere`), `radius`, `temp`, `gravity`, `distLS` |
| `sites[]` | `bodyNum`, `buildType`, `status` (`complete` \| `build` \| planned), `name` |
| `slots` | **Orbital/surface slot counts per body** |

`buildType` values (`dec_truss`, `ourea`, `bellona`, `minerva`) are **build_type_ids**, confirming
the owner's earlier correction. They map straight onto our catalogue.

`deleteIDs`, `updateIDs`, `savedNames`, `idxCalcLimit` are Raven's own sync bookkeeping — ignored.

### Shape of the work

1. **A parser in `@grims/shared`** — pure, total, and defensive. A hand-edited or newer-schema file
   must degrade to "here is what I could read" rather than throwing. Report per-section counts so a
   member sees *31 bodies, 4 sites, 9 slot records* before committing.
2. **A preview step, not a blind apply.** The import shows what it will change — including which
   slot counts it will overwrite and what they currently say — and the member confirms.
3. **Site status maps onto our own states**: `complete` → complete, `build` → building/started,
   absent → planned. This must agree with `siteProgress`, which already decides what the plan page's
   badges say.
4. **Immovability interacts with the drafter** (shipped in #241): imported `complete`/`build` sites
   are fixed, so a drafted layout works around them automatically.

### Risks

- `v`/`rev` will change. Parse defensively and record the version seen on the import record.
- Body `num` is Frontier's body id, which is what we already key on — worth asserting on real data
  rather than assuming.
- An import that silently replaces a plan somebody spent an evening on is the worst outcome here.
  The preview is not optional.

---

## B — Plans shared with the squadron, but member-owned

**Ruling: read-only, but haulable.** Others see the layout, the build order and the shopping list,
and may join and haul to any project the plan has spawned. Only the owner edits.

Today `ColonyPlan.owner` is a two-value enum (`squadron` | `personal`), so this is a genuine third
state rather than a flag. The cleanest shape is a separate `visibility` on a personal plan
(`private` | `squadron`) so "who owns it" and "who can see it" stop being the same question — the
conflation is what makes the current model unable to express this.

**Smaller than it first looks (found 2026-08-24).** That separation already exists on the other
half of the module: `ColonyProject` carries a `ColonyVisibility` enum of exactly
`private | squadron | public`, alongside its own `owner`. So this is not a new concept to design —
it is the same field, on plans, following a pattern already proven in production on projects. The
`public` state is deliberately not wanted here: the ruling was squadron-visible, and a plan on a
public link is a different feature nobody asked for.

Every read path that currently resolves visibility has to learn the third state. That is the bulk of
the work and the part most likely to leak: the failure mode is a plan becoming visible somewhere
nobody intended, so each read path needs a test rather than an audit.

Haulable is nearly free — a plan's projects are already ordinary projects with their own membership.
What changes is only that the plan is *findable* by somebody who is not its owner.

---

## C — The nexus, built onto blocs

**Ruling: extend blocs rather than add a second grouping concept.**

`ColonyBloc` already exists: a named group of systems, each with a role, plus missing-link analysis.
It is officer-created. The nexus is that plus two things:

1. **Member-owned blocs** — today only officers can create one, so a member with four systems has no
   way to group them.
2. **Trade prediction between the grouped systems** — what each system will produce once built, what
   it will want, and therefore which of our own systems should supply which. `planManifest` in
   `@grims/shared` already orders and groups multi-stop runs and is the right thing to build on.

The economy machinery to predict output already exists (`colony-economy.ts`, `colony-simulation.ts`
compute what a completed layout does to a system). What is missing is running it across *several*
systems and matching surplus against demand.

Two concepts that both group systems would drift, which is why this extends rather than duplicates.

---

## D — The 3D map

**Ruling: true 3D, our systems only.** (This overrode a 2D-with-depth-cue suggestion.)

Real galactic coordinates are already available — the Raven export carries `pos`, and our own
`ColonyProject`/system rows carry coords used today for distance ranking.

- Rotatable starfield from the real x/y/z
- Squadron and member systems only
- Distances between them, and the predicted trade routes from **C** drawn as links
- Click a system → its stations, what they sell, what they buy

The station/commodity half rests on the market mirror we already hold (~18M price rows), so the
click-through is mostly a query and a panel rather than new ingestion.

**Constraints worth stating now:** a strict CSP and no external CDNs, so any 3D has to be
self-contained. The companion is Preact in an Electron window and has to render the same thing —
parity is the standing rule, and "true 3D" is materially harder to make readable on a small panel
than a flat projection. Expect the companion's version to need its own interaction design even
though the data and the layout rules are shared.

---

## Sequencing

**A** first: it is self-contained, it unblocks real slot data that nothing else can supply, and its
output feeds both C and D. **B** next, since it is mostly visibility plumbing and independent of the
rest. **C** before **D**, because the map draws the routes the nexus predicts — building the map
first would mean drawing it twice.
