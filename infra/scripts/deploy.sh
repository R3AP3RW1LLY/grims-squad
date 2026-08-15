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
# Resolved in the preflight, AFTER the env file is readable: the shell wins,
# then /srv/grims/.env, then the sslip.io fallback. See the note there.
PUBLIC_URL="${PUBLIC_URL:-}"
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
# Between ok and die: something went wrong, and stopping the deploy over it would cost more than
# the thing itself. Yellow and on stderr, so it survives a `| tail` of a log somebody skims.
warn() { printf '  \033[33m!\033[0m %s\n' "$*" >&2; }

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

# ★ THE PUBLIC URL COMES FROM /srv/grims/.env, NOT FROM THIS FILE ★
#
# This used to be a hard-coded sslip.io default resolved before the env file
# was even read, which meant the verify step would keep probing the OLD name
# after a domain cutover — reporting a healthy site by asking a hostname
# members were no longer using. The shell still wins (so a cutover can be
# rehearsed against either name explicitly), the env file is the normal
# answer, and the sslip.io literal survives only as the fallback for a box
# that predates PUBLIC_URL being required.
PUBLIC_URL="${PUBLIC_URL:-$(envval PUBLIC_URL)}"
PUBLIC_URL="${PUBLIC_URL:-https://45-63-35-93.sslip.io}"

