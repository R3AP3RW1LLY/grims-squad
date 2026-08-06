# Moving the workers to a second box

**Status:** ready to run, blocked on provisioning. Needs the squadron owner to create the instance
and the VPC — nothing on the current box can do either.

**Downtime:** none for members. Ingestion pauses for the few minutes between stopping the old
collector and starting the new one; prices go stale, nothing breaks.

**Do this after the 32 GB upsize, not before.** Both change how the primary behaves, and doing them
together means not knowing which one helped. The upsize also makes this cheaper: with the database
in memory, the workers' queries stop competing for disk.

---

## Why

Measured 2026-08-05, during the nightly galaxy import on the single box:

```
load average          23
companion app         88 seconds to answer
cause                 four unpigz processes decompressing a 4 GB dump
                      on the same eight cores serving the site
```

`cpu_shares: 256` was the first answer and it works — the ingest yields whenever the API wants a
core. What a CPU weight cannot do is give back memory or disk bandwidth, and the ingest wants both
at exactly the moment Postgres does. On 2026-08-06 the box still showed load 6.84 with no deploy
running and Postgres at 560% CPU.

Nobody is waiting on an ingest. Everybody is waiting on the site.

---

## What moves

| service | moves? | why |
|---|---|---|
| `worker-daemon` | yes | Resident scheduler. No ingress, database only. |
| `eddn-collector` | yes | Outbound to the EDDN relay, then Postgres. No ingress. |
| `worker` (cron one-shots) | yes | The nightly reconcile and the galaxy import — the specific job that caused the 88-second responses. |
| `postgres`, `redis`, `meilisearch` | **no** | Moving state is a different, much riskier project. This moves compute only. |
| `api`, `web`, `bot`, `caddy` | **no** | These are what the primary is for. |

## Sizing

The workers need CPU and disk, not much memory: a 4 CPU / 8 GB instance is right, with at least
60 GB of disk for the 4 GB dump, its decompressed form, and room to be wrong about that.

**Same region as the primary.** A VPC does not span regions, and routing this over the public
internet is not an option — see below.

---

## 1. Provision (squadron owner)

1. Vultr → *Deploy* → same region as `45.63.35.93`, Ubuntu 24.04, 4 CPU / 8 GB.
2. Attach it to a **VPC 2.0 network**, creating one if it does not exist, and attach the existing
   primary to the same network. Note both private addresses — `10.x.x.x`, shown in the console and
   in `ip -4 addr` on each box.
3. Add the same SSH key the primary uses (`~/.ssh/grims_squad_ed25519`).

## 2. Let Postgres listen on the VPC — carefully

Today Postgres has no published ports at all: it is reachable only from containers on the primary's
docker network. It now needs to accept connections from one other machine.

> ⚠️ **Bind to the private address, never `0.0.0.0`.** `ports: ['5432:5432']` in compose publishes
> on every interface including the public one, and Docker writes its own iptables rules that sit
> *in front of* ufw — so a ufw rule denying 5432 will not save you. A Postgres holding 107 members'
> data, open to the internet, guarded by a password. Write the address.

On the primary, in `infra/docker/compose.prod.yml`, on the `postgres` service:

```yaml
    ports:
      # The VPC address of THIS box, not 0.0.0.0. See infra/runbooks/workers-second-box.md.
      - '${PRIVATE_IP}:5432:5432'
```

and add `PRIVATE_IP=10.x.x.x` to `/srv/grims/.env`. Redis the same, if the workers use it:

```yaml
    ports:
      - '${PRIVATE_IP}:6379:6379'
```

Then confirm — from your own machine, which must fail:

```bash
nc -zv 45.63.35.93 5432        # must be refused or time out
```

and from the worker box, which must succeed:

```bash
nc -zv 10.x.x.x 5432           # must connect
```

Both checks. A rule that is not tested from the outside is a belief.

## 3. Prepare the worker box

```bash
ssh -i ~/.ssh/grims_squad_ed25519 root@<worker-ip>

# Docker, from the official repository — the distribution package lags badly
curl -fsSL https://get.docker.com | sh

mkdir -p /srv/grims
git clone https://github.com/R3AP3RW1LLY/grims-squad.git /srv/grims/repo

# The registry, same one-time login the primary needs (read:packages token)
echo <TOKEN> | docker login ghcr.io -u r3ap3rw1lly --password-stdin
```

## 4. The environment file

Copy `/srv/grims/.env` from the primary and change **exactly two lines** — the host in
`DATABASE_URL` and in `REDIS_URL`, from the docker service name to the private address:

```
DATABASE_URL=postgresql://grims:...@10.x.x.x:5432/grims
REDIS_URL=redis://10.x.x.x:6379
```

