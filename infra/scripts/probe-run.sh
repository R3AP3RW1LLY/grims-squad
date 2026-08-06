#!/usr/bin/env bash
#
# The wrapper cron calls, which exists for one reason: to hand probe.mjs exactly two secrets and
# nothing else.
#
# ★ WHY NOT JUST `set -a; . /srv/grims/.env` IN THE CRONTAB ★
#
# Sourcing that file executes it. It is a docker-compose env file, not a shell script, and its
# values are unquoted — a password containing a backtick, a parenthesis or a dollar sign is a
# command substitution the moment bash reads it. That is a remote code execution triggered by
# somebody rotating a credential, running as root, once a minute.
#
# The same `sed` extraction deploy.sh uses, reading only the two keys the probe needs.
set -euo pipefail

ENV_FILE=${ENV_FILE:-/srv/grims/.env}
REPO=${REPO:-/srv/grims/repo}

envval() { sed -n "s/^$1=//p" "$ENV_FILE" | head -n1; }

# INV-012: exported into the child's environment, never echoed, never written to the log this
# script's stdout is redirected into.
export DISCORD_BOT_TOKEN
export DISCORD_OPS_CHANNEL_ID
DISCORD_BOT_TOKEN="$(envval DISCORD_BOT_TOKEN)"
DISCORD_OPS_CHANNEL_ID="$(envval DISCORD_OPS_CHANNEL_ID)"

# ★ PROBED BY THE NAME MEMBERS ACTUALLY USE ★
#
# Same reasoning as deploy.sh's verify step, which used to check a hostname nobody was visiting any
# more and call the site healthy on the strength of it. The env file is the answer; the shell can
# override for a rehearsal.
PUBLIC_URL="${PUBLIC_URL:-$(envval PUBLIC_SITE_URL)}"
PUBLIC_URL="${PUBLIC_URL:-https://grims-squad.com}"

# The home page, the heaviest page members actually load, and the API underneath both. `/forum`
# earns its place: during the six-image build it measured 14.9s, within a rounding error of `/`,
# which is how we know the saturation was the box and not one slow route.
export PROBE_URLS="${PROBE_URLS:-${PUBLIC_URL}/,${PUBLIC_URL}/forum,http://127.0.0.1:5001/v1/health}"

exec node "$REPO/tools/probe.mjs"
