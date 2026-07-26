# SEED PLAN

Three distinct seeding concerns, often confused. They have different sources, different idempotency requirements, and different consequences if wrong.

| Kind | What | Runs in | Idempotent | Source |
|---|---|---|---|---|
| **Bootstrap** | Data the application cannot function without | every environment, including production | must be | this file |
| **Reference** | FDevIDs name mappings, commodity catalogue | every environment | must be | EDCD/FDevIDs |
| **Fixtures** | Realistic fake data for development and tests | local + CI only | must be | generated |
| **Galaxy seed** | Systems/stations bootstrapped from dumps | local + production | must be, and resumable | Spansh / Ardent dumps |

**Fixtures must never run in production.** The seed entrypoint refuses to load fixtures when `NODE_ENV=production`, and CI asserts that refusal.

---

## 1 — Bootstrap (all environments)

Run by `pnpm db:seed`. Idempotent: upsert by natural key, never insert blindly.

**Roles and permission bundles** — the seven internal roles and five orthogonal tags from `02-domain/rings-and-roles.md`, with masks taken from `ROLE_PRESETS` in `04-contracts/permissions.ts`. **The masks are imported from that file, never retyped**, or the seed becomes a second source of truth for permissions.

**Forum categories** — the tree from `02-domain/rings-and-roles.md`, with `viewPerm` / `postPerm` masks likewise imported.

**Site config defaults** — home system (decision D3), squadron display identity (D12), EDDN prefilter radius (D4), AI kill switches (both off, i.e. AI enabled), data-freshness thresholds (green <24 h, amber <7 d, red older).

**Feature flags** — one per module, all `false` except those the current phase has shipped. Lets a phase's work land dark.

**Achievements** — the badge catalogue.

**Squadron ranks** — the full ladder from `02-domain/rings-and-roles.md`: nine tenure ranks with
their `tenureMonths` thresholds, six loyalty ranks, four leadership ranks and two reserved ranks.

> **`roleKey` MUST be NULL for every `tenure` and `loyalty` row.** The seed asserts this before
> writing; a rank that quietly acquired a role mapping is exactly the INV-046 violation the
> distinction exists to prevent, and a seed is the easiest place for it to creep in.

> **Not seeded, deliberately:** `role_mappings`. Discord role IDs are decision D2 and are environment-specific. Seeding guessed IDs would silently grant or withhold access — a security defect. The admin console's mapping editor is the only way they arrive, and P1 exit requires them configured.

---

## 2 — Reference data (all environments)

`pnpm db:seed:reference` — populates `reference_names` from **EDCD/FDevIDs** for commodities, modules, ships and rare commodities.

- **Never hand-map** (INV-020). The mapping is downloaded from the FDevIDs release and parsed.
- Idempotent upsert on `(kind, internalName)`.
- Re-run monthly, alongside the `coriolis-data` check — Frontier keeps adding ships and commodities, and an unmapped internal name is a user-visible defect.
- **A commodity present in `market_orders` with no `reference_names` row is an alert**, not a silent fallback to the internal name.
- Pinned to a specific FDevIDs release tag, recorded in `site_config`, so a re-run is reproducible.

---

## 3 — Development fixtures (local + CI only)

`pnpm db:seed:dev`. Deterministic: a fixed PRNG seed, so a failing test is reproducible and diffs are stable.

The fixture set exists to make **authorization and freshness testable**, so it deliberately spans every boundary:

| Fixture | Content | Exists to test |
|---|---|---|
| Users | 12: 1 sysadmin, 1 commander, 2 officers, 1 wing lead, 5 members, 1 applicant, 1 left | every ring boundary, both directions |
| Verifications | one per tier (3/2/1), one expired-stale, one revoked | trust tiers, the 25-day decay, INV-005 |
| Privacy | one member fully private, one fully public, rest default | INV-027 — the fully-private member must be absent from public responses |
| Forum | full category tree; threads and posts in public, member and officer categories; one soft-deleted post; **one Ring 2 post containing a unique nonsense token** | INV-002, INV-024 — the token is what the Ring 0 search test looks for and must not find |
| Systems | ~50 real systems with true coordinates, including two with **ambiguous names** | INV-018 — ambiguity must return candidates, not a guess |
| Stations | ~120, mixed pad sizes, one at 200,000 Ls, three fleet carriers | INV-026 — the distant one must not appear in a default route query |
| Market orders | ~2,000 rows spanning fresh (<1 h), amber (3 d) and stale (40 d) | INV-004 — every freshness bucket rendered |
| Ships & loadouts | 20 ships, 12 loadouts across all three visibilities, 3 doctrine builds | fleet queries, doctrine, visibility filtering |
| Carriers | 2 owned, 1 unowned, one low on fuel | ownership predicates, the shortfall widget |
| Operations | one past with attendance, one live, two future, one at capacity with standby | standby promotion, timezone rendering |
| BGS | 3 tracked factions (1 ours), 14 days of snapshots across 8 systems, 14 ticks, active orders, one conflict | tick association, delta computation, INV-019 |
| Telemetry | events across every category for a member who consented to only two | INV-013 — non-consented categories must be rejected |
| Knowledge chunks | chunks mirroring the forum fixtures, **including the Ring 2 token** | INV-003 — the ACL leak test's primary fixture |
| AI | one conversation with a successful call, one denied call, one needing confirmation | INV-009, INV-011, INV-014 |

**Real system names and coordinates are used** (Sol, Shinrarta Dezhra, Colonia, Deciat and so on), because fake coordinates make spatial queries untestable and fake system names train everyone to ignore wrong ones. Market prices are synthetic and clearly labelled as fixture data.

---

## 4 — Galaxy seed from dumps (local + production)

`pnpm db:seed:galaxy` — bootstraps `systems` and `stations` from Spansh's galaxy dump and/or Ardent's downloads, rather than waiting weeks for organic EDDN coverage (ADR-007, task P3.5).

Requirements, all mandatory:
- **Idempotent** — re-running changes nothing. Verified by comparing row counts and a checksum before and after a second run.
- **Resumable** — a multi-GB stream must survive an interruption. Progress is checkpointed by file offset; a restart continues rather than starting over.
- **Prefiltered on the way in** — only systems inside the configured radius (decision D4) plus tracked BGS systems are inserted. Filtering at parse time, not after insert, is what makes this feasible on a 160 GB disk.
- **Streaming parse.** The dump does not fit in memory; a naive `JSON.parse` of the file is an out-of-memory crash.
- **Never overwrites fresher EDDN data** — the same stale-timestamp rule as the collector applies (INV-017). A dump is a floor, not an override.
- Records the dump's date and source in `site_config` so coverage gaps are explainable.

---

## 5 — Test database strategy

- **Unit tests** touch no database.
- **Integration tests** run against an ephemeral Postgres (Docker in CI, Compose locally), migrated fresh, then seeded with fixtures.
- **Isolation by transaction rollback** per test where possible; by truncate-and-reseed where a test needs committed data (anything exercising triggers, generated columns or the materialised view).
- **Never a shared long-lived test database.** Cross-test pollution produces failures that reproduce only in CI, which is the worst kind.
- The **ACL leak fixture set is loaded for every authorization test**, so a new endpoint is tested against the same boundary corpus as every existing one.
