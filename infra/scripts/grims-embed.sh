#!/bin/sh
#
# One embedding sweep, for the ingestion box's cron.
#
# Installed at /usr/local/bin/grims-embed. THIS copy is the source of truth.
#
# ★ WHY IT IS IN THE REPO NOW — 2026-08-24 ★
#
# It was not. It existed only at /usr/local/bin on the workers box, written by hand when the
# embedding cadences were first scheduled, and nothing in the repository described it or could
# review it. That is exactly how it drifted from the mechanism every other scheduled job uses, and
# how the drift went unnoticed for five days.
#
# The crontab has the same rule written at the top of infra/cron/root.crontab: "A schedule nobody
# can diff is a schedule nobody can check." A script nobody can diff is worse, because it is the
# thing the schedule runs.
#
# ★ THE BUG THIS PINNING EXISTS FOR ★
#
# compose.workers.yml names every image `...:${GRIMS_IMAGE_TAG:-latest}`. deploy.sh exports that
# variable for its OWN process, and cron does not inherit it — so every sweep silently resolved
# `:latest`, a tag nothing moves.
#
# On 2026-08-24 that tag was FIVE DAYS stale, and the failure was invisible rather than loud. The
# image predated `companion` being added to KNOWLEDGE_SOURCES, so:
#
#   - EMBEDDED_SOURCES did not contain `companion`
#   - every sweep counted 0 pending for those rows
#   - `announce()` only fires when pending > 0, so it said nothing
#   - the job exited 0, because it WAS succeeding at the work it could see
#
# Members' visited systems sat unembedded while the job reported success. The squadron owner found
# it by reading a number on a page; nothing else could have.
#
# ★ AND WHY IT REFUSES RATHER THAN FALLING BACK ★
#
# The bug was never `latest` being wrong. It was a SILENT default turning "I cannot tell what is
# deployed" into "run something, anything, and say nothing". infra/scripts/worker-job.sh reached the
# same conclusion on 2026-08-11 and its comment records this box having already spent a fortnight on
# the build from PR #144 for the identical reason. This script simply never adopted it.
#
# A job that does not run is a job somebody notices. A job that runs last week's code is one nobody
# does — until a member asks why their systems are not there.
#
# ★ WHY NOT JUST CALL worker-job.sh ★
#
# It would be the obvious reuse, and it is close. But that wrapper resolves its own compose file and
# is written for `--profile jobs` one-shots on either box; the embed sweeps run on compose.workers.yml
# with `--no-deps` and are invoked several hundred times a day on a three-minute cadence. Keeping
# them separate costs one duplicated read of the sha file, which is cheap and obvious, against
# widening a wrapper that four other jobs depend on.
#
# ★ RUNS AGAINST THE OWNER'S CARD ★
#
# The 3060 on the owner's PC, over WireGuard via the primary box — see AI_EMBED_URL in
# /srv/grims/.env. AI_BASE_URL is the PRIMARY's docker bridge and is unreachable from this machine,
# which is why a separate variable exists.
#
# Usage:  grims-embed [source ...]     no arguments sweeps every embedded source
set -eu

SHA_FILE=${SHA_FILE:-/srv/grims/deployed.sha}
ENV_FILE=${ENV_FILE:-/srv/grims/.env}
COMPOSE_DIR=${COMPOSE_DIR:-/srv/grims/repo/infra/docker}

[ -r "$SHA_FILE" ] || {
  echo "grims-embed: cannot read $SHA_FILE — refusing to run on an unknown revision" >&2
  exit 1
}

GRIMS_IMAGE_TAG="$(tr -d '[:space:]' < "$SHA_FILE")"
[ -n "$GRIMS_IMAGE_TAG" ] || {
  echo "grims-embed: $SHA_FILE is empty — refusing to run on an unknown revision" >&2
  exit 1
}
export GRIMS_IMAGE_TAG

cd "$COMPOSE_DIR" || exit 0
exec docker compose -f compose.workers.yml --env-file "$ENV_FILE" \
  run --rm --no-deps -T worker node apps/worker/dist/embed.js "$@"
