#!/usr/bin/env bash
#
# The wrapper cron calls to run a worker job, which exists for one reason: to make the job run THE
# CODE THAT IS DEPLOYED.
#
# ★ WHY THIS EXISTS — FOUND 2026-08-11, WHILE INSTALLING THE PROMOTION CRON ★
#
# compose.prod.yml names every image `...:${GRIMS_IMAGE_TAG:-latest}`. deploy.sh exports that
# variable to the exact sha it is rolling out, deliberately, so that "what is production running"
# has an answer. Nothing else did.
#
# The nightly reconcile ran:
#
#   cd /srv/grims/repo && docker compose ... --profile jobs run --rm worker node .../main.js
#
# with no such variable in scope, so it silently resolved `:latest` — an image tag deploy.sh does
# not move. On the day this was written that tag was TWENTY-ONE HOURS behind the running site, and
# there is no upper bound on the drift: `latest` only advances when something else happens to push
# it. The reconcile had been quietly running whatever code that was.
#
# It surfaced because a promotion dry run against production disagreed with the same job run
# locally — the deployed image would have promoted two members the new rules hold back. Had the
# promotion cron been installed the way the reconcile one was, it would have announced two
# promotions to the whole squadron, from code the tenure rule was never in.
#
# ★ IT REFUSES RATHER THAN FALLING BACK ★
#
# The bug was not `latest` being wrong. The bug was a SILENT fallback: a default that turns "I
# cannot tell what is deployed" into "run something, anything, and say nothing". So when the sha
# cannot be read, this exits non-zero and prints why. A job that does not run is a job somebody
# notices; a job that runs last week's rules is one nobody does, until it posts.
set -euo pipefail

REPO=${REPO:-/srv/grims/repo}
ENV_FILE=${ENV_FILE:-/srv/grims/.env}
SHA_FILE=${SHA_FILE:-/srv/grims/deployed.sha}
# Overridable so the regression test can watch what this hands to docker, rather than asserting on
# the text of the script and proving nothing about what runs.
DOCKER=${DOCKER:-docker}

die() {
  echo "worker-job: $*" >&2
  exit 1
}

if (( $# == 0 )); then
  die "usage: worker-job.sh <path/to/job.js> [args...]"
fi

[[ -r $SHA_FILE ]] || die "cannot read $SHA_FILE — refusing to run a job on an unknown revision."

# `tr -d` rather than a bare read: the file is written by deploy.sh and ends in a newline, and a tag
# with a stray newline in it fails as a confusing docker error rather than as this clear one.
SHA="$(tr -d '[:space:]' < "$SHA_FILE")"
[[ -n $SHA ]] || die "$SHA_FILE is empty — refusing to run a job on an unknown revision."

# The whole point of the file. Exported, because compose interpolates from the environment.
export GRIMS_IMAGE_TAG="$SHA"

# Printed so the log answers "which code ran" a fortnight later, when that is the only question
# anybody has. The reconcile log could not answer it, which is how this went unnoticed.
echo "worker-job: $* @ ${SHA:0:12} — $(date -u +%Y-%m-%dT%H:%M:%SZ)"

exec "$DOCKER" compose \
  -f "$REPO/infra/docker/compose.prod.yml" \
  --env-file "$ENV_FILE" \
  --profile jobs \
  run --rm worker node "$@"
