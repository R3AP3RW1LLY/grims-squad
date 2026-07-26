# ADR-001 — TypeScript everywhere, in a pnpm + Turborepo monorepo

**Status:** Accepted · **Date:** 2026-07-25 · **Spec origin:** §4 (assumption A4)

## Context

Six deployable units (`web`, `api`, `bot`, `worker`, `eddn-collector`, `gsai`) share a data model, a permission model, and a large set of validation schemas. The team is one or two hobbyists. The single biggest source of bugs in a split-language, split-repo setup at this scale is drift between the front end's idea of a DTO and the back end's.

## Decision

**One language — TypeScript — across every service, in one repository**, using pnpm workspaces + Turborepo.

- `apps/`: `web` (Next.js 15 App Router, React 19), `api` (NestJS 11 on the Fastify adapter), `bot` (discord.js v14), `worker` (BullMQ), `eddn-collector` (zeromq), `gsai` (gateway + agent, deployed to the local box).
- `packages/`: `db` (Prisma), `shared` (Zod schemas, DTOs, enums, permissions), `ed-clients` (external adapters), `ed-domain` (ship maths, FDevIDs mapping), `ui` (design system), `ai-tools` (tool registry), `config` (eslint/tsconfig/prettier bases).
- Node 24 LTS. `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. `any` is banned.
- **`packages/shared` holds the Zod schemas used by both ends.** This is the single largest quality-of-life win in the design and the main justification for the monorepo.
- Cross-package imports only via `@grims/*` aliases; deep relative imports across package boundaries are a lint error.
- The one exception to "TypeScript everywhere": the **EDMC plugin is Python**, because EDMC is a Python host. It lives in `plugins/edmc-grimssquad/` and communicates only over the documented HTTP contract in `04-contracts/telemetry-contract.md`.

## Consequences

**Positive**
- A DTO changes in one place and both ends fail to compile until they agree.
- The bot and the API share one Prisma client and one authorization module, so "what Discord thinks you are" and "what the site thinks you are" cannot drift.
- One toolchain, one lint config, one test runner, one CI pipeline.
- Turborepo caching keeps the PR pipeline fast enough that developers do not route around it.

**Negative / accepted costs**
- `pnpm install` at the root is slower than a single-service repo.
- A careless import can couple two apps that should be independent — mitigated by the alias-only rule and by `depcruise`-style boundary lint in CI.
- Node is not the fastest possible runtime for the EDDN firehose. Accepted: batching (§`05-integrations/eddn.md`) makes the bottleneck Postgres, not the parser.
- TypeScript's `bigint` ergonomics are awkward, and we use `bigint` heavily (credits, `SystemAddress`, permission masks). Accepted deliberately — see ADR-005.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Python / Django** | Strong ED-ecosystem ecosystem fit (EDMC, BGS-Tally are Python) but forces a second language for the front end, reintroducing DTO drift — the exact problem the monorepo exists to solve. |
| **Go** | Excellent for the EDDN collector specifically. Rejected because it would be a second language maintained by a one-person team for one service, and because the Prisma/Zod sharing story disappears. |
| **PHP / Laravel** | Mature forum and admin tooling, but no path to sharing types with a React front end and a weak story for the AI agent runtime. |
| **Polyrepo (one repo per service)** | Version-skew between the shared schema packages becomes a constant tax, and atomic cross-service changes need coordinated PRs. Unjustifiable at this team size. |
| **Nx instead of Turborepo** | More capable, more configuration. "Prefer boring" (`constraints.md`) — Turborepo's task graph plus pnpm workspaces is sufficient here. |
| **Drizzle instead of Prisma** | Genuinely attractive for the raw-SQL-heavy trade queries. Rejected because Prisma's migration workflow and generated client are a better fit for a hobbyist maintainer, and the handful of hot queries can drop to raw SQL through Prisma's `$queryRaw` without abandoning the ORM. |
