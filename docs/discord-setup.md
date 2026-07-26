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
   - **View Channels**
   - **Send Messages**
   - **Embed Links**

   **NOT Manage Roles.** Corrected 2026-07-26: the bot is READ-ONLY with respect
   to roles. Leadership assigns every rank by hand in Discord and the site simply
   mirrors what it finds, so the bot never needs to write one. A token that
   cannot modify roles cannot escalate anyone if it leaks.

   Do **not** grant Administrator either. It is convenient, and it means a
   compromised bot token can delete the server.

4. Copy the generated URL at the bottom, open it, choose **Grim's Squad**, and authorise.

---

## Step 7 — Bot role position: leave it alone

**No action needed.** Corrected 2026-07-26.

Reading roles and members requires no hierarchy position at all, so the bot works
fine at the very bottom of the list — and that is where it should stay. Moving it
up would grant authority it has no use for.

*(This step previously said to drag the bot above every rank role. That is only
true for a bot that ASSIGNS roles. Ours does not, and the advice was wrong for
this design — keeping it here so the reasoning is visible rather than silently
rewritten.)*

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
@everyone 

**This is how the new ranking system works in Grim's Squad**

**Standard Ranks**
*These are the standard ranks that you can achieve within the Squadron.*

When you first join the Discord: <@&892493916530671657> or <@&804027821986807860> (we need a way to have the member choose this at time of server registration)
When you officially decide to join: <@&1528251831531339927> - assigned by leadership after onboarding is complete

**Your promotion depends both on the time you have been with the Squadron, and how active you are.**
1 month: <@&1528252058380144740>
2 months: <@&1528252671453036634>
3 months: <@&1528252377143050361>
4 months: <@&1528253163755405402>
5 months: <@&1528253388901580881>
6 months: <@&1528253529532141739>
7 months: <@&1528253849998065834>
9 months: <@&1528254061504237700>
12 months: <@&1528254279289278534>

**Loyalty Ranks** - optional ranks only assigned by leadership
*These are essentially a badge of honor. They can only be given out by a* <@&1513669809756311593>
 
Loyalty 1: <@&1513158621549297785>
Loyalty 2: <@&1513158687898730526>
Loyalty 3: <@&1513158735776972891>
Loyalty 4: <@&1513158786632646757>
Loyalty 5: <@&1513158830853198025>
Loyalty 6: <@&1513158877271691274> (Reserved for truly impactful members)

**Squadron Leadership Ranks** -- Leadership only, assigned by the leadership team only
*A leading member of the squadron must recommend you for promotion. It is then voted on. It must be unanimous.*

<@&1513669809756311593>
1st: <@&1513749464458723469>
2nd: <@&1513748632963387523>
3rd: <@&1512912750416760892>

**Ranks Reserved For Grim Himself and His 2nd in Command**

Grim: <@&804027885081591818>
2nd in Command: <@&1512912541771235601>
```

I need every **leadership** and **reserved** role. Tenure and loyalty ranks are cosmetic — they grant no permissions (INV-046) — but send them too, since the bot assigns them automatically.

**Role IDs are stored as data, never hard-coded** (INV-008), so renaming a role in Discord later will not break anything. Deleting and recreating one *will*, because that mints a new ID — tell me if that happens. the tenure roles are the default member roles, everything else is managed by the leadership team and will assign those as they see fit. 

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `invalid_request` at login | Redirect URI mismatch — check Step 3 for exact match, no trailing slash |
| Everyone appears to have no roles | **SERVER MEMBERS intent off** — Step 4 |
| `Missing Permissions` assigning a role | Not applicable — the bot never assigns roles |
| `Integration requires code grant` on invite | **Requires OAuth2 Code Grant** is ON — turn it OFF (Step 5) |
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
