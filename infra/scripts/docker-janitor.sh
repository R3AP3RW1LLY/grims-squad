#!/usr/bin/env bash
#
# Nightly Docker cleanup.
#
# ★ WHY THIS EXISTS ★
#
# Squadron owner, 2026-07-31: "create a worker that cleans up stale / old docker instances on our
# server daily please. we cant have this happen!"
#
# On 2026-07-31 the server had 56GB free of 328GB and a full galaxy ingest was about to be declared
# impossible — with a plan upgrade priced up to solve it. The actual contents:
#
#   build cache   252.7 GB   (250.5 GB reclaimable)
#   images         13.07 GB
#   database          18 MB
#   /srv/grims        33 MB
#
# Every deploy builds four images, and BuildKit keeps every intermediate layer of every build
# forever unless told otherwise. Nothing was wrong; nothing had leaked. It simply accumulated,
# invisibly, until it nearly cost real money to work around.
#
# One `docker builder prune` recovered 125GB and took under a minute.
#
# ★ WHAT IT WILL AND WILL NOT TOUCH ★
#
# Build cache and images that no container uses. Both are REGENERABLE — the cost of removing them is
# a slower next build, never data.
#
# It will NOT touch volumes. That is where Postgres lives, and a janitor that can delete the database
# is not a janitor. `docker system prune --volumes` is the flag that would do it, and it is
# deliberately absent; if a future edit adds it, this comment is why it should not.
set -Eeuo pipefail

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }

FREE_BEFORE=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')

say "Docker janitor — $(date -u '+%Y-%m-%d %H:%M UTC')"
ok "before: ${FREE_BEFORE}G free"

# ── build cache ─────────────────────────────────────────────────────────────
#
# The one that actually matters — it was 250GB of the 272GB in use.
#
# 168h keeps roughly a week, so a rebuild during that window still reuses layers and a routine deploy
# stays fast. Anything older belongs to a build nobody will repeat.
say "Build cache older than 7 days"
docker builder prune --force --filter 'until=168h' 2>&1 | tail -2 | sed 's/^/  /'

# ── dangling images ─────────────────────────────────────────────────────────
#
# Untagged layers left behind when a rebuild replaces a tag. Nothing references them by definition.
say "Dangling images"
docker image prune --force 2>&1 | tail -1 | sed 's/^/  /'

# ── unused images ───────────────────────────────────────────────────────────
#
# `-a` removes images no CONTAINER uses, which includes the previous release.
#
# 72h, not 0: keeping three days of old images is what makes a rollback instant. A janitor that
# deletes the version you need to roll back to has turned a bad deploy into an outage.
say "Images unused for 3 days"
docker image prune --all --force --filter 'until=72h' 2>&1 | tail -1 | sed 's/^/  /'

# ── stopped containers ──────────────────────────────────────────────────────
#
# One-shot migration containers mostly. Kept a day so a failed run can still be inspected — a
# container removed before anybody read its logs is a debugging session lost.
say "Containers stopped over a day ago"
docker container prune --force --filter 'until=24h' 2>&1 | tail -1 | sed 's/^/  /'

FREE_AFTER=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
# -- escalation --------------------------------------------------------------
#
# * THE NIGHTLY WINDOWS ARE RIGHT FOR A NORMAL WEEK AND WRONG FOR A BUSY ONE - 2026-08-18 *
#
# Squadron owner: "can we add this to our AI pipeline so it prunes daily or when the alarm goes off
# or when storage is limited and a clean up is required?"
#
# The ingestion box reached ZERO BYTES between two nightly runs. This script had run, had cleaned
# what its windows allowed, had noticed it was still tight, and had said so -- into a log file on a
# box nobody logs into. The next deploy died on "no space left on device".
#
# The windows above are deliberately generous because they protect rollbacks and fast rebuilds. That
# is the right default. It is NOT the right behaviour when the disk is nearly gone: keeping three
# days of images so a hypothetical rollback is fast is worth less than the box continuing to work.
#
# So it escalates rather than merely reporting -- tighten the windows, then drop them entirely, and
# stop the moment there is room. Every step is images and build cache only: regenerable, never data,
# and `--volumes` stays absent for the reason written at the top of this file.
if [[ ${FREE_AFTER} -lt ${DISK_COMFORTABLE_G:-40} ]]; then
  say "Still tight at ${FREE_AFTER}G - escalating"

  for WINDOW in 24h 6h none; do
    if [[ ${WINDOW} == none ]]; then
      # Everything no running container uses. The rollback image goes too, which is the trade being
      # made knowingly: a re-pull costs minutes, a full disk costs the service.
      ok "last resort: every image no container is using"
      docker image prune --all --force >/dev/null 2>&1 || true
      docker builder prune --all --force >/dev/null 2>&1 || true
    else
      ok "images and build cache older than ${WINDOW}"
      docker image prune --all --force --filter "until=${WINDOW}" >/dev/null 2>&1 || true
      docker builder prune --force --filter "until=${WINDOW}" >/dev/null 2>&1 || true
    fi

    FREE_AFTER=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
    ok "now ${FREE_AFTER}G free"
    # Stop as soon as there is room. Escalating further would throw away rollbacks and warm build
    # cache for nothing.
    [[ ${FREE_AFTER} -ge ${DISK_COMFORTABLE_G:-40} ]] && break
  done
fi

say "Done"
ok "after: ${FREE_AFTER}G free  (recovered $((FREE_AFTER - FREE_BEFORE))G)"

# ── the alarm ───────────────────────────────────────────────────────────────
#
# Cleaning up quietly forever would hide a real leak. If the disk is still uncomfortable AFTER a
# prune, something is growing that this script is not responsible for — and that is worth a loud line
# in the log rather than a tidy exit.
# * AND NOW THE ALARM MEANS SOMETHING STRONGER *
#
# It used to fire when the gentle nightly prune left the disk tight, which is a normal state on a
# busy day and is exactly why nobody acted on it. It now fires only after escalation has thrown away
# every image and every layer it is allowed to -- so if it STILL cannot find room, nothing Docker
# owns is the cause and a person is genuinely needed.
#
# The status file is what carries that to somebody. The worker daemon reads it and announces to
# Discord, because a red line in /var/log on a box with no operator is the same as silence - which
# is the failure this whole change is about.
STATUS_FILE=${DISK_STATUS_FILE:-/srv/grims/disk-status.json}
printf '{"freeGb":%s,"comfortableGb":%s,"at":"%s","host":"%s"}
'   "${FREE_AFTER}" "${DISK_COMFORTABLE_G:-40}" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$(hostname)"   > "${STATUS_FILE}" 2>/dev/null || true

if [[ ${FREE_AFTER} -lt ${DISK_COMFORTABLE_G:-40} ]]; then
  printf '
[31m! Only %sG free after FULL cleanup - nothing Docker owns is the cause.[0m
' "${FREE_AFTER}"
  printf '  Check: docker system df, du -sh /var/lib/docker/*, and the database size.
'
  exit 1
fi
