# USER JOURNEYS

Twelve concrete journeys. Each is a source of e2e tests and of UX-ADV review scenarios. Steps are numbered so a test can cite them.

---

## J1 — Prospective recruit becomes a member
**Actor:** anonymous → applicant → member · **Phases:** P1, P2

1. Lands on the public site from a Discord invite, Inara, or a friend. Sees live squadron stats, divisions, GalNet feed.
2. Clicks *Apply*. Turnstile-protected form: CMDR name, Discord handle, timezone, hours/week, playstyle, ships owned, engineering progress, previous squadrons, why us, how they found us, referral.
3. Submit → an `application` thread is created in the Ring 2 Applications category, answers stored as structured JSONB.
4. The bot posts an embed in `#recruitment` with Approve / Reject / Interview buttons.
5. Officers discuss in-thread. If *Interview*, the applicant is granted access to a limited thread to answer questions — **by ownership predicate, not by a permission grant**.
6. *Approve* → the Discord role is granted → role sync assigns `member` → welcome DM with the onboarding checklist.
7. A 30-day probation timer starts; at expiry an officer review is prompted automatically.

**Failure modes to test:** duplicate application from the same Discord ID · applicant attempts to read another applicant's thread (must 404, not 403 — a 403 confirms existence) · approval when the Discord role has been renamed · Turnstile failure.

---

## J2 — Member verifies their CMDR
**Actor:** member · **Phases:** P1

1. Profile → *Verify CMDR*.
2. **Path A (cAPI, tier 3):** PKCE start → Frontier authorize → callback → `GET /profile` → authoritative name → verification row, `expiresAt = +25d`, tokens encrypted.
3. **Path B (Inara nonce, tier 2):** enter a CMDR name → receive a nonce like `GRIM-7X2Q` → place it in the Inara bio → a worker finds it on the next poll (**not instant; the UI must say so**).
4. **Path C (officer manual, tier 1):** post an in-game screenshot to the verification channel → an officer approves.
5. Badge appears on the profile showing the method and tier.
6. At day 20 the bot DMs a re-verification reminder. At day 25 the verification goes `stale`: **read access retained, fleet writes revoked.**

**Failure modes:** cAPI returns 422 mid-flow (expired token, not a generic error) · the CMDR name is already verified by another account (INV-005) · the member never re-verifies · Inara whitelisting not yet granted, so path B is unavailable and the UI must say why.

---

## J3 — Officer promotes a member from Discord
**Actor:** officer, member · **Phases:** P1

1. Officer adds `@Wing Leader` in Discord.
2. `guildMemberUpdate` fires; the bot diffs roles, updates `user_roles`, busts `perm:{userId}`, writes an audit row.
3. The member refreshes the site — **without re-logging in** — and the ops-creation navigation appears.
4. If the gateway event was dropped, the nightly reconciliation repairs it and reports the drift to the admin channel.

**Failure modes:** event dropped and reconciliation not yet run (bounded staleness, must not exceed 24 h) · the Discord role is unmapped (no change, admin alerted) · a mapped role is deleted in Discord (permissions stripped — must alert, not fail silently).

---

## J4 — Member asks "what should I do tonight?"
**Actor:** member · **Phases:** P4, P5, P6 — **the retention loop**

1. Opens the dashboard.
2. **BGS orders for tonight**, prioritised: system, directive, officer guidance, influence delta since last tick.
3. **Next operation** with a countdown, in local time and UTC, and whether their fleet qualifies.
4. **Carrier status**: fuel shortfall against the next scheduled jump.
5. **"Am I needed?"** widget consolidating the above into one line.
6. They act in-game. The EDMC plugin reports it. Their contribution appears without a form being filled in.

**Failure modes:** no active orders (must render a useful empty state, not a blank panel) · tick not yet detected, so deltas are unavailable (say so; do not show a stale delta as current) · member has no verified CMDR, so contributions cannot be attributed.

---

## J5 — Member finds a trade run
**Actor:** member · **Phases:** P6

1. Trade Terminal → origin system, jump range, cargo capacity, credits, min pad, max Ls, max ly, include/exclude carriers, max data age.
2. Results ranked by profit per run, **each row carrying a freshness badge** — green <24 h, amber <7 d, red older (INV-004).
3. Copy-to-clipboard on each system name, for pasting straight into the galaxy map.
4. Optionally save the route, or set an alert ("tell me if Tritium within 50 ly of our carrier drops below 40k/t").
5. For a long-haul plot, submits a Spansh job: the UI **never blocks**; a WebSocket push delivers the waypoints when the job completes.

**Failure modes:** no routes match the filters (explain which filter is binding, do not just say "no results") · all data is stale (show it in red rather than hiding it) · Spansh unavailable (job queued, status honest) · a "profitable" route with a 200,000 Ls supercruise (INV-026 forbids it reaching the results).

---

## J6 — Officer sets the BGS orders after a tick
**Actor:** officer · **Phases:** P4

1. Post-tick, the nightly digest posts to Discord: what changed, what it means.
2. Officer opens the BGS console: system control board with our influence, top competitor, delta since last tick, active and pending states, conflicts.
3. Sets per-system directives: `push` / `hold` / `suppress` / `ignore`, with priority and written guidance.
4. Saving audits the change and pushes the new orders to every member's dashboard.
5. Members see the prioritised list; contributions flow back automatically from telemetry.

