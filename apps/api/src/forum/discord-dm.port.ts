/**
 * Sending a Discord DM — behind a hard allowlist.
 *
 * ★ WHY AN ALLOWLIST EXISTS AT ALL ★
 *
 * Squadron owner, 2026-07-30, on being asked whether DMs could be sent while they slept:
 * "DM ME only! my discord name is Cadet - PEBBLEMERCHANT find me in discord and message me and only
 * me!"
 *
 * The development environment points at the SAME Discord guild as production — there is one bot and
 * one server. So a bug in a fan-out loop during development does not produce a harmless log line, it
 * produces 107 direct messages to real people, possibly at three in the morning. That is not a risk
 * worth carrying for the convenience of not writing this file.
 *
 * ★ THE ALLOWLIST IS THE DEFAULT, NOT AN OPTION ★
 *
 * `DISCORD_DM_ALLOWLIST` unset means NOBODY is messaged, and every attempt is recorded instead. That
 * ordering matters: a sender that defaults to "send to everyone" and is narrowed by configuration is
 * one missing environment variable away from the thing it was written to prevent. This one defaults
 * to silence and is widened deliberately.
 *
 * Production will set it to `*` when the owner decides fan-out should go live. Until then the
 * variable is a single user id, and the recorded attempts are the evidence of what WOULD have been
 * sent — which is what makes reviewing it possible before anybody is woken up.
 */

export interface DmAttempt {
  readonly discordId: string;
  readonly content: string;
  readonly sent: boolean;
  /** Why it was not sent, when it was not. */
  readonly suppressedBecause?: string;
}

export interface DiscordDmSender {
  send(discordId: string, content: string): Promise<DmAttempt>;
  /** Everything this sender was asked to do, for review. */
  attempts(): readonly DmAttempt[];
}

/**
 * Parses the allowlist.
 *
 * `*` means everybody — the production setting, once somebody decides that. A comma-separated list
 * of ids means those ids only. Anything else, including absent or blank, means NOBODY.
 */
export function parseAllowlist(raw: string | undefined): { all: boolean; ids: ReadonlySet<string> } {
  const value = (raw ?? '').trim();
  if (value === '') return { all: false, ids: new Set() };
  if (value === '*') return { all: true, ids: new Set() };
  return {
    all: false,
    ids: new Set(
      value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^[0-9]{5,25}$/.test(s)),
    ),
  };
}

/**
 * The real sender, gated.
 *
 * ★ THE GATE IS BEFORE THE FETCH, NOT INSIDE A CALLBACK ★
 *
 * Deliberate. A guard that runs after the request is built is one refactor away from being skipped,
 * and the failure mode is irreversible — you cannot unsend a DM to a hundred people.
 */
export class GatedDiscordDm implements DiscordDmSender {
  readonly #attempts: DmAttempt[] = [];
  readonly #allow: { all: boolean; ids: ReadonlySet<string> };

  constructor(
    private readonly token: string | undefined,
    allowlistRaw: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.#allow = parseAllowlist(allowlistRaw);
  }

  attempts(): readonly DmAttempt[] {
    return this.#attempts;
  }

  async send(discordId: string, content: string): Promise<DmAttempt> {
    const record = (sent: boolean, suppressedBecause?: string): DmAttempt => {
      const attempt: DmAttempt = {
        discordId,
        content,
        sent,
        ...(suppressedBecause === undefined ? {} : { suppressedBecause }),
      };
      /*
       * Bounded. An unbounded array on a long-lived process is a slow memory leak, and the only
       * consumer is a human reviewing recent attempts.
       */
      this.#attempts.push(attempt);
      if (this.#attempts.length > 200) this.#attempts.shift();
      return attempt;
    };

    if (this.token === undefined || this.token === '') {
      return record(false, 'no bot token configured');
    }

    const permitted = this.#allow.all || this.#allow.ids.has(discordId);
    if (!permitted) {
      /*
       * The recorded attempt IS the deliverable while the allowlist is narrow: it is how the owner
       * reviews who fan-out would have reached, before it reaches them.
       */
      return record(false, 'not on DISCORD_DM_ALLOWLIST');
    }

    try {
      // Open a DM channel with EXACTLY one recipient. Discord's API takes a single id here, so
      // there is no shape in which this call could address a group.
      const chRes = await this.fetchImpl('https://discord.com/api/v10/users/@me/channels', {
        method: 'POST',
        headers: { authorization: `Bot ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ recipient_id: discordId }),
      });
      if (!chRes.ok) return record(false, `could not open a DM channel (${chRes.status})`);

      const channel = (await chRes.json()) as { id?: string };
      if (typeof channel.id !== 'string') return record(false, 'Discord returned no channel id');

      const msgRes = await this.fetchImpl(
        `https://discord.com/api/v10/channels/${channel.id}/messages`,
        {
          method: 'POST',
          headers: { authorization: `Bot ${this.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ content }),
        },
      );
      if (!msgRes.ok) return record(false, `Discord refused the message (${msgRes.status})`);

      return record(true);
    } catch {
      /*
       * A network failure is not an error worth propagating: a notification that did not arrive by
       * DM still exists in-app, and taking a reply request down because Discord was briefly
       * unreachable would be the wrong trade.
       */
      return record(false, 'Discord was unreachable');
    }
  }
}

/**
 * Composes the message.
 *
 * ★ IT NAMES THE THREAD, NOT THE MEMBER WHO REPLIED ★
 *
 * INV-048: a broadcast event never names a member. A DM is not a broadcast, but the habit is worth
 * keeping — and the title plus a link is what makes the notification useful. Who replied is visible
 * the moment they open it.
 */
export function replyDmText(threadTitle: string, link: string, baseUrl: string): string {
  return [
    `**New reply:** ${threadTitle}`,
    '',
    `${baseUrl}${link}`,
    '',
    '_You are getting this because you are watching that thread. Turn these off in Settings._',
  ].join('\n');
}
