# Discord

## Role in this system
The identity layer and the primary interface. Discord roles are the input to the entire authorization model, and every notification, order and AI answer surfaces there with a link back.

## Trust tier
**authoritative** — for identity and roles. It says nothing about which CMDR someone flies; that is cAPI's job.

## Access requirements
- A Discord **application** with an OAuth2 client and a **bot** user.
- **The SERVER MEMBERS privileged intent MUST be enabled** in the application's Bot settings.
- Bot invited to the guild with: `View Channels`, `Send Messages`, `Embed Links`, `Manage Roles`, `Create Events`, `Manage Events`, `Send Messages in Threads`, `Use Slash Commands`.
- **The bot's own role must sit ABOVE every role it manages** in the guild hierarchy, or role grants fail with a permissions error that looks like a code bug.

## Base URLs
```
REST     https://discord.com/api/v10
Gateway  wss://gateway.discord.gg
OAuth2   https://discord.com/oauth2/authorize
```

## Endpoints we use
| Method | Path | Purpose | Params | Cache TTL |
|---|---|---|---|---|
| GET | `/oauth2/authorize` | Start login | `client_id`, `redirect_uri`, `response_type=code`, `scope`, `state` | — |
| POST | `/oauth2/token` | Exchange code | `grant_type`, `code`, `redirect_uri` | — |
| GET | `/users/@me` | Identity: id, username, global_name, avatar, email | — | per login |
| GET | `/users/@me/guilds/{guildId}/member` | **The role ID array for OUR guild** | — | per login |
| GET | `/guilds/{guildId}/members` | Full member list, for nightly reconciliation | `limit=1000`, `after` | nightly |
| PUT | `/guilds/{g}/members/{u}/roles/{r}` | Grant a role (outbound sync) | — | — |
| DELETE | `/guilds/{g}/members/{u}/roles/{r}` | Revoke a role | — | — |
| POST | `/channels/{id}/messages` | Notifications, embeds, moderation alerts | — | — |
| POST | `/users/@me/channels` + message | Direct messages (reminders, expiry warnings) | — | — |
| POST | `/guilds/{g}/scheduled-events` | Operation → Discord Scheduled Event | — | — |
| PATCH/DELETE | `/guilds/{g}/scheduled-events/{id}` | Keep the event in sync | — | — |
| POST | `/applications/{a}/commands` | Register slash commands | — | on deploy |

## OAuth2 scopes
```
identify email guilds.members.read
```
**`guilds.members.read`, not `guilds`.** Only the former returns the role ID array for a specific guild, and that array is the entire basis of role-gating. `guilds` returns a list of guilds and is useless here.

## Gateway events the bot listens to
| Event | Action |
|---|---|
| `guildMemberAdd` | Create/link the user, assign `applicant`, post to the recruitment channel |
| `guildMemberUpdate` | **Diff roles, recompute the permission mask, bust `perm:{userId}`, write an audit row.** The freshness path — target under 5 s end to end. |
| `guildMemberRemove` | Soft-deactivate the account, revoke sessions, **keep their content** |
| `roleUpdate` / `roleDelete` | If a *mapped* role was renamed or deleted, **alert admins** — silent permission stripping is the failure to avoid |
| `interactionCreate` | Slash commands, and the Approve/Reject/Interview buttons on application embeds |

## Response shapes
`GET /users/@me/guilds/{guildId}/member`
```json
{
  "user": { "id": "123456789012345678", "username": "grimshaw",
            "global_name": "Grimshaw", "avatar": "a1b2c3" },
  "nick": "CMDR Grimshaw",
  "roles": ["987654321098765432", "876543210987654321"],
  "joined_at": "2024-03-14T09:22:11.000Z",
  "premium_since": null,
  "pending": false
}
```
**`roles` is an array of snowflake STRINGS.** They exceed 2^53 and are never numbers.

## Rate limits & etiquette
- Per-route buckets. Respond to `X-RateLimit-Remaining` / `X-RateLimit-Reset-After`; on 429 honour `retry_after`.
- **Global limit ~50 requests/second** across the application.
- A 429 with `"global": true` is serious — back off everything, not just that route.
- discord.js handles bucketing, but **bulk operations must still be paced.** A nightly reconciliation over 150 members is fine; a role sweep firing 150 PUTs in a burst is not.
- Discord ToS: store no more than necessary. We store the Discord ID, username, nickname and role IDs — nothing else.

