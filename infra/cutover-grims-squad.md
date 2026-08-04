# Cutover runbook — grims-squad.com

The move from `https://45-63-35-93.sslip.io` to `https://grims-squad.com`, in
the order that keeps both names serving throughout. Nothing in this file has
been applied; every step is an operator action on the production box
(`root@45.63.35.93`) or in an external console, and each step says how to
verify it and how to undo it.

**The one rule: the sslip.io name keeps serving until the last step, and even
then it is not removed.** The companion app's installed base was built with
`https://45-63-35-93.sslip.io` compiled in as its API base and its auto-update
feed, so that name must answer until a companion release built against the new
domain has actually reached members. DNS moving is invisible to those installs;
the old hostname dying is not.

Credentials: the Cloudflare API token lives in `.secrets/cloudflare.env` on the
operator's machine. It is referenced below as `$CF_API_TOKEN` and is never to
be committed, echoed into shell history on the server, or pasted into chat.

---

## 0. Prerequisites (do these before anything else)

1. **Deploy the staging commit.** The commit that ships this runbook also ships
   the `grims-squad.com` server block (`infra/caddy/sites/grims-squad.com.caddy`),
   the compose mounts for `/srv/grims/caddy` and `/etc/ssl/grims-squad.com`,
   and a deploy preflight that now REQUIRES `PUBLIC_URL` and `PUBLIC_SITE_URL`.

2. **Add the two variables to `/srv/grims/.env` first**, still pointing at the
   current name, or that deploy's preflight will refuse to run:

   ```
   PUBLIC_URL=https://45-63-35-93.sslip.io
   PUBLIC_SITE_URL=https://45-63-35-93.sslip.io
   ```

3. **Confirm the zone exists in Cloudflare** and capture its id (needed by
   every later API call):

   ```sh
   curl -sS -H "Authorization: Bearer $CF_API_TOKEN" \
     "https://api.cloudflare.com/client/v4/zones?name=grims-squad.com" \
     | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"][0]["id"])'
   # export ZONE_ID=<the id printed>
   ```

4. **Do NOT add grims-squad.com to `SITE_HOSTNAMES`.** That variable feeds the
   Let's Encrypt block in the Caddyfile, and ACME for a name that Cloudflare
   proxies fails. The new domain gets its own server block with an Origin CA
   certificate instead — that separation is deliberate.

---

## 1. Issue the Cloudflare Origin CA certificate

> **✅ DONE 2026-08-04 — nothing to run here.** The certificate was issued via
> the API (id `2800257103…`, apex + `*.grims-squad.com`, expires 2041-07-31)
> and is installed on the VPS as `/etc/ssl/grims-squad.com/{cert,key}.pem`,
> modulus-verified as a matching pair. The key also sits (gitignored) at
> `.secrets/origin-ca/` on the dev machine. Alongside it, three zone settings
> were pre-set the same day: **Always Use HTTPS on**, **minimum TLS 1.2**
> (was 1.0), automatic HTTPS rewrites already on. The `www` CNAME → apex
> (proxied) already exists. The steps below stay as the record of HOW, for the
> next domain.

The browser's TLS terminates at Cloudflare; this certificate only secures
Cloudflare's connection back to our origin, which is why a fifteen-year
API-issued pair is the right tool and public-CA issuance is not.

On the **server**, generate the key and a CSR (the key never leaves the box):

```sh
mkdir -p /etc/ssl/grims-squad.com && chmod 700 /etc/ssl/grims-squad.com
openssl ecparam -name prime256v1 -genkey -noout \
  -out /etc/ssl/grims-squad.com/key.pem
openssl req -new -key /etc/ssl/grims-squad.com/key.pem \
  -subj "/CN=grims-squad.com" \
  -out /tmp/grims-squad.csr
```

From the **operator machine** (or the server — anywhere with the token), ask
Cloudflare to sign it. The call shape:

