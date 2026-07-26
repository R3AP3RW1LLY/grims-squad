# Coriolis

## Role in this system
A self-hosted ship-outfitting tool at `shipyard.<domain>`, plus the MIT-licensed source of the ship-fit formulas we port into `packages/ed-domain`.

**It is deployed, not called.** There is no runtime adapter — no application code makes HTTP requests to Coriolis. The integration surfaces are: a Docker deployment, an imported build format, and ported maths.

## Trust tier
**self-hosted subsystem** — we run it, we pin it, we own its uptime.

## Access requirements
None. MIT-licensed source on GitHub.

## Source
```
https://github.com/EDCD/coriolis        # the app — Node/React, MIT
https://github.com/EDCD/coriolis-data   # ship/module JSON, MIT
https://edsy.org                        # EDSY — the other major outfitter, import support only
```

## Deployment
```bash
git clone https://github.com/EDCD/coriolis        vendor/coriolis
git clone https://github.com/EDCD/coriolis-data   vendor/coriolis-data
# PIN BOTH to a specific commit and record it in site_config
git -C vendor/coriolis      checkout <pinned-sha>
git -C vendor/coriolis-data checkout <pinned-sha>

docker buildx build --build-context data=../coriolis-data --tag coriolis .
docker run -d -p 3300:3300 coriolis
```

```yaml
# infra/docker/coriolis.yml
services:
  coriolis:
    build:
      context: ../../vendor/coriolis
      additional_contexts:
        data: ../../vendor/coriolis-data
    ports: ["3300:3300"]
    restart: unless-stopped
```

Served at `shipyard.<domain>` behind Caddy, theme-matched to `07-design/tokens.json`.

## Build formats we import
Four, all required (task P7.2):

| Format | Shape | Notes |
|---|---|---|
| Coriolis URL | `https://coriolis.io/outfit/<ship>?code=<base64>` | Decode the `code` parameter |
| EDSY URL | `https://edsy.org/#/L=<compact>` | Different, more compact encoding |
| Coriolis JSON | export document | Direct |
| Journal `Loadout` | the game's own event | **The canonical form** — arrives automatically from the EDMC plugin |

`loadouts.coriolisJson` stores the canonical document; Coriolis and EDSY URLs are stored alongside for round-tripping.

## Ship maths — ported, not called
`packages/ed-domain` implements, ported from Coriolis with attribution:
- Optimal-mass FSD curves → jump range laden, unladen, maximum
- Shield booster diminishing returns and resistance stacking → effective shield HP
- Armour hardness and resistance → effective armour HP
- DPS by damage type, thermal load, distributor draw
- Cargo, fuel scoop rate, rebuy, total cost

**It must live in our code because GSAI calls it directly as a tool** (`calculate_jump_range`, `analyse_loadout`) and because the fleet queries that make wing composition work run in SQL against cached stats. Scraping the Coriolis UI would be fragile, slow, and unusable as an AI tool.

**Unit-tested against known-good Coriolis outputs — within 1% on ten reference builds** (P7.3 exit criterion).

## Maintenance obligations
| Task | Cadence | Why it matters |
|---|---|---|
| Check `coriolis-data` for updates | **monthly** | **Frontier keeps adding ships. Stale module data produces confidently wrong builds, which is worse than no builds.** |
| Re-run the ship-maths test suite after a data update | with each update | Our ported formulas can drift from upstream after a formula change |
| Review upstream `coriolis` commits | quarterly | Security and dependency updates |
| Verify the pinned SHAs are recorded | with each update | Reproducible builds |

Both checks share a runbook slot with the FDevIDs refresh — same cadence, same cause.

## Failure modes
| Failure | Detection | Our response |
|---|---|---|
| Container down | health check on `shipyard.<domain>` | Alert. **The Locker keeps working** — stored builds, stats, comparison and doctrine are all ours. Only new *building* stops. |
| Stale `coriolis-data` after a game update | monthly check, or a member reporting a missing ship | Update, re-pin, re-run the maths tests. **Silent until someone notices**, which is why the check is calendared. |
| Upstream build breaks | Docker build fails | Stay on the pinned SHA. **Never auto-update.** |
| Our ported maths drifts from Coriolis | the 1%-on-ten-builds test suite | Fix ours; the test suite is the tripwire. |
| Coriolis URL format changes | import parse failure | `422 INVALID_LOADOUT_FORMAT`. Journal `Loadout` import still works — which is why supporting all four formats is a resilience decision, not a convenience one. |

## Licence — binding on the whole project
| Component | Licence | Obligation |
|---|---|---|
| `coriolis` code | MIT | Preserve copyright notices |
| `coriolis-data` code | MIT | Preserve copyright notices |
| **Bundled game data and imagery** | **Frontier's IP, used under permission for NON-COMMERCIAL purposes** | **Keep the entire site non-commercial** |
| Ported formulas in `packages/ed-domain` | MIT | **Attribute Coriolis in the source file header** |

**Consequences that bind the whole project, not just the shipyard:**
- No paid memberships, no ads, no selling access.
- The Frontier attribution notice in the footer of every page (INV-029).
- **Monetising later would require removing Coriolis and its data.** This is permanent (`00-charter/constraints.md`).

## Gotchas
- **Pin both repositories to a commit.** An unpinned build means a working deployment silently becomes a broken one on the next rebuild, and you will not know which change did it.
- **`coriolis-data` is the one that rots.** The app changes slowly; the *data* falls behind every game update that adds a ship or module. **Wrong module stats produce a build a member actually flies** — this is the highest-consequence stale-data path in the project after market prices.
- **Do not fork and modify Coriolis to add member accounts.** That turns a pinned upstream into a permanent merge burden in someone else's codebase, to add features that belong in the Locker (ADR-009).
- **Do not scrape the UI for stats.** Port the formulas. The AI needs to call them directly.
- **EDSY's encoding is entirely different from Coriolis's.** Two separate parsers; do not attempt one clever unified decoder.
- **The journal `Loadout` event is the most reliable import path** because it comes straight from the game and arrives automatically via the EDMC plugin. Treat it as canonical and the URL formats as conveniences.
- **The two UIs will not look identical.** Theming narrows the gap; it will not close it. Accepted (ADR-009).
- **The non-commercial constraint is not shipyard-scoped.** It applies to the whole site for as long as Coriolis's data is used anywhere in it.
