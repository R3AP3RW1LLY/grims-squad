# ADR-005 — Permission bitmask, computed once, enforced in the data layer

**Status:** Accepted · **Date:** 2026-07-25 · **Spec origin:** §5.4, §6.1, §6.2

## Context

Authorization touches every module: forum categories, ops, fleet, carriers, BGS orders, trade, AI tools, admin. The common failure mode is string role checks (`if (user.role === 'officer')`) scattered through controllers, which drift, get forgotten on new endpoints, and cannot be reasoned about as a whole.

Separately, the AI subsystem needs to reduce a caller's authority to a single value it can filter a tool registry and a vector index by, *before* any model sees anything (ADR-015).

## Decision

**A permission bitmask is the single currency of authority, and it is enforced in the data layer first.**

### The mask
- `Permission` is a frozen map of `bigint` bit flags in `04-contracts/permissions.ts`, grouped by domain with reserved gaps between groups so new permissions never renumber existing ones.
- **Roles are named bundles of permissions**, editable in the admin UI, mapped to Discord role IDs by data (`role_mappings`), not by code.
- **Effective mask = OR(all granted role masks) AND NOT user.denyMask.** No other mechanism grants permission (INV-001). Deny always wins.
- Orthogonal tags (`bgs_team`, `carrier_owner`, `miner`, `combat_wing`, `explorer`) are ordinary roles with `isHierarchical = false`. They grant permissions and drive notification routing; they never imply rank.
- Cached in Redis at `perm:{userId}`, TTL 5 min, **busted on `guildMemberUpdate`** and on any role or mapping change.

### Storage type — the mask exceeds 64 bits
`SITE_CONFIG` is `1n << 63n` = 2^63, which is one greater than the maximum of a signed 64-bit integer. Postgres `BIGINT` is signed. Therefore:

- **Postgres: `NUMERIC(40,0)`** (Prisma `Decimal @db.Decimal(40,0)`). Exact, no rounding, room for ~132 bits of future permissions.
- **TypeScript: `bigint`.** `number` is unusable above 2^53.
- **JSON transport: decimal string.** Never a JS number.
- A single pair of converters lives in `packages/shared` and is the only place the two representations meet.

Rejected alternative storage types are listed below; this is the choice the bootstrap brief required be documented.

### Enforcement — two layers, in this order
1. **Data layer (primary).** A Prisma client extension / repository wrapper injects visibility predicates into every query for ACL-bearing models. A query issued on behalf of a Ring 0 caller is *physically incapable* of returning a Ring 1 row, even if a controller check is forgotten or the repository is called directly (INV-002).
2. **Controller guard (secondary).** `@RequiresPermission(...)` on every route, for a clear 403 and an audit trail.

Defence in depth, in that order. A controller guard alone is a defect, not a shortcut.

## Consequences

**Positive**
- One value expresses a caller's entire authority — trivially cacheable, trivially passed to the AI gateway, trivially filtered against.
- Adding a permission is a bit flag plus a role-bundle edit, not a code sweep.
- A forgotten controller guard is a bug, not a breach.
- Admin UI can compute a live "who does this affect?" preview by intersecting masks.

**Negative / accepted costs**
- `bigint` ↔ `Decimal` conversion is a real, ongoing ergonomics tax. Contained to `packages/shared`.
- Bit flags are opaque in the database. Mitigated by `describePermissions(mask)`, used in the admin UI and every audit row.
- 64 named permissions is not unlimited. The reserved gaps and the 40-digit numeric give substantial headroom; exhausting it needs a new ADR, not an ad-hoc second column.
- The data-layer extension must be *comprehensive*. A model with an ACL that is not registered with it is invisible to the protection. `ci:invariants` includes a test enumerating ACL-bearing models against the extension's registry.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **String role checks in controllers** | The exact drift-and-forget failure this ADR exists to prevent. |
| **Full RBAC tables with a permission join per request** | A join (or several) on every request for data that changes rarely, when a cached 128-bit integer answers the same question. Also unusable as a compact context for the AI gateway. |
| **Postgres row-level security (RLS)** | Genuinely attractive and enforces below the ORM. Rejected because it requires per-request `SET LOCAL` role/GUC plumbing through Prisma's connection pool, which is fragile and easy to get subtly wrong; and because policy logic would then live in migrations, away from the tests that prove it. Reconsider if the data-layer extension proves leaky. |
| **`BIGINT` storage with 63 permissions** | Would cap us at 63 and require renumbering to make room. The spec's own permission list already reaches bit 63. |
| **Two `BIGINT` columns (low/high)** | Every query and comparison doubles. All the cost of a big integer with none of the clarity. |
| **`BYTEA` / bit string storage** | Efficient, but arithmetic and comparison in SQL become awkward and the value is unreadable in ad-hoc queries. `NUMERIC` is exact and legible. |
| **Storing the effective mask denormalised on `users`** | Would need recomputation on every role, mapping and bundle change, with a stale-value failure mode that silently grants access. Compute from roles, cache in Redis, bust on change. |
| **Casbin or a policy engine (OPA)** | A whole additional runtime and DSL for a permission model that fits in one file. "Prefer boring." |
