import type { PrismaClient } from './index.js';

/**
 * Writing notifications — the one door every producer uses.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "we need to add the Personal and Squadron Activity notifications and the notifications system
 * that notifies users of various activities" — approved design: personal rows into the existing
 * `notifications` table, squadron-wide events once each into `squadron_activity`.
 *
 * ★ IN packages/db, NOT IN THE API ★
 *
 * Producers live in three processes: the API (forum, colonisation, shipyard, telemetry), the
 * worker (badge sweeps, auto-completion, seasons) and — someday — the bot. The forum's original
 * fan-out lives in the API and the worker cannot reach it; a second copy in the worker is how the
 * two drift. This module is process-neutral: a PrismaClient in, rows out, and the LIVE nudge is a
 * callback the caller supplies (the API publishes to its SSE service directly; the worker goes
 * through the Redis bridge). Failure NEVER propagates: a notification is decoration on an action
 * that already succeeded, and no member's post, delivery or claim may fail because a bell did.
 */

export interface PersonalNotice {
  readonly userId: string;
  /** Namespaced: 'forum.answer-accepted' | 'badge.earned' | 'colony.crew-joined' | ... */
  readonly kind: string;
  readonly title: string;
  readonly body?: string;
  /** Deep link into the site. */
  readonly link?: string;
}

export interface SquadronNotice {
  readonly kind: string;
  readonly title: string;
  readonly body?: string;
  readonly link?: string;
  readonly actorUserId?: string;
  readonly meta?: Record<string, unknown>;
}

/** How a producer nudges live badges after rows land. Absent = rows only, still correct. */
export type LiveNudge = (userIds: readonly string[] | 'everyone') => Promise<void> | void;

/**
 * One personal notification each for `userIds` (deduplicated). Returns how many rows landed.
 */
export async function notifyMembers(
  db: PrismaClient,
  userIds: readonly string[],
  notice: Omit<PersonalNotice, 'userId'>,
  nudge?: LiveNudge,
): Promise<number> {
  const unique = [...new Set(userIds)].filter((id) => id !== '');
  if (unique.length === 0) return 0;

  try {
    const result = await db.notification.createMany({
      data: unique.map((userId) => ({
        userId,
        channel: 'in_app' as const,
        kind: notice.kind,
        title: notice.title,
        body: notice.body ?? null,
        link: notice.link ?? null,
        // In-app rows are "delivered" the moment they exist — the bell reads the table.
        state: 'sent' as const,
        sentAt: new Date(),
      })),
    });
    if (nudge !== undefined) await nudge(unique);
    return result.count;
  } catch {
    // See the header: the action already succeeded; the bell must not un-succeed it.
    return 0;
  }
}

/** One squadron-feed entry, once. Returns whether it landed. */
export async function notifySquadron(
  db: PrismaClient,
  notice: SquadronNotice,
  nudge?: LiveNudge,
): Promise<boolean> {
  try {
    await db.squadronActivity.create({
      data: {
        kind: notice.kind,
        title: notice.title,
        body: notice.body ?? null,
        link: notice.link ?? null,
        actorUserId: notice.actorUserId ?? null,
        // exactOptionalPropertyTypes: the key must be absent, not undefined-valued.
        ...(notice.meta === undefined ? {} : { meta: notice.meta as object }),
      },
    });
    if (nudge !== undefined) await nudge('everyone');
    return true;
  } catch {
    return false;
  }
}
