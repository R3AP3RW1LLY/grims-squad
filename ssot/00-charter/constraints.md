# CONSTRAINTS

Hard boundaries. A design that violates one of these is wrong regardless of its other merits.

## Budget

| Item | Monthly | Note |
|---|---|---|
| VPS — 4 vCPU / 8 GB / 160 GB NVMe (Hetzner CX32 class) | $8–15 | The only compute we pay for |
| Domain | $1–3 | |
| Cloudflare (DNS, CDN, Tunnel, Turnstile, Access) | $0 | Free tier covers a team this size |
| Object storage ~50 GB | ~$1 | R2 or MinIO — decision D5 |
| Backups, S3-compatible, 100 GB | ~$2 | |
| Sentry / Grafana Cloud | $0 | Free tiers |
| Transactional email, low volume | $0–10 | Decision D11 |
| **AI inference** | **$0** | Local hardware, by design |
| **Ceiling** | **~$30/mo** | A design that requires more needs human sign-off before implementation |

**Consequences that bind design:**
- No managed Postgres, no managed Redis, no managed search. Self-hosted on the VPS in Compose.
- No paid LLM API in the request path. Cloud fallback is feature-flagged and off (`scope.md`).
- 160 GB disk is the real constraint on the EDDN collector. The radius prefilter (decision D4) is what keeps us inside it — expect ~50 GB with it, unbounded growth without it.

## Hardware — the AI box

| | RTX 3060 (instance A) | RTX 5070 Ti (instance B) |
|---|---|---|
| Architecture / CC | Ampere GA106 / 8.6 | Blackwell GB203 / 12.0 |
| VRAM | 12 GB (**confirm — decision D8**) | 16 GB |
| Bandwidth | 360 GB/s | 896 GB/s |
| TGP | 170 W | 300 W |
| Role | Interactive, resident 24/7, never contended | Batch/overflow, yields to the game |

- **PSU:** 750 W minimum, 850 W comfortable. Both cards can draw peak simultaneously.
- **UPS required.** A power cut mid-`pg_dump` is how untested backups get discovered.
- **NVIDIA driver 580+.** Ollama needs 550+; Blackwell needs newer.
- **Thermals:** the 3060 likely breathes the 5070 Ti's exhaust and is the card running 24/7. The arbiter sheds to DEGRADED above ~83 °C.
- **The box is not always on and that is fine.** The public edge must never depend on it (INV-019).

## Team

**One or two hobbyists, part-time.** This is the constraint that kills clever architecture.

- **Prefer boring.** Every clever abstraction is a future 02:00 debugging session.
- Realistic full-vision timeline: 9–11 months solo, part-time. A genuinely useful v1 (P0–P2 + the EDMC plugin) is 8–10 weeks and is what to aim at first.
- **Bus factor is a named risk.** A second admin must hold credentials; runbooks must be current; the stack stays boring on purpose.
- Agents may merge autonomously within the limits of `10-quality/git-workflow.md` precisely because there is not always a human available to click merge — but never for the changes that section forbids.

## Legal — non-commercial, and it is load-bearing

The right to use Frontier's game data and imagery, and Coriolis's bundled data, rests on this project being non-commercial. Losing that status invalidates the licence basis for a large part of the product.

- **No paid memberships, no ads, no selling access.** Donations to cover hosting are acceptable and must be transparent about what they fund.
- **Footer attribution is mandatory** on every page: *"Created using assets and imagery from Elite: Dangerous, with the permission of Frontier Developments plc, for non-commercial purposes. Not endorsed by Frontier Developments; no Frontier Developments employee was involved in the making of this site."*
- **No direct asset ripping.** The ED aesthetic is recreated from `07-design/tokens.json`, not extracted from the game client.
- If Frontier ever objects, **comply immediately** — do not negotiate first.

### Licences we are bound by

| Component | Licence | What it obliges us to do |
|---|---|---|
| `EDCD/coriolis`, `EDCD/coriolis-data` | MIT | Preserve copyright notices. Attribute ported ship-maths formulas in `packages/ed-domain`. |
| Ardent (api / collector / www) | **AGPL-3.0** | Using the **hosted API imposes nothing**. Self-hosting a **modified** Ardent over a network obliges us to offer the modified source to users. Therefore: hosted API for v1; if self-hosted, run unmodified or keep the fork public. |
| EDCD tooling generally | varies per repo | Check each repository individually before vendoring. |
| Elite Dangerous Wiki text | CC BY-SA | Attribute and share-alike if reused. Preferred: link, don't copy. |
| Our own code | to be chosen by the human | The EDMC plugin **must** ship with a public, readable source (members are installing code that reads their game journal). |

## Privacy & data protection

- **GDPR / UK GDPR applies** if there are EU or UK members, hobbyist status notwithstanding. At this scale it is a page of plain-English policy and two API endpoints — not a compliance programme.
- **Telemetry is opt-in per category, defaulting to off**, with one-click revoke and purge (INV-013).
- **Never publish** a member's credit balance, exact location, or fleet without an explicit per-field opt-in.
- **Data export** — any member can download everything held about them as JSON.
- **Deletion on departure** — offer full purge; default to anonymising forum posts rather than deleting them, to preserve thread coherence, unless they ask otherwise.
- Under-18 members are plausible in an ED squadron (decision D15). Collect no birthdates we don't need; officers must treat DM-based recruitment of minors into voice as a moderation matter.

## Retention

| Data | Retention | Enforced by |
|---|---|---|
| Audit log | 1 year | scheduled purge job |
| AI conversations | 90 days default, user-deletable earlier | scheduled purge job |
| Raw telemetry events | 30 days | scheduled purge job |
| Telemetry aggregates | indefinite | — |
| `market_orders` | current state only | upsert-in-place |
| `market_history` | 90 days | retention job or Timescale compression (decision D10) |
| Backups | 30 days, restore-tested monthly | backup job + `09-runbooks/backup-restore.md` |

Full detail in `03-data/retention.md`.

## Operating constraints

- **The public edge never depends on the home box.** Local box off → site fully functional, GSAI shows OFFLINE honestly (INV-019).
- **`bot` and `eddn-collector` are singletons.** Both must be resumable; a few seconds of gap on deploy is acceptable, silent data loss is not.
- **Rate limits we do not control:** Inara ~2 req/min and requires whitelisting; Spansh is a one-person operation to be treated politely (cache, dedupe, back off); Ardent enforces none currently but asks for respectful use; Discord's REST limits are strict.
- **Every external API sits behind an adapter interface.** The ED third-party ecosystem has a documented habit of disappearing; EDDB is the proof (ADR-013).
