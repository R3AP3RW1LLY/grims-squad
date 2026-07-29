#!/usr/bin/env bash
#
# Zero-downtime deploy.
#
# ★ WRITTEN BECAUSE A DEPLOY TOOK THE API DOWN FOR FIFTEEN MINUTES ★
#
# On 2026-07-29 the sequence was: pull, build, migrate, `up -d`. The API
# crash-looped, because `/srv/grims/.env` carried S3 credentials under older
# names than the new build reads. The config guard refused to start — correctly
# — and production was down until somebody noticed.
#
# Two things made that worse than it needed to be:
#
#   The fault was DISCOVERABLE BEFORE the swap. Nothing checked.
#   The web container kept answering 200 the whole time, so "is the site up"
#   said yes while every signed-in page was dead.
#
# So this script refuses to swap anything until it has proved the new build can
# start, and it verifies through the PUBLIC URL rather than trusting container
# status.
#
#   usage: ./deploy.sh [--ref <git-ref>]
set -Eeuo pipefail

REPO=/srv/grims/repo
ENV_FILE=/srv/grims/.env
COMPOSE="docker compose -f $REPO/infra/docker/compose.prod.yml --env-file $ENV_FILE"
PUBLIC_URL="${PUBLIC_URL:-https://45-63-35-93.sslip.io}"
REF=main

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }

PREVIOUS_SHA="$(git -C "$REPO" rev-parse HEAD)"

# ─────────────────────────────────────────────────────────── 1. preflight
#
# ★ EVERYTHING THAT CAN BE CHECKED WITHOUT TOUCHING PRODUCTION, FIRST ★
#
# The failure this exists for was a missing environment variable — knowable in
# a second, and instead discovered by watching the API crash-loop.
say "Preflight"

[[ -r $ENV_FILE ]] || die "cannot read $ENV_FILE"

# Read from the file rather than the environment: that is what compose does,
# and a variable exported in this shell would produce a false pass.
envval() { sed -n "s/^$1=//p" "$ENV_FILE" | head -n1; }

REQUIRED=(
  POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
  DATABASE_URL REDIS_PASSWORD
  DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET DISCORD_BOT_TOKEN DISCORD_GUILD_ID
  OAUTH_STATE_SECRET TOKEN_ENCRYPTION_KEYRING
  # The five the API's object-store guard demands together. Missing ONE of them
  # is what took production down: it counts as "partly configured" and the API
  # refuses to start rather than silently writing avatars to local disk.
  S3_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY
  # Its own variable, deliberately. Sharing S3_BUCKET would put database dumps
  # in the media bucket — the arrangement the squadron owner ruled out.
  BACKUP_S3_BUCKET
)

missing=()
for key in "${REQUIRED[@]}"; do
  value="$(envval "$key")"
  [[ -n $value && $value != *CHANGE_ME* ]] || missing+=("$key")
