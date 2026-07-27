#!/usr/bin/env bash
#
# Encrypted PostgreSQL backup to Vultr Object Storage.
#
# Runs twice daily from cron. Installed at /srv/grims/backup-db.sh on the server;
# this copy is the source of truth and is deployed from the repo.
#
# WHY THE DUMP IS ENCRYPTED BEFORE UPLOAD
# The bucket lives on the same Vultr account as the server, so without
# client-side encryption one compromised Vultr login yields the server AND every
# backup of it. The key lives in /srv/grims/.env, which is itself inside the
# secrets vault — so a total server loss is still recoverable, but a stolen
# bucket on its own is not useful.
#
# WHY pg_dump AND NOT A DISK SNAPSHOT
# A snapshot restores the whole machine to a moment. A dump restores ONE TABLE
# to a moment, which is what you actually need at 2am when a migration ate a
# column. It is also a fifth of the price.

set -euo pipefail

ENV_FILE=/srv/grims/.env
LOG=/var/log/grims-backup.log
RETENTION_DAYS=30

log() { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >> "$LOG"; }
die() { log "FAILED: $1"; exit 1; }

[[ -r "$ENV_FILE" ]] || die "cannot read $ENV_FILE"

# Read specific keys rather than `source`-ing the file.
#
# `.env` is written for docker compose, not for bash, so values are unquoted.
# SITE_HOSTNAMES is `https://a, https://b` — sourcing that makes bash treat the
# space as a command separator and try to EXECUTE the second URL. Compose parses
# it correctly; bash does not. Reading only the keys we need is immune to
# whatever else lands in that file later.
envval() {
  local line
  line="$(grep -m1 "^$1=" "$ENV_FILE" || true)"
  printf '%s' "${line#*=}"
}

POSTGRES_USER="$(envval POSTGRES_USER)"
POSTGRES_DB="$(envval POSTGRES_DB)"
BACKUP_ENCRYPTION_KEY="$(envval BACKUP_ENCRYPTION_KEY)"
S3_HOST="$(envval S3_HOST)"
S3_BUCKET="$(envval S3_BUCKET)"
S3_ACCESS_KEY="$(envval S3_ACCESS_KEY)"
S3_SECRET_KEY="$(envval S3_SECRET_KEY)"

for v in POSTGRES_USER POSTGRES_DB BACKUP_ENCRYPTION_KEY S3_HOST S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY; do
  [[ -n "${!v}" ]] || die "$v is missing from $ENV_FILE"
done

STAMP="$(date -u +%Y%m%d-%H%M%S)"
OBJ="database/grims-${STAMP}.sql.gz.enc"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

PG_CONTAINER="$(docker ps --filter 'name=postgres' --format '{{.Names}}' | head -1)"
[[ -n "$PG_CONTAINER" ]] || die "no running postgres container"

log "starting backup -> ${OBJ}"

# --no-owner / --no-acl so the dump restores into a database whose role names
# differ — which is exactly the situation you are in when restoring somewhere new.
docker exec "$PG_CONTAINER" pg_dump \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    --no-owner --no-acl --clean --if-exists \
  | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass "pass:${BACKUP_ENCRYPTION_KEY}" \
  > "$TMP/dump.enc" || die "pg_dump pipeline failed"

SIZE=$(stat -c%s "$TMP/dump.enc")
# A truncated or empty dump that uploads "successfully" is worse than a failure,
# because it silently replaces the idea that you have a backup.
(( SIZE > 2048 )) || die "dump is only ${SIZE} bytes — refusing to upload"

# Prove it decrypts and looks like SQL BEFORE it counts as a backup.
#
# Written to a file rather than piped straight into grep. `grep -q` exits on the
# first match, which closes the pipe and hands gzip a SIGPIPE — and under
# `set -o pipefail` that makes a perfectly good dump report as a failure. The
# check is meant to catch corruption, not to invent it.
set +o pipefail
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "pass:${BACKUP_ENCRYPTION_KEY}" \
  -in "$TMP/dump.enc" 2>/dev/null | gzip -dc 2>/dev/null > "$TMP/verify.sql" || true
set -o pipefail

TABLES=$(grep -c '^CREATE TABLE' "$TMP/verify.sql" || true)
# A dump with a handful of tables is a dump of the wrong database, or one that
# stopped early. Uploading it would quietly replace a real backup with a stub.
(( TABLES >= 40 )) || die "dump contains only ${TABLES} CREATE TABLE statements — expected 40+"
grep -q 'PostgreSQL database dump complete' "$TMP/verify.sql" \
  || die "dump has no completion marker — it was truncated"
log "verified: ${TABLES} tables, dump marked complete"

aws_s3() {
  docker run --rm -i \
    -e AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
    -e AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
    -e AWS_DEFAULT_REGION=us-east-1 \
    -v "$TMP:/data" \
    amazon/aws-cli:latest --endpoint-url "https://${S3_HOST}" "$@"
}

aws_s3 s3 cp /data/dump.enc "s3://${S3_BUCKET}/${OBJ}" >/dev/null 2>&1 \
  || die "upload failed"

log "uploaded ${OBJ} (${SIZE} bytes)"

# ------------------------------------------------------------------ retention
# Deletes by age, but NEVER below a floor. A clock skew or a stalled backup job
# must not be able to sweep away every copy at once.
KEEP_FLOOR=10
CUTOFF=$(date -u -d "-${RETENTION_DAYS} days" +%Y%m%d)
mapfile -t OLD < <(
  aws_s3 s3 ls "s3://${S3_BUCKET}/database/" 2>/dev/null \
    | awk '{print $4}' | grep -E '^grims-[0-9]{8}-' | sort
)
TOTAL=${#OLD[@]}
if (( TOTAL > KEEP_FLOOR )); then
  for f in "${OLD[@]}"; do
    (( TOTAL <= KEEP_FLOOR )) && break
    d="${f#grims-}"; d="${d%%-*}"
    if [[ "$d" < "$CUTOFF" ]]; then
      aws_s3 s3 rm "s3://${S3_BUCKET}/database/${f}" >/dev/null 2>&1 && {
        log "pruned ${f}"; TOTAL=$((TOTAL - 1))
      }
    fi
  done
fi

log "done — ${TOTAL} backup(s) retained"