```sh
curl -sS -X POST "https://api.cloudflare.com/client/v4/certificates" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data @- <<JSON
{
  "hostnames": ["grims-squad.com", "www.grims-squad.com"],
  "request_type": "origin-ecc",
  "requested_validity": 5475,
  "csr": $(python3 -c 'import json,sys;print(json.dumps(open("/tmp/grims-squad.csr").read()))')
}
JSON
```

- `requested_validity` is in days; 5475 is fifteen years.
- `request_type` matches the key above (`origin-ecc` for the EC key; use
  `origin-rsa` only if the key was generated RSA).
- If the token is refused with an authentication error, the Origin CA
  endpoints on older accounts want the **Origin CA Key** (Cloudflare dashboard
  → My Profile → API Tokens → Origin CA Key) sent as
  `-H "X-Auth-User-Service-Key: <key>"` instead of the Bearer header. Same
  body, same response.

The response's `result.certificate` field is the PEM. Install it:

```sh
# paste result.certificate into:
vi /etc/ssl/grims-squad.com/cert.pem
chmod 600 /etc/ssl/grims-squad.com/*.pem
openssl x509 -in /etc/ssl/grims-squad.com/cert.pem -noout -subject -enddate  # sanity
rm /tmp/grims-squad.csr
```

---

## 2. Enable the grims-squad.com server block

> **✅ STAGED 2026-08-04.** `/srv/grims/caddy/grims-squad.com.caddy` is already
> on the box — copied ahead of time, inert until the deploy ships the compose
> file that mounts `/srv/grims/caddy` and the Caddyfile that imports it. Only
> the `up -d caddy` / reload half of this section remains to run at cutover.

The block is already on the box (the repo is the Caddy mount); enabling it is
copying it into the operator-owned directory the Caddyfile imports from:

```sh
mkdir -p /srv/grims/caddy
cp /srv/grims/repo/infra/caddy/sites/grims-squad.com.caddy /srv/grims/caddy/
cd /srv/grims/repo
docker compose -f infra/docker/compose.prod.yml --env-file /srv/grims/.env \
  up -d caddy            # first enable only: picks up the new mounts
docker compose -f infra/docker/compose.prod.yml --env-file /srv/grims/.env \
  exec -T caddy caddy reload --config /etc/caddy/Caddyfile
```

**Verify before DNS exists** — point curl at the box directly:

```sh
curl -sSI --resolve grims-squad.com:443:45.63.35.93 --insecure \
  https://grims-squad.com/v1/health
# expect HTTP/2 200. --insecure because the Origin CA is not in curl's trust
# store; Cloudflare, not the public, is this certificate's audience.
```

And confirm the old name still answers: `curl -sSI https://45-63-35-93.sslip.io/v1/health`.

Undo: `rm /srv/grims/caddy/grims-squad.com.caddy` and reload. The sslip.io
block is untouched either way.

---

## 3. Point DNS at the origin (the actual flip)

> **Zone facts as of 2026-08-04** (zone id `38ed982206d0772e8312e4a7094a910a`):
> the apex holds **two proxied GoDaddy parking A records** (15.197.148.33,
> 3.33.130.190) that must be DELETED, and `www` → apex (proxied) **already
> exists** — do not POST a second one. A stray `_domainconnect` CNAME from
> GoDaddy can be deleted at the same time or left; nothing reads it.

Delete the parking records, then create ours (proxied, orange cloud):

```sh
# The two parking record ids:
curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?type=A&name=grims-squad.com" \
  -H "Authorization: Bearer $CF_API_TOKEN" | python3 -c \
  'import json,sys;[print(r["id"], r["content"]) for r in json.load(sys.stdin)["result"]]'

# Delete each (twice, once per id from above):
curl -sS -X DELETE "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/<id>" \
  -H "Authorization: Bearer $CF_API_TOKEN"

# Create the origin record:
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"type":"A","name":"grims-squad.com","content":"45.63.35.93","proxied":true,"ttl":1}'
```

