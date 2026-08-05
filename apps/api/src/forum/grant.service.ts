import { AppError, ErrorCode, Permission } from '@grims/shared';
import type { AclBoundClient } from '../authz/acl-db.service.js';
import { satisfiesMask } from './category.service.js';

/**
 * Per-thread read access for a named user (INV-002).
 *
 * ★ THE ONLY THING IN THE FORUM THAT WIDENS ACCESS ★
 *
 * Squadron owner, 2026-07-29: "officers category should only be visible to
 * officers. non-officers should not have the ability to view unless permission to a
 * specific user is provided this should be done from a dropdown on the post that
 * allows an admin to allow access to one or more users (multi select dropdown that
 * is searchable and autocompletable)".
 *
 * Everything else narrows. `viewPerm` narrows, `isAtLeastAsRestrictive` narrows,
 * `isPublic` narrows. This lets a named individual past a category ACL they do not
 * satisfy, which makes it the highest-risk write in the module and the reason for
 * the four rules below.
 *
 * ★ THE FOUR RULES, AND WHY EACH ONE EXISTS ★
 *
 *   1. The granter must hold FORUM_MODERATE.
 *      The "admin" in the instruction. Without it this is a self-service bypass.
 *
 *   2. The granter must be able to SEE the thread.
 *      The rule that actually closes the hole. Rule 1 alone would let a moderator
 *      who cannot read the officers' board grant somebody else access to it —
 *      handing out a key to a room you have never been in. Enforced by reading the
 *      thread through the granter's OWN bound client, so an invisible thread is
 *      indistinguishable from a missing one.
 *
 *   3. The grantee must be an active account.
 *      "all forum users must be in our discord" (same day). A grant to a banned or
 *      departed account would sit there waiting to become live again.
 *
 *   4. A grant conveys READ ONLY.
 *      Posting is still decided by the category's `post_perm`. Somebody invited to
 *      read an officers' thread cannot reply in it — being shown something is not
 *      being given a voice in it.
 */

/** What the UI needs to render one existing grant. */
export interface GrantView {
  readonly userId: string;
  readonly handle: string;
  readonly displayName: string | null;
  readonly grantedAt: string;
  /** Who issued it. Shown so the list is reviewable rather than anonymous. */
  readonly grantedByHandle: string;
  readonly reason: string | null;
}

/** A candidate for the autocomplete. Deliberately minimal — see `search`. */
export interface GranteeCandidate {
  readonly userId: string;
  readonly handle: string;
  readonly displayName: string | null;
  /** True when this user can already see the thread without a grant. */
  readonly alreadyHasAccess: boolean;
  /** A path on our own API, or null. Used by the mention autocomplete; absent for grants. */
  readonly avatarUrl?: string | null;
}

export class GrantService {
  /**
   * Existing grants on a thread.
   *
   * Read through the CALLER's bound client, so a caller who cannot see the thread
   * gets an empty list rather than the names of people who can. The grant list of an
   * invisible thread is itself information about that thread.
   */
  async list(db: AclBoundClient, threadId: string): Promise<GrantView[]> {
    const thread = await db.forumThread.findFirst({
      where: { id: threadId },
      select: { id: true },
    });
    if (thread === null) {
      /*
       * `RESOURCE_NOT_VISIBLE`, the codebase's purpose-built cloak (INV-024): it
       * maps to a 404 so that a caller cannot tell "does not exist" from "exists and
       * is not yours". A 403 here would confirm the thread is real, which on the
       * officers' board is the whole thing being protected.
       */
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Thread not found.');
    }

    const rows = await db.forumThreadGrant.findMany({
      where: { threadId },
      select: {
        userId: true,
        grantedAt: true,
        reason: true,
        user: { select: { handle: true, displayName: true } },
        granter: { select: { handle: true } },
      },
      orderBy: { grantedAt: 'asc' },
    });

    return rows.map((r) => ({
      userId: r.userId,
      handle: r.user.handle,
      displayName: r.user.displayName,
      grantedAt: r.grantedAt.toISOString(),
      grantedByHandle: r.granter.handle,
      reason: r.reason,
    }));
  }

