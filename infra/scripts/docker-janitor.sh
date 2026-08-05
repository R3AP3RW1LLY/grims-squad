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
say "Done"
ok "after: ${FREE_AFTER}G free  (recovered $((FREE_AFTER - FREE_BEFORE))G)"

# ── the alarm ───────────────────────────────────────────────────────────────
#
# Cleaning up quietly forever would hide a real leak. If the disk is still uncomfortable AFTER a
# prune, something is growing that this script is not responsible for — and that is worth a loud line
# in the log rather than a tidy exit.
if [[ ${FREE_AFTER} -lt 40 ]]; then
  printf '\n\033[31m✖ Only %sG free after cleanup — something else is growing.\033[0m\n' "${FREE_AFTER}"
  printf '  Check: docker system df, du -sh /var/lib/docker/*, and the database size.\n'
  exit 1
fi
