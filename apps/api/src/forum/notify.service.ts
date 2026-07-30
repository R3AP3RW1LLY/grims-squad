import { AppError, ErrorCode, computeEffectiveMask, type PermissionMask } from '@grims/shared';
import type { AclBoundClient } from '../authz/acl-db.service.js';
import { satisfiesMask } from './category.service.js';

/**
 * Notification fan-out (INV-039).
 *
 * ★ THE INVARIANT, AND WHY IT IS ITS OWN THING ★
 *
 * INV-039: "Notification fan-out re-checks each recipient's CURRENT mask against the target's
 * CURRENT category at send time, and moving a thread prunes subscriptions whose holders no longer
 * satisfy the destination viewPerm."
 *
 * The red-team note attached to it is the important part: *fan-out is not "on behalf of a user", so
 * INV-002 does not reach it.* Every other read in the forum goes through an ACL-bound client
 * carrying one principal. Fan-out is the opposite shape — one row, many recipients, none of whom is
 * "the caller". So the data-layer ACL cannot help, and the check has to be here, explicitly, per
 * recipient.
 *
 * ★ THE LEAK THIS PREVENTS, CONCRETELY ★
 *
 * A member subscribes to a thread in General. An officer moves that thread to the officers' board.
 * Somebody replies. Without the re-check, the member receives a notification carrying the thread
 * TITLE and a link — from a board they cannot open. The title alone is the disclosure; a
 * notification saying "new reply in Disciplinary: CMDR Smith" has already said the thing.
 *
 * That is also why a stale subscription row is not enough to notify on: the subscription records a
 * past intention, and the ACL is a present fact.
 *
 * ★ TWO INDEPENDENT DEFENCES, ON PURPOSE ★
 *
 *   `pruneOnMove`  deletes subscriptions the destination board excludes, at move time.
 *   `recipientsFor` re-checks every remaining subscriber at SEND time.
 *
 * Either alone would very nearly work. Both, because pruning is a bulk operation that can be
 * interrupted, roles change between a move and a reply, and a member can be demoted without
 * anything touching their subscriptions at all. The prune keeps the table honest; the send-time
 * check is what actually holds.
 */

/**
 * Why somebody is being notified.
 *
 * ★ THE REASON TRAVELS WITH THE RECIPIENT ★
 *
 * Owner chose three separate opt-ins, because the volumes are different: being answered directly is
 * rare and almost always wanted, while a busy watched thread can produce twenty messages in an
 * evening. A single switch would force a choice between missing a direct reply and being flooded,
 * and the choice people actually make is to turn everything off.
 *
 * So the reason is decided here, per recipient, and the preference consulted is the one that
 * matches it.
 */
export type NotifyReason = 'direct_reply' | 'mention' | 'watched_thread';

/** What a recipient needs, resolved once so the sender never re-reads. */
export interface Recipient {
  readonly userId: string;
  readonly discordId: string | null;
  readonly reason: NotifyReason;
  /** In-app always; Discord only if they have an identity and opted in FOR THIS REASON. */
  readonly wantsDiscordDm: boolean;
}

export interface FanOutTarget {
  readonly threadId: string;
  readonly threadTitle: string;
  readonly categorySlug: string;
  readonly threadSlug: string;
  /** The post that caused this, so the actor is never notified about their own reply. */
  readonly actorId: string;
  /** Who wrote the post being replied TO, if this is a direct reply. */
  readonly replyToAuthorId?: string | null;
  /** Members @mentioned in the new post, already validated by the document parser. */
  readonly mentionedUserIds?: readonly string[];
}