## Failure modes
| Failure | Detection | Our response |
|---|---|---|
| **SERVER MEMBERS intent not enabled** | `roles` array empty or member fetch fails | **Everyone appears to be a guest.** Fails quietly and looks like an authorization bug. Has its own `STATUS.md` row for this reason. |
| Gateway disconnect | discord.js `disconnect`/`resume` | Auto-reconnect. **Events during the gap are lost** — the nightly reconciliation is what makes this survivable, not optional. |
| Rate limited | 429 | Honour `retry_after`; queue rather than drop. |
| Bot role too low in hierarchy | 403 on a role grant | **Alert admins with the actual cause.** Looks like a code bug; is a configuration problem. |
| Mapped role deleted in Discord | `roleDelete` for a mapped ID | Alert admins. **Do not silently strip permissions** from every affected member. |
| Discord outage | 5xx / gateway down | **New logins fail; existing sessions survive** (15-min access, 30-day refresh). The site keeps working. |
| Member left the guild | `guildMemberRemove` | Soft-deactivate, revoke sessions, retain content. |
| DM blocked by the member | 403 on DM create | Fall back to an in-app notification. **Never retry into a rate limit.** |

## Adapter interface
```ts
// packages/ed-clients/src/discord/discord.adapter.ts
export interface IDiscordIdentityProvider {
  readonly source: 'discord';
  readonly trustTier: 'authoritative';

  buildAuthorizeUrl(input: { state: string; redirectUri: string }): string;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<DiscordTokens>;
  getCurrentUser(accessToken: string): Promise<DiscordUser>;
  /** The call that matters — returns the role ID array for OUR guild. */
  getGuildMember(accessToken: string, guildId: string): Promise<DiscordGuildMember | null>;
}

export interface IDiscordGuildAdmin {
  listAllMembers(guildId: string): AsyncIterable<DiscordGuildMember>;  // paginated, for reconciliation
  addRole(guildId: string, userId: string, roleId: string, reason: string): Promise<void>;
  removeRole(guildId: string, userId: string, roleId: string, reason: string): Promise<void>;
  sendChannelMessage(channelId: string, payload: DiscordMessagePayload): Promise<string>;
  sendDirectMessage(userId: string, payload: DiscordMessagePayload): Promise<void>;
  upsertScheduledEvent(guildId: string, event: ScheduledEventInput): Promise<string>;
}
```

`reason` is passed as `X-Audit-Log-Reason` so the change is explicable **in Discord's own audit log**, not only in ours.

## Gotchas
- **The SERVER MEMBERS privileged intent is the single most common setup failure.** Without it `guildRoles` is silently empty and every member looks like a guest. There is no error — just an inexplicably locked-out squadron.
- **`guilds.members.read` ≠ `guilds`.** Requesting the wrong scope gives you a guild list and no roles, and the mistake is easy to miss because the login still "works".
- **Snowflakes are strings.** IDs exceed 2^53. Store and compare as strings, always.
- **Gateway events get dropped during outages and reconnects.** Real-time sync is an optimisation; the **nightly full reconciliation is what keeps the model honest** (INV-008 spirit). Never treat gateway events as guaranteed delivery.
- **The bot's role must be above every role it manages.** Otherwise role grants 403 with a message that reads like a code defect.
- **Never hard-code a Discord role ID in application source.** They live in `role_mappings` as data (INV-008), and they differ between the real guild and any test guild.
- **A permission cache that is not busted on `guildMemberUpdate` is a security defect**, not a performance issue — it means a demoted member keeps their access for up to 5 minutes.
- **WebSocket subscriptions must also drop on demotion.** A long-lived socket that keeps Ring 1 channels after a role change is the obvious way to leak (`04-contracts/websocket-events.md`).
- **Do not build message-level Discord ↔ forum mirroring.** Thread-level bridging only — explicitly rejected in ADR-006 and `scope.md`.
- **Discord outages must not lock people out.** Existing sessions survive by design; only new logins fail.
- **DM failures are normal.** Members block DMs from servers. Fall back to in-app, never retry into a rate limit.
