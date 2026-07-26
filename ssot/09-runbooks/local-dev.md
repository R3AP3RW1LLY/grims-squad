# RUNBOOK — Local development

## Prerequisites
| Tool | Version | Check |
|---|---|---|
| Node | 22 LTS | `node --version` |
| pnpm | 9+ | `pnpm --version` |
| Docker + Compose | current | `docker compose version` |
| Prisma CLI | **pinned to 6.x** (decision D17) | `npx prisma --version` |

> Prisma 7 moved the connection URL out of the schema into `prisma.config.ts`. Our SSOT schema uses the ≤6 form and validates on **6.19.3**. Do not upgrade without resolving D17.

## First run

```bash
git clone <repo> grim-squad && cd grim-squad
pnpm install

cp .env.example .env            # placeholders only — fill in local values
docker compose -f infra/docker/compose.dev.yml up -d   # postgres, redis, meilisearch

pnpm db:migrate:dev             # creates all 54 tables + hand-written indexes
pnpm db:seed                    # roles, categories, site config
pnpm db:seed:reference          # FDevIDs commodity/module/ship names
pnpm db:seed:dev                # deterministic fixtures — NEVER runs in production

pnpm dev                        # web :3001, api :3000
```

## Verify the stack is actually working

```bash
curl -s localhost:3000/v1/health | jq
# expect: status "ok", every check "ok"

docker compose -f infra/docker/compose.dev.yml exec postgres \
  psql -U grims -d grimssquad -c '\dt' | wc -l      # expect 54 tables + header

# The hand-written indexes are the easiest thing to forget:
docker compose -f infra/docker/compose.dev.yml exec postgres \
  psql -U grims -d grimssquad -c \
  "select indexname from pg_indexes where indexname in
   ('systems_xyz_idx','market_orders_sell_idx','market_orders_buy_idx',
    'cmdr_verifications_active_name_uniq','knowledge_chunks_embedding_idx');"
```

If any of those five are missing, the migration is incomplete — see `03-data/indexes.md`.

## Everyday commands

| Command | Does |
|---|---|
| `pnpm dev` | web + api with hot reload |
| `pnpm test` | unit + integration |
| `pnpm test:unit` | unit only, no database |
| `pnpm test:invariants` | **only `@INV-nnn` tagged tests** |
| `pnpm typecheck` | strict, all packages |
| `pnpm lint` | ESLint + Prettier |
| `pnpm ssot:check` | **the drift check — run before every PR** |
| `pnpm ssot:sync` | re-copy/regenerate from `ssot/` after changing the SSOT |
| `pnpm db:studio` | Prisma Studio |
| `pnpm db:reset` | drop, migrate, seed. **Destroys local data.** |

## Changing the schema — the order matters

```
1. Edit ssot/03-data/schema.prisma          ← the SOURCE
2. npx prisma format --schema ssot/03-data/schema.prisma
3. npx prisma validate --schema ssot/03-data/schema.prisma
4. pnpm ssot:sync                            ← copies to packages/db
5. pnpm db:migrate:dev --name <descriptive>
6. Add any hand-written index DDL to the migration by hand (03-data/indexes.md)
7. pnpm ssot:check                           ← must pass
```

**Editing `packages/db/prisma/schema.prisma` directly is the single most common SSOT drift.** CI will catch it; catching it yourself is faster.

## Running the ED services locally

| Service | Local approach |
|---|---|
| Discord | A **separate test guild**. Never develop against the live one — a mistaken role sync affects real members. |
| EDDN | Real relay. It is public and read-only; connecting from a dev machine is fine and harmless. |
| Ardent / EDSM / GalNet | Real, anonymous. Cache aggressively so a dev loop is not hammering them. |
| Spansh | **Use the fake unless testing the adapter itself.** One maintainer; do not burn their capacity on a dev loop. |
| Inara | **Fake only.** The 2/min global budget must not be spent locally. |
| cAPI | Fake, unless doing a deliberate live verification round trip. |
| Ollama | Optional locally. Without it, `/v1/ai/status` reports `OFFLINE` — which is also a useful default, since INV-030 says the site must work that way. |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `pnpm install` fails on a workspace protocol | Wrong pnpm major | Install pnpm 9+ |
| `prisma validate` rejects `url = env(...)` | Prisma 7 installed | Pin to `prisma@6` (D17) |
| Migration succeeds but a partial index is missing | Prisma cannot express partial indexes | Add the raw SQL from `03-data/indexes.md` to the migration |
| `type "vector" does not exist` | pgvector extension missing | Use the `pgvector/pgvector:pg16` image, not stock postgres |
| `type "citext" does not exist` | extension missing | `CREATE EXTENSION citext;` — it should be in the first migration |
| Everyone appears to be a guest | **SERVER MEMBERS intent not enabled** | Enable it on the Discord application. This fails silently. |
| `guild_roles` empty after login | Wrong OAuth scope | Must be `guilds.members.read`, not `guilds` |
| Integration tests flake | Shared test database | Each run migrates a fresh ephemeral database — never a shared one |
| Contrast check fails after a token edit | A pair dropped below AA | See `07-design/accessibility.md`; pick a compliant token |
| `ssot:check` fails and you did not touch the SSOT | You edited a generated copy | Revert the copy, change the SSOT, `pnpm ssot:sync` |

## Ports

| Port | Service |
|---|---|
| 3000 | api |
| 3001 | web |
| 3300 | coriolis (P7) |
| 5432 | postgres |
| 6379 | redis |
| 7700 | meilisearch |
| 11434 | ollama-interactive (P8) |
| 11435 | ollama-heavy (P8) |
