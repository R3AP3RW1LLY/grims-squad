import { describe, it, expect } from 'vitest';
import { ThreadService } from './thread.service.js';
import { CategoryService } from './category.service.js';
import { PendingReindexQueue } from './reindex.port.js';
import { NotifyService } from './notify.service.js';

/**
 * What a board row is allowed to say (P2 — CIG-style rows).
 *
 * ★ THESE ARE DISCLOSURE TESTS, NOT FORMATTING TESTS ★
 *
 * A richer row means more fields leaving the server, and two of them are the kind that look
 * harmless until they are not:
 *
 *   - `avatarUrl` must be OUR path. A Discord CDN address here would report every reader of every
 *     board to a third party, and `img-src 'self'` would break the image rather than the privacy —
 *     so the failure would be visible as "broken avatars" long after the decision was made.
 *   - `viewCount` must only move for a thread the caller was allowed to read. A counter that ticks
 *     on a refused read is an oracle for whether a private thread exists, which is exactly what
 *     `bySlug`'s uniform 404 exists to prevent.
 *
 * The third is smaller but is the one people notice: a thread with no replies must not name a "last
 * poster", because a row that shows the same person twice reads as a conversation that has not
 * happened.
 */

const AUTHOR = {
  id: 'u-author',
  handle: 'grim',
  displayName: 'Grim',
  avatarStoredHash: 'abc123',
};
const REPLIER = {
  id: 'u-replier',
  handle: 'pebble',
  displayName: 'Pebblemerchant',
  avatarStoredHash: null,
};

function svc(): ThreadService {
  return new ThreadService(new CategoryService(), new PendingReindexQueue(), new NotifyService());
}

/** A bound client that yields one thread and records every write attempted against it. */
function clientWith(
  thread: Record<string, unknown> | null,
  category: Record<string, unknown> = {
    id: 'c1',
    parentId: null,
    slug: 'general',
    name: 'General',
    description: null,
    position: 0,
    isLocked: false,
    // Prisma hands back a Decimal; only `.toFixed(0)` is safe on it, so the fake exposes just that.
    postPerm: null,
  },
) {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    forumCategory: {
      findMany: async () => [category],
    },
    // The unread-count query runs for a signed-in caller; none of these tests pass a user id,
    // but the model still has to exist on the fake for `list` to reach the end.
    forumCategoryRead: {
      findMany: async () => [],
    },
    // Present so `postsFor` can run end to end; the posts themselves are not what these test.
    forumPost: { findMany: async () => [] },
    forumReaction: { groupBy: async () => [], findMany: async () => [] },
    forumThread: {
      findFirst: async () => thread,
      findMany: async () => (thread === null ? [] : [thread]),
      groupBy: async () => [],
      count: async () => 0,
      update: async ({ where, data }: { where: unknown; data: unknown }) => {
        updates.push({ where, data });
        return {};
      },
    },
  };
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    categoryId: 'c1',
    slug: 'a-thread',
    title: 'A thread',
    kind: 'discussion',
    isPinned: false,
    isLocked: false,
    postCount: 1,
    viewCount: 7,
    lastPostAt: null,
    lastPostBy: null,
    createdAt: new Date('2026-07-30T10:00:00Z'),
    authorId: AUTHOR.id,
    author: {
      handle: AUTHOR.handle,
      displayName: AUTHOR.displayName,
      avatarStoredHash: AUTHOR.avatarStoredHash,
    },
    lastPoster: null,
    ...over,
  };
}