export class NotifyService {
  /**
   * Everyone who should hear about a reply, after re-checking each one.
   *
   * ★ READ WITH A SYSTEM CLIENT, DELIBERATELY, AND THEN CHECKED BY HAND ★
   *
   * This needs to see every subscription regardless of who is asking, which is exactly what
   * `forSystem` exists for — and exactly why the permission check below is not optional. The
   * bound-client protection is absent here BY DESIGN, so this function carries it instead.
   *
   * The mask is recomputed from each recipient's CURRENT roles, not read from a cache and not
   * carried on the subscription. A member demoted an hour ago must stop receiving, and the only
   * source of truth for that is their roles right now.
   */
  async recipientsFor(
    db: AclBoundClient,
    target: FanOutTarget,
  ): Promise<Recipient[]> {
    /*
     * The CURRENT category of the thread, read now rather than passed in. A caller supplying the
     * category would be supplying the thing being checked — and the whole failure mode is a thread
     * that has MOVED since somebody subscribed.
     */
    const thread = await db.forumThread.findFirst({
      where: { id: target.threadId, deletedAt: null },
      select: {
        id: true,
        categoryId: true,
        category: { select: { viewPerm: true } },
      },
    });
    if (thread === null) return [];

    const required =
      thread.category.viewPerm === null ? null : BigInt(thread.category.viewPerm.toFixed(0));

    /*
     * Subscriptions to the THREAD or to its CURRENT category. Category subscribers matter: somebody
     * watching General should hear about a new thread there, and must stop hearing the moment the
     * thread leaves.
     */
    const subs = await db.forumSubscription.findMany({
      where: {
        OR: [{ threadId: target.threadId }, { categoryId: thread.categoryId }],
        level: { not: 'muted' },
      },
      select: {
        userId: true,
        user: {
          select: {
            id: true,
            status: true,
            denyMask: true,
            notifyDmDirectReply: true,
            notifyDmMention: true,
            notifyDmWatched: true,
            userRoles: { select: { role: { select: { permMask: true } } } },
            discordIdentity: { select: { discordId: true } },
          },
        },
      },
    });

    /*
     * ★ EVERY CANDIDATE, WITH THE REASON THEY QUALIFY UNDER ★
     *
     * Somebody can qualify more than once — the author of the post being replied to may also be
     * watching the thread, and may also have been mentioned. They get ONE notification, under the
     * STRONGEST reason, because three messages about one reply is how a member decides the bot is
     * broken and mutes it.
     *
     * Strength order: a direct reply is addressed to you, a mention names you, a watched thread is
     * something you asked about generally.
     */
    const candidates = new Map<string, NotifyReason>();

    const consider = (userId: string, reason: NotifyReason): void => {
      const rank: Record<NotifyReason, number> = {
        direct_reply: 3,
        mention: 2,
        watched_thread: 1,
      };
      const existing = candidates.get(userId);
      if (existing === undefined || rank[reason] > rank[existing]) {
        candidates.set(userId, reason);
      }
    };

    if (typeof target.replyToAuthorId === 'string') {
      consider(target.replyToAuthorId, 'direct_reply');
    }
    for (const id of target.mentionedUserIds ?? []) consider(id, 'mention');
    for (const sub of subs) consider(sub.userId, 'watched_thread');

    /*
     * The people reached by a direct reply or a mention may not be subscribed at all, so their rows
     * are not in `subs`. Fetched here rather than assumed.
     */
    const extraIds = [...candidates.keys()].filter(
      (id) => !subs.some((s) => s.userId === id),
    );
    const extras =
      extraIds.length === 0
        ? []
        : await db.user.findMany({
            where: { id: { in: extraIds } },
            select: {
              id: true,
              status: true,
              denyMask: true,
              notifyDmDirectReply: true,
              notifyDmMention: true,
              notifyDmWatched: true,
              userRoles: { select: { role: { select: { permMask: true } } } },
              discordIdentity: { select: { discordId: true } },
            },
          });

    const byId = new Map(
      [...subs.map((s) => s.user), ...extras].map((u) => [u.id, u] as const),
    );

    const out: Recipient[] = [];
    for (const [userId, reason] of candidates) {
      const u = byId.get(userId);
      if (u === undefined) continue;

      // Never notify somebody about their own reply, whatever the reason.
      if (u.id === target.actorId) continue;

      /*
       * ★ THE RE-CHECK ★
       *
       * `computeEffectiveMask` ORs the held roles, applies the deny mask, and returns
       * NO_PERMISSIONS for any non-active status — so a banned or departed account is excluded
       * here without a separate condition, which is the point of that function being the one place
       * this is decided.
       */
      const mask = computeEffectiveMask(
        u.userRoles.map((ur) => BigInt(ur.role.permMask.toFixed(0)) as PermissionMask),
        u.denyMask === null ? 0n : (BigInt(u.denyMask.toFixed(0)) as PermissionMask),
        u.status,
      );

      if (!satisfiesMask(mask, required)) {
        /*
         * Skipped SILENTLY, with no row written and nothing logged that names them.
         *
         * INV-048: a broadcast event never names a member. Logging "skipped CMDR Smith, no longer
         * permitted" would put the fact of their demotion into a log that other people read — a
         * smaller disclosure than the notification itself, and the same kind.
         */
        continue;
      }

      /*
       * Discord requires BOTH a linked identity and an explicit opt-in FOR THIS REASON. Absent
       * either, in-app only — a DM is a message into somebody's private inbox, and inferring
       * consent from "they linked Discord to sign in" would be putting words in their mouth.
       */
      const optedIn =
        reason === 'direct_reply'
          ? u.notifyDmDirectReply
          : reason === 'mention'
            ? u.notifyDmMention
            : u.notifyDmWatched;

      out.push({
        userId: u.id,
        discordId: u.discordIdentity?.discordId ?? null,
        reason,
        wantsDiscordDm: optedIn === true && u.discordIdentity !== null,
      });
    }

    return out;
  }