REQUIRED=(
  POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
  DATABASE_URL REDIS_PASSWORD
  # ★ ADDED 2026-07-29, AFTER A DEPLOY THAT WOULD HAVE PASSED WITHOUT IT ★
  #
  # REDIS_URL used to matter only to the permission cache, which fails soft — a
  # missing value cost a little latency and nothing else, so it was reasonably
  # left out of this list.
  #
  # It is now what the API's live-event bridge dials to receive notifications
  # from the scheduled jobs. Unset, the bridge falls back to localhost:6379,
  # which inside a container is nothing at all: it retries forever, the API
  # starts perfectly happily, and every live update from the worker is silently
  # dropped. A member watching the verification page would wait for something
  # that was never coming.
  #
  # Exactly the class of failure this preflight exists for — knowable in a
  # second, and otherwise discovered by a member wondering why a page never
  # updated.
  REDIS_URL
  DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET DISCORD_BOT_TOKEN DISCORD_GUILD_ID
  OAUTH_STATE_SECRET TOKEN_ENCRYPTION_KEYRING
  # The five the API's object-store guard demands together. Missing ONE of them
  # is what took production down: it counts as "partly configured" and the API
  # refuses to start rather than silently writing avatars to local disk.
  S3_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY
  # Its own variable, deliberately. Sharing S3_BUCKET would put database dumps
  # in the media bucket — the arrangement the squadron owner ruled out.
  BACKUP_S3_BUCKET
  # ★ ADDED FOR THE grims-squad.com CUTOVER, AND REQUIRED FROM NOW ON ★
  #
  # PUBLIC_URL is what the API stamps into every absolute link it writes
  # (forum notifications, the joining guide) and what this script's verify step
  # probes; PUBLIC_SITE_URL is baked into the web build as og:image and canonical
  # URLs. Both had sslip.io fallbacks scattered through the stack, which meant a
  # domain cutover was N edits in M files. They are now REQUIRED so the answer
  # lives in exactly one place — /srv/grims/.env — and the cutover is a one-line
  # change there (infra/cutover-grims-squad.md). Until the cutover, set both to
  # https://45-63-35-93.sslip.io; this preflight failing is the reminder.
  PUBLIC_URL PUBLIC_SITE_URL
  # ★ FRONTIER cAPI, REQUIRED FROM NOW ON — SQUADRON OWNER, 2026-08-15 ★
  #
  # "we have been approved and have our keys from frontier ... the primary feature must be so that
  # players that are playing on Geforce Now and cloud platforms can use the companion app like
  # everyone else"
  #
  # These are REQUIRED rather than optional-with-a-fallback, and that is the whole point of listing
  # them here. cAPI is how a cloud player exists on this platform at all: unset, they simply have no
  # journal, no cargo, no deliveries and no promotion activity — and every one of those failures
  # looks exactly like a member who has not played, which is the worst possible way to be wrong
  # about somebody.
  #
  # An unset secret is silent. A refused deploy is not.
  #
  # FDEV_CAPI_REDIRECT_URI must match what is registered with Frontier character for character; a
  # mismatch is rejected at the authorise step, before any of our code runs, with an error the
  # member sees and we never do.
  FDEV_CAPI_CLIENT_ID FDEV_CAPI_REDIRECT_URI
  # ★ THE ANNOUNCEMENT PIPELINE'S THREE SETTINGS, REQUIRED FROM NOW ON ★
  #
  # Squadron owner, 2026-08-04: the announcement wiring must be part of the
  # deploy sequence, not an operator memory. Unset channels make the bot queue
  # rows silently — a deploy announcement that never arrives and never errors —
  # so a deploy is refused until /srv/grims/.env names both channels and the
  # forum author (infra/cutover-grims-squad.md §7.1 has the values).
  DISCORD_ANNOUNCE_CHANNEL_ID DISCORD_PROMOTIONS_CHANNEL_ID ANNOUNCE_FORUM_AUTHOR_HANDLE
  # ★ AND THE COLONISATION CHANNEL — SQUADRON OWNER, 2026-08-05 ★
  #
  # Squadron colonisation projects announce to their own channel. Required for the same reason as
  # the two above: unset means the rows queue silently, so the first anybody would know is a
  # project nobody was told about.
  DISCORD_COLONY_CHANNEL_ID
  # ★ AND THE RELEASE CHANNEL ★
  #
  # Where "what changed on the website and in the app" goes. Required for the same reason as the
  # rest: unset means the row queues silently and nobody hears about a release that shipped.
  DISCORD_RELEASE_CHANNEL_ID

  # ★ THE ADDRESS POSTGRES AND REDIS ARE REACHABLE ON — ADDED 2026-08-06 ★
  #
  # The WireGuard address of this box (10.66.0.1), used by compose.prod.yml to publish those two
  # ports. Required for the same reason the announcement channels are: unset is not an error, it is
  # a SILENCE. compose would fall back to loopback, the ingestion box would quietly fail to
  # connect, and prices would simply stop being current with no error anywhere.
  #
  # The loopback fallback stays in compose regardless — it is what makes forgetting this harmless
  # instead of publishing the database to the internet. This makes forgetting it loud as well.
  GRIMS_BIND_IP
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

# ★ THE REGISTRY LOGIN, CHECKED HERE RATHER THAN DISCOVERED AT THE PULL ★
#
# Since the images are built in CI, a deploy cannot proceed without being able to read them. The
# repository is private, so its packages are private, so an unauthenticated pull gets a 403 — and
# `docker` reports that as "denied", which reads like a permissions bug rather than a missing login.
#
# Found in the preflight it costs a sentence. Found at the pull it costs the deploy, and the
# operator spends ten minutes reading GHCR error codes to learn something knowable up front.
if ! grep -q 'ghcr\.io' /root/.docker/config.json 2>/dev/null; then
  die "not signed in to ghcr.io — the images cannot be pulled.
     Create a token at https://github.com/settings/tokens with the read:packages scope, then:
       echo <TOKEN> | docker login ghcr.io -u r3ap3rw1lly --password-stdin
     The login persists; this is a one-time step per box."
fi
ok "registry credentials present"

# ★ THE AI TUNNEL — SQUADRON OWNER, 2026-08-10 ★
#
# "ensuring its running and connected should also be part of the deployment process!"
#
# Every AI feature on the platform — the assistant, the knowledge search, the screening, the
# artwork — answers through a reverse SSH tunnel to a machine in the owner's house. When that tunnel
# is down or nothing is listening on it, NOTHING says so: the features simply time out one request
# at a time, on member-facing pages, and the first anybody knows is somebody reporting that the
# assistant "does not work".
#
# ★ CHECKED HERE, AND NOT FATAL ★
#
# Warned rather than died, deliberately. The AI is one feature among many and blocking a security
# fix because a desktop at home is asleep would be the wrong trade — but a deploy is the one moment
# somebody is watching the output, which makes it exactly the right moment to say so.
#
# ★ AND THE PATH MATTERS ★
#
# AI_BASE_URL ends in /v1 (it is the OpenAI-compatible surface), so the models list is $URL/models.
# Asking for /api/tags against it returns 404 from a perfectly healthy tunnel — which is how this
# check was nearly written to report a working AI as broken.
AI_BASE="$(envval AI_BASE_URL)"
if [[ -n $AI_BASE ]]; then
  AI_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "${AI_BASE%/}/models" || echo 000)"
  if [[ $AI_CODE == "200" ]]; then
    ok "AI reachable at $AI_BASE"
  else
    warn "AI at $AI_BASE answered ${AI_CODE} — the assistant, knowledge search and artwork will time out until the tunnel is up and Ollama is serving (nothing else is affected)"
  fi
fi

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

