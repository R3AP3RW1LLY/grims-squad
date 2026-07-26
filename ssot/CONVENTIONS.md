# CONVENTIONS

## Naming

| Context | Style | Example |
|---|---|---|
| SQL tables, columns | `snake_case`, tables plural | `forum_threads`, `market_id` |
| Prisma model | `PascalCase` singular, `@@map` to snake plural | `model ForumThread { @@map("forum_threads") }` |
| Prisma field | `camelCase`, `@map` to snake | `systemAddress Int @map("system_address")` |
| TypeScript vars/functions | `camelCase` | `computeEffectiveMask` |
| TypeScript types/classes/components | `PascalCase` | `TradeRouteDto`, `FreshnessBadge` |
| Constants, env vars | `SCREAMING_SNAKE` | `EDDN_RELAY_URL` |
| Files | `kebab-case.ts` | `discord.controller.ts`, `trade-route.service.ts` |
| Test files | `<subject>.spec.ts` (unit), `<subject>.int.spec.ts` (integration), `<subject>.e2e.spec.ts` | `permissions.spec.ts` |
| React components | `PascalCase.tsx` | `SystemHoverCard.tsx` |
| Booleans | read as assertions | `isVerified`, `hasCarrier`, `canModerate` |
| Permissions | `SCREAMING_SNAKE`, `<DOMAIN>_<VERB>[_<SCOPE>]` | `FORUM_VIEW_OFFICER` |
| Queues (BullMQ) | `kebab-case` | `spansh-plot`, `rag-index` |
| Redis keys | `colon:delimited:lowercase` | `perm:{userId}`, `nonce:gsai:{nonce}` |
| WS channels | `resource:id` | `ops:{opId}`, `ai:{conversationId}` |
| Git branches | `p<n>/<task-id-kebab>-<slug>` | `p2/p2-4-reactions-subscriptions` |
| ADR files | `ADR-<nnn>-<kebab-title>.md` | `ADR-007-eddn-own-collector.md` |

## Units — always suffix, never guess

`Ly`, `Ls`, `Cr`, `Tons`, `Ms`, `Hours`, `Days`, `Mb`, `Pct`.
`distanceLy`, `distanceToArrivalLs`, `profitPerTonCr`, `dataAgeHours`, `latencyMs`.
A bare number in an API response is a defect.

## Time

- All timestamps stored and transmitted as **UTC ISO-8601** with `Z`.
- Elite runs on game time = UTC. Every user-facing time renders **both** local and UTC.
- `TIMESTAMPTZ` in Postgres, `DateTime` in Prisma. Never a naive local timestamp.

## Money & big numbers

- Credits: `BigInt` in TS, `BIGINT` in PG. Never `number` — squadron totals exceed 2^53.
- `SystemAddress`, `MarketId`: `BigInt` / `BIGINT`. Never string, never number.
- Permission masks: `bigint` in TS, `Decimal`/`NUMERIC(40,0)` in PG (see ADR-005).

## Repository layout

```
apps/       web api bot worker eddn-collector gsai
packages/   db shared ed-clients ed-domain ui ai-tools config
infra/      docker tunnel grafana
plugins/    edmc-grimssquad
docs/       source spec, provenance
ssot/       the law
```

## Imports

Workspace packages only via aliases: `@grims/shared`, `@grims/db`, `@grims/ed-clients`, `@grims/ed-domain`, `@grims/ai-tools`, `@grims/ui`, `@grims/config`.
No deep relative imports across package boundaries (`../../packages/...` is a lint error).
**Application code never imports a vendor SDK directly** — always through `packages/ed-clients` (ADR-013).

## TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- `any` is banned. `unknown` + a Zod parse at the boundary instead.
- Non-null assertion `!` is banned outside tests.
- Every exported function has an explicit return type.

## Validation

- Zod schemas live in `packages/shared` and are used by **both** ends.
- Every external input — HTTP body, query, EDDN message, telemetry event, AI tool arg — is parsed by Zod at the boundary before it reaches business logic.
- A parse failure is a typed error from `04-contracts/errors.md`, never a 500.

## Errors

- No bare `catch {}`. Catch, classify, log with context, rethrow or convert to a typed error.
- The envelope in `04-contracts/errors.md` is the only shape leaving the API.
- Never leak internal messages, stack traces or SQL to a client.

## Logging

- Pino, structured JSON, one line per event, `requestId` correlated across web → api → gsai.
- **Never log**: tokens, secrets, raw telemetry payloads, AI conversation content, email addresses, IP addresses in plaintext (hash them).
- Levels: `error` needs a human; `warn` is a degraded path taken; `info` is a state change; `debug` is off in prod.

## Comments

Comment *why*, never *what*. Every non-obvious index, every workaround for an upstream bug, and every security control carries a comment saying so. `/// ` doc comments on every Prisma model and non-obvious field.

## Commits — Conventional Commits, task-tagged

```
<type>(<scope>): [P<n>.<m>] <imperative subject>
```

Types: `feat` `fix` `test` `refactor` `perf` `docs` `chore` `ci` `build` `revert`.
Scopes: `api` `web` `bot` `worker` `eddn` `gsai` `db` `shared` `ed-clients` `ed-domain` `ui` `ai-tools` `infra` `ssot` `plugin`.

TDD produces a pair (see `10-quality/tdd-policy.md`):
```
test(api): [P1.2] refresh-token reuse revokes the family — red
feat(api): [P1.2] refresh-token reuse revokes the family — green
```

Footer for SSOT-affecting work: `SSOT: ssot/STATUS.md, ssot/08-plan/tasks.yaml`.
Breaking change: `BREAKING CHANGE:` footer plus an ADR reference.

## Definition of a well-formed PR

Title = the conventional-commit subject. Body must contain:
1. Task ID and link to its `tasks.yaml` entry
2. Acceptance criteria as a checklist, each mapped to the test name that proves it
3. The review-gate table (which §9 gates ran, findings by severity, resolution)
4. Test evidence (command + result)
5. SSOT files touched
6. Risk tier and whether autonomous merge is authorised
