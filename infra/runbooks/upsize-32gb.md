# Upsizing the box to 32 GB

**Status:** ready to run. Needs the squadron owner — the instance must be powered off from the
Vultr console, which nothing on the box can do to itself.

**Expected downtime:** 10–20 minutes, of which the resize is 5–10. This is the one maintenance task
in this repo that is *not* zero-downtime, and it cannot be made so on a single box.

---

## Why — the measurement, not the hunch

Taken 2026-08-06 on the live box, no deploy running:

```
RAM                 15.6 GB total, postgres RSS 8.8 GB
load average        6.84 with 8 cores
database            16 GB
  market_entries     9.6 GB  (18.86M rows)
  knowledge_items    6.6 GB
cache hit ratio     95.86%
```

**The database is larger than the machine's memory.** 16 GB of data on 15.6 GB of RAM, of which
Postgres already holds 8.8 GB and five application containers need the rest. Nothing else in this
document matters as much as that single line.

What it costs, measured — the "commodities near me" query at
[market.store.ts:286](../../apps/api/src/logistics/market.store.ts#L286):

```
Bitmap Index Scan on market_entries_coords_idx
  (actual time=5243.315..5243.316 rows=527138)
  Buffers: shared hit=83 read=26064          ← 83 cached, 26,064 read from disk
Execution Time: 6057.944 ms
```

Six seconds, and 5.2 of them are one index scan pulling ~200 MB off the disk because it is not in
memory. That index is 4 GB and there is nowhere to keep it.

### What was checked and rejected first

`market_entries_coords_idx` looks like dead weight: 4 GB, and `pg_stat_user_indexes` reports **5
scans against 39.3 million inserts**. Dropping it was the obvious cheap win and it would have been
a serious mistake — the plan above shows it carrying the one query in the codebase that filters on
coordinates without a commodity, and without it that query seq-scans 18.9M rows.

Five scans does not mean useless. It means rarely run and, when run, essential. Recorded here
because the next person to read that statistic will reach for the same drop.

Genuinely dead and worth removing (separately, no downtime — see the end):

- 14 × `knowledge_items_embedding_idx_ccnew*`, all `indisready = false`, 0 bytes. Debris from
  interrupted `REINDEX CONCURRENTLY`. They cost nothing at runtime — they are not maintained on
  write — so this is tidying, not tuning. Do not let it be sold as a performance fix.

---

## ★ THE STEP THAT IS EASY TO MISS, AND MAKES THE WHOLE THING POINTLESS ★

**Postgres will not use the new memory. You have to tell it.**

`timescale/timescaledb-ha` runs `timescaledb-tune` **once**, when it initialises an empty data
directory, and writes the result into `postgresql.conf` inside the `pgdata` volume. That file
survives the resize, the restart, and every future deploy. Today it says:

```
shared_buffers      = 3996MB     ← 25% of the RAM this box had when the volume was created
effective_cache_size = 11989MB
work_mem            = 15985kB
```

Resize to 32 GB and change nothing else, and Postgres carries on using 4 GB of buffers and
believing the OS has 12 GB of cache, on a machine with 32. The bill doubles and the six-second
query stays six seconds.

Step 7 is the point of this runbook. Steps 1–6 just make it possible.

---

## Before the window

1. **Take a fresh dump.** The deploy script's backup is the model:

   ```bash
   ssh root@45.63.35.93
   /srv/grims/backup-db.sh          # or: docker exec grims-postgres-1 pg_dump -U grims grims | gzip > /srv/grims/backups/pre-upsize.sql.gz
   ls -lh /srv/grims/backups/ | tail -3
   ```

   A resize should not touch the disk. "Should not" is not a backup.

2. **Record the starting point**, so the improvement is a measurement rather than an impression:

   ```bash
   for i in 1 2 3; do curl -o /dev/null -sw '%{time_total}\n' https://grims-squad.com/; done
   uptime
   docker exec grims-postgres-1 psql -U grims -d grims -tAc \
     "select round(100.0*sum(blks_hit)/(sum(blks_hit)+sum(blks_read)),2) from pg_stat_database"
   ```

   `/var/log/grims-probe.ndjson` also has a per-minute history — the whole reason it exists is so
   this comparison does not depend on somebody having remembered to run curl.

3. **Tell members.** Ten to twenty minutes of a dead site is short, and unannounced it is the same
   experience as an outage.

## The window

4. **Stop the stack cleanly.** Pulling power from a running Postgres means crash recovery on a
   16 GB database at the worst possible moment.

   ```bash
   cd /srv/grims/repo/infra/docker
   docker compose --env-file /srv/grims/.env stop
   docker compose --env-file /srv/grims/.env ps        # everything Exited
   sync
   ```

5. **Power off from the Vultr console.** Not `shutdown -h now` — use the console's *Stop*, so its
   state machine agrees the instance is off before offering the resize.

6. **Resize.** Vultr console → the instance → *Settings* → *Change Plan* → the 32 GB plan → confirm,
   then boot.

   > ⚠️ **A Vultr plan change is one-way.** Once resized, the instance cannot be moved back to a
   > smaller plan — the disk has grown and Vultr will not shrink it. Choosing 32 GB is choosing it
   > permanently for this instance. That was the squadron owner's call on 2026-08-05; it is
   > repeated here because it is the only irreversible step in this document.

## After the window

7. **Retune Postgres — the actual point.**

   ```bash
   docker compose --env-file /srv/grims/.env up -d postgres
   docker exec -u postgres grims-postgres-1 sh -c '
     cp /home/postgres/pgdata/data/postgresql.conf /home/postgres/pgdata/data/postgresql.conf.pre32g'
   ```

   Then apply the new values. `ALTER SYSTEM` writes `postgresql.auto.conf`, which overrides
   `postgresql.conf` and — unlike hand-editing — leaves an obvious record of what was changed by a
   human and why:

   ```bash
   docker exec grims-postgres-1 psql -U grims -d grims -c "
     ALTER SYSTEM SET shared_buffers = '8GB';
     ALTER SYSTEM SET effective_cache_size = '24GB';
     ALTER SYSTEM SET work_mem = '32MB';
     ALTER SYSTEM SET maintenance_work_mem = '2GB';
   "
   docker compose --env-file /srv/grims/.env restart postgres    # shared_buffers needs a restart
   ```

   Where each number comes from:

   | setting | value | why |
   |---|---|---|
   | `shared_buffers` | 8 GB | The conventional 25%. Higher is tempting with a 16 GB database, but Postgres double-buffers with the OS page cache, and past ~40% the two fight. 8 GB of buffers plus ~20 GB of page cache holds the whole database twice over. |
   | `effective_cache_size` | 24 GB | Not an allocation — a *hint* used to price index scans. Leaving it at 12 GB on a 32 GB box makes the planner think memory is scarce and prefer sequential scans, which is the opposite of what the upsize is for. |
   | `work_mem` | 32 MB | The near-query above spilled ~13 MB to temp files at 15.9 MB. 32 MB keeps that sort in memory. Not higher: this is **per sort node per connection**, so 100 connections × 2 parallel workers × 32 MB is 6.4 GB worst case — affordable at 32 GB, and 64 MB would not be. |
   | `maintenance_work_mem` | 2 GB | Unchanged. It only bounds VACUUM and index builds, and 2 GB already exceeds what they use. |

8. **Bring the rest up in dependency order** and confirm each is healthy:

   ```bash
   docker compose --env-file /srv/grims/.env up -d
   docker compose --env-file /srv/grims/.env ps        # all healthy
   curl -sf http://127.0.0.1:5001/v1/health && echo API OK
   ```

9. **Verify the settings actually took.** `ALTER SYSTEM` silently accepts a setting that then fails
   to apply — this is the check that the whole exercise worked:

   ```bash
   docker exec grims-postgres-1 psql -U grims -d grims -tAc \
     "select name||' = '||setting||' '||coalesce(unit,'') from pg_settings
       where name in ('shared_buffers','effective_cache_size','work_mem')"
   ```

   `shared_buffers` should read `1048576 8kB`. If it still reads `511488`, the restart did not
   happen — `restart` is required, `reload` is not enough.

10. **Measure the same things as step 2.** The near-query is the one to watch:

    ```bash
    docker exec grims-postgres-1 psql -U grims -d grims -c "
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT commodity, min(buy_price), count(DISTINCT station_key)::int
        FROM market_entries
       WHERE coords IS NOT NULL
         AND coords <@ cube_enlarge(cube(ARRAY[0::float8,0::float8,0::float8]), 50, 3)
         AND (coords <-> cube(ARRAY[0::float8,0::float8,0::float8])) <= 50
         AND market_seen_at >= now() - interval '90 days'
       GROUP BY commodity"
    ```

    Run it **twice**. The first run warms the cache and is not the number of interest; the second is
    what a member would experience. Baseline to beat: `read=26064`, 6058 ms. Success looks like the
    `read=` count collapsing toward zero — that is the index living in memory, which is the entire
    thesis of this upsize.

---

## Rollback

There isn't one for the resize, and pretending otherwise would be worse than saying so. Vultr does
not move an instance down a plan.

Everything *else* rolls back normally: if the retune makes things worse, restore the saved config
and restart —

```bash
docker exec grims-postgres-1 psql -U grims -d grims -c "ALTER SYSTEM RESET ALL"
docker compose --env-file /srv/grims/.env restart postgres
```

— which returns Postgres to exactly the settings it has today, on a machine with twice the memory.

## What this does not fix

Worth being blunt, because "we upsized and it is still sometimes slow" is a conversation better had
now than in a month.

- **It is not the deploy problem.** That was six Docker images compiling on the box, and it is
  fixed by building them in CI (PR #116), not by having more memory to compile them in.
- **It does not make the near-query fast in absolute terms.** It removes the disk reads. A GROUP BY
  over 527,138 rows still has to happen; expect hundreds of milliseconds, not single digits.
- **CPU is not obviously the constraint.** Load 6.84 on 8 cores is high, but it is dominated by
  Postgres waiting on I/O rather than computing. If load stays high after this, that is the signal
  to move the workers to a second box — the separate piece of work, not a variant of this one.

## Tidying, separately

Not part of the window, no downtime, do it any time:

```bash
docker exec grims-postgres-1 psql -U grims -d grims -c "
  DO \$\$ DECLARE r record; BEGIN
    FOR r IN SELECT c.relname FROM pg_index i
             JOIN pg_class c ON c.oid = i.indexrelid
             WHERE NOT i.indisready AND c.relname LIKE '%_ccnew%'
    LOOP EXECUTE format('DROP INDEX IF EXISTS %I', r.relname); END LOOP;
  END \$\$;"
```

Fourteen invalid index stubs from interrupted `REINDEX CONCURRENTLY`. Filtered on `NOT indisready`
so it can only ever remove indexes Postgres has already abandoned — a valid index, however it is
named, is not touched.
