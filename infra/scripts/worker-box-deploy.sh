#!/usr/bin/env bash
#
# The ONLY thing the primary's deploy key may run on the INGESTION box.
#
# Installed at /usr/local/bin/grims-worker-deploy on 149.248.39.225, and pinned as the forced
# command for that key in ~/.ssh/authorized_keys:
#
#   command="/usr/local/bin/grims-worker-deploy",no-pty,no-port-forwarding,... ssh-ed25519 AAAA...
#
# ★ WHY IT IS IN THE REPOSITORY — ADDED 2026-08-11 ★
#
# It was not. It existed only on the box, exactly like the crontab beside it and exactly like the
# deploy script that spent eleven days drifting out of date before deploy-bootstrap.sh was written
# to stop it. A script nobody can diff is a script nobody can review, and this one holds the rules
# that decide what may run on that machine.
#
# ★ WHY A FORCED COMMAND AND NOT A LOGIN ★
#
# Squadron owner, 2026-08-08, choosing how to close the manual second-box deploy: a dedicated key,
# restricted server-side, rather than a copy of the operator's key.
#
# Whatever the client sends is ignored — there is no shell, no port forwarding, no pty. The only
# variable the caller controls is the revision, read from SSH_ORIGINAL_COMMAND and checked against a
# hex pattern before it is used.
#
# The worst a compromised primary can do with this key is deploy a commit that is already on
# origin/main to this box. It cannot read a file, open a shell, or reach anything else.
#
# ★ WHY THE REVISION IS VALIDATED RATHER THAN TRUSTED ★
#
# It is interpolated into a git command. A revision that could contain a semicolon would make the
# forced command pointless, which is the whole reason this file exists.
set -Eeuo pipefail

REPO=/srv/grims/repo
COMPOSE_FILE="$REPO/infra/docker/compose.workers.yml"
ENV_FILE=/srv/grims/.env
SHA_FILE=/srv/grims/deployed.sha

say() { printf '  [worker-box] %s\n' "$*"; }
die() { printf '  [worker-box] ✖ %s\n' "$*" >&2; exit 1; }

# The caller sends `deploy <sha>`; anything else is refused rather than interpreted.
read -r -a ARGS <<< "${SSH_ORIGINAL_COMMAND:-}"
[[ ${ARGS[0]:-} == "deploy" ]] || die "this key may only run: deploy <sha>"

SHA="${ARGS[1]:-}"
[[ $SHA =~ ^[0-9a-f]{40}$ ]] || die "not a full commit sha: ${SHA:-<empty>}"

[[ -r $ENV_FILE ]] || die "cannot read $ENV_FILE"

# ★ THE FEATURES THIS BOX RUNS NEED THEIR OWN SETTINGS, AND IT HAS ITS OWN .env ★
#
# Found on 2026-08-16, and it is exactly the failure this whole script exists to make impossible.
#
# The journal poller runs in `worker-daemon`, which lives HERE — not on the primary. Its settings
# were configured on the primary only, because that is where the API needed them, so the poller
# would have started, found no client id, logged "Frontier is not configured on this box" once, and
# never polled. The feature would have looked shipped and done nothing, for the cloud players it
# was built for, with nothing failing anywhere.
#
# So the deploy REFUSES rather than starting a daemon that cannot do its job. A missing setting is
# knowable in a second here; discovered later it is a fortnight of a member wondering why their
# flying never counted.
for key in FDEV_CAPI_CLIENT_ID FDEV_CAPI_REDIRECT_URI FDEV_CAPI_SHARED_KEY TOKEN_ENCRYPTION_KEYRING; do
  value="$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2-)"
  [[ -n $value && $value != *CHANGE_ME* ]]     || die "missing $key in $ENV_FILE — the journal poller would start disabled and say nothing.
     Copy it from the primary's /srv/grims/.env."
done
say "cAPI settings present"

PREVIOUS="$(git -C "$REPO" rev-parse HEAD)"
say "rollback point ${PREVIOUS:0:8}"

git -C "$REPO" fetch --quiet origin
# The sha must actually be an ancestor of origin/main. A deploy key that can check out an arbitrary
# object could run any commit ever pushed to any branch, including one that never passed CI.
git -C "$REPO" merge-base --is-ancestor "$SHA" origin/main \
  || die "$SHA is not on origin/main — refusing"

git -C "$REPO" reset --quiet --hard "$SHA"
say "at $(git -C "$REPO" log --oneline -1)"