  /**
   * Candidates for the "add people" dropdown.
   *
   * ★ WHY THIS SEARCHES AND DOES NOT LIST EVERYONE ★
   *
   * The instruction asks for a dropdown that is "searchable and autocompletable",
   * and the obvious implementation is to ship every member to the browser and filter
   * there. That would publish the full membership roster — handles, display names —
   * to anybody who can open a thread page, which is a roster leak dressed up as a UI
   * convenience. So the filtering happens HERE and the response is capped.
   *
   * ★ AND WHY IT REFUSES A SHORT QUERY ★
   *
   * A one-character query returns a large slice of the roster, and an EMPTY query
   * returns all of it — which is the same leak with more steps. Two characters
   * minimum, and an empty result rather than an error, so the UI can show "keep
   * typing" without treating it as a failure.
   */
  async search(
    db: AclBoundClient,
    threadId: string,
    query: string,
    granterMask: bigint,
  ): Promise<GranteeCandidate[]> {
    this.#assertMayGrant(granterMask);

    const thread = await this.#visibleThread(db, threadId);

    const q = query.trim();
    if (q.length < 2) return [];

    const rows = await db.user.findMany({
      where: {
        status: 'active',
        OR: [
          { handle: { contains: q, mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        handle: true,
        displayName: true,
        userRoles: { select: { role: { select: { permMask: true } } } },
        threadGrantsReceived: { where: { threadId }, select: { threadId: true } },
      },
      // Capped. A dropdown cannot usefully show more, and an uncapped LIKE over the
      // roster is both a leak and a slow query.
      take: 20,
      orderBy: { handle: 'asc' },
    });

    return rows.map((u) => {
      /*
       * Whether this person can ALREADY see the thread, so the UI can say so instead
       * of letting an admin issue a grant that changes nothing.
       *
       * `toFixed(0)`, never `toString()`: permMask is NUMERIC(40,0) and Prisma maps
       * it to a Decimal whose toString() switches to exponential notation at 1e21 —
       * and ALL_PERMISSIONS is 1.19e21, so every all-permission role is over that
       * line and `BigInt(...)` would throw.
       */
      const mask = u.userRoles.reduce(
        (acc, ur) => acc | BigInt(ur.role.permMask.toFixed(0)),
        0n,
      );
      const inherited = satisfiesMask(mask, thread.categoryViewPerm);
      const granted = u.threadGrantsReceived.length > 0;

      return {
        userId: u.id,
        handle: u.handle,
        displayName: u.displayName,
        alreadyHasAccess: inherited || granted,
      };
    });
  }

  /**
   * Grants one or more users read access to a thread.
   *
   * Takes a LIST because the instruction asks for a multi-select, and issuing five
   * grants as five requests would leave a half-applied set when the third fails.
   * Written in one transaction so the set applies or does not.
   */
  async grant(
    db: AclBoundClient,
    threadId: string,
    userIds: readonly string[],
    granterId: string,
    granterMask: bigint,
    reason: string | null,
  ): Promise<GrantView[]> {
    this.#assertMayGrant(granterMask);
    await this.#visibleThread(db, threadId);

    const ids = [...new Set(userIds)];
    if (ids.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Name at least one person to grant access to.');
    }
    if (ids.length > 25) {
      /*
       * A cap, because "grant to everyone" is what this must not become. Twenty-five
       * is far above any real use and far below the roster — an admin who needs more
       * than that wants the category's `view_perm` changed, which is a different and
       * more visible decision.
       */
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'That is more people than a per-thread grant is for. If a whole group needs this board, change the board instead.',
      );
    }

    /*
     * Rule 3: every grantee must be an active account. Checked as a SET before
     * writing anything — granting four of five and failing on the last would leave
     * an admin unsure what actually applied.
     */
    const active = await db.user.findMany({
      where: { id: { in: ids }, status: 'active' },
      select: { id: true },
    });
    if (active.length !== ids.length) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'One of those accounts is not active, so it cannot be given access.',
      );
    }

    await db.$transaction(
      ids.map((userId) =>
        /*
         * `upsert` rather than `create`, so re-granting is idempotent instead of a
         * primary-key error. The update deliberately touches only `reason` — the
         * original `grantedAt`/`grantedBy` stay put, because who first authorised
         * this is the fact the audit trail exists to keep.
         */
        db.forumThreadGrant.upsert({
          where: { threadId_userId: { threadId, userId } },
          create: { threadId, userId, grantedBy: granterId, reason },
          update: { reason },
        }),
      ),
    );

    return this.list(db, threadId);
  }

  /** Revokes a grant. Deleting the row is the whole operation. */
  async revoke(
    db: AclBoundClient,
    threadId: string,
    userId: string,
    granterMask: bigint,
  ): Promise<GrantView[]> {
    this.#assertMayGrant(granterMask);
    await this.#visibleThread(db, threadId);

    /*
     * `deleteMany` rather than `delete`, so revoking a grant that is already gone
     * succeeds instead of throwing. Two admins clicking the same X should not
     * produce an error for the slower one.
     */
    await db.forumThreadGrant.deleteMany({ where: { threadId, userId } });
    return this.list(db, threadId);
  }

