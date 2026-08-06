# Turning on pg_stat_statements

**Status:** prepared, not applied. It needs a Postgres **restart**, so it belongs in the approved
deploy window rather than in the middle of the night.

## Why

Every performance claim in this repository's history was produced by sampling `pg_stat_activity` in
a shell loop and counting what came back. That is how the colonisation query was found on
2026-08-06 — by looping twenty times, one second apart, and noticing the same statement in
sixty-one of the samples.

It worked, and it should not have been necessary. `pg_stat_statements` records total time, call
count and mean per statement continuously, so "what is this database actually spending its time
on" becomes a query rather than an afternoon.

Concretely, it would have answered in one line the question that took hours: which statement
accounted for the load, and whether it was one slow call or ten thousand fast ones.

## Why it is not on already

It requires the library to be preloaded at server start:

```
shared_preload_libraries = 'timescaledb'      # current
shared_preload_libraries = 'timescaledb,pg_stat_statements'
```

That is a restart-only setting. The extension is available in this image — `pg_available_extensions`
lists it — so nothing needs installing.

## Applying it, during the deploy window

```bash
docker exec grims-postgres-1 psql -U grims -d grims \
  -c "ALTER SYSTEM SET shared_preload_libraries = 'timescaledb,pg_stat_statements'" \
  -c "ALTER SYSTEM SET pg_stat_statements.max = 5000" \
  -c "ALTER SYSTEM SET pg_stat_statements.track = 'top'"

docker compose -f /srv/grims/repo/infra/docker/compose.prod.yml \
  --env-file /srv/grims/.env restart postgres

docker exec grims-postgres-1 psql -U grims -d grims \
  -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements"
```

> ⚠️ `shared_preload_libraries` is a REPLACE, not an append. Omitting `timescaledb` from that list
> stops the database starting at all — `market_history` is a hypertable and the extension has to be
> preloaded for it to exist. Both names, every time.

## Verifying

```bash
docker exec grims-postgres-1 psql -U grims -d grims -c \
  "select calls, round(total_exec_time)::int as total_ms, round(mean_exec_time)::int as mean_ms,
          left(query, 70) as q
     from pg_stat_statements
    where query not like '%pg_stat_statements%'
    order by total_exec_time desc limit 10"
```

If that returns rows, it is working. If it errors with "relation does not exist", the restart did
not pick up the library — check `shared_preload_libraries` actually contains both names.

## Cost

A fixed shared-memory allocation for `pg_stat_statements.max` entries (5,000 here, a few MB) and a
small per-statement bookkeeping cost. On a box that spent an evening at 1,189% CPU because nobody
could see which statement was responsible, that is not a close call.

## What to do with it afterwards

The first useful question, once it has a day of data:

- **highest `total_exec_time`** — where the database actually spends its life. Not the slowest
  query; the one whose calls × duration dominates. The colonisation lookup was only ~0.27s after
  the index, but at sixty per page load it would still top this list.

Reset the counters with `select pg_stat_statements_reset()` after a fix, so the next measurement
starts from the change rather than from the incident.