  /**
   * Removes subscriptions the destination board excludes (INV-039, second half).
   *
   * Called from the move. Returns how many were removed, so the mover can be told — a silent prune
   * would mean somebody loses a subscription with no idea why they stopped hearing about a thread.
   */
  async pruneOnMove(db: AclBoundClient, threadId: string, destinationCategoryId: string): Promise<number> {
    const category = await db.forumCategory.findFirst({
      where: { id: destinationCategoryId },
      select: { viewPerm: true },
    });
    if (category === null) {
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No such board.');
    }

    // A public destination excludes nobody, so there is nothing to prune and no reason to read
    // every subscriber's roles to discover that.
    const required = category.viewPerm === null ? null : BigInt(category.viewPerm.toFixed(0));
    if (required === null) return 0;

    const subs = await db.forumSubscription.findMany({
      where: { threadId },
      select: {
        userId: true,
        user: {
          select: {
            status: true,
            denyMask: true,
            userRoles: { select: { role: { select: { permMask: true } } } },
          },
        },
      },
    });

    const losing = subs
      .filter((s) => {
        const mask = computeEffectiveMask(
          s.user.userRoles.map((ur: { role: { permMask: { toFixed: (n: number) => string } } }) => BigInt(ur.role.permMask.toFixed(0)) as PermissionMask),
          s.user.denyMask === null ? 0n : (BigInt(s.user.denyMask.toFixed(0)) as PermissionMask),
          s.user.status,
        );
        return !satisfiesMask(mask, required);
      })
      .map((s) => s.userId);

    if (losing.length === 0) return 0;

    await db.forumSubscription.deleteMany({
      where: { threadId, userId: { in: losing } },
    });

    return losing.length;
  }

  /**
   * Writes the in-app notification rows.
   *
   * ★ THE TITLE IS INCLUDED, WHICH IS WHY THE RE-CHECK HAD TO HAPPEN FIRST ★
   *
   * A notification carries the thread title and a link, because one that said "something happened
   * somewhere" would be useless. That is precisely what makes an unchecked fan-out a disclosure:
   * the title is the payload. The ordering here is not an optimisation — `recipientsFor` must run
   * before anything is written.
   */
  async writeInApp(
    db: AclBoundClient,
    recipients: readonly Recipient[],
    target: FanOutTarget,
  ): Promise<number> {
    if (recipients.length === 0) return 0;

    await db.notification.createMany({
      data: recipients.map((r) => ({
        userId: r.userId,
        channel: 'in_app' as const,
        /*
         * The REASON is the kind, so an in-app list can say "replied to you" rather than a
         * uniform "new reply" — which is the difference between a notification somebody acts on
         * and one they scroll past.
         */
        kind: `forum_${r.reason}`,
        title: target.threadTitle,
        body: null,
        link: `/forum/${target.categorySlug}/${target.threadSlug}`,
        /*
         * `sent` immediately: an in-app notification IS delivered the moment the row exists, since
         * delivery is the member reading it. Leaving it `pending` would have a worker forever
         * trying to "send" something already sent.
         */
        state: 'sent' as const,
        sentAt: new Date(),
      })),
    });

    return recipients.length;
  }
}