**Failure modes:** a tick is missed or misdetected, so deltas are wrong (validate against known ticks first — this poisons everything downstream) · double-counted influence from multiple EDDN reports (INV-019) · orders set for a system we no longer have presence in.

---

## J7 — Wing lead fills an operation
**Actor:** wing lead, members · **Phases:** P5, P7

1. Creates an op: type, time (stored UTC), system, station, required ship roles, capacity.
2. Auto-syncs to a Discord Scheduled Event; the bot announces it.
3. Members sign up, **selecting from their actual fleet**, choosing a role. Overflow goes to standby.
4. The **wing composition checker** reports "needs 2 more shieldless miners; 3 members have a qualifying build" — driven by the fleet query from the Loadout Locker.
5. Reminder DMs at T-24 h, T-1 h, T-10 min.
6. Post-op: attendance marked, an AAR thread auto-created in Squadron Log, contribution stats recorded.

**Failure modes:** a member's fleet data is stale so they sign up with a ship they sold · timezone rendering wrong for a member in a third zone (INV-025) · a standby member promoted without notification · the Discord event deleted out-of-band.

---

## J8 — Member saves and shares a build
**Actor:** member, officer · **Phases:** P7

1. Builds in the self-hosted Coriolis at `shipyard.<domain>`.
2. Imports into the Locker by Coriolis URL — or EDSY URL, Coriolis JSON, or the journal `Loadout` event arriving automatically from EDMC.
3. Stats computed and cached: jump range laden/unladen/max, DPS by damage type, effective shield and armour HP, thermal load, cargo, scoop rate, rebuy, total cost.
4. Sets visibility `private | squadron | public`. Comments and versions accumulate on the build.
5. The requirements checker lists the engineering needed and where to unlock it, plus a materials shopping list.
6. An officer marks it `isDoctrine` for a role: "our standard BGS conflict-zone Krait".

**Failure modes:** `coriolis-data` is stale so module stats are wrong (**worse than no build** — the monthly check exists for this) · an EDSY URL format change · our ported maths drifting from Coriolis's · a private build appearing in a fleet query.

---

## J9 — Member asks GSAI a question
**Actor:** member · **Phases:** P8

1. Presses ⌘K anywhere; the slide-over opens with the current page's context injected — on a system page, "what's the market here" needs no system name.
2. **Fast path (~70%):** the intent classifier matches with high confidence → the tool is called directly → a templated answer renders in under 200 ms. **The LLM never runs.**
3. **Agent path:** tools are filtered by the caller's mask *before* the model sees them; tool calls render as collapsible cards; the answer cites sources and **relays data freshness**.
4. A mutating request ("sign me up for Thursday's op") shows exactly what will happen and waits for confirmation.
5. If the box is off, the panel says `OFFLINE` honestly: read queries fall back to templated non-LLM answers; chat queues and is delivered by Discord DM on reconnect.

**Failure modes:** classifier false positive giving a confidently wrong answer (threshold starts conservative for this reason) · a Ring 0 user asking about Ring 2 content (**must return nothing, and retrieval must return zero rows** — INV-003) · prompt injection in indexed forum content (must not escalate — INV-015) · step limit reached (say so plainly).

---

## J10 — Member installs the EDMC plugin
**Actor:** member · **Phases:** P3

1. Profile → *Connect EDMC*. Issues a device token, scoped `telemetry:write`, shown once.
2. Downloads the plugin from the public repository and drops it into the EDMC plugins folder.
3. Settings panel: per-category toggles, **all off by default** — location, combat, trade, exploration, BGS, carrier, fleet.
4. Plays. Events post in batches on a background thread. **The game is never blocked; failures are silent and retried.**
5. The profile shows a live indicator: "EDMC connected — sharing: location, BGS".
6. One-click revoke kills the token and offers a purge of collected data.

**Failure modes:** network loss mid-session (game unaffected, events retried) · a category toggled off client-side but sent anyway (**server must reject, not ignore** — INV-013) · token leaked (revocation immediate) · plugin version older than the contract (endpoint accepts gracefully).

---

## J11 — Member exercises their privacy rights
**Actor:** member · **Phases:** P1, P3, P9

1. Profile → Privacy. Granular toggles for who can see location, credits, fleet, activity. **Conservative defaults.**
2. *Export my data* → a JSON download of everything held about them.
3. *Revoke device token* → telemetry stops immediately; purge offered.
4. *Leave the squadron* → full purge offered; default is to **anonymise forum posts rather than delete them**, preserving thread coherence, unless they ask otherwise.

**Failure modes:** a private field still present in a public API response (INV-027 — absent, not null) · export missing a data category · purge leaving orphaned telemetry aggregates or RAG chunks.

---

## J12 — Operator responds to a 02:00 incident
**Actor:** sysadmin · **Phases:** all — the OPS-ADV scenario

1. A Discord `#site-alerts` message: *EDDN silent > 10 min*.
2. Opens the admin health dashboard: EDDN lag, Ardent latency, Spansh queue depth, GSAI status, DB size, disk.
3. Follows `09-runbooks/incident-eddn-stalled.md`: check the relay, check the container, check the dead-letter rate, check disk.
4. Restarts the collector; it resumes without duplicating rows or losing acknowledged messages (INV-034).
5. Records the incident and, if the runbook did not help, improves it in the same session.

**Failure modes:** the runbook is stale · the alert fires with no actionable detail · the restart duplicates rows · disk is full so the restart fails immediately (the alert should have fired at 80%).
