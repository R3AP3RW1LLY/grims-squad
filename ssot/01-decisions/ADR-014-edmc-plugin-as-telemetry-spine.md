# ADR-014 — The EDMC plugin is the telemetry spine

**Status:** Accepted · **Date:** 2026-07-25 · **Spec origin:** §2.8, §7.12, §14 (Phase 3)

## Context

Four modules — BGS, ops, carriers, trade — all need to know what CMDRs are actually doing. The alternatives are asking members to fill in forms (they won't, consistently, and the data will be wrong) or inferring from EDDN (which is anonymised and cannot attribute activity to a member).

Members already run EDMarketConnector. A Python plugin of a few hundred lines, posting selected journal events to our API, supplies all four modules from one pipe with zero ongoing member effort.

The spec calls this "the highest-leverage item in the entire spec relative to effort", and the phase plan puts the telemetry spine before BGS, ops, carriers and trade deliberately: **build the pipe before the four taps.**

## Decision

**Ship an open-source EDMC plugin and treat it as core infrastructure, not an add-on.**

What it supplies: live location and ship for the activity ticker and ops coordination; automatic BGS activity capture (missions, bounties, bonds, cartographics, per faction, per system); automatic loadout sync into the Locker on every `Loadout` event; cargo and hauling progress for group ops; carrier jump and market updates from owners; exploration and exobiology logs.

**Five rules, non-negotiable:**

1. **Opt-in per event category, defaulting to off**, with a settings panel. Categories: `location`, `combat`, `trade`, `exploration`, `bgs`, `carrier`, `fleet`. **Consent is enforced server-side** — a non-consented category is **rejected with a clear error**, not silently ignored (INV-013). Client-side filtering is a courtesy; the server is the control.
2. **Never block or slow the game.** All I/O on a background thread, bounded queue, short timeouts, silent failure, retry on the next loop. A plugin that stutters the game gets uninstalled, and the spine is lost with it.
3. **Device tokens, not passwords.** Issued from the member's profile page, scoped to `telemetry:write`, individually revocable, **encrypted at rest** (INV-012). Revocation is immediate and offers a purge of collected data.
4. **Publish the source.** Members are installing code that reads their game journal. A closed-source plugin asking for journal access is a trust disaster. The repository is public and readable.
5. **Offer to forward to EDDN** for members not already contributing — good citizenship, and it improves everyone's data including ours.

**Server side:** `POST /v1/telemetry` accepts batches (≤25 events), authenticates by device token, validates every event against `04-contracts/telemetry-contract.md` with Zod, enforces consent per category, is idempotent by `(deviceTokenId, journalTimestamp, event)`, and rate-limits per token.

**Privacy posture:** a visible indicator when telemetry is being received and what is being shared; one-click revoke and purge; JSON export of everything held; nothing published — location, credits, fleet — without an explicit per-field opt-in.

## Consequences

**Positive**
- BGS activity reporting requires no member action at all, which is the difference between a BGS console that reflects reality and one that reflects who could be bothered.
- The Locker stays current automatically; ops signups can offer the member's actual fleet; carrier fuel tracks itself.
- One integration serves four modules, which is why it is sequenced before all of them.

**Negative / accepted costs**
- **Python, in a TypeScript project.** The single deliberate exception to ADR-001. Contained to `plugins/edmc-grimssquad/` behind the HTTP contract, with its own lint/test/CI job.
- **Adoption is the real risk.** The exit criterion is ≥3 real members running it. If members do not install it, four downstream modules degrade to manual entry. Mitigated by making install trivial, the source readable, and the value obvious.
- **We are collecting real-time location data about real people's gameplay, plus their Discord identity and their in-game finances.** This obliges the whole privacy apparatus above and brings GDPR squarely into play.
- Journal event shapes change with game updates. The contract needs version-tolerant parsing and a dead-letter path, exactly like EDDN.
- The plugin runs on members' machines and we cannot force an upgrade. The endpoint must accept older payload versions gracefully.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Manual activity forms only** | Under-reported, biased toward the diligent, and instantly stale. It is the status quo the whole project exists to replace. |
| **Infer everything from EDDN** | EDDN is anonymised. It cannot attribute a bounty voucher to a member, which is the entire point of BGS activity tracking. We still consume EDDN — for the galaxy, not for the roster. |
| **Depend on BGS-Tally instead of shipping our own plugin** | Covers BGS only, not loadouts, cargo, carriers or location, and puts our data pipeline behind another project's roadmap. We support *importing* BGS-Tally data; we do not depend on it. |
| **A custom desktop app instead of an EDMC plugin** | Members already run EDMC. A second background app is a much harder ask for strictly less integration. |
| **Reading journal files from a shared/cloud folder** | Fragile, invasive, and platform-specific. |
| **Closed-source plugin** | Members would be installing unreadable code that reads their game journal. Correctly, many would refuse. |
| **Client-side consent filtering only** | The client is not a security boundary. A modified or stale plugin would send categories the member never agreed to. |
| **Blocking, synchronous HTTP in `journal_entry`** | Stutters the game. The plugin gets uninstalled and takes the spine with it. |
