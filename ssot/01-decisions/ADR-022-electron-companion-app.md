# ADR-022 — An Electron companion app replaces Frontier cAPI

**Status:** Accepted · **Date:** 2026-07-27 · **Spec origin:** human decision, this date

## Context

P1.8 has been blocked from the start on Frontier Companion API access. The application
has never been submitted, approval is discretionary, and the wait is measured in weeks
with no guarantee at the end of it. Meanwhile cAPI was carrying two jobs for us:

1. **Proving a CMDR name belongs to a member.**
2. **Confirming a member has played recently**, which is what feeds monthly rank
   progression.

The second one is the blocker with teeth. Every activity row in production currently
reads `game_activity = 'unknown'`, so the qualification rule — any Discord activity
**and** an Elite session — cannot be satisfied by anybody. The promotion engine would
report zero on 1 August 2026 whatever else we built.

The first job has already been solved without Frontier: a member's own **Inara API key**
returns the commander bound to that account, so the name arrives from Inara rather than
from a text box (see `inara_links`, and the manual officer path for anyone who declines).

That leaves game activity, and the answer is not an API at all. **Everything cAPI reports
is already on the member's own disk**, in the game's journal files, usually richer and in
real time:

| | cAPI | Journal files |
|---|---|---|
| CMDR name, credits, ships | yes | yes (`LoadGame`, `Loadout`) |
| Location | last sync only | live (`FSDJump`, `Docked`) |
| Has played recently | inferred | definitive |
| Full ship builds | partial | complete |
| BGS, exploration, mining detail | no | yes |
| Token expiry | ~25 days, surfaces as HTTP 422 | none |
| Third-party approval | weeks, discretionary, may never arrive | none needed |

Reading one's own journals is the ordinary, sanctioned path — EDMC, EDDiscovery and
EDMarketConnector all do exactly this, and Frontier documents the format for it.

**A note on market data, because it changes what the app is for.** Market prices and trade
routes come from **EDDN**, a public firehose fed by thousands of players, and
`apps/eddn-collector` already exists to consume it. Whether our 108 members run any
particular tool changes almost nothing about our market coverage. So the companion app is
**not** needed for market data, and building it as "our own EDMC" would be rebuilding
something we get for free.

## Decision

**Build an Electron companion app whose job is journal collection.** Frontier cAPI is
removed from the critical path permanently and becomes, at most, a later upgrade.

**Electron specifically — a non-negotiable human instruction, 2026-07-27.** Tauri was
proposed on binary-size and memory grounds and was rejected. This ADR records that the
trade was made deliberately and not overlooked: Electron ships a Chromium runtime, so
installers are on the order of a hundred megabytes rather than a few, and idle memory is
higher. In exchange it is the most widely understood desktop stack in the ecosystem, its
packaging, auto-update and code-signing paths are trodden flat, and every member of this
project can already read the code.

**Wrap the hub; do not rebuild it.** The app hosts the existing Next.js frontend and adds
a journal watcher beside it. One frontend codebase. Reimplementing the browser app inside
the desktop app would double the surface for no user-visible gain.

**The Inara key is shared between surfaces.** A key added in the app is the same key as
one added on the website — same endpoint, same encrypted column, distinguished only by
the `source` field so it can be explained later. A member does it once, wherever they
happen to be.

**The app is OPTIONAL, and stays optional.** The website remains complete on its own.
Anyone unwilling to install a binary is verified by an officer and can be a full member
with a full rank. The moment the app becomes a prerequisite we have excluded people for
the convenience of automation.

### What it does

- Watches the journal directory and posts session events to our ingest endpoint.
- Offers to add an Inara API key, which syncs to the web account.
- Hosts the hub, so it is a single place to be.

### What it does NOT do

- It does not upload to EDDN. We consume EDDN; we are not a market client, and pretending
  to be one means owning a data-quality obligation to the whole community.
- It does not read anything outside the journal directory.
- It is not required for market data, trade routes, or any existing feature.

## Consequences

**Verification stays at trust tier 2, and that is adequate.** The app runs on the member's
machine and sends what it is told; fabricating journal files is possible for someone
determined. Only Frontier can attest tier 3. But the threat model here is "a member
inflates their activity to be promoted sooner in a 108-person squadron", and tier 2
answers that comfortably. Tier 3 solves a problem we do not have.

**Code signing is a real cost, not a detail.** An unsigned Windows binary triggers
SmartScreen, and a scary warning on first launch is a worse first impression than having
no app. This needs a certificate and a budget line before any public release.

**Install friction is the main risk.** A website asks nothing of anyone; a binary asks for
trust. Most Elite players already run something similar, which helps, but the mitigation
that matters is that the app is never required.

**We are asking members to run our code.** That is a responsibility rather than a
feature, and it argues for a small, auditable, single-purpose agent rather than a large
one that grows capabilities quietly.

**Journals are Windows-first in practice.** Elite runs on Linux through Proton, where
journals live under the Proton prefix, and macOS support ended years ago. Windows is the
target; the path resolver should be pluggable rather than hard-coded, and Linux is
best-effort.

## Alternatives considered

**Wait for Frontier cAPI.** Rejected: the wait is unbounded, approval is not guaranteed,
and it blocks the August promotion run for a capability the journals provide better.

**Ask members to run EDMC with a custom plugin.** Genuinely viable and much less work —
EDMC has a stable plugin API and many members already run it. Rejected because it makes
our onboarding depend on a third-party tool's install, versioning and plugin directory,
and because the human asked for a first-party app.

**Consume EDDN and attribute activity from it.** Rejected as impossible rather than
undesirable: EDDN anonymises the uploader, so messages cannot be attributed to a member.
EDDN remains the right source for market data and the wrong one for per-member activity.

**Do nothing and keep manual verification.** Rejected: it leaves `game_activity` at
`unknown` forever, which means no member ever qualifies for promotion and the entire rank
progression system is decorative.
