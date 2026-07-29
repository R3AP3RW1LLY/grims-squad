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
# Discord reconciliation — role drift, orphaned identities, anomalies.
0 3 * * *      cd /srv/grims && docker compose run --rm worker pnpm reconcile

# Inara profile sweep — pilot ranks for the roster (ADR-004, amended 2026-07-28).
*/15 * * * *   cd /srv/grims && docker compose run --rm worker pnpm inara:sync

# Promotions — the 1st of the month, 00:00 UTC. NOT before 1 August 2026.
0 0 1 * *      cd /srv/grims && docker compose run --rm worker pnpm promote

# Commander audit — every commander's squadron and nickname, nightly.
15 0 * * *     cd /srv/grims && docker compose run --rm worker pnpm audit:daily
```

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
| `0` | Swept cleanly, **or no `INARA_API_KEY` is configured** |
| `1` | One or more commanders got no answer — requests are failing |

A missing key exits **0 on purpose**. Inara is optional; a deployment without a
key simply has no Inara-sourced ranks and the roster falls back to the journal.
Alerting every twenty minutes about a feature nobody configured is how a
monitoring channel gets muted, and a muted channel is worse than none.

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