# ★ KEEP THE LAST FEW, NOT ALL OF THEM — 2026-08-10 ★
#
# Nothing has ever removed these. Found at 60 files and 97 GB, going back to the first deploy on
# 29 July, on a 469 GB disk that was 55% full and climbing by roughly 3 GB per deploy. Eight deploys
# in one afternoon is 24 GB, and the failure mode when the disk fills is not a failed deploy — it is
# Postgres unable to write, which is the whole platform.
#
# Ten is about a fortnight at the usual rate and covers the case these exist for: something shipped
# an hour ago was wrong and the migration needs undoing. A dump from July would restore a schema
# nothing in this repo still speaks.
#
# `ls -t` newest-first, `tail -n +11` everything past the tenth. Deliberately after the dump has been
# checked non-empty, so a failed backup never prunes the one that would have saved us.
KEEP_BACKUPS=10
mapfile -t OLD_DUMPS < <(ls -t /srv/grims/backups/pre-deploy-*.sql.gz 2>/dev/null | tail -n "+$((KEEP_BACKUPS + 1))")
if (( ${#OLD_DUMPS[@]} > 0 )); then
  FREED="$(du -ch "${OLD_DUMPS[@]}" 2>/dev/null | tail -1 | cut -f1)"
  rm -f "${OLD_DUMPS[@]}"
  ok "pruned ${#OLD_DUMPS[@]} older backup(s), $FREED reclaimed"
fi

# ─────────────────────────────────────────────────────────── 4. build
#
# Built BEFORE anything is replaced, so a compile error costs nothing. Images
# are built under their own names and only swapped in once they exist.
# ★ PRUNE BEFORE BUILDING, NOT AFTER ★
#
# The nightly janitor handles the steady state. This is the burst case: a deploy builds four images
# and BuildKit keeps every intermediate layer, so several deploys in one session can add tens of GB
# between two runs of the cron job.
#
# Before rather than after, because the failure it prevents is a build that dies half way for want
# of disk — and a deploy that fails at the build step has already taken the site's attention without
# giving anything back.
#
# 168h keeps a week, so this does NOT slow a routine deploy: today's layers are all still there.
docker builder prune --force --filter 'until=168h' >/dev/null 2>&1 || true
#
# ★ AND A CEILING, BECAUSE THE WEEK-LONG WINDOW IS NOT ONE — MEASURED 2026-08-05 ★
#
# Six deploys in one day, six images each, and every layer inside the 168h window: the build cache
# reached 188 GB and the disk 76%. The time filter cannot help with that, because the problem is
# volume within the window rather than age.
#
# ★ AND --keep-storage DOES NOT DO WHAT I CLAIMED IT DID — MEASURED 2026-08-05 ★
#
# It caps the RECLAIMABLE cache, not the total. With 185 GB of cache of which only 24 GB was
# unused, `--keep-storage 40GB` reclaimed exactly nothing: 24 is already under 40, so there was
# nothing it considered worth evicting. The disk went on filling — 76% again within three deploys.
#
# The honest lever is the unfiltered prune, which drops every layer no current image needs. That
# reclaimed 24 GB; the remaining 161 GB was cache backing images that were themselves stale, and
# only `--all` clears it — 157 GB, taking the disk from 79% to 26%.
#
# So: prune what is unused on every deploy, and clear the lot when the disk is genuinely tight.
# `--all` costs one slow build afterwards and nothing else — build cache is a speed optimisation,
# never data.
docker builder prune --force >/dev/null 2>&1 || true

# ★ AND NOW THE IMAGES THEMSELVES, WHICH IS NEW ★
#
# Building on the box grew the build CACHE. Pulling from a registry grows the IMAGE store instead,
# and it grows faster: six images per deploy, each tagged with its commit, and a tagged image is
# never dangling — so the ordinary `docker image prune` will not touch one of them. Twenty deploys
# would be twenty complete sets sitting there forever.
#
# This is the same failure that took the disk to 79%, in a new costume, and it is being written
# down before it costs anything rather than after a member reports a slow site.
#
# 168h keeps a week of revisions, so every rollback target a deploy could plausibly want is still
# local and instant. `--filter until=` only ever considers images no container is using, so the
# running set is safe regardless of age.
docker image prune --force --filter 'until=168h' >/dev/null 2>&1 || true

used_pct="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
if [[ -n $used_pct && $used_pct -ge 70 ]]; then
  warn "disk at ${used_pct}% — clearing the whole build cache and every unused image"
  docker builder prune --all --force >/dev/null 2>&1 || true
  # ★ ONLY UNDER PRESSURE, BECAUSE THIS IS THE ROLLBACK PATH BEING SPENT ★
  #
  # `--all` removes every image no RUNNING container needs, which includes the previous revision —
  # the thing a rollback would otherwise pull from local disk in seconds. That is an acceptable
  # price at 70% and a bad trade at any less, so it lives here and not above. A rollback still
  # works; it just fetches from the registry like any other pull.
  docker image prune --all --force >/dev/null 2>&1 || true
fi
ok "old build cache and superseded images pruned"

# ★ EVERY SERVICE, NOT THE FOUR THAT FACE A MEMBER ★
#
# This built `api web bot worker` and stopped. The two it left out — the ingest daemon and the EDDN
# collector — are the two that run unattended, so nobody notices they are stale until something they
# ingest is wrong, and then the source looks blameless because the fix IS in the repository.
#
# Measured 2026-08-05: the daemon had been running an image built at 04:14 for the rest of the day.
# A fix to the market rebuild's transaction budget was merged, deployed, verified present in the
# `worker` image — and the daemon, which is the thing that actually runs that rebuild hourly, kept
# executing the old code and kept failing the same way. The deploy reported success every time.
#
# `--profile jobs` is still needed: the one-shot `worker` service is behind it.
# ★ NICED, BECAUSE THE OLD SITE IS STILL SERVING DURING THIS ★
#
# The swap is health-gated and the swap was never the problem. The BUILD is: six images compiling
# TypeScript and Next in parallel took an 8-core box to a load average of 19, and the containers
# still serving members answered slowly enough to time out. The deploy then reported success —
# correctly, because the new containers were healthy — while members had spent ten minutes getting
# INTERNAL_ERROR. Reported by the squadron owner on 2026-08-05: "this is supposed to be zero
# downtime updates etc! what the fuck!"
#
# ★ PULLED, NOT BUILT — AND THE HISTORY OF WHY ★
#
# This box used to compile six Docker images on every deploy, while serving members. Two attempts
# were made to civilise that and both failed in instructive ways:
#
#   `nice -n 19 docker compose build` lowers the priority of the CLI CLIENT. The compiling happens
#   inside the Docker daemon, and `ps -o ni` showed dockerd and every build process at nice 0
#   throughout. It changed nothing, and was declared a fix on one fast page load.
#
#   `COMPOSE_PARALLEL_LIMIT=2` genuinely helped — sixteen minutes of a build passed with pages at
#   0.24s — and still could not cover the peak: when the Next.js image began, `/` took 19.95
#   seconds. Fewer compilers is better than more, and no number of them is none.
#
# The squadron owner's verdict, 2026-08-05: build in CI, and let production pull.
#
# So `.github/workflows/images.yml` builds every image on merge and pushes it to GHCR tagged with
# its commit, and this step fetches the exact revision being deployed. The box does no compiling at
# all — a pull is network and disk, which is what a server has spare.
#
# ★ TAGGED BY SHA, WHICH IS WHAT MAKES A ROLLBACK CHEAP ★
#
# `latest` would make "what is production running" unanswerable, which is the question
# deployed.sha exists to answer. Naming the revision means a rollback is a pull of an image that
# already exists rather than a rebuild of a tree that has moved on.
say "Fetching images"
export GRIMS_IMAGE_TAG="$TARGET_SHA"

# ★ RETRIED, BECAUSE THE REGISTRY IS A NETWORK — MEASURED 2026-08-06 ★
#
# GHCR returned "error reading from server: EOF" mid-layer twice in one evening: once pulling onto
# the ingestion box, once during the deploy of #119. Both succeeded immediately on a second
# attempt. Neither was a real failure.
#
# The second one was expensive anyway. With no retry the deploy aborted here, the rollback ran, and
# production was left running `:latest` while `deployed.sha` named a revision the repository no
# longer held — so "what is production running" became unanswerable, which is the exact question
# tagging by commit exists to answer.
#
# Three attempts with a widening pause. A network read is allowed to fail; making the release
# process fatal on the first one turns ordinary internet weather into an outage.
fetched=false
for attempt in 1 2 3; do
  if $COMPOSE --profile jobs pull --quiet api web bot worker; then
    fetched=true
    break
  fi
  # No sleep after the last attempt — it would only delay the failure message.
  if [[ $attempt -lt 3 ]]; then
    warn "image fetch attempt ${attempt} failed — retrying in $((attempt * 10))s"
    sleep $((attempt * 10))
  fi
done

if [[ $fetched != true ]]; then
  # Still fatal once the retries are spent. A missing image means CI has not finished — or has
  # failed — for this revision, and the honest response is to stop before the swap rather than
  # quietly serve whatever was pulled last time. Retrying forever would be worse than stopping:
  # nobody watches a script that has gone quiet.
  die "could not fetch images for ${TARGET_SHA:0:8} after 3 attempts — is the images workflow finished? (gh run list --workflow=images.yml)"
fi
ok "images for ${TARGET_SHA:0:8} fetched"

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

# ─────────────────────────────── 5b. reference data the schema does not carry
#
# ★ A MIGRATION MAKES THE TABLE; SOMETHING STILL HAS TO FILL IT ★
#
# `colony_build_types` and `colony_build_costs` are created by a migration and populated by
# nothing. `seed-catalogue.ts` exists to do it, its own header says "RUN ON DEPLOY", and it was
# in no cron entry and no deploy step — so production carried the empty tables the migration made
# and `/colonisation/build-types` rendered a page with no rows in it. Reported by the squadron
# owner on 2026-08-05: "not loading with the appropriate data (its empty)".
#
# Nothing was broken. The seed is correct, the page is correct, the migration is correct, and
# there was simply no moment at which the two were introduced to each other.
#
# ★ WHY IT IS SAFE TO RUN ON EVERY DEPLOY ★
#
# `seedBuildCatalogue` skips any build type marked `source = 'observed'` — a bill of materials the
# squadron measured by actually building the thing. Community figures only ever fill rows nothing
# of ours has confirmed, so a deploy cannot overwrite what members learned by flying.
#
# ★ AND WHY IT IS NOT FATAL ★
#
# This runs BEFORE the swap, where a non-zero exit would abort the deploy and roll back. A stale
# catalogue is a page listing yesterday's figures; a failed deploy is the whole site not shipping.
# Those are not the same cost, so this warns and carries on — loudly enough to be seen.
say "Seeding reference data"
if $COMPOSE --profile jobs run --rm worker node apps/worker/dist/seed-catalogue.js; then
  ok "build catalogue seeded (observed figures preserved)"
else
  warn "the build catalogue did NOT seed — /colonisation/build-types may be stale or empty"
fi

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
# `up -d` first, so a change to the MOUNT itself is applied — a reload alone
# cannot fix a container holding a stale inode, which is exactly how two
# earlier proxy fixes shipped without ever being loaded.
$COMPOSE up -d caddy >/dev/null 2>&1 || true
$COMPOSE exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1   && ok "proxy config reloaded"   || ok "proxy reload skipped (no change)"

# Prove it took, rather than trusting a reload that reports success either way.
if $COMPOSE exec -T caddy grep -q lb_try_duration /etc/caddy/Caddyfile 2>/dev/null; then
  ok "proxy retry window active"
else
  die "the proxy is not serving the current Caddyfile — a swap would drop requests"
fi

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

# ★ THE ROLLBACK WAS UNREACHABLE — PRODUCTION OUTAGE, 2026-08-10 ★
#
# This script has had a rollback since it was written, wired as `trap 'rollback' ERR`. It had never
# once run, because bash does NOT fire an ERR trap when a script calls `exit` — and every failure
# path here goes through `die`, which does exactly that.
#
# So the gate that exists to catch a bad build (`wait_healthy api` seeing "Restarting") fired
# correctly, printed its refusal, exited — and left the WEB container already swapped to the new
# revision while the API stayed broken until somebody rolled it back by hand. Production served a
# newer website against an older API: a button calling an endpoint that did not exist.
#
# Reproduced before believing it:
#
#     trap 'echo ROLLBACK' ERR;  die() { exit 1; }; die   # prints nothing
#     trap 'echo ROLLBACK' EXIT; die() { exit 1; }; die   # prints ROLLBACK
#
# ★ SO IT HANGS OFF EXIT, WITH TWO FLAGS TO KEEP IT HONEST ★
#
# EXIT fires on success too, so the handler needs to know whether a rollback is warranted:
#
#   SWAPPED   set the instant the first new container starts. Before that nothing has moved, and a
#             preflight failure must leave production untouched rather than restarting healthy
#             containers for no reason.
#   VERIFIED  set once the public URL has answered every gate. After that an exit is the script
#             finishing, and undoing a deploy that worked would be the worse failure.
SWAPPED=0
VERIFIED=0
rollback() {
  printf '\n\033[31m✖ rolling back to %s\033[0m\n' "${PREVIOUS_SHA:0:8}" >&2
  git -C "$REPO" reset --quiet --hard "$PREVIOUS_SHA"
  # ★ A ROLLBACK IS NOW A PULL, WHICH IS THE WHOLE POINT OF TAGGING BY SHA ★
  #
  # This used to REBUILD six images at the worst possible moment — during a failed deploy, on a box
  # already in trouble, taking minutes to restore a service that was down. The previous revision's
  # images are in the registry and usually still in the local cache, so this is now seconds.
  export GRIMS_IMAGE_TAG="$PREVIOUS_SHA"
  $COMPOSE --profile jobs pull --quiet api web bot worker >/dev/null 2>&1 || true
  # EVERY service, not just the API. The outage this exists for left a new web against an old API
  # because only one of them had been put back.
  $COMPOSE up -d api web bot >/dev/null 2>&1 || true

  # ★ AND THEN PROVE IT ★
  #
  # `|| true` above keeps a failing rollback from cascading, which also means it cannot report one.
  # A rollback that quietly did nothing is the worst possible ending: the operator reads "rolled
  # back" and walks away from a dead site.
  local back
  back="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$PUBLIC_URL/v1/health" || echo 000)"
  if [[ $back == "200" ]]; then
    printf '[31m  rolled back and %s/v1/health answers 200.[0m
' "$PUBLIC_URL" >&2
  else
    printf '[1;31m  ROLLBACK DID NOT RESTORE THE SITE — /v1/health answered %s. The site is DOWN and needs a person.[0m
' "$back" >&2
  fi

  printf '\033[31m  rolled back. The database was NOT reverted — %s holds the pre-deploy state.\033[0m\n' "$DUMP" >&2
}
# EXIT, not ERR: `die` calls `exit`, which an ERR trap never sees. See the note above the rollback.
on_exit() {
  local code=$?
  if (( code != 0 )) && (( SWAPPED == 1 )) && (( VERIFIED == 0 )); then rollback; fi
}
trap 'on_exit' EXIT

# The API first and alone. It is the one that refuses to start on bad config,
# so if anything is wrong this is where it surfaces — while the old web
# container is still serving the old API's responses.
# From here on, a failure must undo itself — see `on_exit`. Before this line nothing has moved and
# a preflight failure leaves production untouched, which is why the flag is set here and not at the
# top of the script.
SWAPPED=1

$COMPOSE up -d api
wait_healthy api

$COMPOSE up -d web bot
wait_healthy web
wait_healthy bot

# ★ THE BACKGROUND PAIR NO LONGER LIVES HERE — 2026-08-06 ★
#
# `worker-daemon` and `eddn-collector` used to be started at this point. They now run on the
# ingestion box (149.248.39.225) and reach this database over a WireGuard tunnel, because the
# nightly galaxy import took this machine to load 23 and made the companion app wait EIGHTY-EIGHT
# SECONDS while four unpigz processes decompressed a 4 GB dump on the cores serving members.
#
# Starting them here again would not merely waste the second machine: two EDDN collectors both
# write every station, interleaving delete-and-insert over the same rows. The advisory lock keeps
# that from becoming corruption — one of them simply loses the race and idles — so the symptom
# would be a box you pay for doing nothing while this one quietly went back to ingesting.
#
# tools/deploy-script.spec.ts asserts they are absent from both this file and compose.prod.yml, so
# putting either back is a test failure rather than a discovery weeks later.
#
# Deploying THEM is a separate step; see infra/runbooks/workers-second-box.md.

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

# ★ THE WEB CONTAINER MUST BE ABLE TO REACH THE API ★
#
# Not the same question as "is the API up". A React Server Component runs inside
# the web container, and if it cannot reach the API every server-side call
# returns null — which `lib/api.ts` deliberately treats as "not signed in", so
# every authenticated page renders its signed-out state while the site answers
# 200 throughout.
#
# That shipped once. Signing in appeared to do nothing, and every public check
# said the site was healthy.
# The probe is a FILE, not an inline -e string. The inline version needed
# quotes nested three deep — bash, then docker exec, then node — and the
# escaping was wrong, so the check failed against a container that was working
# perfectly. A false alarm on a deploy gate is worse than no gate: the next
# person to see it assumes it lies.
WEB_PROBE=$(mktemp)
cat > "$WEB_PROBE" <<'PROBE'
const url = (process.env.API_INTERNAL_URL || 'http://api:5001') + '/v1/health';
fetch(url, { signal: AbortSignal.timeout(8000) })
  .then((r) => process.exit(r.ok ? 0 : 1))
  .catch(() => process.exit(1));
PROBE

if $COMPOSE exec -T web node < "$WEB_PROBE" >/dev/null 2>&1; then
  ok "web can reach the API internally"
  rm -f "$WEB_PROBE"
else
  rm -f "$WEB_PROBE"
  die "the web container cannot reach the API — signed-in pages would render as signed out"
fi
# Members-only, so a redirect to sign-in is the CORRECT answer. A 200 here would
# mean the gate had come off.
check /roster 307

# ★ PAST THIS LINE THE DEPLOY IS DONE ★
#
# The public URL has answered on every gate, so an exit from here on is the script finishing rather
# than failing, and `on_exit` must not undo a deploy that worked. Everything below is bookkeeping.
VERIFIED=1

# ─────────────────────────────────────────────────────────── 8. record
#
# ★ AFTER the verify, deliberately ★
#
# Everything in this section is bookkeeping about a deploy that has already
# succeeded. The marker names the revision members are NOW being served, so
# writing it before the health gate would record a deploy that might yet be
# rolled back — and the changelog describes what shipped, which is only true
# once it has actually shipped.
say "Recording the release"

# The deployed-revision marker. `tools/changelog.mjs` reads this as its default
# --from, and it is the one answer to "what is production running" that does
# not require the repo checkout to be trusted (a hotfix `git reset` between
# deploys would silently move HEAD without deploying anything).
printf '%s\n' "$TARGET_SHA" > /srv/grims/deployed.sha
ok "deployed revision recorded → /srv/grims/deployed.sha"

# ─────────────────────────────────────────────── the ingestion box
#
# ★ THE SECOND BOX, WHICH THIS SCRIPT USED TO LEAVE BEHIND — 2026-08-11 ★
#
# infra/runbooks/workers-second-box.md §9 has said since the box was stood up: "deploy.sh currently
# deploys one machine. Until it knows about this one, a deploy updates the primary and leaves the
# workers on the old revision." It was never implemented, and it is not survivable in the way the
# runbook hoped — on 2026-08-11 the ingestion box was found running the build from PR #144 while
# production ran thirteen commits ahead, and every scheduled job on it was resolving `:latest`.
#
# ★ AFTER THE HEALTH GATE, DELIBERATELY ★
#
# The primary has already been proved serving this revision. Pushing a build to the workers that the
# member-facing box could not run would take down ingestion for a revision we are about to roll
# back — so this only ever ships what has already been verified.
#
# ★ NON-FATAL, AND LOUD ★
#
# The primary is UP and members are being served. Failing the whole deploy here would report a
# failure that is not one, and — worse — the EXIT trap would roll a healthy site back to punish the
# other machine. The workers stay on their previous revision, which the wrapper enforces itself, and
# the line below says so in a way nobody can mistake for success.
#
# The key is restricted server-side to `deploy <sha>` (infra/scripts/worker-box-deploy.sh), so this
# cannot do anything else to that box even if this script is wrong.
WORKERS_HOST="${WORKERS_HOST:-$(envval WORKERS_HOST)}"
WORKERS_KEY="${WORKERS_KEY:-/root/.ssh/worker_deploy_ed25519}"

# ★ IT RETRIES, BECAUSE IT RACES THE IMAGE BUILD — FIXED 2026-08-11 ★
#
# The first real run of this step failed, and correctly: `api`, `web`, `bot` and `worker` had
# finished building but `eddn-collector` had not, so the ingestion box refused the pull and rolled
# itself back while the primary stayed healthy.
#
# That is not a fault, it is arithmetic. The primary needs four images and starts the moment they
# exist; this box needs a fifth, and the matrix job that builds it is frequently the last to finish.
# A deploy that needs a human to re-run it minutes later is a deploy that will be forgotten, and
# forgetting is exactly how that box ended up thirteen commits behind in the first place.
#
# Only a PULL failure is retried. A daemon that starts and dies is a real failure and retrying it
# five times would just take five times as long to tell us so.
deploy_workers() {
  local attempt out
  for attempt in 1 2 3 4 5; do
    if out="$(ssh -i "$WORKERS_KEY" -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=15 \
               "root@${WORKERS_HOST}" "deploy $TARGET_SHA" 2>&1)"; then
      printf '%s\n' "$out"
      return 0
    fi
    printf '%s\n' "$out"

    if [[ $out != *"could not pull images"* ]]; then
      return 1
    fi
    if (( attempt < 5 )); then
      ok "images for ${TARGET_SHA:0:8} are not published yet — retrying in 60s (${attempt}/4)"
      sleep 60
    fi
  done
  return 1
}

if [[ -z $WORKERS_HOST ]]; then
  ok "no WORKERS_HOST configured — skipping the ingestion box"
elif [[ ! -r $WORKERS_KEY ]]; then
  ok "✖ ingestion box NOT deployed — no key at $WORKERS_KEY. It is still on its previous revision."
elif deploy_workers; then
  ok "ingestion box deployed ${TARGET_SHA:0:8}"
else
  ok "✖ ingestion box FAILED and rolled ITSELF back — it is on its previous revision, the primary is fine. Recover: ssh -i $WORKERS_KEY root@$WORKERS_HOST 'deploy $TARGET_SHA'"
fi

# The changelog release row: what changed between the revision members WERE on
# and the one they are on now, grouped Website / Companion App / Platform, and
# served by GET /v1/changelog. Generated here because this is the only moment
# that knows both SHAs and has git, node and the database in one place.
#
# `|| true` throughout: a changelog that failed to record must never turn a
# healthy deploy into a reported failure — the row can be inserted by hand
# afterwards (tools/changelog.mjs --sql | psql), and the site is already up.
if [[ "$PREVIOUS_SHA" == "$TARGET_SHA" ]]; then
  ok "same revision as before — no changelog entry to record"
elif command -v node >/dev/null 2>&1; then
  if node "$REPO/tools/changelog.mjs" --repo "$REPO" --from "$PREVIOUS_SHA" --to "$TARGET_SHA" --sql \
    | $COMPOSE exec -T postgres psql -q -v ON_ERROR_STOP=1 \
        -U "$(envval POSTGRES_USER)" -d "$(envval POSTGRES_DB)" >/dev/null 2>&1; then
    ok "changelog recorded: ${PREVIOUS_SHA:0:8} → ${TARGET_SHA:0:8}"

    # The deploy ANNOUNCEMENT — a durable `announcements` row the bot posts to
    # Discord and the API carbon-copies into the forum, both within a minute.
    # Only attempted once the changelog row it links to actually landed, and
    # non-fatal for the same reason: the site is already up, and the row can be
    # inserted by hand afterwards.
    if node "$REPO/tools/changelog.mjs" --repo "$REPO" --from "$PREVIOUS_SHA" --to "$TARGET_SHA" \
        --announce-sql --public-url "$PUBLIC_URL" \
      | $COMPOSE exec -T postgres psql -q -v ON_ERROR_STOP=1 \
          -U "$(envval POSTGRES_USER)" -d "$(envval POSTGRES_DB)" >/dev/null 2>&1; then
      ok "deploy announcement queued — the bot and the forum pick it up within a minute"
    else
      ok "announcement insert FAILED — recover with: node tools/changelog.mjs --from $PREVIOUS_SHA --announce-sql --public-url $PUBLIC_URL | psql (deploy itself is complete)"
    fi
  else
    ok "changelog insert FAILED — recover with: node tools/changelog.mjs --from $PREVIOUS_SHA --sql | psql (deploy itself is complete)"
  fi
else
  ok "node is not on this host — record the changelog by hand: node tools/changelog.mjs --from $PREVIOUS_SHA --sql | psql"
fi

# ★ THE ONE-SHOT ANNOUNCEMENT HOOK ★
#
# Squadron owner, 2026-08-04: the inaugural announcement (and any future
# one-time post) must be part of the deploy sequence, not an operator memory.
# Stage SQL at /srv/grims/announce-once.sql before deploying; this fires it
# exactly once AFTER the health gate — success renames the file to .done so a
# redeploy cannot repeat it, failure leaves it in place and says so. Non-fatal
# like every record step: the site is already verified up.
ANNOUNCE_ONCE=/srv/grims/announce-once.sql
if [[ -f "$ANNOUNCE_ONCE" ]]; then
  say "Firing the staged one-shot announcement"
  if $COMPOSE exec -T postgres psql -q -v ON_ERROR_STOP=1 \
      -U "$(envval POSTGRES_USER)" -d "$(envval POSTGRES_DB)" < "$ANNOUNCE_ONCE" >/dev/null 2>&1; then
    mv "$ANNOUNCE_ONCE" "${ANNOUNCE_ONCE}.done.$(date -u +%Y%m%dT%H%M%SZ)"
    ok "one-shot announcement fired and archived — the bot and forum pick it up within a minute"
  else
    ok "one-shot announcement FAILED — the file is untouched at $ANNOUNCE_ONCE; fix and run: psql < $ANNOUNCE_ONCE"
  fi
fi

# ─────────────────────────────────────────────────────────── 9. entrypoint
#
# ★ THE BOX RAN A DEPLOY SCRIPT FROM 30 JULY FOR ELEVEN DAYS — FOUND 2026-08-10 ★
#
# `/srv/grims/deploy.sh` was a COPY of this file, taken once and never taken again. This file kept
# improving; the box's copy did not, and nothing anywhere compared them. What the box was missing by
# the time anybody looked:
#
#   - the backup pruning, which is why 61 dumps and 101 GB had piled up on a disk that also holds
#     Postgres
#   - every required-variable check added since — each of which exists because unset is a SILENCE
#   - reading PUBLIC_URL from the env file, so its health gate probed the old sslip.io hostname and
#     pronounced the site healthy by asking a name members no longer use
#   - the changelog and announcement steps entirely
#
# A deploy still ran, still said "no downtime", and was telling the truth about the part it knew.
# That is the shape of the thing: a mirror that drifts does not fail, it just quietly stops doing
# the newest half of its job.
#
# So the entrypoint is now `deploy-bootstrap.sh` — a file with no deploy logic in it, which fetches
# and execs THIS script from the ref being deployed. It cannot go stale because there is nothing in
# it to go stale. And this step keeps it installed, so running the repo copy by hand repairs the
# entrypoint rather than bypassing it.
#
# Last, and non-fatal, for the same reason every record step is: the site is already verified up,
# and a deploy that succeeded must not be reported as failed over its own housekeeping.
BOOTSTRAP="$REPO/infra/scripts/deploy-bootstrap.sh"
ENTRYPOINT=/srv/grims/deploy.sh
if [[ -r $BOOTSTRAP ]] && ! cmp -s "$BOOTSTRAP" "$ENTRYPOINT"; then
  say "Repairing the deploy entrypoint"
  if install -m 0700 "$BOOTSTRAP" "$ENTRYPOINT"; then
    ok "$ENTRYPOINT now bootstraps this script instead of being a copy of it"
  else
    warn "could not update $ENTRYPOINT — it is a stale copy; install $BOOTSTRAP over it by hand"
  fi
fi

say "Deployed ${TARGET_SHA:0:8} with no downtime"