export GRIMS_IMAGE_TAG="$SHA"
COMPOSE="docker compose -f $COMPOSE_FILE --env-file $ENV_FILE"

$COMPOSE pull -q || die "could not pull images for ${SHA:0:8} — is the images workflow finished?"
say "images pulled"

$COMPOSE up -d
say "containers recreated"

# ★ PROVE IT, RATHER THAN REPORTING THE EXIT CODE OF `up -d` ★
#
# `up -d` returns as soon as the containers start. A daemon that starts and immediately dies on a
# bad env var would still look like a successful deploy — which is the failure the primary's own
# deploy script was written to prevent, and this box deserves the same treatment.
sleep 15
for service in worker-daemon eddn-collector; do
  state="$($COMPOSE ps --format '{{.Service}} {{.State}}' | awk -v s="$service" '$1 == s {print $2}')"
  [[ $state == running ]] || {
    printf '  [worker-box] ✖ %s is %s, rolling back to %s\n' "$service" "${state:-missing}" "${PREVIOUS:0:8}" >&2
    git -C "$REPO" reset --quiet --hard "$PREVIOUS"
    GRIMS_IMAGE_TAG="$PREVIOUS" $COMPOSE up -d || true
    # The marker follows the rollback, or the cron jobs below would run the revision that just
    # failed its health check.
    printf '%s\n' "$PREVIOUS" > "$SHA_FILE"
    exit 1
  }
  say "$service running"
done

# ★ THE DEPLOYED-REVISION MARKER — ADDED 2026-08-11 ★
#
# This box had no such file, and that is not cosmetic: infra/scripts/worker-job.sh reads it to pin
# GRIMS_IMAGE_TAG for every scheduled job here. Without it the wrapper REFUSES to run, which is the
# correct failure but means the Inara sweep, the reconcile and the commander audit could not run at
# all. Before the wrapper existed they ran `:latest` instead — an image tag nothing moves, which is
# how this box spent a fortnight running the build from PR #144 while production ran ahead of it.
#
# Written LAST, after both services are proved running, for the same reason the primary writes its
# marker after the health gate: it names the revision this box is NOW running, and a marker written
# before the proof would name one that had already been rolled back.
printf '%s\n' "$SHA" > "$SHA_FILE"
say "deployed revision recorded → $SHA_FILE"

# -- the prune ---------------------------------------------------------------
#
# * THIS BOX FILLED TO ZERO BYTES AND ROLLED A DEPLOY BACK - 2026-08-18 *
#
# Squadron owner: "yes add a prune step! this was supposed to be done a long time ago!"
#
# The nightly janitor already runs here and already keeps three days of images, which is the right
# window for a normal week. It is not the right window for a day with six releases in it: each lands
# ~6GB of worker and collector images, so the disk reached 100% between two nightly runs and the
# next deploy died on "no space left on device".
#
# The janitor DID notice -- it printed "Only 8G free after cleanup - something else is growing" --
# but it prints into a log file on a box nobody logs into, so the first anybody knew was a failed
# deploy. This closes the gap where the images are created, rather than waiting for 04:17.
#
# * WHAT IT PROTECTS *
#
# The image just deployed and the ROLLBACK image, BY NAME. Not by age: the rollback point can be any
# age, and an age filter that happened to delete it would turn the next bad deploy into an outage.
# That is the one thing this must never do, so it is an exclusion rather than a window.
#
# * AND WHY IT IS LAST, AND NON-FATAL *
#
# Both services are already proved running by the health gate above. Housekeeping must never fail a
# deploy that worked - the rule every record step in the primary script follows.
say "clearing images this deploy superseded"
SUPERSEDED=$(
  docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' 2>/dev/null     | grep -F 'grims-squad/'     | grep -vF ":$SHA "     | grep -vF ":$PREVIOUS "     | awk '{print $2}' | sort -u
) || SUPERSEDED=""
if [[ -n $SUPERSEDED ]]; then
  printf '%s
' "$SUPERSEDED" | xargs -r docker rmi -f >/dev/null 2>&1 || true
  ok "cleared $(printf '%s
' "$SUPERSEDED" | wc -l) superseded image(s); kept ${SHA:0:8} and rollback ${PREVIOUS:0:8}"
else
  ok "nothing superseded to clear"
fi
ok "$(df -BG --output=avail / | tail -1 | tr -dc '0-9')G free on this box"

say "deployed ${SHA:0:8}"
