import { AppError, ErrorCode, Permission } from '@grims/shared';
import type { AclBoundClient } from '../authz/acl-db.service.js';
import { satisfiesMask } from './category.service.js';

/**
 * Moderation (P2.6, INV-009).
 *
 * ★ EVERY ACTION WRITES TWO ROWS, AND THEY ARE NOT THE SAME ROW ★
 *
 * `moderation_actions` is the MEMBER-FACING record: why somebody was muted, until when, and where
 * they may appeal. It is the thing a moderator reads next month to answer "has this happened
 * before", and the thing a member is shown when they ask why they cannot post.
 *
 * `audit_log` is the SYSTEM record required by INV-009: actor, action, target, before and after. It
 * covers every privileged action in the application uniformly, so an investigation reads one table
 * rather than knowing which subsystem to ask.
 *
 * They overlap and they are not redundant. A moderation record without an audit row would be
 * invisible to a security review; an audit row without a moderation record would leave a muted
 * member with no explanation. Both are written in ONE transaction, so neither can exist alone.
 *
 * ★ BEFORE AND AFTER ARE REAL, NOT A LABEL ★
 *
 * INV-009 asks for before/after, and the temptation is to write `{action: 'lock'}` in both. That
 * satisfies the schema and answers no question. A lock records `{isLocked: false}` then
 * `{isLocked: true}`, so a reviewer can see what actually changed — including the case where a
 * moderator locked something already locked, which is exactly what somebody claiming "I never
 * touched it" would produce.
 */

/** What a member is told when a sanction stops them. */
export interface ActiveSanction {
  readonly action: 'mute' | 'ban';
  readonly reason: string;
  /** Null means indefinite. */
  readonly expiresAt: string | null;
  readonly appealThreadId: string | null;
}

