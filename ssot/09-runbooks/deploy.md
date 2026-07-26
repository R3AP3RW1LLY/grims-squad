# RUNBOOK — Deploy

## Environments

| Env | Where | Deploy trigger | Database |
|---|---|---|---|
| `local` | Docker Compose | manual | ephemeral |
| `staging` | Same VPS, separate compose project | **automatic** on merge to `main` | separate |
| `production` | VPS + local box | **manual gate** after staging smoke tests | primary |

**Production is never deployed autonomously** (ADR-019). Staging is. That gate is the last human checkpoint before members are affected.

## Pipeline

```
merge to main
  → build and push images (tagged with the commit SHA)
  → deploy staging
  → smoke tests
  → ★ MANUAL GATE ★
  → deploy production
  → post-deploy health verification
  → automatic rollback if health fails
```

## Deploying production

```bash
# 1. Confirm staging is healthy and the smoke tests passed
curl -s https://staging.<domain>/v1/health | jq '.status'     # "ok"

# 2. Approve the manual gate in the GitHub Actions run

# 3. Watch the rolling replace
ssh vps 'docker compose -f /srv/grims/compose.prod.yml ps'

# 4. Verify
curl -s https://<domain>/v1/health | jq
curl -sI https://<domain> | head -1                            # 200
```

### What rolls and what does not

| Service | Strategy | Note |
|---|---|---|
| `web`, `api`, `worker` | rolling replace | zero downtime |
| `bot` | stop/start | **singleton.** A few seconds' gap is accepted; it must be resumable |
| `eddn-collector` | stop/start | **singleton.** Must lose no acknowledged message and create no duplicate (INV-034) |
| `postgres`, `redis`, `meilisearch` | not replaced | data services; upgrades are a separate, planned operation |
| `coriolis` | rolling | pinned upstream; only redeployed deliberately |

## Migrations — expand/contract, always

`prisma migrate deploy` runs **before** the new image serves traffic. Therefore every migration must be **backwards-compatible with the currently-running version**.

```
Adding a column         → nullable or defaulted. Never NOT NULL without a default.
Renaming a column       → THREE deploys: add new → backfill + dual-write → drop old.
Dropping a column       → only after no running version references it.
Adding an index         → CREATE INDEX CONCURRENTLY, outside a transaction.
Changing a type         → new column, backfill, swap, drop. Never an in-place ALTER TYPE.
```

**A migration that is not reversible cannot be merged autonomously** (ADR-018). Destructive migrations require a human and a fresh backup taken immediately beforehand.

## Rollback

```bash
# Application rollback — one command
ssh vps 'cd /srv/grims && ./rollback.sh <previous-sha>'

# Verify
curl -s https://<domain>/v1/health | jq '.version'
```

**Reverting `main` never needs permission.** If production is suspected broken, revert first and diagnose after — `main` staying green outranks any individual change (ADR-018).

**A schema rollback is different and is not automatic.** If the migration was expand-only (as it should be), the old code runs fine against the new schema and no schema rollback is needed. If a contract step has already run, restore from backup (`backup-restore.md`) — this is precisely why contract steps are separate deploys.

## Post-deploy verification

```bash
curl -s https://<domain>/v1/health | jq                     # all checks ok
curl -s https://<domain>/v1/admin/health | jq '.eddn'       # lag < 60s
curl -s https://<domain>/v1/systems/search?q=Sol | jq '.[0]'
```

Then check for 15 minutes:
- Sentry: no new error class
- EDDN lag stable and not climbing
- Queue depths draining, not growing
- p95 latency comparable to pre-deploy

## First-time VPS provisioning

```bash
# Harden BEFORE anything else is installed
ssh-copy-id vps
# disable password auth and root login in /etc/ssh/sshd_config
apt install -y fail2ban ufw unattended-upgrades
ufw default deny incoming && ufw allow 22,80,443/tcp && ufw enable

# Docker, then the stack
curl -fsSL https://get.docker.com | sh
mkdir -p /srv/grims && cd /srv/grims
# place compose.prod.yml, Caddyfile, and .env from the SECRET STORE — never from the repo
docker compose -f compose.prod.yml up -d
```

DNS through Cloudflare, proxied. Caddy obtains and renews certificates automatically.

## Secrets

- **Never in the repository.** `.env.example` holds placeholders only (INV-036).
- Production secrets come from the store chosen in decision D6 and are injected at deploy.
- **Rotation is quarterly**, or immediately on any suspicion (`secrets-rotation.md`).
- gitleaks runs against the full history on every PR — a secret that reaches `main` is rotated first, investigated second.

## Deploying GSAI to the local box (P8)

Separate target, separate cadence. The site does not wait for it.

```bash
# On the local box
systemctl restart ollama-interactive ollama-heavy
ollama ps                                          # size_vram MUST equal size
OLLAMA_HOST=127.0.0.1:11435 ollama ps

cd /opt/gsai && docker compose up -d gsai-gateway gsai-agent
curl -s http://localhost:8443/health

# Confirm the API sees the heartbeat
curl -s https://<domain>/v1/ai/status | jq '.status'   # "online"
```

**If the local box is down, do not delay a site deploy for it.** The site is designed to be entirely functional without it (INV-030), and behaving otherwise would quietly turn a best-effort component into a dependency.

## Deploy checklist

- [ ] CI fully green, including `ssot:check` and the invariant suite
- [ ] Review gates for the risk tier passed, zero unresolved BLOCKER/MAJOR
- [ ] Migration is expand-only and reversible
- [ ] `ssot/STATUS.md` updated
- [ ] Backup taken if the migration is destructive
- [ ] Staging smoke tests passed
- [ ] Manual gate approved by a human
- [ ] Post-deploy health verified
- [ ] 15-minute observation window clear
