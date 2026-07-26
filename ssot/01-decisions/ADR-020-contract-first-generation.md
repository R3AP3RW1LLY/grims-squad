# ADR-020 — Contracts generate code; code never generates contracts

**Status:** Accepted · **Date:** 2026-07-25 · **Origin:** derived from `AGENTS.md` §1 (SSOT supremacy), the bootstrap brief, and ADR-019

## Context

Four artefacts describe the system's contracts: the Prisma schema, the permission bitmask, the OpenAPI document, and the AI tool registry. Each exists in two places — the SSOT and the codebase. The direction of authority between the two determines whether `ssot/` is the law or merely documentation.

The default habit in most projects is the reverse of what this project needs: write the code, generate the OpenAPI document from decorators, introspect the database into a schema file. That is convenient and it makes the SSOT a lagging description of whatever the code happens to do.

## Decision

**The SSOT artefact is the source. The codebase artefact is derived. Never the reverse.**

| Source of truth | Derived artefact | Mechanism | Drift caught by |
|---|---|---|---|
| `ssot/03-data/schema.prisma` | `packages/db/prisma/schema.prisma` | **copied verbatim** | byte-identical check |
| `ssot/04-contracts/permissions.ts` | `packages/shared/src/permissions.ts` | **copied verbatim** | byte-identical check |
| `ssot/06-ai/tools.yaml` | `packages/ai-tools` registry (Zod schemas, permission bindings, metadata) | **generated** | regenerate and diff |
| `ssot/04-contracts/openapi.yaml` | client types; route/permission coverage assertions | **generated + asserted** | route parity test |
| `ssot/07-design/tokens.json` | Tailwind theme, CSS custom properties | **generated** | regenerate and diff |
| `ssot/02-domain/invariants.md` | the `@INV-nnn` test suite | **manually paired, mechanically checked** | every INV has a passing tagged test |

**Rules:**
1. **To change a contract, change the SSOT file first**, then re-copy or regenerate, then let the implementation follow. Editing the derived artefact is the drift that ADR-019's check exists to catch.
2. `schema.prisma` and `permissions.ts` are **copied, not generated**, because they are already in their target language. `prisma format` is run on the SSOT copy so both sides are canonical and a byte comparison is meaningful.
3. **OpenAPI carries `x-required-permission` on every operation.** A route registered without the permission its OpenAPI operation declares — or a permission mismatch between the two — fails the contract check. This makes the API's authorization surface reviewable as a document.
4. **`tools.yaml` is the authority on what GSAI can do.** A tool that exists in the registry but not in the YAML fails the build. This matters because the tool list *is* the AI's capability boundary (ADR-015).
5. **Generators are deterministic and their output is committed**, so a reviewer sees exactly what changed and CI can diff without running code generation as a trusted step.
6. A breaking contract change requires an ADR and a `BREAKING CHANGE:` commit footer.

## Consequences

**Positive**
- `ssot/` remains genuinely authoritative rather than aspirational — the mechanism, not the intention, keeps it true.
- A reviewer reads one file to understand the whole API surface, or the whole AI capability boundary.
- Client types cannot disagree with the server, because both descend from the same document.
- A new session can trust the SSOT without reading the implementation, which is precisely what the SSOT is for.

**Negative / accepted costs**
- **Writing the contract first is slower** than letting it emerge from decorators, and it feels like duplicated effort when the implementation is obvious.
- Hand-maintaining OpenAPI is more work than generating it from NestJS decorators, and it can be *wrong* in a way generated output cannot. The route-parity test is what makes that safe: a mismatch fails the build in either direction.
- Generated output committed to the repository produces larger diffs.
- Contract changes require touching two places in the correct order. Deliberate friction — the correct order is the entire decision.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Generate OpenAPI from NestJS decorators** | Inverts authority: the document then describes whatever the code does, including its mistakes. The SSOT stops governing. Convenient, and exactly wrong for this project. |
| **Introspect the database to produce `schema.prisma`** | Same inversion, with the schema — the highest-value artefact in the SSOT — as the victim. |
| **Define AI tools in TypeScript, document them in YAML** | The YAML immediately drifts, and the AI's capability boundary becomes whatever code happens to register. That boundary is a security control (ADR-015). |
| **Keep contracts only in the SSOT and hand-write the implementations** | No mechanical link at all, so drift is invisible until something breaks in production. |
| **Symlink the SSOT files into the packages** | Fragile on Windows, confusing in Docker build contexts, and hides the copy step that makes the relationship explicit. An explicit copy plus a CI check is boring and obvious. |
| **Generate at build time without committing output** | Reviewers cannot see what changed, and CI must trust a code-generation step it cannot diff. |