describe('what a board row discloses', () => {
  describe('avatars', () => {
    it('MANDATORY: the avatar is a path on our own API, never a third-party address', async () => {
      const db = clientWith(row());
      const view = await svc().bySlug(db as never, 'general', 'a-thread', 0n);

      expect(view.author.avatarUrl).toBe(`/v1/media/avatars/${AUTHOR.id}`);
      // Asserted as an absence too: a future refactor that emitted Discord's URL would still
      // START with a slash if someone stored a path, so the hostile shape is named directly.
      expect(view.author.avatarUrl).not.toContain('discord');
      expect(view.author.avatarUrl).not.toContain('http');
    });

    it('MANDATORY: a member with no stored avatar gets null, not a hash', async () => {
      /*
       * `avatarStoredHash` and the misleadingly-named `avatarUrl` column both hold hashes. Emitting
       * either as a URL would produce a broken image AND leak Discord's asset id — this pins that
       * the absent case is a clean null the client can render initials for.
       */
      const db = clientWith(
        row({
          authorId: REPLIER.id,
          author: {
            handle: REPLIER.handle,
            displayName: REPLIER.displayName,
            avatarStoredHash: null,
          },
        }),
      );
      const view = await svc().bySlug(db as never, 'general', 'a-thread', 0n);
      expect(view.author.avatarUrl).toBeNull();
    });
  });

  describe('the last poster', () => {
    it('MANDATORY: is null when nobody has replied', async () => {
      const view = await svc().bySlug(clientWith(row()) as never, 'general', 'a-thread', 0n);
      expect(view.lastPoster).toBeNull();
    });

    it('MANDATORY: is null when the only poster IS the author', async () => {
      // The author replying to their own thread must not make the row show them on both ends.
      const db = clientWith(
        row({
          postCount: 3,
          lastPostBy: AUTHOR.id,
          lastPoster: {
            id: AUTHOR.id,
            handle: AUTHOR.handle,
            displayName: AUTHOR.displayName,
            avatarStoredHash: AUTHOR.avatarStoredHash,
          },
        }),
      );
      const view = await svc().bySlug(db as never, 'general', 'a-thread', 0n);
      expect(view.lastPoster).toBeNull();
    });

    it('names a genuinely different last poster, with their own avatar', async () => {
      const db = clientWith(
        row({
          postCount: 2,
          lastPostBy: REPLIER.id,
          lastPoster: { ...REPLIER },
        }),
      );
      const view = await svc().bySlug(db as never, 'general', 'a-thread', 0n);
      expect(view.lastPoster?.displayName).toBe('Pebblemerchant');
      expect(view.lastPoster?.avatarUrl).toBeNull();
    });

    it('survives a deleted account without losing the thread', async () => {
      /*
       * The relation is `onDelete: SetNull`, so a departed member leaves `lastPostBy` set and the
       * join empty. That must read as "no distinct last poster" rather than throwing — a thread
       * outliving its last replier is normal, not an error.
       */
      const db = clientWith(row({ postCount: 4, lastPostBy: 'u-gone', lastPoster: null }));
      const view = await svc().bySlug(db as never, 'general', 'a-thread', 0n);
      expect(view.lastPoster).toBeNull();
      expect(view.postCount).toBe(4);
    });
  });

  describe('the view counter', () => {
    /*
     * ★ COUNTED BY THE ROUTE, NOT BY THE LOOKUP ★
     *
     * The increment used to live inside `bySlug` and double-counted every page view, because
     * `postsFor` resolves the thread through `bySlug` as its ACL step — and `markSolution` does
     * too, so marking an answer counted as reading. `recordView` is separate for that reason, and
     * these tests pin both halves: the lookup does not count, and the counter does not run for a
     * thread the caller could not read.
     */
    it('MANDATORY: reading a thread does not itself count a view', async () => {
      const db = clientWith(row());
      await svc().bySlug(db as never, 'general', 'a-thread', 0n);
      await Promise.resolve();
      expect(db.updates).toHaveLength(0);
    });

    it('MANDATORY: fetching the posts does not count a second view', async () => {
      // The regression that prompted the split: one page view produced two increments.
      const db = clientWith(row());
      await svc().postsFor(db as never, 'general', 'a-thread', 0n, null);
      await Promise.resolve();
      expect(db.updates).toHaveLength(0);
    });

    it('increments by exactly one when the route records a view', async () => {
      const db = clientWith(row());
      await svc().recordView(db as never, 't1');

      expect(db.updates).toHaveLength(1);
      expect(db.updates[0]).toMatchObject({
        where: { id: 't1' },
        data: { viewCount: { increment: 1 } },
      });
    });

    it('MANDATORY: a failing counter does not throw', async () => {
      /*
       * A view count is the least important thing on the page. If the write fails — a lock, replica
       * lag, a dead connection — the member must still get their thread. The controller does not
       * await this, so a rejection would also be an unhandled one, which is a spectacular way to
       * lose a forum over a number nobody checks.
       */
      const db = clientWith(row());
      db.forumThread.update = async () => {
        throw new Error('database on fire');
      };
      await expect(svc().recordView(db as never, 't1')).resolves.toBeUndefined();
    });

    it('reports the count it read, not the count after any bump', async () => {
      const view = await svc().bySlug(
        clientWith(row({ viewCount: 7 })) as never,
        'general',
        'a-thread',
        0n,
      );
      expect(view.viewCount).toBe(7);
    });
  });
});