Then set the zone's TLS mode to **Full (strict)** — anything weaker lets
Cloudflare reach the origin over plain HTTP or accept any certificate, which
would make the Origin CA pair theatre:

```sh
curl -sS -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/ssl" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"value":"strict"}'
```

Verify from anywhere: `curl -sSI https://grims-squad.com/v1/health` → 200, and
the certificate the browser sees is Cloudflare's, which is correct.

Undo: DELETE the A record just created
(`curl -X DELETE .../dns_records/<record_id>`, id is in the POST response)
— the domain goes dark but the site continues on sslip.io as though nothing
happened. (The parking records are not worth restoring; they advertised
GoDaddy, not us.)

---

## 4. Switch the application's own idea of its address

One file, `/srv/grims/.env`:

```
PUBLIC_URL=https://grims-squad.com
PUBLIC_SITE_URL=https://grims-squad.com
DISCORD_REDIRECT_URI=https://grims-squad.com/v1/auth/discord/callback
```

Then redeploy so the API restarts with the new environment and the web image
is REBUILT — `NEXT_PUBLIC_SITE_URL` is baked at build time, so a restart alone
would keep serving og:image URLs on the old name:

```sh
/srv/grims/repo/infra/scripts/deploy.sh
```

The deploy's own verify step now probes `https://grims-squad.com` (it reads
`PUBLIC_URL` from the env file), which is exactly the check we want here.

Undo: revert the three lines and run the deploy script again.

---

## 5. External registrations the OWNER must update

The code derives every callback from `DISCORD_REDIRECT_URI`
(`apps/api/src/auth/auth.module.ts`: sign-in uses it verbatim; the join flow
replaces the trailing `/callback` with `/join/callback`). The provider side
has to be taught the same URLs.

**Discord** — <https://discord.com/developers/applications> → the app → OAuth2
→ Redirects. **ADD** these two; do not remove the sslip.io pair until after
the cutover is verified, so both environments work during the transition:

```
https://grims-squad.com/v1/auth/discord/callback
https://grims-squad.com/v1/auth/discord/join/callback
```

**Inara** — Inara has no OAuth callback; what it holds is the application
record (`GrimsSquadHub`, whitelisted by name) and the homepage URL from our
access request. Message Artie via <https://inara.cz/contact/> that the
production URL for `GrimsSquadHub` is now `https://grims-squad.com`. The app
NAME must not change — it is what every API request sends.

**Frontier cAPI** (only if/when the P1.8 application is approved): the
registered redirect must be `https://grims-squad.com/v1/auth/frontier/callback`,
matching `FRONTIER_REDIRECT_URI` in `/srv/grims/.env`.

---

## 6. Health checks (the human path, not just curl)

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://grims-squad.com/v1/health   # 200
curl -sS -o /dev/null -w '%{http_code}\n' https://grims-squad.com/            # 200
curl -sS -o /dev/null -w '%{http_code}\n' https://grims-squad.com/roster      # 307 — the gate is ON
curl -sS -o /dev/null -w '%{http_code}\n' https://45-63-35-93.sslip.io/v1/health  # 200 — old name STILL serving
```

Then, in a browser: sign in with Discord at `https://grims-squad.com` (this
exercises the new redirect URI end to end), open the forum, open a member
profile. A green curl with a broken OAuth redirect is precisely the failure
mode the browser check exists to catch.

---

## 7. Announce the new home (one-time, after the health checks pass)

The announcements pipeline delivers durable `announcements` rows two ways: the
bot posts each row's content into the Discord channel its kind maps to, and the
API carbon-copies rows carrying a forum half into the forum's Announcements
category (authored by the account below) and rings every member's bell. Every
future deploy queues its own announcement automatically (deploy.sh's record
step); this section configures the pipeline and fires the inaugural message.

### 7.1 The env section — `/srv/grims/.env`

