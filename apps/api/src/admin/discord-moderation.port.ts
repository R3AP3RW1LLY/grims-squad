/**
 * Kicking, banning and timing somebody out in Discord.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "we need to create a full on member roster that shows every member in our discord with full
 * administrative tools for them, kick, ban, timeout"
 *
 * ★ WHY REST, RATHER THAN ASKING THE BOT ★
 *
 * The bot is a separate process on a gateway connection. Routing a kick through it would mean a job
 * row, a NOTIFY, a listener, and an officer watching a spinner for a result that arrives out of
 * band — and no way to tell "the bot is down" from "Discord refused". Discord's REST API takes a
 * bot token over plain HTTPS, the same way `discord-dm.port.ts` already sends direct messages, and
 * gives a definite answer in one call.
 *
 * ★ THE INTERESTING FAILURES ARE ALL 403 ★
 *
 * A bot cannot action anybody whose highest role sits at or above its own, whatever permissions it
 * holds. Measured on this guild 2026-08-01: the bot's top role is `Assistant` at position 41, so
 * `Admin` (42) and `YAGPDB.xyz` (43) are out of reach. That is a Discord rule, not a bug, and the
 * only wrong response to it is a generic "something went wrong" — so every refusal comes back as a
 * sentence an officer can act on.
 */

export type ModerationAction = 'timeout' | 'untimeout' | 'kick' | 'ban' | 'unban';

export interface ModerationRequest {
  readonly action: ModerationAction;
  readonly discordId: string;
  /** Shown in Discord's own audit log, and stored in ours. */
  readonly reason: string;
  /** `timeout` only. Minutes, capped at Discord's 28-day maximum. */
  readonly minutes?: number;
  /** `ban` only. How much of their recent history to delete, in days: 0, 1 or 7. */
  readonly deleteMessageDays?: number;
}

export interface ModerationOutcome {
  readonly ok: boolean;
  /** Present when `ok` is false. Written for an officer, not for a log. */
  readonly problem?: string;
}

/** Discord's hard ceiling on a timeout. Longer than this and the API refuses the whole request. */
export const MAX_TIMEOUT_MINUTES = 28 * 24 * 60;

export abstract class DiscordModeration {
  abstract apply(req: ModerationRequest): Promise<ModerationOutcome>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Turns a Discord HTTP status into something worth reading.
 *
 * ★ "SOMETHING WENT WRONG" IS THE ONE UNACCEPTABLE ANSWER ★
 *
 * Every status here means something different and each has a different fix. An officer who ticks
 * the box and gets a shrug will try again, then try a second member, then report the page as
 * broken — when the real answer was "this person outranks the bot" the whole time.
 */
export function explainStatus(status: number, action: ModerationAction): string {
  if (status === 403) {
    return (
      `Discord refused: the bot cannot ${action} this member. Its own role must sit ABOVE ` +
      `theirs in Server Settings → Roles, and nobody can be actioned above the bot however many ` +
      `permissions it has.`
    );
  }
  if (status === 404) {
    return 'Discord does not have this member any more — they may have already left.';
  }
  if (status === 429) {
    return 'Discord is rate limiting us. Wait a moment and try again.';
  }
  if (status >= 500) {
    return 'Discord is having problems. Nothing was changed; try again shortly.';
  }
  return `Discord refused the request (HTTP ${status}).`;
}

export class RestDiscordModeration extends DiscordModeration {
  readonly #token: string;
  readonly #guildId: string;
  readonly #fetch: FetchLike;

  constructor(token: string, guildId: string, fetchImpl: FetchLike = fetch) {
    super();
    this.#token = token;
    this.#guildId = guildId;
    this.#fetch = fetchImpl;
  }

  async apply(req: ModerationRequest): Promise<ModerationOutcome> {
    if (this.#token === '' || this.#guildId === '') {
      /*
       * Said plainly rather than swallowed. A moderation page that silently does nothing because a
       * token is missing looks identical to one where every member happens to be out of reach.
       */
      return { ok: false, problem: 'No Discord bot token is configured on this server.' };
    }

    const base = `https://discord.com/api/v10/guilds/${this.#guildId}`;
    const member = `${base}/members/${req.discordId}`;

    const call = ((): { url: string; init: RequestInit } => {
      switch (req.action) {
        case 'timeout': {
          const minutes = Math.min(Math.max(1, req.minutes ?? 0), MAX_TIMEOUT_MINUTES);
          return {
            url: member,
            init: {
              method: 'PATCH',
              body: JSON.stringify({
                communication_disabled_until: new Date(Date.now() + minutes * 60_000).toISOString(),
              }),
            },
          };
        }
        case 'untimeout':
          // Null, not an absent field: Discord treats a missing key as "leave it alone", so
          // omitting it would report success and lift nothing.
          return {
            url: member,
            init: { method: 'PATCH', body: JSON.stringify({ communication_disabled_until: null }) },
          };
        case 'kick':
          return { url: member, init: { method: 'DELETE' } };
        case 'ban':
          return {
            url: `${base}/bans/${req.discordId}`,
            init: {
              method: 'PUT',
              body: JSON.stringify({
                // Discord takes SECONDS here and rejects anything over seven days.
                delete_message_seconds: Math.min(Math.max(0, req.deleteMessageDays ?? 0), 7) * 86_400,
              }),
            },
          };
        case 'unban':
          return { url: `${base}/bans/${req.discordId}`, init: { method: 'DELETE' } };
      }
    })();

    try {
      const res = await this.#fetch(call.url, {
        ...call.init,
        headers: {
          authorization: `Bot ${this.#token}`,
          'content-type': 'application/json',
          /*
           * ★ THE REASON GOES INTO DISCORD'S OWN AUDIT LOG ★
           *
           * Our audit row records who did it here. This header is what somebody scrolling
           * Discord's server audit log sees, and without it a ban issued from this site is
           * indistinguishable from one issued by a compromised bot.
           *
           * Encoded because the header is not allowed to carry raw non-ASCII, and a reason
           * containing an accent would otherwise fail the whole request.
           */
          'x-audit-log-reason': encodeURIComponent(req.reason).slice(0, 460),
        },
      });

      if (!res.ok) return { ok: false, problem: explainStatus(res.status, req.action) };
      return { ok: true };
    } catch {
      return { ok: false, problem: 'Could not reach Discord. Nothing was changed.' };
    }
  }
}

/** Records what was asked and refuses everything. For tests, and never wired in production. */
export class NullDiscordModeration extends DiscordModeration {
  readonly calls: ModerationRequest[] = [];

  async apply(req: ModerationRequest): Promise<ModerationOutcome> {
    this.calls.push(req);
    return { ok: false, problem: 'Moderation is not configured.' };
  }
}
