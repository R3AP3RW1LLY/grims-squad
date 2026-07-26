# Grim's Squad Hub

Squadron platform for **Grim's Squad** — an Elite Dangerous squadron running a player minor faction, fleet carriers, combat/AX, trade, mining and exploration.

Public site · gated member forum · ship-build locker · trade and market terminal · BGS console · fleet-carrier operations · Discord integration · a locally-hosted AI assistant.

**Status: pre-P0.** The specification is complete and reviewed; no application code has been written yet.

---

## This repository is not accepting outside pull requests

It is public so the squadron and anyone curious can read how it is built. It is **not** an open-contribution project — PRs from non-collaborators are closed automatically.

Found a genuine bug or a security issue? **Open an issue.** Those are read.

---

## Where to start reading

Everything is driven by `ssot/` — the Single Source of Truth. It is the law; application code is downstream of it.

| Start here | Why |
|---|---|
| [`AGENTS.md`](AGENTS.md) | The operating contract. Read first, every session. |
| [`ssot/README.md`](ssot/README.md) | How to navigate the SSOT. |
| [`ssot/STATUS.md`](ssot/STATUS.md) | Where the build actually is, and what is blocked. |
| [`ssot/00-charter/scope.md`](ssot/00-charter/scope.md) | What is being built, what is not, and what is explicitly rejected. |
| [`ssot/08-plan/roadmap.yaml`](ssot/08-plan/roadmap.yaml) | The ten phases and why they are in that order. |

## Layout

```
ssot/          The law — charter, decisions, domain, data, contracts,
               integrations, AI, design, plan, runbooks, quality
docs/          The source specification, preserved for provenance
.github/       CI and repository policy
```

## How this is built

- **Spec-first.** `ssot/` is authoritative; CI fails on any drift between it and generated code.
- **Test-driven, without exception.** The failing test is written and observed failing first ([ADR-016](ssot/01-decisions/ADR-016-test-driven-development.md)).
- **Adversarially reviewed.** Six review gates whose reviewers are instructed to break the work, not approve it ([ADR-017](ssot/01-decisions/ADR-017-adversarial-review-gates.md)). The specification itself went through three independent panels before any code was written — 25 findings, 10 of them blockers, all fixed. See [`ssot/10-quality/review-log.md`](ssot/10-quality/review-log.md).
- **47 numbered invariants**, each with a machine-checked test ([`ssot/02-domain/invariants.md`](ssot/02-domain/invariants.md)).

## A note on the Elite Dangerous ecosystem

Several things commonly assumed about ED third-party tooling are wrong, and they are load-bearing here:

- **EDDB shut down in 2023.** Anything built on `eddb.io/api` is dead.
- **Inara has no OAuth.** "Login with Inara" cannot be built. It is a whitelisted JSON-POST API at roughly 2 requests/minute — enrichment only.
- **Frontier cAPI refresh tokens expire at ~25 days**, and expiry surfaces as HTTP 422. Verification is a recurring ceremony, not a session.
- **All market data is player-reported via EDDN and may be stale.** Every price this project surfaces carries its age.

Details in [`ssot/05-integrations/`](ssot/05-integrations/).

---

## Legal

Created using assets and imagery from Elite: Dangerous, with the permission of Frontier Developments plc, for **non-commercial purposes**. Not endorsed by Frontier Developments; no Frontier Developments employee was involved in the making of this site.

This project is non-commercial and must remain so — the right to use Frontier's game data and Coriolis's bundled data depends on it ([`ssot/00-charter/constraints.md`](ssot/00-charter/constraints.md)).

Ship-fit mathematics is ported from [Coriolis](https://github.com/EDCD/coriolis) (MIT) with attribution.

*Fly safe, CMDR. o7*

<!-- autonomy check: this line is removed by the same PR flow that added it -->