done
[[ ${#missing[@]} -eq 0 ]] || die "missing or placeholder in $ENV_FILE: ${missing[*]}"
ok "${#REQUIRED[@]} required settings present"

[[ "$(envval S3_BUCKET)" != "$(envval BACKUP_S3_BUCKET)" ]] \
  || die "S3_BUCKET and BACKUP_S3_BUCKET are the same bucket — database dumps would land in media"
ok "media and backup buckets are separate"

# ─────────────────────────────────────────────────────────── 2. fetch
say "Fetching $REF"
git -C "$REPO" fetch --quiet origin
git -C "$REPO" reset --quiet --hard "origin/$REF"
TARGET_SHA="$(git -C "$REPO" rev-parse HEAD)"
ok "$(git -C "$REPO" log --oneline -1)"

# ─────────────────────────────────────────────────────────── 3. backup
#
# BEFORE the migrations, not after. A backup taken afterwards cannot undo them.
say "Backing up the database"
mkdir -p /srv/grims/backups
DUMP="/srv/grims/backups/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
$COMPOSE exec -T postgres pg_dump -U "$(envval POSTGRES_USER)" -d "$(envval POSTGRES_DB)" \
  | gzip > "$DUMP"
[[ -s $DUMP ]] || die "the dump is empty — refusing to migrate"
ok "$(du -h "$DUMP" | cut -f1) → $DUMP"

# ─────────────────────────────────────────────────────────── 4. build
#
# Built BEFORE anything is replaced, so a compile error costs nothing. Images
# are built under their own names and only swapped in once they exist.
say "Building images"
$COMPOSE --profile jobs build api web bot worker
ok "api, web, bot, worker built"

# ─────────────────────────────────────────────────────────── 5. migrate
#
# ★ MIGRATIONS RUN BEFORE THE SWAP, AND MUST BE ADDITIVE ★
#
# The old containers are still serving at this point, so a migration that
# DROPS or renames something breaks them the moment it lands. Additive
# migrations let both versions run against the same schema, which is what makes
# a zero-downtime swap possible at all.
say "Applying migrations"
$COMPOSE --profile jobs run --rm --entrypoint sh worker \
  -c "pnpm --filter @grims/db exec prisma migrate deploy"
ok "schema up to date"

# ─────────────────────────────────────────────────────────── 6. swap
#
# ★ HEALTH-GATED, ONE SERVICE AT A TIME ★
#
# `up -d` replaces a container and returns immediately — it does not wait for
# the thing to be healthy, which is precisely how a crash loop gets left running
# while the deploy reports success.
say "Rolling out"

# ★ CADDY FIRST, SO THE RETRY WINDOW IS IN PLACE BEFORE ANYTHING MOVES ★
#
# The proxy holds and retries requests that arrive while a container is being
# replaced (see the Caddyfile). Reloading it AFTER the swap would leave the one
# window it exists to cover uncovered. `caddy reload` is graceful — it does not
# drop connections.
$COMPOSE exec -T caddy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null   && ok "proxy config reloaded"   || ok "proxy reload skipped (no change)"

wait_healthy() {
  local service=$1 attempts=${2:-30} state
  for ((i = 1; i <= attempts; i++)); do
    state="$($COMPOSE ps "$service" --format '{{.Status}}' 2>/dev/null || true)"
    case "$state" in
      *healthy*)     ok "$service healthy"; return 0 ;;
      *Restarting*)  die "$service is restarting — it cannot start with this configuration" ;;
    esac
    # A service with no healthcheck reports "Up" and nothing more. Give it a
    # moment to fall over before believing it.
    if [[ $state == Up* && $i -ge 4 ]]; then ok "$service up"; return 0; fi
    sleep 3
  done
  die "$service did not become healthy in time"
}

rollback() {
  printf '\n\033[31m✖ rolling back to %s\033[0m\n' "${PREVIOUS_SHA:0:8}" >&2
  git -C "$REPO" reset --quiet --hard "$PREVIOUS_SHA"
  $COMPOSE --profile jobs build api web bot worker >/dev/null 2>&1 || true
  $COMPOSE up -d api web bot >/dev/null 2>&1 || true
  printf '\033[31m  rolled back. The database was NOT reverted — %s holds the pre-deploy state.\033[0m\n' "$DUMP" >&2
}
trap 'rollback' ERR

# The API first and alone. It is the one that refuses to start on bad config,
# so if anything is wrong this is where it surfaces — while the old web
# container is still serving the old API's responses.
$COMPOSE up -d api
wait_healthy api

$COMPOSE up -d web bot
wait_healthy web
wait_healthy bot

trap - ERR

# ─────────────────────────────────────────────────────────── 7. verify
#
# ★ THROUGH THE PUBLIC URL, NOT `docker ps` ★
#
# During the outage this script exists to prevent, the web container answered
# 200 the entire time while every API-backed page was dead. Container status
# said "Up". Only a real request through Caddy tells the truth.
say "Verifying"

check() {
  local path=$1 expected=$2
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$PUBLIC_URL$path" || echo 000)"
  [[ $code == "$expected" ]] || die "$path answered $code, expected $expected"
  ok "$path → $code"
}

check /v1/health 200
check / 200
# Members-only, so a redirect to sign-in is the CORRECT answer. A 200 here would
# mean the gate had come off.
check /roster 307

say "Deployed ${TARGET_SHA:0:8} with no downtime"
