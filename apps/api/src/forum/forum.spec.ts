import { describe, it, expect, beforeEach } from 'vitest';
import { Permission, ErrorCode } from '@grims/shared';
import {
  CategoryService,
  isAtLeastAsRestrictive,
  satisfiesMask,
  assertSlug,
} from './category.service.js';
import { ThreadService, slugify } from './thread.service.js';
import { PendingReindexQueue } from './reindex.port.js';

/**
 * P2.1 — categories and threads.
 *
 * ★ WHAT THESE TESTS DELIBERATELY DO NOT RE-PROVE ★
 *
 * "A Ring 0 user cannot see, COUNT, or infer a Ring 1 category" is a property of
 * the BOUND CLIENT, proven in `authz/acl-db.service.spec.ts` — the predicate is
 * merged before the query reaches Prisma, so counts and aggregates are filtered
 * too. Re-asserting it here against a fake would test the fake.
 *
 * What these tests prove is the layer above: that this service only ever reads
 * through the client it was given, that a private category is a 404 rather than a
 * 403, and that the rules with no home in the data layer — parent permissiveness,
 * post permission, the reindex on move — actually hold.
 */

const OFFICER = Permission.FORUM_VIEW_OFFICER;
const MODERATE = Permission.FORUM_MODERATE;
const POST_MEMBER = Permission.FORUM_POST_MEMBER;

/**
 * A client that behaves like one already ACL-bound: it only returns the rows the
 * given principal may see. That is the contract `AclDbService` provides, so
 * modelling it here keeps these tests about THIS layer.
 */
function boundClient(
  rows: Array<{
    id: string;
    slug: string;
    name: string;
    viewPerm: bigint | null;
    postPerm: bigint | null;
    parentId?: string | null;
    isLocked?: boolean;
  }>,
  mask: bigint,
) {
  const visible = rows.filter((r) => satisfiesMask(mask, r.viewPerm));
  const dec = (v: bigint | null) => (v === null ? null : { toFixed: () => v.toString() });

  const created: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const threads: Array<Record<string, unknown>> = [];

  return {
    created,
    updated,
    threads,
    forumCategory: {
      findMany: async () =>
        visible.map((r) => ({
          id: r.id,
          parentId: r.parentId ?? null,
          slug: r.slug,
          name: r.name,
          description: null,
          position: 0,
          isLocked: r.isLocked ?? false,
          postPerm: dec(r.postPerm),
          viewPerm: dec(r.viewPerm),
        })),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const r = visible.find((x) => x.id === where.id);
        return r === undefined
          ? null
          : {
              id: r.id,
              isLocked: r.isLocked ?? false,
              postPerm: dec(r.postPerm),
              viewPerm: dec(r.viewPerm),
            };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 'new-category' };
      },
    },
    forumThread: {
      findMany: async () => [],
      findFirst: async () => null,
      findUnique: async ({ where }: { where: { id: string } }) =>
        threads.find((t) => t['id'] === where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        threads.push({ ...data, id: 'new-thread' });
        return { id: 'new-thread', slug: data['slug'] };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updated.push({ ...where, ...data });
        return {};
      },
    },
  };
}

const TREE = [
  { id: 'pub', slug: 'general', name: 'General', viewPerm: null, postPerm: POST_MEMBER },
  { id: 'off', slug: 'officers', name: 'Officers', viewPerm: OFFICER, postPerm: OFFICER },
];

describe('the rules with no home in the data layer', () => {
  describe('a child cannot be more permissive than its parent', () => {
    it('MANDATORY: a public child under a private parent is refused', () => {
      // Otherwise the category LIST is filtered correctly and the direct URL is
      // not — which looks right on the page people actually check.
      expect(isAtLeastAsRestrictive(null, OFFICER)).toBe(false);
    });

    it('allows a child that demands the same bits', () => {
      expect(isAtLeastAsRestrictive(OFFICER, OFFICER)).toBe(true);
    });

    it('allows a child that demands MORE', () => {
      expect(isAtLeastAsRestrictive(OFFICER | MODERATE, OFFICER)).toBe(true);
    });

    it('refuses a child that swaps one requirement for another', () => {
      // Holding MODERATE is not holding OFFICER. A child must demand every bit
      // the parent does, not merely "something".
      expect(isAtLeastAsRestrictive(MODERATE, OFFICER)).toBe(false);
    });

    it('a public parent accepts anything', () => {
      expect(isAtLeastAsRestrictive(OFFICER, null)).toBe(true);
      expect(isAtLeastAsRestrictive(null, null)).toBe(true);
    });
  });

  describe('slugs', () => {
    it('accepts what belongs in a URL', () => {
      expect(() => assertSlug('bgs-orders')).not.toThrow();
      expect(() => assertSlug('a1')).not.toThrow();
    });

    it('refuses what does not', () => {
      for (const bad of ['Has Capitals', 'trailing-', '-leading', 'double--hyphen', 'sp ace', '']) {
        expect(() => assertSlug(bad), bad).toThrow();
      }
      expect(() => assertSlug('x'.repeat(65))).toThrow();
    });

    it('slugify never produces an empty or colliding stem', () => {
      // A title of pure punctuation would otherwise slug to '' — and every empty
      // slug in a category collides with every other.
      expect(slugify('!!!')).toMatch(/^thread-[a-z0-9]{1,6}$/);
      expect(slugify('Wing ops tonight')).toMatch(/^wing-ops-tonight-[a-z0-9]{1,6}$/);
      // Two calls on the same title must differ, or two people posting at once
      // both lose to the unique index.
      expect(slugify('same title')).not.toBe(slugify('same title'));
    });
  });
});