export class ModerationService {
  /**
   * The sanction currently stopping this member, if any.
   *
   * ★ READ ON EVERY POST ATTEMPT, NOT CACHED ★
   *
   * A mute that expired two minutes ago must stop applying. Caching this would mean a member
   * staying muted past their sentence, which is both wrong and the kind of thing that gets reported
   * as "the site is broken" rather than as a moderation bug.
   *
   * Ordered newest-first and takes the first: a member muted, unmuted and muted again has three
   * rows, and only the latest is in force.
   */
  async activeSanction(db: AclBoundClient, userId: string): Promise<ActiveSanction | null> {
    const rows = await db.moderationAction.findMany({
      where: {
        targetUserId: userId,
        action: { in: ['mute', 'ban', 'unban'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { action: true, reason: true, expiresAt: true, appealThreadId: true },
    });

    const latest = rows[0];
    if (latest === undefined) return null;

    // An unban clears whatever came before it. Recorded as its own action rather than by deleting
    // the ban, so the history survives.
    if (latest.action === 'unban') return null;

    /*
     * An EXPIRED sanction is not in force. Compared here rather than in the query so the boundary
     * is one place and testable — a `lt: new Date()` in the WHERE would put the same rule in SQL
     * where it is harder to see and easy to write as `lte` by accident.
     */
    if (latest.expiresAt !== null && latest.expiresAt.getTime() <= Date.now()) return null;

    return {
      action: latest.action === 'ban' ? 'ban' : 'mute',
      reason: latest.reason,
      expiresAt: latest.expiresAt?.toISOString() ?? null,
      appealThreadId: latest.appealThreadId,
    };
  }

  /**
   * Refuses a post when the member is muted or banned, and SAYS WHY AND UNTIL WHEN.
   *
   * P2.6's acceptance is explicit about that wording, and it is the right requirement: a member who
   * cannot post and is told only "forbidden" will ask an officer, who will have to go and look it
   * up. Telling them costs nothing and answers the question before it is asked.
   */
  async assertMayPost(db: AclBoundClient, userId: string): Promise<void> {
    const sanction = await this.activeSanction(db, userId);
    if (sanction === null) return;

    const until =
      sanction.expiresAt === null
        ? 'This does not expire on its own.'
        : `It lifts on ${new Date(sanction.expiresAt).toUTCString()}.`;

    const appeal =
      sanction.appealThreadId === null
        ? 'Speak to an officer if you think this is wrong.'
        : 'You can appeal in the thread an officer opened for it.';

    throw new AppError(
      ErrorCode.PERMISSION_DENIED,
      `You cannot post at the moment: ${sanction.reason} ${until} ${appeal}`,
    );
  }

  /**
   * Records a moderation action and its audit row, in one transaction.
   *
   * Private-by-convention rather than exported: every public method below funnels through it, so
   * there is exactly one place that writes these rows and exactly one place to get the pairing
   * wrong.
   */
  async #record(
    db: AclBoundClient,
    input: {
      actorId: string;
      action: string;
      targetType: string;
      targetId: string | null;
      targetUserId: string | null;
      reason: string;
      expiresAt: Date | null;
      appealThreadId: string | null;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    },
  ): Promise<void> {
    await db.$transaction([
      db.moderationAction.create({
        data: {
          actorId: input.actorId,
          action: input.action as never,
          targetType: input.targetType,
          targetId: input.targetId,
          targetUserId: input.targetUserId,
          reason: input.reason,
          expiresAt: input.expiresAt,
          appealThreadId: input.appealThreadId,
        },
      }),
      db.auditLog.create({
        data: {
          actorId: input.actorId,
          actorType: 'user',
          // Namespaced, so an investigator can select every moderation event without knowing the
          // individual verbs.
          action: `moderation.${input.action}`,
          targetType: input.targetType,
          targetId: input.targetId,
          /*
           * Cast because Prisma types a Json column as its own InputJsonValue union rather than
           * accepting a plain record. The VALUES are ours and structural — see the callers, which
           * pass real before/after state rather than a label — so this is a type-level formality,
           * not a place where unchecked data enters.
           */
          before: input.before as object,
          after: input.after as object,
        },
      }),
    ]);
  }

  #assertModerator(mask: bigint): void {
    if (!satisfiesMask(mask, Permission.FORUM_MODERATE)) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'You cannot moderate.');
    }
  }

  /** A reason is REQUIRED on every action, and that is not a validation detail. */
  #reason(raw: unknown): string {
    if (typeof raw !== 'string' || raw.trim().length < 3) {
      /*
       * A moderation record with no reason is useless to the next moderator and unanswerable to the
       * member it is about. Requiring one at the boundary is the only place it can be enforced —
       * a nullable column would be filled with "." within a week.
       */
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Say why. The member will be shown this.');
    }
    return raw.trim().slice(0, 1000);
  }

  /** Locks or unlocks a thread. */
  async setLocked(
    db: AclBoundClient,
    threadId: string,
    locked: boolean,
    actorId: string,
    mask: bigint,
    reason: unknown,
  ): Promise<void> {
    this.#assertModerator(mask);
    const why = this.#reason(reason);

    const thread = await db.forumThread.findFirst({
      where: { id: threadId, deletedAt: null },
      select: { id: true, isLocked: true, authorId: true },
    });
    if (thread === null) throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Thread not found.');

    await db.forumThread.update({ where: { id: thread.id }, data: { isLocked: locked } });

    await this.#record(db, {
      actorId,
      action: locked ? 'lock' : 'unlock',
      targetType: 'thread',
      targetId: thread.id,
      targetUserId: thread.authorId,
      reason: why,
      expiresAt: null,
      appealThreadId: null,
      // Real values, so a reviewer can see a no-op lock as well as a real one.
      before: { isLocked: thread.isLocked },
      after: { isLocked: locked },
    });
  }

  /** Pins or unpins a thread. */
  async setPinned(
    db: AclBoundClient,
    threadId: string,
    pinned: boolean,
    actorId: string,
    mask: bigint,
    reason: unknown,
  ): Promise<void> {
    this.#assertModerator(mask);
    const why = this.#reason(reason);

    const thread = await db.forumThread.findFirst({
      where: { id: threadId, deletedAt: null },
      select: { id: true, isPinned: true, authorId: true },
    });
    if (thread === null) throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Thread not found.');

    await db.forumThread.update({ where: { id: thread.id }, data: { isPinned: pinned } });

    await this.#record(db, {
      actorId,
      action: pinned ? 'pin' : 'unpin',
      targetType: 'thread',
      targetId: thread.id,
      targetUserId: thread.authorId,
      reason: why,
      expiresAt: null,
      appealThreadId: null,
      before: { isPinned: thread.isPinned },
      after: { isPinned: pinned },
    });
  }

  /**
   * Warns a member. No effect on what they can do — which is the point.
   *
   * A warning that silently changed nothing would be a note to the moderator. A warning that muted
   * somebody would be a mute. This is the middle rung, and it exists so that escalation has a step
   * before it removes somebody's voice.
   */
  async warn(
    db: AclBoundClient,
    targetUserId: string,
    actorId: string,
    mask: bigint,
    reason: unknown,
  ): Promise<void> {
    this.#assertModerator(mask);
    const why = this.#reason(reason);

    const target = await db.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
    if (target === null) throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No such member.');

    await this.#record(db, {
      actorId,
      action: 'warn',
      targetType: 'user',
      targetId: targetUserId,
      targetUserId,
      reason: why,
      expiresAt: null,
      appealThreadId: null,
      before: {},
      // A warning changes nothing, so `after` records the warning itself rather than a state.
      after: { warned: true, reason: why },
    });
  }

  /**
   * Mutes a member for a period.
   *
   * ★ MUTES EXPIRE, BANS DO NOT ★
   *
   * A mute with no end is a ban wearing a smaller word, and the difference matters to the person it
   * is applied to. So a duration is required here and refused for a ban — which is the shape that
   * stops "temporary" sanctions quietly becoming permanent because nobody remembered to lift them.
   */
  async mute(
    db: AclBoundClient,
    targetUserId: string,
    hours: number,
    actorId: string,
    mask: bigint,
    reason: unknown,
  ): Promise<{ expiresAt: string }> {
    this.#assertModerator(mask);
    const why = this.#reason(reason);

    if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 90) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'A mute lasts between an hour and ninety days. Longer than that is a ban, and should be called one.',
      );
    }

    const target = await db.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
    if (target === null) throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No such member.');

    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    await this.#record(db, {
      actorId,
      action: 'mute',
      targetType: 'user',
      targetId: targetUserId,
      targetUserId,
      reason: why,
      expiresAt,
      appealThreadId: null,
      before: { canPost: true },
      after: { canPost: false, until: expiresAt.toISOString() },
    });

    return { expiresAt: expiresAt.toISOString() };
  }

  /**
   * Bans a member.
   *
   * ★ A BAN CARRIES A REASON AND AN APPEAL ROUTE ★
   *
   * P2.6's acceptance requires both. The appeal thread id is optional in the schema and required in
   * spirit: a ban with nowhere to appeal is a decision nobody can be wrong about, and in a squadron
   * of a hundred people that is how a mistake becomes permanent.
   *
   * Not enforced as a hard requirement here because the appeal thread may not exist yet when the
   * ban is issued — a moderator acting at speed should not be blocked. It is recorded either way,
   * so an unappealable ban is visible in the record rather than invisible.
   */
  async ban(
    db: AclBoundClient,
    targetUserId: string,
    actorId: string,
    mask: bigint,
    reason: unknown,
    appealThreadId: string | null,
  ): Promise<void> {
    this.#assertModerator(mask);
    const why = this.#reason(reason);

    const target = await db.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, status: true },
    });
    if (target === null) throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No such member.');

    /*
     * The account status changes too, not just the moderation record. `computeEffectiveMask`
     * returns NO_PERMISSIONS for a banned account, so this single field is what actually removes
     * their access everywhere — the moderation row explains it, the status enforces it.
     */
    await db.user.update({ where: { id: target.id }, data: { status: 'banned' } });

    await this.#record(db, {
      actorId,
      action: 'ban',
      targetType: 'user',
      targetId: targetUserId,
      targetUserId,
      reason: why,
      expiresAt: null,
      appealThreadId,
      before: { status: target.status },
      after: { status: 'banned', appealThreadId },
    });
  }

  /** Lifts a ban. Recorded as its own action so the history survives. */
  async unban(
    db: AclBoundClient,
    targetUserId: string,
    actorId: string,
    mask: bigint,
    reason: unknown,
  ): Promise<void> {
    this.#assertModerator(mask);
    const why = this.#reason(reason);

    const target = await db.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, status: true },
    });
    if (target === null) throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'No such member.');

    await db.user.update({ where: { id: target.id }, data: { status: 'active' } });

    await this.#record(db, {
      actorId,
      action: 'unban',
      targetType: 'user',
      targetId: targetUserId,
      targetUserId,
      reason: why,
      expiresAt: null,
      appealThreadId: null,
      before: { status: target.status },
      after: { status: 'active' },
    });
  }

  /**
   * A member's moderation history. Moderators only.
   *
   * Not shown to the member themselves through this path: somebody reading their own record should
   * see the sanction that applies to them (which `assertMayPost` tells them) rather than a list of
   * every note a moderator has ever written about them.
   */
  async historyFor(
    db: AclBoundClient,
    targetUserId: string,
    mask: bigint,
  ): Promise<Array<{ action: string; reason: string; createdAt: string; actorHandle: string }>> {
    this.#assertModerator(mask);

    const rows = await db.moderationAction.findMany({
      where: { targetUserId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        action: true,
        reason: true,
        createdAt: true,
        actor: { select: { handle: true } },
      },
    });

    return rows.map((r) => ({
      action: r.action,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      actorHandle: r.actor.handle,
    }));
  }
}