Everything else stays byte-identical. The workers announce to Discord and read the same buckets, so
a "minimal" env file here means a job that runs for a week and quietly announces nothing.

```bash
scp /srv/grims/.env root@<worker-ip>:/srv/grims/.env      # from the primary
chmod 600 /srv/grims/.env                                  # on the worker box
```

## 5. Start them

```bash
cd /srv/grims/repo/infra/docker
docker compose -f compose.workers.yml --env-file /srv/grims/.env pull
docker compose -f compose.workers.yml --env-file /srv/grims/.env up -d
docker compose -f compose.workers.yml --env-file /srv/grims/.env logs -f --tail=50
```

Look for the collector reporting messages, and for the daemon connecting rather than retrying.

## 6. Verify it is actually writing

From the primary, confirming that the *new* collector is the one doing the work:

```bash
docker exec grims-postgres-1 psql -U grims -d grims -tAc \
  "select client_addr, count(*) from pg_stat_activity
    where datname='grims' group by client_addr"
```

The worker box's private address should appear. Then, that its writes are landing:

```bash
docker exec grims-postgres-1 psql -U grims -d grims -tAc \
  "select max(market_seen_at) from market_entries"
```

Run it twice a minute apart. The timestamp must advance.

## 7. Move the cron

On the **worker** box, `/etc/cron.d/grims-worker` — the same file, with the compose invocation
pointed at this file:

```
0 3 * * * root cd /srv/grims/repo && docker compose -f infra/docker/compose.workers.yml --env-file /srv/grims/.env --profile jobs run --rm worker node apps/worker/dist/main.js >> /var/log/grims-reconcile.log 2>&1
```

## 8. Stop the old ones — and this is the step that matters

```bash
# On the PRIMARY
cd /srv/grims/repo/infra/docker
docker compose --env-file /srv/grims/.env stop worker-daemon eddn-collector
rm /etc/cron.d/grims-worker
```

> ★ **Two collectors is the failure mode of this whole migration.** They would both write every
> station, interleaving two delete-and-insert transactions over the same rows. The advisory lock
> inside the process prevents corruption — it does not care which host it is called from, which is
> why it was written as an advisory lock — but one of the two will sit idle having lost the race,
> and you will have paid for a machine doing nothing while believing ingestion is twice as fast.
>
> Check, do not assume:
>
> ```bash
> docker exec grims-postgres-1 psql -U grims -d grims -tAc \
>   "select count(*) from pg_locks where locktype='advisory'"
> ```
>
> Exactly one.

Then remove those three services from `compose.prod.yml` so the next deploy does not start them
again. Until that lands, **a deploy will undo step 8** — `docker compose up -d` starts everything
the file declares.

## 9. Teach the deploy about the second box

`infra/scripts/deploy.sh` currently deploys one machine. Until it knows about this one, a deploy
updates the primary and leaves the workers on the old revision — which is survivable (they are the
same repo and usually compatible) right up until a migration changes a column they write.

The smallest honest version, after the primary's health gate passes:

```bash
ssh -i /root/.ssh/worker_ed25519 root@<worker-ip> "
  cd /srv/grims/repo && git fetch --quiet origin && git reset --quiet --hard $TARGET_SHA &&
  cd infra/docker &&
  GRIMS_IMAGE_TAG=$TARGET_SHA docker compose -f compose.workers.yml --env-file /srv/grims/.env pull -q &&
  GRIMS_IMAGE_TAG=$TARGET_SHA docker compose -f compose.workers.yml --env-file /srv/grims/.env up -d"
```

This needs a key from the primary to the worker box, which is a new piece of trust and should be a
dedicated key with a forced command, not a copy of the operator's. Write it when the box exists —
it is the one part of this document that should not be guessed at in advance.

---

## Rollback

Genuinely cheap, unlike the upsize, because nothing was moved — only started elsewhere:

```bash
# On the worker box
docker compose -f compose.workers.yml --env-file /srv/grims/.env down

# On the primary
docker compose --env-file /srv/grims/.env up -d worker-daemon eddn-collector
cp /srv/grims/repo/infra/cron/grims-worker /etc/cron.d/grims-worker
```

Back to the current arrangement in under a minute. The worker instance can then be destroyed, and
Vultr bills it by the hour.

## How you will know it worked

`/var/log/grims-probe.ndjson` on the primary, around 03:00 — the window that used to produce
88-second responses. Compare the week before against the week after:

```bash
grep '"at":"....-..-..T03' /var/log/grims-probe.ndjson \
  | jq -r 'select(.url|endswith("/")) | .ms' | sort -n | tail -5
```

The worst nightly response time is the number this is for. If it is still seconds, the workers were
not the constraint and the next thing to look at is Postgres itself — not a third box.