  /** Rule 1. */
  #assertMayGrant(mask: bigint): void {
    if (!satisfiesMask(mask, Permission.FORUM_MODERATE)) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'Only a moderator can grant access to a thread.');
    }
  }

  /**
   * Who this member can usefully @mention in a thread.
   *
   * ★ FILTERED TO PEOPLE WHO CAN ACTUALLY READ IT ★
   *
   * An autocomplete over the whole roster is the obvious build and is quietly broken. Mentioning
   * somebody who cannot see the thread does NOTHING — the notification fan-out re-checks the mask
   * at send time (INV-039), so the mention is dropped and the author never learns it was. On the
   * officers' board that is the normal case, and "I tagged them and they never replied" is how it
   * would be discovered.
   *
   * So the same `inherited || granted` test the grant autocomplete uses decides the list. Somebody
   * who cannot read the thread is not offered, because offering them is offering a no-op.
   *
   * ★ NO FORUM_MODERATE HERE, DELIBERATELY ★
   *
   * `search` above requires it because granting access is an admin act. Mentioning is not — every
   * member does it. The check that DOES apply is rule 2: the thread is read through the caller's
   * own bound client, so somebody who cannot see a thread cannot enumerate who can.
   *
   * The result is not a disclosure beyond what the roster page already shows a signed-in member,
   * with one exception worth stating: on a restricted board, this reveals which members hold the
   * permission to read it. That is the same fact the thread's own reply list reveals, and the
   * alternative — an autocomplete that silently drops most of what it offers — is worse.
   */
  async mentionCandidates(
    db: AclBoundClient,
    threadId: string,
    query: string,
  ): Promise<GranteeCandidate[]> {
    const thread = await this.#visibleThread(db, threadId);

    const q = query.trim();
    // Two characters minimum, matching `search`: a one-character prefix is most of the roster.
    if (q.length < 2) return [];

    const rows = await db.user.findMany({
      where: {
        status: 'active',
        OR: [
          { handle: { contains: q, mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        handle: true,
        displayName: true,
        avatarStoredHash: true,
        userRoles: { select: { role: { select: { permMask: true } } } },
        threadGrantsReceived: { where: { threadId }, select: { threadId: true } },
      },
      // A dropdown cannot usefully show more, and an uncapped LIKE over the roster is both a
      // leak and a slow query.
      take: 10,
      orderBy: { handle: 'asc' },
    });

    return rows
      .map((u) => {
        /*
         * `toFixed(0)`, never `toString()`: permMask is NUMERIC(40,0) and Prisma maps it to a
         * Decimal whose toString() switches to exponential notation at 1e21 — ALL_PERMISSIONS is
         * 1.19e21, so every all-permission role is over that line and `BigInt(...)` would throw.
         */
        const mask = u.userRoles.reduce((acc, ur) => acc | BigInt(ur.role.permMask.toFixed(0)), 0n);
        const canRead =
          satisfiesMask(mask, thread.categoryViewPerm) || u.threadGrantsReceived.length > 0;
        return {
          userId: u.id,
          handle: u.handle,
          displayName: u.displayName,
          alreadyHasAccess: canRead,
          avatarUrl: u.avatarStoredHash === null ? null : `/v1/media/avatars/${u.id}`,
        };
      })
      .filter((c) => c.alreadyHasAccess);
  }

  /**
   * Rule 2, and the reason this whole file is safe.
   *
   * Reads the thread through the GRANTER's bound client. If the ACL predicate hides
   * it, `findFirst` returns null and there is nothing to grant — so a moderator who
   * cannot see the officers' board cannot hand out access to it, and no explicit
   * "is this the officers' board" check is needed anywhere.
   *
   * Also returns the category's `view_perm`, which `search` needs to tell an admin
   * who already has access.
   */
  async #visibleThread(
    db: AclBoundClient,
    threadId: string,
  ): Promise<{ id: string; categoryViewPerm: bigint | null }> {
    const thread = await db.forumThread.findFirst({
      where: { id: threadId, deletedAt: null },
      select: { id: true, category: { select: { viewPerm: true } } },
    });
    if (thread === null) {
      // Cloaked, for the reason spelled out in `list`.
      throw new AppError(ErrorCode.RESOURCE_NOT_VISIBLE, 'Thread not found.');
    }
    return {
      id: thread.id,
      categoryViewPerm:
        thread.category.viewPerm === null ? null : BigInt(thread.category.viewPerm.toFixed(0)),
    };
  }
}