Three additions. No channel id lives in code (INV-008); these variables are the
only place the destinations exist, and an unset variable means that kind of
announcement simply WAITS, logged once — the same default-silent doctrine as
the DM allowlist.

```
# Where the bot posts 'deploy' and 'member-verified' announcements.
DISCORD_ANNOUNCE_CHANNEL_ID=1532113020388511794
# Where the bot posts 'promotion' announcements (the monthly orders).
DISCORD_PROMOTIONS_CHANNEL_ID=1532113079196717307
# Whose account authors the forum carbon-copies. A handle, not an id — the
# API resolves it case-insensitively against `users.handle`.
ANNOUNCE_FORUM_AUTHOR_HANDLE=r3ap3ractual_22545
```

Then restart the bot and the API so both pick the variables up (the step 4
redeploy already did this if the variables were added before it ran). The
`announcements` table itself arrives with the ordinary migration step of any
deploy — nothing to run by hand.

Verify the quiet state: with the variables set and no rows pending,
`docker compose ... logs bot | grep announcement` shows no complaints. An
"announcement channel not configured" warning names exactly which variable is
missing.

### 7.2 The inaugural announcement — one psql INSERT, run once

The owner's approved text, verbatim. Kind `deploy`, with the forum carbon-copy
titled `GRIMS-SQUAD.COM IS LIVE`. The bot posts it to the announcements channel
and the API creates the forum thread and notifies every member, both within a
minute of the INSERT.

The INSERT is a SELECT so the "DM Pebblemerchant" line resolves the owner's real
Discord id from `discord_identities` at run time — no snowflake lives in this
file (INV-008 discipline, applied to the runbook too). In the channel copy the
mention `<@id>` is itself the DM affordance; in the forum copy it is a
`discord.com/users/<id>` link, which opens a DM for anyone signed into Discord.

```sh
cd /srv/grims/repo
PGUSER=$(sed -n 's/^POSTGRES_USER=//p' /srv/grims/.env | head -n1)
PGDB=$(sed -n 's/^POSTGRES_DB=//p' /srv/grims/.env | head -n1)
docker compose -f infra/docker/compose.prod.yml --env-file /srv/grims/.env \
  exec -T postgres psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO announcements (kind, content, forum_title, forum_body)
SELECT
  'deploy',
  replace($grims$# 🚀 GRIMS-SQUAD.COM IS LIVE

Commanders — the hub has a new home: **https://grims-squad.com**

This is the biggest update we have ever shipped. **v0.5.0** brings, among 250+ changes:

⚔️ **Leaderboards** — Data Runners, Colony Builders, Trade Barons. Monthly seasons, all-time honour rolls, and ranks worth earning: will you be the first **Void Cartographer**? The first **Trade Baron** needs 10 billion in profit.
🗺️ **Data Bounties** — dock somewhere dark, get paid. Jackpots pay double.
🏗️ **The Colonisation Planner** — pick your stations, simulate what they do to the system, see what they'll actually trade. Attach your fleet carriers and the shopping list knows what's already aboard.
🔔 **Notifications** — the bell knows when your answer is accepted, your bounty banks, your badge lands.
📦 **The Companion App v0.5.0** — full mirror: Shipyard, markets, trade planner, live overlays that follow your build.

Every detail: https://grims-squad.com/changelog

🛟 **Need a hand getting set up?** Whether it's signing in, Inara verification, or pairing the companion app — DM __OWNER_MENTION__ and we'll get you flying.

Fly dangerous. o7$grims$, '__OWNER_MENTION__', '<@' || di.discord_id || '>'),
  'GRIMS-SQUAD.COM IS LIVE',
  replace($grims$# 🚀 GRIMS-SQUAD.COM IS LIVE

Commanders — the hub has a new home: **https://grims-squad.com**

This is the biggest update we have ever shipped. **v0.5.0** brings, among 250+ changes:

⚔️ **Leaderboards** — Data Runners, Colony Builders, Trade Barons. Monthly seasons, all-time honour rolls, and ranks worth earning: will you be the first **Void Cartographer**? The first **Trade Baron** needs 10 billion in profit.
🗺️ **Data Bounties** — dock somewhere dark, get paid. Jackpots pay double.
🏗️ **The Colonisation Planner** — pick your stations, simulate what they do to the system, see what they'll actually trade. Attach your fleet carriers and the shopping list knows what's already aboard.
🔔 **Notifications** — the bell knows when your answer is accepted, your bounty banks, your badge lands.
📦 **The Companion App v0.5.0** — full mirror: Shipyard, markets, trade planner, live overlays that follow your build.

Every detail: https://grims-squad.com/changelog

🛟 **Need a hand getting set up?** Whether it's signing in, Inara verification, or pairing the companion app — [DM Pebblemerchant](__OWNER_DM_URL__) and we'll get you flying.

Fly dangerous. o7$grims$, '__OWNER_DM_URL__', 'https://discord.com/users/' || di.discord_id)
FROM users u
JOIN discord_identities di ON di.user_id = u.id
WHERE u.handle = 'r3ap3ractual_22545';
SQL
```

