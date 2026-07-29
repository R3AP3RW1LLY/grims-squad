# Scheduled jobs

Every recurring job runs as a **one-shot process under the host's cron**, never
as a resident timer inside a container. A long-lived timer has to survive
restarts, deploys and clock changes and gets all three subtly wrong; cron
already solves that, and it is observable from outside the application — you can
see whether a job ran, and what it exited with, without reading the app's logs.

Each job exits **non-zero when it did not do its job**, so a silently failing
schedule shows up in cron's own mail rather than looking healthy forever.

## The crontab

```cron
CRON_TZ=UTC
COMPOSE=docker compose -f /srv/grims/repo/infra/docker/compose.prod.yml --env-file /srv/grims/.env

# Discord roles onto platform roles. EVERY MINUTE (owner, 2026-07-29).
#
# Touches Discord not at all: the bot keeps `discord_guild_members` current from
# gateway events, so this reads roles that are already fresh and costs a handful
# of indexed queries. Asking Discord for 109 members every minute would be
# 157,000 requests a day and would be rate-limited within the hour.
* * * * *      cd /srv/grims/repo && $COMPOSE run --rm worker node apps/worker/dist/role-sync.js >> /var/log/grims-role-sync.log 2>&1

# Discord reconciliation — role drift, orphaned identities, anomalies.
0 3 * * *      cd /srv/grims/repo && $COMPOSE run --rm worker node apps/worker/dist/main.js

# Inara profile sweep — pilot ranks for the roster (ADR-004, amended 2026-07-28).
*/15 * * * *   cd /srv/grims/repo && $COMPOSE run --rm worker node apps/worker/dist/inara-sync.js

# Promotions — the 1st of the month, 00:00 UTC. NOT before 1 August 2026.
0 0 1 * *      cd /srv/grims/repo && $COMPOSE run --rm worker node apps/worker/dist/promote.js

# Commander audit — every commander's squadron and nickname, nightly.
15 0 * * *     cd /srv/grims/repo && $COMPOSE run --rm worker node apps/worker/dist/daily-audit.js
```

**`node dist/…`, not `pnpm <script>`.** The package scripts run `tsx` against
TypeScript source. That works, but it pays a compile on every one of the 96
daily sweeps and depends on a devDependency being present in a production image
— a `pnpm install --prod` anywhere in the future would break all four jobs at
once, silently, at 3am.

**The `worker` service carries `profiles: ['jobs']`.** Without it `docker compose
up -d` would start the container alongside the API, the entrypoint would exit,
and restart-on-failure would loop it forever. A profiled service is only created
when something names it — and `run` always names its service explicitly.

Set `CRON_TZ=UTC` at the top of the crontab. Promotions are defined in UTC and a
host in a summer-time zone would otherwise run them an hour early for half the
year — which for a monthly job means running on the last day of the previous
month.

## `inara:sync` — every 15 minutes

**Why the cadence is affordable.** INV-033 caps Inara at 2 requests per minute
globally. The adapter batches **30 commanders per request**, so the whole
squadron costs about four requests — roughly two minutes of budget, three times
an hour. One name per request would have taken ~50 minutes and could only ever
have run nightly.

**What it writes.** `inara_commander_profiles` only. It never writes a commander
name and never touches verification: an Inara profile is self-reported, and
treating it as evidence would undo the point of key-based verification.

**Exit codes**

| Code | Meaning |
|---|---|
| `0` | Swept cleanly, **or no member has linked an Inara key** |
| `1` | One or more commanders got no answer — requests are failing |

No keys exits **0 on purpose**. Nobody has linked one yet, so there is nothing
to call with and the roster falls back to journal ranks. Alerting every fifteen
minutes about a feature nobody has configured is how a monitoring channel gets
muted, and a muted channel is worse than none.

### ★ THERE IS NO SQUADRON KEY ★

