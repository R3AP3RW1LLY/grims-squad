import { describe, it, expect } from 'vitest';
import { Permission, ErrorCode } from '@grims/shared';
import { ThreadService } from './thread.service.js';
import { CategoryService } from './category.service.js';
import { PendingReindexQueue } from './reindex.port.js';
import { NotifyService } from './notify.service.js';

/**
 * Marking the answer (P2 — best-reply float).
 *
 * ★ THE THREE RULES WORTH PINNING ★
 *
 * 1. WHO. The member who asked, or a moderator. Not the author of the reply — a "mark my own post
 *    as the answer" button is a status game, and this squadron is 107 people who all see it.
 * 2. WHERE. The post must be IN this thread. Without that check a caller could pass any post id
 *    they can see and have it marked as the answer to a thread it has nothing to do with.
 * 3. HOW MANY. One per thread. Two answers is the same as none, because a reader scanning for the
 *    marker finds both and has to read both anyway.
 *
 * Rule 2 is the one that looks like paranoia and is not: the same mistake was already possible on
 * `replyToId`, which is why `PostService` scopes its lookup the same way.
 */

const ASKER = 'u-asker';
const HELPER = 'u-helper';
const MOD_MASK = Permission.FORUM_MODERATE;

function svc(): ThreadService {
  return new ThreadService(new CategoryService(), new PendingReindexQueue(), new NotifyService());
}

function client(opts: {
  threadAuthorId?: string;
  /** Posts that exist IN this thread. A post id absent from here is in some other thread. */
  postsInThread?: readonly string[];
}) {
  const authorId = opts.threadAuthorId ?? ASKER;
  const inThread = opts.postsInThread ?? ['p1', 'p2'];
  const tx: unknown[][] = [];
  const updateMany: Array<Record<string, unknown>> = [];
  const update: Array<Record<string, unknown>> = [];

  return {
    tx,
    updateMany,
    update,
    forumCategory: {
      findMany: async () => [
        {
          id: 'c1',
          parentId: null,
          slug: 'help',
          name: 'Help',
          description: null,
          position: 0,
          isLocked: false,
          postPerm: null,
        },
      ],
    },
    forumCategoryRead: { findMany: async () => [] },
    forumThread: {
      findFirst: async ({ select }: { select?: Record<string, unknown> }) => {
        // The second call asks only for `authorId`; the first is the full row for `bySlug`.
        if (select?.['authorId'] === true && select['id'] === undefined) return { authorId };
        return {
          id: 't1',
          categoryId: 'c1',
          slug: 'how-do-i',
          title: 'How do I',
          kind: 'question',
          isPinned: false,
          isLocked: false,
          postCount: 3,
          viewCount: 0,
          lastPostAt: null,
          lastPostBy: null,
          createdAt: new Date('2026-07-30T10:00:00Z'),
          authorId,
          author: { handle: 'asker', displayName: 'Asker', avatarStoredHash: null },
          lastPoster: null,
        };
      },
      update: async () => ({}),
    },
    forumPost: {
      findFirst: async ({ where }: { where: { id: string; threadId: string } }) =>
        where.threadId === 't1' && inThread.includes(where.id) ? { id: where.id } : null,
      updateMany: (args: Record<string, unknown>) => {
        updateMany.push(args);
        return args;
      },
      update: (args: Record<string, unknown>) => {
        update.push(args);
        return args;
      },
    },
    $transaction: async (ops: unknown[]) => {
      tx.push(ops);
      return [];
    },
  };
}