describe('CategoryService', () => {
  const svc = new CategoryService();

  it('lists only what the bound client returned', async () => {
    const db = boundClient(TREE, 0n);
    const list = await svc.list(db as never, 0n);
    expect(list.map((c) => c.slug)).toEqual(['general']);
  });

  it('lists the officer category for an officer', async () => {
    const db = boundClient(TREE, OFFICER);
    const list = await svc.list(db as never, OFFICER);
    expect(list.map((c) => c.slug).sort()).toEqual(['general', 'officers']);
  });

  it('MANDATORY: sends canPost as a boolean and never the raw mask', async () => {
    // The mask would tell a member exactly which bit they lack — a map of the
    // permission model, handed to anybody who opens the network tab.
    const db = boundClient(TREE, POST_MEMBER);
    const list = await svc.list(db as never, POST_MEMBER);
    const general = list.find((c) => c.slug === 'general');

    expect(general?.canPost).toBe(true);
    expect(JSON.stringify(list)).not.toContain('postPerm');
    expect(JSON.stringify(list)).not.toContain('viewPerm');
  });

  it('reports canPost false in a locked category, whatever the mask', async () => {
    const db = boundClient(
      [{ ...TREE[0]!, isLocked: true }],
      POST_MEMBER,
    );
    const list = await svc.list(db as never, POST_MEMBER);
    expect(list[0]?.canPost).toBe(false);
  });

  it('MANDATORY: an invisible category is NOT FOUND, never forbidden', async () => {
    // A 403 confirms the category is real, and which private categories exist is
    // itself information (INV-024).
    const db = boundClient(TREE, 0n);
    await expect(svc.bySlug(db as never, 'officers', 0n)).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_VISIBLE,
    });
  });

  it('a missing category answers identically to a hidden one', async () => {
    const db = boundClient(TREE, 0n);
    const hidden = await svc.bySlug(db as never, 'officers', 0n).catch((e) => e.code);
    const absent = await svc.bySlug(db as never, 'does-not-exist', 0n).catch((e) => e.code);
    expect(hidden).toBe(absent);
  });

  describe('create', () => {
    it('refuses somebody without FORUM_MODERATE', async () => {
      const db = boundClient(TREE, POST_MEMBER);
      await expect(
        svc.create(db as never, { slug: 'new', name: 'New' }, POST_MEMBER),
      ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
    });

    it('MANDATORY: refuses a public child under a private parent', async () => {
      const db = boundClient(TREE, OFFICER | MODERATE);
      await expect(
        svc.create(
          db as never,
          { slug: 'leak', name: 'Leak', parentId: 'off', viewPerm: null },
          OFFICER | MODERATE,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });

    it('accepts a child at least as restrictive as its parent', async () => {
      const db = boundClient(TREE, OFFICER | MODERATE);
      await expect(
        svc.create(
          db as never,
          { slug: 'ops', name: 'Ops', parentId: 'off', viewPerm: OFFICER },
          OFFICER | MODERATE,
        ),
      ).resolves.toEqual({ id: 'new-category' });
    });

    it('cannot attach a child to a parent it cannot see', async () => {
      // Stops a lower-tier moderator hanging a category off an invisible branch,
      // where they could not then moderate whatever appeared in it.
      const db = boundClient(TREE, MODERATE);
      await expect(
        svc.create(db as never, { slug: 'x', name: 'X', parentId: 'off' }, MODERATE),
      ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_NOT_VISIBLE });
    });

    it('stores the mask as a decimal string, not a number', async () => {
      // NUMERIC(40,0) exceeds 64 bits; a JS number would silently drop the high
      // bits, which reads as a permission check quietly passing.
      const db = boundClient(TREE, MODERATE);
      await svc.create(db as never, { slug: 'q', name: 'Q', viewPerm: 1n << 100n }, MODERATE);
      expect(db.created[0]?.['viewPerm']).toBe((1n << 100n).toString());
    });
  });
});