Corrected 2026-07-29, on the squadron owner's instruction. **Inara issues API
keys to PEOPLE, not to squadrons.** This job was written around a single
`INARA_API_KEY` that would belong to the squadron — a thing that does not exist
and was never going to be set, which is why the sweep skipped cleanly every
fifteen minutes and every pilot rank on the roster stayed blank for anybody not
running the companion app.

It now borrows from the members who have linked their own key: the same keys
that already prove their commander name, decrypted the same way.

**One key per request, whatever the batch size.** Inara's envelope carries
exactly one `APIkey` in its header and any number of events in its body, so
thirty commander lookups share a request but cannot share thirty keys — one
member's key authenticates the whole chunk. The pool ROTATES so no single member
carries every call, and a rejected key is retired for the rest of the run rather
than retried on every chunk.

**It reads nothing private.** The sweep asks for PUBLIC commander profiles by
name — the same pages anyone can open in a browser. The key only identifies the
caller to Inara's rate limiter; a member's key is never used to fetch something
they could not already see themselves.

`INARA_API_KEY` is still honoured if a deployment happens to have one, but only
as a fallback when the pool is empty. Preferring it would put the squadron's
whole rate spend on one key even when a dozen members had offered theirs.

`unanswered > 0` is the one outcome worth waking someone for. "Not found" is
normal — most members have no Inara account — but unanswered means requests are
failing, and a sweep that has quietly stopped refreshing anybody otherwise looks
identical to a healthy one.

**Overlap** is not a correctness problem (two sweeps write the same rows from
the same source) but it doubles rate-limit spend for nothing. A run takes ~2
minutes against a 20-minute interval, so there is an order of magnitude of
headroom; if the squadron grows past ~1,000 verified commanders, revisit it.

## `audit:daily` — every night at 00:15 UTC

**What it catches.** Two facts go stale between logins, and a member has no
reason to notice either:

- **Squadron** — somebody leaves Grim's Squad on Inara, or is removed. Nothing
  on our side is told, so they keep a green "verified" badge indefinitely.
- **Nickname** — somebody renames themselves in Discord, or is promoted, or an
  officer edits their nickname by hand. The `RANK - COMMANDER` prefix is then
  wrong until they next happen to touch their Inara key, which for most members
  is never.

The twenty-minute sweep only looks at people waiting on a squadron application.
This looks at **everybody**, once a day.

**Why 00:15 and not midnight.** Promotions run at 00:00 on the first of the
month. Starting at the same instant would have two jobs writing rank state while
each reads it, and the loser would sweep with a half-applied ladder — writing
nicknames for ranks that were mid-change. Fifteen minutes is not a lock; it is
enough separation that they never overlap in practice, and the audit is
idempotent besides.

**Why daily and not more often.** A member's OWN key cannot be batched —
`getOwnIdentity` answers for one key — so a hundred members with keys is a
hundred requests, roughly fifty minutes at 2/min (INV-033). Fine once a night,
impossible every twenty minutes. Members *without* a key are read from public
profiles, thirty to a request, which costs almost nothing.

**★ IT AUDITS. IT DOES NOT PUNISH ★**

A member Inara no longer shows in the squadron is recorded and written to the
audit log (`cmdr.squadron.departed`) for an officer to see. **Nothing is
revoked.** Inara membership is self-managed on a third-party site we do not run,
and stripping somebody's access at quarter past midnight with nobody watching is
not a decision a cron job gets to make.

| Code | Meaning |
|---|---|
| `0` | Swept cleanly |
| `1` | One or more commanders got no answer from Inara |
| `2` | `TOKEN_ENCRYPTION_KEYRING` is unset — refuses rather than silently falling back to public lookups for everybody |

Departures and refused renames are **not** failures. The guild owner cannot be
renamed by a bot, and neither can anybody whose highest role sits above the
bot's; both are ordinary facts about a guild. `unreachable` is the one outcome
worth waking somebody for.
