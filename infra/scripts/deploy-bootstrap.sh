#!/usr/bin/env bash
#
# The deploy ENTRYPOINT. Installed at /srv/grims/deploy.sh, and deliberately tiny.
#
# ★ WRITTEN BECAUSE THE BOX HAD BEEN RUNNING A DEPLOY SCRIPT FROM 30 JULY ★
#
# `/srv/grims/deploy.sh` was a COPY of `infra/scripts/deploy.sh`, taken once and never taken again.
# The repo's version kept improving; the box's did not. On 2026-08-10 the two were eleven days apart
# and the box was missing, among other things:
#
#   - the backup pruning, which is why 61 pre-deploy dumps and 101 GB had accumulated
#   - every required-variable preflight check added since (PUBLIC_SITE_URL, the four Discord
#     channels, ANNOUNCE_FORUM_AUTHOR_HANDLE, GRIMS_BIND_IP) — each of which exists because unset
#     is a SILENCE rather than an error
#   - reading PUBLIC_URL from /srv/grims/.env, so its health gate probed the old sslip.io hostname
#     and reported a healthy site by asking a name members no longer use
#   - the changelog and deploy-announcement steps entirely
#
# None of that announced itself. A deploy ran, said "Deployed with no downtime", and was telling the
# truth about the part it still knew how to do.
#
# ★ WHY A BOOTSTRAP AND NOT JUST A FRESHER COPY ★
#
# A fresher copy is the same bug with a later date on it. The entrypoint has to be something that
# cannot go stale, so this file does one thing: fetch, extract the real script from the ref being
# deployed, and exec it. It has no deploy logic to fall behind on.
#
# ★ AND WHY NOT A SYMLINK INTO THE REPO ★
#
# Because the deploy's own `git fetch` and checkout rewrite files inside the repo — including the
# script it would then be running. Bash reads a script incrementally as it executes, so replacing
# that file mid-run can make a running deploy jump into the middle of a different version of itself.
# Extracting to a temp file first means the thing being executed is never the thing being updated.
#
# The real script keeps this file installed — see the "entrypoint" step at the end of deploy.sh — so
# the two cannot drift again even if somebody runs the repo copy directly.
#
#   usage: /srv/grims/deploy.sh [--ref <git-ref>]
set -Eeuo pipefail

REPO=/srv/grims/repo
REF=main

# Parsed here only to know WHICH version of the deploy script to run. Every argument is passed
# through untouched, so this stays correct as the real script grows options this one has never heard
# of.
ARGS=("$@")
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="${2:-main}"; shift 2 ;;
    *) shift ;;
  esac
done

git -C "$REPO" fetch --quiet --prune origin

# `origin/$REF` first so a branch name means the REMOTE branch — the thing being deployed — rather
# than whatever the box's local copy of it happens to be pointing at. A tag or a raw SHA has no
# origin/ form, so it falls through to itself.
SOURCE="origin/$REF"
git -C "$REPO" rev-parse --verify --quiet "$SOURCE^{commit}" >/dev/null 2>&1 || SOURCE="$REF"

RUNNER="$(mktemp /tmp/grims-deploy.XXXXXXXX.sh)"
trap 'rm -f "$RUNNER"' EXIT

git -C "$REPO" show "$SOURCE:infra/scripts/deploy.sh" > "$RUNNER" || {
  printf '\033[31m✖ cannot read infra/scripts/deploy.sh at %s\033[0m\n' "$SOURCE" >&2
  exit 1
}
[[ -s $RUNNER ]] || { printf '\033[31m✖ deploy script at %s is empty\033[0m\n' "$SOURCE" >&2; exit 1; }
chmod +x "$RUNNER"

printf '\033[2m  bootstrap: running infra/scripts/deploy.sh from %s\033[0m\n' "$SOURCE"
exec "$RUNNER" "${ARGS[@]}"
