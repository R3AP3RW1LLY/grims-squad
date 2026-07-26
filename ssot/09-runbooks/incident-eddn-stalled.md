# INCIDENT — EDDN collector stalled

**Alert:** `EDDN silent > 10 min` in `#site-alerts`

**Impact:** Market and system data stop updating. Prices go stale — but they are still *labelled* with their age (INV-004), so the site tells the truth rather than lying. BGS influence ingestion stops, which matters more: a missed tick cannot be recovered from EDDN afterwards.

**Severity:** high if it persists past one BGS tick; medium otherwise.

---

## The critical distinction

**A connected-but-silent socket looks exactly like a quiet galaxy.** Nothing errors. This is the most dangerous failure mode in the collector and the reason the alert is on *silence*, not on an error rate.

---

## Triage — in order, stop when you find it

### 1. Is the collector even running?
```bash
ssh vps 'docker compose -f /srv/grims/compose.prod.yml ps eddn'
ssh vps 'docker compose -f /srv/grims/compose.prod.yml logs --tail=200 eddn'
```
| Finding | Go to |
|---|---|
| Container exited or restarting | §A |
| Running, logs show connection errors | §B |
| Running, logs quiet, no errors | §C — the dangerous one |
| Running, logs show parse failures | §D |
| Running, logs show write backlog | §E |

### 2. Is the relay up, or is it us?
```bash
ssh vps 'nc -zv eddn.edcd.io 9500'
curl -s https://<domain>/v1/admin/health | jq '.eddn'
```
If the relay is unreachable from the VPS **and** from a second network, it is upstream — see §F.

### 3. Is the disk full?
```bash
ssh vps 'df -h /var/lib/docker'
```
**Check this early.** A full disk stops writes, and it also fails the restart, which turns a stall into an outage.

---

## §A — Container exited or crash-looping

```bash
ssh vps 'docker compose -f compose.prod.yml logs --tail=500 eddn' | grep -iE 'error|fatal|panic'
```

| Cause | Fix |
|---|---|
| OOM killed | Raise the memory limit, or reduce the batch size. Investigate whether backpressure shedding is actually working. |
| Postgres unreachable at start | Fix Postgres first, then restart the collector. |
| Bad config after a deploy | Roll back (`deploy.md`). |
| Unhandled exception in a handler | Capture the message, restart to restore service, then fix and add a regression test (ADR-016). |

```bash
ssh vps 'docker compose -f compose.prod.yml restart eddn'
```

## §B — Connection errors

Normal transient behaviour is a reconnect with backoff. **Persistent failure** means:

```bash
ssh vps 'docker exec <eddn-container> nc -zv eddn.edcd.io 9500'   # from inside the container
```
If the host reaches it and the container does not, the **egress rules or the container network** changed — most likely a recent infra edit. Check the last infra commit.

## §C — Running, silent, no errors ← the dangerous one

The ZeroMQ socket believes it is connected and no data is arriving.

```bash
curl -s https://<domain>/v1/admin/health | jq '.eddn.lastMessageAt, .eddn.messagesPerSecond'
```

`messagesPerSecond: 0` with a `lastMessageAt` older than a few minutes means a **half-open socket**.

```bash
ssh vps 'docker compose -f compose.prod.yml restart eddn'
# then watch it recover
watch -n5 'curl -s https://<domain>/v1/admin/health | jq ".eddn.messagesPerSecond"'
```

**If the `receiveTimeout` did not fire on its own, that is a defect.** The collector is supposed to detect exactly this and reconnect. File it, write a regression test, fix it. A restart is the mitigation; the auto-reconnect is the fix.

## §D — Parse failures

```bash
curl -s https://<domain>/v1/admin/health | jq '.eddn.parseFailureRate, .eddn.deadLetterCount'
```

| Rate | Meaning |
|---|---|
| < 0.5% | Normal. Malformed uploads exist in the wild. |
| Rising steadily | **An EDDN schema changed.** Inspect the dead-letter queue. |
| Sudden spike to a large fraction | A schema change, or our parser broke in a deploy. Check what shipped. |

```bash
ssh vps 'docker compose -f compose.prod.yml exec eddn node scripts/dump-dlq.js --limit 5'
```

Update the parser, keeping it **version-tolerant** — an unknown field must not throw. A new `$schemaRef` should be ignored-and-counted, never an error.

## §E — Write backlog

```bash
curl -s https://<domain>/v1/admin/health | jq '.eddn.queueDepth, .database.connections, .database.slowQueries'
```

| Cause | Fix |
|---|---|
| Batching broken — single-row inserts | **The most likely cause of a persistent backlog.** Verify batching is actually active. Single-row inserts fall behind within an hour. |
| Postgres slow | Check `slowQueries`, connection count, and whether a migration or a `best_trades` refresh is running non-concurrently. |
| Prefilter bypassed | Ingesting the whole galaxy. Check the radius config against decision D4. |
| Missing index | Upserts scanning. Verify the indexes from `03-data/indexes.md` exist. |

Shed low-value schemas temporarily if needed — the collector should already be doing this under backpressure, and **if it is not, that is a defect**.

## §F — Relay is down upstream

Nothing to fix. Confirm on the EDCD Discord or the EDDN status page.

```
[ ] Post a note in #site-alerts so nobody re-triages it
[ ] Confirm the collector is retrying with backoff, not spinning
[ ] After recovery, seed any large gap from a Spansh dump (P3.5 job)
```

**Data during the outage is not recoverable from EDDN** — the relay does not replay. That is a property of the firehose, not a bug.

---

## After recovery

```bash
# 1. Confirm flow resumed
curl -s https://<domain>/v1/admin/health | jq '.eddn'

# 2. Lag should fall below 60s within a few minutes
# 3. Check for duplicates — there should be NONE (INV-034, idempotent upserts)
psql -c "select market_id, commodity, count(*) from market_orders
         group by 1,2 having count(*) > 1 limit 5;"
```

**If that query returns rows, the upsert key is wrong** and it is a far more serious problem than the stall.

Then:
- [ ] **Did BGS miss a tick?** Check `bgs_ticks` for a gap. A missing tick must not be inferred after the fact from incomplete data — leave it unassociated rather than guessing (INV-019).
- [ ] Update `STATUS.md` with the incident and its duration.
- [ ] If the runbook did not help, **improve it in this session** — that is the OPS-ADV standard.
- [ ] If the collector failed to self-heal, write the regression test before the fix.

## Prevention

| Control | Where |
|---|---|
| `receiveTimeout` ~60 s with reconnect on silence | collector |
| Alert on messages/sec = 0 for 10 min | monitoring |
| Alert on parse-failure **rate**, not count | monitoring |
| Alert on disk > 80%, not 95% | monitoring |
| Batch writes, 500 rows / 2 s | collector |
| Backpressure shedding by schema value | collector |
| Radius prefilter at parse time | collector |
| Idempotent, resumable, stale-discarding upserts | collector |
