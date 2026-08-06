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
#
# ★ A DM AND/OR A CHANNEL — SQUADRON OWNER, 2026-08-06 ★
#
# DISCORD_OPS_USER_ID is a Discord USER id, and the probe opens a DM to it. A channel alert at 3am
# is read at 9am, and the whole reason this exists is that the site was slow for twenty minutes and
# the only monitoring system was somebody noticing.
#
# Both are read because they are not alternatives: one person on call, plus a record the squadron
# can see, is a normal arrangement. Set either, or both, or neither — with neither the probe still
# measures and says in its log that it told nobody.
export DISCORD_BOT_TOKEN
export DISCORD_OPS_USER_ID
export DISCORD_OPS_CHANNEL_ID
DISCORD_BOT_TOKEN="$(envval DISCORD_BOT_TOKEN)"
DISCORD_OPS_USER_ID="$(envval DISCORD_OPS_USER_ID)"
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
#
# ★ THE API IS CHECKED THROUGH CADDY, NOT ON LOOPBACK — FIXED 2026-08-06 ★
#
# This said http://127.0.0.1:5001/v1/health, and the very first run on the real box announced
# "🔴 127.0.0.1:5001 is not responding". It never had been. The API publishes NO host ports; it is
# reachable only from the docker network, which is why deploy.sh's verify step curls
# `http://api:5001` from inside a container rather than from the host.
#
# An alert that fires forever about something that was never up is how a channel gets muted, and it
# would have started the minute this reached cron. The public path answers in 0.059s and is the
# route a member's request actually travels, so it is both reachable and more honest about what is
# being measured.
# ★ WIDENED AFTER THE OUTAGE OF 2026-08-06 ★
#
# The probe watched three URLs and reported all three healthy throughout that outage. It was
# right — the home page, the forum and the health check were all fast. What had collapsed was the
# COMPANION's colonisation route, which nothing was measuring: responses there went from 667ms to
# 14,646 ms, and the first anybody knew was the squadron owner saying the app would not connect.
#
# A monitoring system that watches only what was slow last time is a monitoring system for last
# time. The companion colonisation surface is added because it is the expensive one, the one with a
# bulkhead in front of it, and the one whose slowness is the leading indicator of everything else
# queueing behind it.
#
# ★ IT IS PROBED UNAUTHENTICATED, ON PURPOSE ★
#
# Without a device token this answers 401, which is a fine thing to measure: it proves the route is
# reachable and how long the API takes to reject, and it costs the database nothing. Embedding a
# real token in a cron script to measure it "properly" would put a credential on disk to watch a
# latency number — INV-012, and not a trade worth making.
export PROBE_URLS="${PROBE_URLS:-${PUBLIC_URL}/,${PUBLIC_URL}/forum,${PUBLIC_URL}/v1/health,${PUBLIC_URL}/v1/companion/colony/projects}"

exec node "$REPO/tools/probe.mjs"
