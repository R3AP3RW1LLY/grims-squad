# ADR-002 — Discord OAuth2 is the primary identity layer

**Status:** Accepted · **Date:** 2026-07-25 · **Spec origin:** §2.9, §5.1, §5.2 (assumption A3)

## Context

The squadron already exists as a Discord server with roles. Members are already authenticated there, and officers already administer membership there. Any identity system that requires officers to maintain a *second* roster will drift within a week and be abandoned within a month.

Three candidate identity sources exist: Discord OAuth2, Frontier cAPI, and Inara. Inara has no OAuth at all (ADR-004). cAPI is a real OAuth2 provider but its refresh tokens expire at ~25 days (ADR-003).

## Decision

**Discord OAuth2 is the primary identity. Discord roles are the source of truth for authorization input.**

- Scopes: `identify`, `email`, `guilds.members.read`.
- `guilds.members.read` — **not** `guilds` — because only the former returns the role ID array for our specific guild. That array is the whole basis of role-gating.
- On callback: fetch `/users/@me` and `/users/@me/guilds/{GUILD_ID}/member`, upsert `users` + `discord_identities` (including `guildRoles[]`), map guild role IDs to internal roles via `role_mappings`, then issue our own session.
- Our session, not Discord's, carries the request: access JWT 15 min, refresh JWT 30 d, rotating, family-tracked with reuse detection. Cookies `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefixed.
- **Freshness comes from three independent mechanisms**, deliberately overlapping: OAuth callback (correct at login), bot gateway events `guildMemberAdd`/`guildMemberUpdate`/`guildMemberRemove`/`roleUpdate` (real-time), and a nightly full-guild reconciliation (repairs drift from dropped gateway events).
- **Discord role IDs are mapped, never hard-coded.** `role_mappings` is data, editable in the admin console.
- Optional per-role outbound sync: a site-side grant can push back to Discord, so officers can promote from either surface.

## Consequences

**Positive**
- Zero new account admin. A member joining the Discord server appears on the site; a role change propagates in seconds.
- No password store, no reset flow, no credential-stuffing surface.
- The bot and the API share one database and one authorization model, so the two surfaces cannot disagree.

**Negative / accepted costs**
- **Discord outage = no new logins.** Existing sessions survive (15-min access JWT, 30-day refresh), so this degrades gracefully rather than locking everyone out.
- The **SERVER MEMBERS privileged intent must be enabled** on the Discord application, or `guildRoles` is silently empty and everyone appears to be a guest. This has its own entry in `STATUS.md` because it fails quietly.
- Someone who leaves the Discord server loses site access. Handled by soft-deactivation, not deletion — content is preserved, sessions revoked.
- Discord identity says nothing about which CMDR the person plays. That is exactly why ADR-003 exists.
- Renaming or deleting a mapped Discord role can silently strip permissions. The bot's `roleUpdate` handler alerts admins for this reason.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Frontier cAPI as primary identity** | Its refresh token dies at ~25 days, forcing every member through an interactive re-authorization roughly monthly just to read the forum. Approval is also discretionary and could simply never arrive. Unacceptable as the *only* door. |
| **"Login with Inara"** | Does not exist. Inara has no OAuth provider and no login delegation. Not a trade-off — an impossibility. |
| **Local accounts with passwords** | Adds a credential store, a reset flow, a breach surface, and a second roster to maintain. Explicitly rejected in `scope.md`. |
| **Email magic links** | Removes the password store but keeps the second roster, and still requires manual role administration. |
| **Discord as identity *and* trusting Discord nicknames as CMDR names** | Nicknames are unverified free text. It would let anyone claim any CMDR. ADR-003 exists precisely to avoid this. |