describe('marking the answer', () => {
  describe('who may', () => {
    it('MANDATORY: the member who started the thread may', async () => {
      const db = client({});
      await svc().markSolution(db as never, 'help', 'how-do-i', 'p2', {
        userId: ASKER,
        mask: 0n,
      });
      expect(db.tx).toHaveLength(1);
    });

    it('MANDATORY: a moderator may, even though they did not ask', async () => {
      const db = client({});
      await svc().markSolution(db as never, 'help', 'how-do-i', 'p2', {
        userId: 'u-mod',
        mask: MOD_MASK,
      });
      expect(db.tx).toHaveLength(1);
    });

    it('MANDATORY: an ordinary member may not, including the reply author', async () => {
      /*
       * THE POINT OF THE RULE. `HELPER` wrote p2 — the post being marked. If writing the reply were
       * enough, "mark my own answer" would be a button every member has on their own posts.
       */
      const db = client({});
      await expect(
        svc().markSolution(db as never, 'help', 'how-do-i', 'p2', { userId: HELPER, mask: 0n }),
      ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
      expect(db.tx).toHaveLength(0);
    });

    it('MANDATORY: a member holding OTHER permissions is not a moderator', async () => {
      // Holding some bits is not holding FORUM_MODERATE. The check is an equality on the masked
      // value, not a truthiness test — a `&` that is merely non-zero would pass anybody.
      const db = client({});
      await expect(
        svc().markSolution(db as never, 'help', 'how-do-i', 'p2', {
          userId: HELPER,
          mask: Permission.FORUM_POST_MEMBER | Permission.FORUM_VIEW_OFFICER,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
      expect(db.tx).toHaveLength(0);
    });
  });

  describe('which post', () => {
    it('MANDATORY: a post from another thread cannot be marked', async () => {
      /*
       * `p9` exists somewhere the caller can see, but not here. Marking it would attach an answer
       * to a thread whose author never chose it — and would do so through an endpoint that only
       * checked "are you the author of the thread you named".
       */
      const db = client({ postsInThread: ['p1', 'p2'] });
      await expect(
        svc().markSolution(db as never, 'help', 'how-do-i', 'p9', { userId: ASKER, mask: 0n }),
      ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_NOT_VISIBLE });
      expect(db.tx).toHaveLength(0);
    });
  });

  describe('how many', () => {
    it('MANDATORY: setting an answer clears any existing one first', async () => {
      const db = client({});
      await svc().markSolution(db as never, 'help', 'how-do-i', 'p2', { userId: ASKER, mask: 0n });

      // Two operations, in one transaction: clear the thread, then set this post.
      expect(db.tx[0]).toHaveLength(2);
      expect(db.updateMany[0]).toMatchObject({
        where: { threadId: 't1', isSolution: true },
        data: { isSolution: false },
      });
      expect(db.update[0]).toMatchObject({
        where: { id: 'p2' },
        data: { isSolution: true },
      });
    });

    it('un-marking clears without setting anything', async () => {
      const db = client({});
      await svc().markSolution(
        db as never,
        'help',
        'how-do-i',
        'p2',
        { userId: ASKER, mask: 0n },
        false,
      );
      expect(db.tx[0]).toHaveLength(1);
      expect(db.update).toHaveLength(0);
    });

    it('MANDATORY: clear and set are one transaction', async () => {
      /*
       * Separately, a failure between them leaves a thread with NO answer when it had one — the
       * member's mark silently disappears because somebody else's mark failed to apply.
       */
      const db = client({});
      await svc().markSolution(db as never, 'help', 'how-do-i', 'p1', { userId: ASKER, mask: 0n });
      expect(db.tx).toHaveLength(1);
    });
  });

  describe('the capability flag the UI reads', () => {
    it('MANDATORY: is false for a signed-out reader', async () => {
      const view = await svc().bySlug(client({}) as never, 'help', 'how-do-i', 0n, null);
      expect(view.canMarkSolution).toBe(false);
    });

    it('is true for the asker and for a moderator, false for anybody else', async () => {
      const s = svc();
      const asker = await s.bySlug(client({}) as never, 'help', 'how-do-i', 0n, ASKER);
      const mod = await s.bySlug(client({}) as never, 'help', 'how-do-i', MOD_MASK, 'u-mod');
      const other = await s.bySlug(client({}) as never, 'help', 'how-do-i', 0n, HELPER);

      expect(asker.canMarkSolution).toBe(true);
      expect(mod.canMarkSolution).toBe(true);
      expect(other.canMarkSolution).toBe(false);
    });
  });
});
