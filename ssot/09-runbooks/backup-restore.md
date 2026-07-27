# RUNBOOK — Backup and restore

> **An untested backup is a rumour.** The restore test is the point of this document; the backup job is the easy half.

## What is backed up

| Data | Method | Frequency | Retention |
|---|---|---|---|
| Postgres | `pg_dump` (custom format) + **WAL archiving** | nightly full, continuous WAL | 30 days |
| Object storage (uploads) | provider replication or `rclone sync` | nightly | 30 days |
| Meilisearch index | **not backed up** | — | rebuilt from Postgres |
| Redis | **not backed up** | — | cache, queues and sessions; loss forces re-login and re-queues jobs |
| Secrets | **NOT backed up** — a root-owned `0600` `.env` on the VPS (decision D6) | — | — |
| `ssot/` and code | git | every commit | forever |

> ⚠ **Secrets are NOT backed up, and that is a deliberate gap you must close manually.**
> Since decision D6 they live only in a root-owned `0600` `/srv/grims/.env` on the VPS. If the box
> is destroyed, that file is gone with it. **Keep an offline copy somewhere you control** — a
> password manager entry is fine — and treat "VPS destroyed" as also meaning "re-enter every
> secret by hand". This is the honest cost of choosing no external secret store; the alternative
> was a third-party dependency you declined.

**Meilisearch and Redis are deliberately excluded.** Both are derived or ephemeral. Backing them up would create a second source of truth for data Postgres already owns — and a stale search index restored over a fresh database is worse than an empty one.

## Backup job

```bash
# /srv/grims/backup.sh — cron 03:00 UTC daily
set -euo pipefail
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

docker compose -f /srv/grims/compose.prod.yml exec -T postgres \
  pg_dump -U grims -Fc grimssquad > "/tmp/grimssquad-${STAMP}.dump"

# Verify the dump is READABLE before shipping it. A dump that pg_restore cannot
# list is not a backup, and this catches truncation and disk-full silently.
pg_restore --list "/tmp/grimssquad-${STAMP}.dump" > /dev/null

rclone copy "/tmp/grimssquad-${STAMP}.dump" "backup:grims/db/"
rm -f "/tmp/grimssquad-${STAMP}.dump"

rclone sync /srv/grims/uploads backup:grims/uploads/
curl -fsS "$HEALTHCHECK_PING_URL"      # dead-man's switch — silence is a failure
```

**The dead-man's switch matters more than the job.** A backup job that stops running produces no error — only an absence. The monitor alerts on the missing ping, not on a failure signal.

## Restore — full database

```bash
# 1. STOP the writers first. Restoring under live writes produces a corrupt result.
docker compose -f compose.prod.yml stop api worker bot eddn

# 2. Fetch
rclone copy backup:grims/db/grimssquad-<STAMP>.dump /tmp/

# 3. Restore into a NEW database, never over the live one
docker compose exec -T postgres createdb -U grims grimssquad_restore
docker compose exec -T postgres pg_restore -U grims -d grimssquad_restore \
  --no-owner --no-privileges < /tmp/grimssquad-<STAMP>.dump

# 4. VERIFY before swapping
docker compose exec -T postgres psql -U grims -d grimssquad_restore -c '\dt' | wc -l
docker compose exec -T postgres psql -U grims -d grimssquad_restore \
  -c 'select count(*) from users; select count(*) from forum_posts; select max(created_at) from audit_log;'

# 5. Swap
docker compose exec -T postgres psql -U grims -c \
  'ALTER DATABASE grimssquad RENAME TO grimssquad_old;
   ALTER DATABASE grimssquad_restore RENAME TO grimssquad;'

# 6. Restart, then rebuild what was not backed up
docker compose -f compose.prod.yml start api worker bot eddn
pnpm search:reindex        # Meilisearch, from Postgres
pnpm rag:reindex           # knowledge_chunks — see the WARNING below

# Verify BOTH extensions survived the restore. A dump restored into an image
# lacking either one silently loses the hypertable or the vector column type.
psql -c "select extname from pg_extension where extname in ('timescaledb','vector','cube','citext');"
psql -c "select hypertable_name from timescaledb_information.hypertables;"   # expect market_history
```

**Keep `grimssquad_old` for at least 48 hours.** Renaming is instantaneous and reversible; dropping is neither.

## ⚠ Restore consequences you must handle

| Consequence | Why | Action |
|---|---|---|
| **Sessions are invalid** | Redis is not restored | Members re-login. Expected; say so in the announcement. |
| **Queued jobs are lost** | Redis is not restored | Re-enqueue reference refresh and any pending digests. |
| **Search returns nothing** | Meilisearch not restored | `pnpm search:reindex`. |
| **RAG index is stale or absent** | `knowledge_chunks` restored to a point in time | **`pnpm rag:reindex`. A chunk whose visibility predates a restored ACL change is a leak (INV-003).** Treat this as a security step, not a convenience. |
| **EDDN data has a gap** | Collector was stopped | It self-heals as CMDRs visit. Seed from a dump if the gap is large. |
| **Telemetry gap** | Endpoint was down | Members' plugins retried and dropped. Unrecoverable; acceptable. |
| **Idempotency keys lost** | 24-hour TTL rows | A client retry may double-apply. Low risk; note the window. |