describe('ThreadService', () => {
  let reindex: PendingReindexQueue;
  let svc: ThreadService;
  let pruned: Array<{ threadId: string; toCategoryId: string }>;

  beforeEach(() => {
    reindex = new PendingReindexQueue();
    pruned = [];
    /*
     * A recording NotifyService. `move` now prunes subscriptions the destination board excludes
     * (INV-039, second half), and it must do so in the SAME operation as the move — so the
     * dependency is real rather than optional, and this stub asserts the call happens.
     *
     * Deliberately not the real service: its own behaviour is covered exhaustively in
     * `notify.spec.ts`, and duplicating that here would mean two places to update when the rule
     * changes.
     */
    const notify = {
      pruneOnMove: async (_db: unknown, threadId: string, toCategoryId: string) => {
        pruned.push({ threadId, toCategoryId });
        return 0;
      },
    };
    svc = new ThreadService(new CategoryService(), reindex, notify as never);
  });

  it('MANDATORY: threads in an invisible category are NOT FOUND', async () => {
    const db = boundClient(TREE, 0n);
    await expect(svc.listByCategory(db as never, 'officers', 0n)).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_VISIBLE,
    });
  });

  it('MANDATORY: refuses to post without the category post permission', async () => {
    const db = boundClient(TREE, 0n);
    await expect(
      svc.create(db as never, { categoryId: 'pub', title: 'Hello there' }, 'author-1', 0n),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
  });

  it('refuses to post in a locked category', async () => {
    const db = boundClient([{ ...TREE[0]!, isLocked: true }], POST_MEMBER);
    await expect(
      svc.create(db as never, { categoryId: 'pub', title: 'Hello there' }, 'a', POST_MEMBER),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
  });

  it('MANDATORY: the author is the session user, never a request field', async () => {
    const db = boundClient(TREE, POST_MEMBER);
    await svc.create(
      db as never,
      { categoryId: 'pub', title: 'Wing ops tonight' },
      'session-user',
      POST_MEMBER,
    );
    expect(db.threads[0]?.['authorId']).toBe('session-user');
  });

  it('refuses a title that is too short or too long', async () => {
    const db = boundClient(TREE, POST_MEMBER);
    for (const title of ['ab', 'x'.repeat(201)]) {
      await expect(
        svc.create(db as never, { categoryId: 'pub', title }, 'a', POST_MEMBER),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    }
  });

  it('cannot post into a category it cannot see', async () => {
    const db = boundClient(TREE, POST_MEMBER);
    await expect(
      svc.create(db as never, { categoryId: 'off', title: 'Sneaking in' }, 'a', POST_MEMBER),
    ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_NOT_VISIBLE });
  });

  describe('move', () => {
    it('refuses somebody without FORUM_MODERATE', async () => {
      const db = boundClient(TREE, POST_MEMBER);
      await expect(svc.move(db as never, 't1', 'off', POST_MEMBER)).rejects.toMatchObject({
        code: ErrorCode.PERMISSION_DENIED,
      });
    });

    /*
     * ★ INV-003: THE ENQUEUE IS THE SECOND HALF OF THE MOVE ★
     *
     * Moving a thread from a public category to an officer one changes who may
     * read it — and knowledge chunks already indexed from its posts still carry
     * the OLD visibility. Until they are re-indexed, a Ring 0 retrieval can
     * surface officer content through search or the AI while the thread itself is
     * correctly hidden.
     */
    it('MANDATORY @INV-003: a move enqueues a reindex', async () => {
      const db = boundClient(TREE, OFFICER | MODERATE);
      db.threads.push({ id: 't1', categoryId: 'pub' });

      await svc.move(db as never, 't1', 'off', OFFICER | MODERATE);

      expect(db.updated[0]).toMatchObject({ id: 't1', categoryId: 'off' });
      expect(reindex.requests).toEqual([{ kind: 'thread', id: 't1', reason: 'moved' }]);

      /*
       * ★ AND IT PRUNES SUBSCRIPTIONS (INV-039, SECOND HALF) ★
       *
       * Asserted in the same test as the reindex because they are two halves of one operation. A
       * move that did one without the other leaves either stale search results or subscribers who
       * can no longer open the thread they are following — and the second is a disclosure, since a
       * notification carries the thread title.
       */
      expect(pruned).toEqual([{ threadId: 't1', toCategoryId: 'off' }]);
    });

    it('does NOT enqueue when the thread is already in that category', async () => {
      // Nothing moved, so nothing to re-index. An enqueue here would make the
      // queue depth a measure of how often somebody clicked, not of work to do.
      const db = boundClient(TREE, OFFICER | MODERATE);
      db.threads.push({ id: 't1', categoryId: 'pub' });

      await svc.move(db as never, 't1', 'pub', OFFICER | MODERATE);

      expect(db.updated).toEqual([]);
      expect(reindex.requests).toEqual([]);
    });

    it('cannot move a thread into a category it cannot see', async () => {
      const db = boundClient(TREE, MODERATE);
      db.threads.push({ id: 't1', categoryId: 'pub' });
      await expect(svc.move(db as never, 't1', 'off', MODERATE)).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_VISIBLE,
      });
    });
  });

  it('creating a thread enqueues a reindex too', async () => {
    const db = boundClient(TREE, POST_MEMBER);
    await svc.create(db as never, { categoryId: 'pub', title: 'New thread' }, 'a', POST_MEMBER);
    expect(reindex.requests).toEqual([
      { kind: 'thread', id: 'new-thread', reason: 'created' },
    ]);
  });
});
