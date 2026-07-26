# Discord application setup

Everything the Hub needs from Discord, in the order you should do it.

**Time:** about 15 minutes.
**You need:** the **Manage Server** permission on the Grim's Squad server (Guild ID `801929816596152320`).

> **The one step everyone misses is Step 4** (the SERVER MEMBERS intent). Without
> it, role lookups come back **silently empty** — no error, no warning. Every
> member appears to have no roles, so everyone looks like a guest and nobody can
> see anything. If you do nothing else carefully, do that step carefully.

---

## Step 1 — Create the application

1. Go to <https://discord.com/developers/applications>.
2. **New Application**, top right.
3. Name it `Grim's Squad Hub`. This name appears on the login consent screen your members will see, so it is worth getting right.
4. Accept the terms → **Create**.

On the **General Information** page, set:

- **Description** — shown on the consent screen. Something like:
  *"Squadron hub for Grim's Squad. Signs you in and reads your server roles."*
- **App Icon** — the squadron badge, if you have one.

**Copy the `APPLICATION ID`** and keep it somewhere safe. That is your `DISCORD_CLIENT_ID`.

---

## Step 2 — Get the client secret

1. Left sidebar → **OAuth2**.
2. Under **Client Secret**, click **Reset Secret** → confirm.
3. **Copy it now.** Discord shows it exactly once. If you lose it you must reset again, which invalidates the old one.

That is your `DISCORD_CLIENT_SECRET`.

> Treat this like a password. It grants the ability to impersonate the
> application. Do not paste it into Discord chat, a screenshot, or a ticket.
> Send it to me the way described in Step 8.

---

## Step 3 — Add the redirect URI

Still on the **OAuth2** page:

1. Under **Redirects**, click **Add Redirect**.
2. Add **both** of these, exactly, including the scheme and with **no trailing slash**:

```
http://localhost:5001/v1/auth/discord/callback
https://grims-squad.com/v1/auth/discord/callback
```

3. **Save Changes** (the green bar at the bottom).

The first is for local development, the second for production once DNS is live. Discord requires an exact string match — a trailing slash or `http` where `https` was registered produces `invalid_request` at login with no further explanation.

---

## Step 4 — Enable the SERVER MEMBERS intent ⚠️

**This is the step that silently breaks everything if skipped.**

1. Left sidebar → **Bot**.
2. If there is no bot yet, click **Add Bot** → **Yes, do it**.
3. Scroll to **Privileged Gateway Intents**.
4. Turn **ON**: **SERVER MEMBERS INTENT**.
5. Leave **PRESENCE INTENT** and **MESSAGE CONTENT INTENT** **OFF** — we do not need either, and requesting permissions you do not use is how an application ends up over-privileged. Message Content in particular would let the bot read every message in the server.
6. **Save Changes**.

Why it matters: role synchronisation reads `/users/@me/guilds/{id}/member`. Without this intent that endpoint returns success with an empty `roles` array. Nothing errors. Everyone just appears to be a guest.

---

## Step 5 — Get the bot token

Still on the **Bot** page:

1. Under **Token**, click **Reset Token** → confirm.
2. **Copy it immediately** — like the client secret, it is shown once.

That is your `DISCORD_BOT_TOKEN`.

Also on this page:

- **PUBLIC BOT** → turn **OFF**. This stops anyone else adding our bot to their server.
- **REQUIRES OAUTH2 CODE GRANT** → leave **OFF**. Turning it on breaks the normal invite flow.

---

## Step 6 — Invite the bot to the server

1. Left sidebar → **OAuth2** → **URL Generator**.
2. Under **Scopes**, tick:
   - `bot`
   - `applications.commands`
3. Under **Bot Permissions**, tick only:
   - **Manage Roles** — required, this is how ranks are applied
   - **View Channels**
   - **Send Messages**
   - **Embed Links**
   - **Read Message History**

   Do **not** grant Administrator. It is convenient and it means a compromised bot token can delete the server.

4. Copy the generated URL at the bottom, open it, choose **Grim's Squad**, and authorise.

---

## Step 7 — Position the bot's role ⚠️

**Also easy to miss, and it produces a confusing failure.**

1. Server Settings → **Roles**.
2. Find the role Discord created for the bot (it will be called `Grim's Squad Hub`).
3. **Drag it ABOVE every role the bot needs to assign** — above all rank roles.

Discord will not let a bot assign a role positioned at or above its own, **even with Manage Roles**. The symptom is `Missing Permissions` on role assignment while the bot obviously has the permission, which sends people hunting in the wrong place for a long time.

Rule of thumb: bot role directly under your leadership roles, above everything it manages.

---

## Step 8 — Send me the values

Create a file at the repository root called **`TODO.local.md`**. It is already in `.gitignore`, so it can never be committed.

```
DISCORD_CLIENT_ID=<application id from step 1>
DISCORD_CLIENT_SECRET=<from step 2>
DISCORD_BOT_TOKEN=<from step 5>
```

I will wire them into `apps/api/.env` (also gitignored) and run the first real login.

> **Never** put these in `.env.example`, any file under `ssot/`, or a commit
> message. CI runs gitleaks on every push and will block the merge — it has
> already caught me once for exactly this.

---

## Step 9 — What I need after that

Once the bot is in the server, I need the **role IDs** (decision **D2**). Getting them:

1. Discord → User Settings → **Advanced** → turn on **Developer Mode**.
2. Server Settings → **Roles**.
3. Right-click each role → **Copy Role ID**.

Send them as a list, role name to ID:

```
Squadron Leader        = 123456789012345678
1st Sector Overseer    = ...
Galactic Admiral       = ...
Prime Legate           = ...
```

I need every **leadership** and **reserved** role. Tenure and loyalty ranks are cosmetic — they grant no permissions (INV-046) — but send them too, since the bot assigns them automatically.

**Role IDs are stored as data, never hard-coded** (INV-008), so renaming a role in Discord later will not break anything. Deleting and recreating one *will*, because that mints a new ID — tell me if that happens.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `invalid_request` at login | Redirect URI mismatch — check Step 3 for exact match, no trailing slash |
| Everyone appears to have no roles | **SERVER MEMBERS intent off** — Step 4 |
| `Missing Permissions` assigning a role | Bot role too low — Step 7 |
| `invalid_client` | Wrong client secret, or it was reset after you copied it |
| Login works, roles never update | Bot not actually in the server, or it cannot see the member |

---

## What we ask for, and what we deliberately do not

The login consent screen requests exactly two scopes:

- **`identify`** — your Discord ID, username and avatar.
- **`guilds.members.read`** — your roles and join date in *this server only*.

We do **not** request:

- **`email`** — removed deliberately. There is no email channel anywhere in the platform (decision D11), so an address could never be used for anything. Collecting it would mean storing, backing up and eventually breaching personal data for no benefit.
- **`guilds`** — we do not need the list of every other server you are in.
- **Message Content** — the bot never reads your messages.

Your OAuth tokens are encrypted at rest with AES-256-GCM before they touch the database, and each one is cryptographically bound to your account, so a stolen database row cannot be replayed against another (INV-012).