The RAG re-index is the one that is genuinely dangerous to skip.

## Point-in-time recovery

WAL archiving allows restore to a specific moment — the tool for "a bad migration ran at 14:32".

```bash
# restore the base backup, then in recovery.conf / postgresql.auto.conf:
restore_command = 'rclone cat backup:grims/wal/%f > %p'
recovery_target_time = '2026-07-25 14:31:00+00'
```

Verify `recovery_target_time` is **before** the damaging event, in **UTC**. A local timestamp here restores to the wrong moment and looks like it worked.

## ★ The monthly restore test — mandatory

**The most important item in this runbook.** Scheduled, and its absence alerts after 30 days.

```
1. Take the most recent production dump.
2. Restore it into a scratch database on the VPS (or locally).
3. Point a local API instance at it.
4. Verify:
     [ ] Table count is 56
     [ ] users, forum_posts and audit_log row counts are plausible against production
     [ ] A member profile loads
     [ ] A forum thread with posts loads
     [ ] Encrypted token columns are still unreadable as plaintext
     [ ] search:reindex completes
     [ ] rag:reindex completes and the ACL leak test still passes
5. Record the date and result in STATUS.md.
6. Drop the scratch database.
```

**Failing to run it for 30 days is itself an alert.** A restore procedure that has never been executed is a document, not a capability.

## Alerts

| Condition | Threshold | Severity |
|---|---|---|
| Backup ping missing | > 26 hours | **critical** |
| `pg_restore --list` verification failed | any | **critical** |
| Backup size deviates > 30% from the trailing mean | any | warning — could be truncation or a retention bug |
| Restore test not run | > 30 days | warning, escalating weekly |
| WAL archiving lagging | > 15 min | warning |
| Backup storage > 80% | any | warning |

## Disaster scenarios

| Scenario | Response |
|---|---|
| VPS destroyed | Provision a new one (`deploy.md`), restore the latest dump, re-point DNS. **Target: under 2 hours.** |
| Database corrupted, cause unknown | PITR to before the earliest suspicious event. Keep the corrupt copy for analysis. |
| Ransomware / malicious deletion | Backups are in a separate provider with separate credentials. **Restore, rotate every secret, then investigate.** |
| Accidental destructive migration | PITR to immediately before it. This is why a destructive migration requires a fresh backup and a human (ADR-018). |
| Local AI box lost | **Nothing to restore.** No unique state lives there — models re-pull, the RAG index is on the VPS. Rebuild from `models.md`. |
| Backup storage credentials lost | The reason a second admin holds credentials (risk R3). |

## Encrypted database backups (live since 2026-07-26)

**Schedule:** 04:00 and 16:00 `America/Los_Angeles`, via `/etc/cron.d/grims-backup`.
`CRON_TZ` is pinned so the times hold across daylight saving — without it they
would drift by an hour twice a year, which nobody notices until they are looking
for a backup that ran at the wrong time.

**Destination:** `s3://grims-squad-vault/database/` on Vultr Object Storage
(`sjc1`, private, verified 403 to anonymous requests).

**Script:** `infra/scripts/backup-db.sh`, deployed to `/srv/grims/backup-db.sh`.

### Why the dump is encrypted before it leaves the server

The bucket is on the **same Vultr account** as the server. Without client-side
encryption, one compromised Vultr login yields the server *and* every backup of
it. `BACKUP_ENCRYPTION_KEY` lives in `/srv/grims/.env`, which is itself inside
the secrets vault — so a total server loss is recoverable, but a stolen bucket
on its own is not useful.

### Why `pg_dump` rather than disk snapshots

A snapshot restores the whole machine to a moment. A dump restores **one table**
to a moment, which is what you actually need when a migration ate a column. It
is also roughly a fifth of the price of Vultr's snapshot surcharge.

### What the script refuses to do

It will not upload a backup it has not verified:

- under 2 KB → refused as truncated
- fewer than 40 `CREATE TABLE` statements → refused as the wrong database or a
  dump that stopped early
- no `PostgreSQL database dump complete` marker → refused as truncated

A stub that uploads "successfully" is worse than a visible failure, because it
silently replaces the belief that a backup exists.

### Retention

30 days, with a **floor of 10 backups** that are never pruned regardless of age.
Clock skew or a stalled job must not be able to sweep away every copy at once.

### Restore

```bash
aws --endpoint-url https://sjc1.vultrobjects.com     s3 cp s3://grims-squad-vault/database/<file> .
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in <file> | gunzip > dump.sql
psql -U grims -d grims < dump.sql
```

Verified end to end on 2026-07-26: dump → upload → download → decrypt → restore
into a scratch database → 57 tables, the webmaster mask intact at
`1197902339489246755967`, and the member row with all 8 Discord roles. The
scratch database was dropped afterwards.

**Restore is tested, not assumed.** Re-test after any schema change large enough
to worry about.