The SELECT inserts exactly one row when the handle resolves and ZERO rows when
it does not — check psql's `INSERT 0 1` tail. `INSERT 0 0` means the handle has
no Discord identity row, and nothing was announced.

Verify: the message appears in the announcements channel within a minute; the
forum's Announcements category gains the thread, authored by the account named
above; the bell badge lights for a signed-in member. If the channel post never
arrives, check the bot's logs for which variable it says is missing; if the
forum copy never arrives, the API's logs name the gap (no author, or no
category called "announcements") — create the category or fix the handle, and
the same row delivers on the next minute's poll. Nothing needs re-inserting.

Undo: there is no unsaying an announcement; that is why this step runs after
the health checks rather than before them.

---

## 8. Rollback (any point after step 3)

1. **DNS back:** delete the `grims-squad.com` A record and the `www` CNAME
   (step 3's undo). Members on the new name lose it as caches expire; the
   sslip.io name never stopped working.
2. **Env back:** restore in `/srv/grims/.env`:
   `PUBLIC_URL=https://45-63-35-93.sslip.io`,
   `PUBLIC_SITE_URL=https://45-63-35-93.sslip.io`,
   `DISCORD_REDIRECT_URI=https://45-63-35-93.sslip.io/v1/auth/discord/callback`,
   then `/srv/grims/repo/infra/scripts/deploy.sh` to rebuild and restart onto
   the old address.
3. Leave the certificates, the enabled server block and the Discord redirect
   additions in place — they are all inert without DNS and make the next
   attempt a two-step (DNS + env) rather than a repeat of this file.

---

## Appendix — what stays on sslip.io, knowingly

- **The companion app.** `apps/companion/src/config.ts` compiles
  `https://45-63-35-93.sslip.io` in as the API base, and
  `electron-builder.yml` publishes updates from
  `https://45-63-35-93.sslip.io/v1/companion/download`. Installed copies keep
  both until a NEW companion release built against `grims-squad.com` ships and
  members update — which is why the sslip.io server block is not being retired
  in this runbook at all.
- **The deploy script's last-resort fallback** and the API/web fallbacks in
  code keep the sslip.io literal, deliberately: the environment always wins,
  and the fallback only exists so a machine with no configuration still points
  somewhere real.

## Appendix — the changelog deploy step

`infra/scripts/deploy.sh` now ends by writing `/srv/grims/deployed.sha` and
inserting a `changelog_releases` row (via `tools/changelog.mjs --sql` piped
into psql) describing everything between the previously deployed revision and
the new one. It is deliberately non-fatal: if it reports a failure, the deploy
is still good, and the row can be inserted by hand with
`node tools/changelog.mjs --from <previous sha> --sql | psql`.
