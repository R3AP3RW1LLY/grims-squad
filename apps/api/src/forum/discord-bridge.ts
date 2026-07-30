import type { AclBoundClient } from '../authz/acl-db.service.js';

/**
 * The Discord thread bridge (P2.8).
 *
 * ★ IT POSTS NOTHING, AND THAT IS THE CURRENT CONFIGURATION ★
 *
 * Squadron owner, 2026-07-30, asked whether it could post into the real server while they slept:
 * "Build it, post NOTHING until you approve."
 *
 * So the bridge is complete and its sender is a recorder. `DISCORD_BRIDGE_CHANNELS` unset means no
 * message reaches Discord and every intended message is kept for review. The same ordering as the
 * DM allowlist, for the same reason: development points at the SAME guild as production, and a
 * default of "send" is one missing environment variable away from posting a squadron's private
 * board into a public channel.
 *
 * ★ THREAD-LEVEL ONLY (ADR-006) ★
 *
 * A thread announcement, never a message-by-message mirror. ADR-006 rejected message-level
 * mirroring, and the reasons hold up:
 *
 *   - Two-way sync is a distributed-systems problem nobody asked for. Edits, deletes and reactions
 *     would each need a mapping and a conflict rule.
 *   - A mirrored message is a SECOND copy of member content with its own ACL — Discord's — and the
 *     forum's permissions do not travel with it.
 *   - The value is "somebody started a thread, go and read it". That is one message.
 *
 * ★ THE ACL DECIDES WHAT MAY BE BRIDGED, NOT THE CHANNEL MAP ★
 *
 * A bridged announcement carries the thread TITLE into a Discord channel whose membership we do not
 * control. So a board is bridgeable only if it is readable without any permission at all — a public
 * board. Bridging the officers' board would publish its titles to whoever is in that channel, which
 * is the same disclosure the notification fan-out was careful about, with a wider audience.
 */

export interface BridgeAttempt {
  readonly channelId: string;
  readonly content: string;
  readonly sent: boolean;
  readonly suppressedBecause?: string;
}

export interface BridgeTarget {
  readonly categorySlug: string;
  readonly threadTitle: string;
  readonly threadUrl: string;
  readonly authorDisplayName: string;
}

/**
 * Which boards bridge to which channels.
 *
 * `slug:channelId` pairs, comma separated. Absent means nothing bridges — see the header.
 */
export function parseChannelMap(raw: string | undefined): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const entry of (raw ?? '').split(',')) {
    const [slug, channelId] = entry.split(':').map((s) => s.trim());
    if (slug === undefined || channelId === undefined) continue;
    if (slug === '' || !/^[0-9]{5,25}$/.test(channelId)) continue;
    out.set(slug, channelId);
  }
  return out;
}

/**
 * Composes the announcement.
 *
 * ★ TITLE AND LINK, AND THE AUTHOR'S DISPLAY NAME — NOT THE BODY ★
 *
 * The body is deliberately absent. Posting it would be the message-level mirror ADR-006 rejected,
 * and it would put member content into a channel with different membership. A title and a link let
 * somebody decide to go and read it, which is the entire point.
 */
export function bridgeMessage(target: BridgeTarget): string {
  return [
    `**New thread in ${target.categorySlug}**`,
    `${target.threadTitle} — by ${target.authorDisplayName}`,
    target.threadUrl,
  ].join('\n');
}

export interface BridgeSender {
  post(channelId: string, content: string): Promise<BridgeAttempt>;
  attempts(): readonly BridgeAttempt[];
}

/**
 * The sender, gated exactly like the DM one.
 *
 * The gate runs BEFORE the request is built. A guard after the fact is one refactor from being
 * skipped, and a message posted to a Discord channel cannot be unposted from the notifications of
 * everybody who was watching it.
 */
export class GatedBridgeSender implements BridgeSender {
  readonly #attempts: BridgeAttempt[] = [];
  readonly #allowed: ReadonlySet<string>;

  constructor(
    private readonly token: string | undefined,
    allowedChannelIds: Iterable<string>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.#allowed = new Set(allowedChannelIds);
  }

  attempts(): readonly BridgeAttempt[] {
    return this.#attempts;
  }

  async post(channelId: string, content: string): Promise<BridgeAttempt> {
    const record = (sent: boolean, suppressedBecause?: string): BridgeAttempt => {
      const attempt: BridgeAttempt = {
        channelId,
        content,
        sent,
        ...(suppressedBecause === undefined ? {} : { suppressedBecause }),
      };
      this.#attempts.push(attempt);
      if (this.#attempts.length > 200) this.#attempts.shift();
      return attempt;
    };

    if (this.token === undefined || this.token === '') {
      return record(false, 'no bot token configured');
    }
    if (!this.#allowed.has(channelId)) {
      /*
       * The recorded attempt IS the deliverable while nothing is configured: it is how the owner
       * reviews what the bridge would have said, in which channel, before any of it is said.
       */
      return record(false, 'channel not in DISCORD_BRIDGE_CHANNELS');
    }

    try {
      const res = await this.fetchImpl(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bot ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          content,
          /*
           * No pings, ever. `allowed_mentions` empty means a thread title containing "@everyone"
           * cannot notify a server — a member could otherwise write a title that alerts a hundred
           * people, from a forum with no such capability of its own.
           */
          allowed_mentions: { parse: [] },
        }),
      });
      if (!res.ok) return record(false, `Discord refused the message (${res.status})`);
      return record(true);
    } catch {
      // A bridge failure must not fail the thread creation that triggered it.
      return record(false, 'Discord was unreachable');
    }
  }
}

export class DiscordBridge {
  constructor(
    private readonly sender: BridgeSender,
    private readonly channels: ReadonlyMap<string, string>,
    private readonly baseUrl: string,
  ) {}

  /**
   * Announces a new thread, if its board is bridged AND public.
   *
   * Returns the attempt so a caller can log or surface it; returns null when the board is not
   * bridged at all, which is the ordinary case and not worth an attempt record.
   */
  async announceThread(
    db: AclBoundClient,
    threadId: string,
  ): Promise<BridgeAttempt | null> {
    const thread = await db.forumThread.findFirst({
      where: { id: threadId, deletedAt: null },
      select: {
        title: true,
        slug: true,
        category: { select: { slug: true, viewPerm: true } },
        author: { select: { displayName: true, handle: true } },
      },
    });
    if (thread === null) return null;

    const channelId = this.channels.get(thread.category.slug);
    if (channelId === undefined) return null;

    /*
     * ★ THE ACL CHECK THAT MATTERS MORE THAN THE CHANNEL MAP ★
     *
     * A bridged announcement carries the thread title into a channel whose membership we do not
     * control. So only a board readable with NO permission at all may be bridged.
     *
     * Checked here rather than trusted from configuration: somebody adding `officers:12345` to the
     * channel map would otherwise publish the officers' board titles, and a configuration mistake
     * should not be able to cause a disclosure.
     */
    if (thread.category.viewPerm !== null) {
      return {
        channelId,
        content: '',
        sent: false,
        suppressedBecause: `the ${thread.category.slug} board is not public, so it is never bridged`,
      };
    }

    const content = bridgeMessage({
      categorySlug: thread.category.slug,
      threadTitle: thread.title,
      threadUrl: `${this.baseUrl}/forum/${thread.category.slug}/${thread.slug}`,
      authorDisplayName: thread.author.displayName ?? thread.author.handle,
    });

    return this.sender.post(channelId, content);
  }
}
