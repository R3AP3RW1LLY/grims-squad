import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@grims/shared';
import type { PrismaClient } from '@grims/db';
import type { AclDbService } from '../authz/acl-db.service.js';
import { RoadmapService } from './roadmap.service.js';

/**
 * The kanban's writes and the board's read scope, against recording stubs.
 *
 * ★ WHAT MATTERS HERE ★
 *
 * A move renumbers the affected column(s) whole and transactionally; promote only accepts
 * Feature Requests threads, lands in Ideas, and is idempotent on the thread; and the board's
 * thread links resolve through the CALLER'S bound client, so a card never carries an address
 * its reader cannot open.
 */

interface CardRow {
  id: string;
  title: string;
  body: string | null;
  column: string;
  position: number;
  sourceThreadId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function card(id: string, column: string, position: number, over: Partial<CardRow> = {}): CardRow {
  return {
    id,
    title: `Card ${id}`,
    body: null,
    column,
    position,
    sourceThreadId: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

interface Recorded {
  updates: Array<{ where: { id: string }; data: Record<string, unknown> }>;
  creates: Array<Record<string, unknown>>;
  transactions: number;
  boundThreadQueries: Array<Record<string, unknown>>;
}

function stub(
  cards: CardRow[],
  visibleThreads: Array<{
    id: string;
    slug: string;
    categorySlug: string;
    /** The board's display name, for the slug-or-name resolution. Defaults to the slug. */
    categoryName?: string;
  }> = [],
) {
  const rec: Recorded = { updates: [], creates: [], transactions: 0, boundThreadQueries: [] };

  const matches = (row: CardRow, where: Record<string, unknown>): boolean => {
    if ('id' in where) {
      const id = where['id'];
      if (typeof id === 'string' && row.id !== id) return false;
      if (typeof id === 'object' && id !== null && 'not' in (id as object)) {
        if (row.id === (id as { not: string }).not) return false;
      }
    }
    if ('column' in where && row.column !== where['column']) return false;
    if ('archivedAt' in where) {
      const want = where['archivedAt'];
      if (want === null && row.archivedAt !== null) return false;
      if (typeof want === 'object' && want !== null && row.archivedAt === null) return false;
    }
    if ('sourceThreadId' in where && row.sourceThreadId !== where['sourceThreadId']) return false;
    return true;
  };

  const db = {
    roadmapCard: {
      findMany: async (a: { where: Record<string, unknown> }) =>
        cards
          .filter((c) => matches(c, a.where))
          .sort((x, y) => x.position - y.position),
      findFirst: async (a: { where: Record<string, unknown> }) =>
        cards.find((c) => matches(c, a.where)) ?? null,
      count: async (a: { where: Record<string, unknown> }) =>
        cards.filter((c) => matches(c, a.where)).length,
      create: async (a: { data: Record<string, unknown> }) => {
        rec.creates.push(a.data);
        return card('new-card', String(a.data['column'] ?? 'ideas'), Number(a.data['position'] ?? 0), {
          title: String(a.data['title'] ?? ''),
          sourceThreadId: (a.data['sourceThreadId'] as string | undefined) ?? null,
        });
      },
      update: (a: { where: { id: string }; data: Record<string, unknown> }) => {
        // Recorded lazily so $transaction can count what it was handed.
        rec.updates.push(a);
        return Promise.resolve({});
      },
    },
    $transaction: async (writes: unknown[]) => {
      rec.transactions += 1;
      return Promise.all(writes as Array<Promise<unknown>>);
    },
  } as unknown as PrismaClient;

  const bound = {
    forumThread: {
      findMany: async (a: Record<string, unknown>) => {
        rec.boundThreadQueries.push(a);
        return visibleThreads.map((t) => ({
          id: t.id,
          slug: t.slug,
          category: { slug: t.categorySlug },
        }));
      },
      findFirst: async (a: { where: { id: string } }) => {
        const t = visibleThreads.find((v) => v.id === a.where.id);
        return t === undefined
          ? null
          : {
              id: t.id,
              title: `Thread ${t.id}`,
              category: { slug: t.categorySlug, name: t.categoryName ?? t.categorySlug },
            };
      },
    },
  };
  const acl = { forCaller: async () => bound } as unknown as AclDbService;

  return { svc: new RoadmapService(db, acl), rec };
}

describe('moves are column + position writes, renumbered whole', () => {
  it('MANDATORY: moving within a column rewrites every position 0..n in ONE transaction', async () => {
    const { svc, rec } = stub([card('a', 'ideas', 0), card('b', 'ideas', 1), card('c', 'ideas', 2)]);

    await svc.move('c', 'ideas', 0);

    expect(rec.transactions).toBe(1);
    const byId = new Map(rec.updates.map((u) => [u.where.id, u.data]));
    expect(byId.get('c')).toMatchObject({ column: 'ideas', position: 0 });
    expect(byId.get('a')).toMatchObject({ position: 1 });
    expect(byId.get('b')).toMatchObject({ position: 2 });
  });

  it('MANDATORY: moving across columns renumbers BOTH columns — the source keeps no gap', async () => {
    const { svc, rec } = stub([
      card('a', 'ideas', 0),
      card('b', 'ideas', 1),
      card('c', 'ideas', 2),
      card('p', 'planned', 0),
    ]);

    await svc.move('b', 'planned', 0);

    const byId = new Map(rec.updates.map((u) => [u.where.id, u.data]));
    expect(byId.get('b')).toMatchObject({ column: 'planned', position: 0 });
    expect(byId.get('p')).toMatchObject({ position: 1 });
    // The column it left closes up: a, c become 0, 1.
    expect(byId.get('a')).toMatchObject({ position: 0 });
    expect(byId.get('c')).toMatchObject({ position: 1 });
  });

  it('a made-up column is refused by name', async () => {
    const { svc } = stub([card('a', 'ideas', 0)]);
    await expect(svc.move('a', 'someday', 0)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
  });

  it('an archived card cannot be moved — absent and archived are ONE answer', async () => {
    const { svc } = stub([card('a', 'ideas', 0, { archivedAt: new Date() })]);
    await expect(svc.move('a', 'planned', 0)).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_VISIBLE,
    });
  });
});

describe('archive leaves the board, not the history', () => {
  it('archives with a stamp, and the board read no longer lists it', async () => {
    const rows = [card('a', 'ideas', 0), card('b', 'ideas', 1, { archivedAt: new Date() })];
    const { svc, rec } = stub(rows);

    await svc.archive('a');
    expect(rec.updates[0]?.where.id).toBe('a');
    expect(rec.updates[0]?.data['archivedAt']).toBeInstanceOf(Date);

    const board = await svc.board('member-1');
    expect(board.map((c) => c.id)).toEqual(['a']); // 'b' is archived; the stub does not apply writes.
  });

  it('restore puts the card at the END of the column it left from', async () => {
    const { svc, rec } = stub([
      card('a', 'planned', 0),
      card('z', 'planned', 1, { archivedAt: new Date() }),
    ]);

    await svc.restore('z');
    expect(rec.updates[0]?.data).toMatchObject({ archivedAt: null, position: 1 });
  });
});

describe('promote to board', () => {
  it('MANDATORY: a Feature Requests thread lands in Ideas, titled from the thread, linked by source', async () => {
    const { svc, rec } = stub(
      [card('a', 'ideas', 0)],
      [{ id: 'th1', slug: 'dark-mode-abc', categorySlug: 'feature-requests' }],
    );

    const result = await svc.promote('webmaster-1', 'th1');

    expect(result.alreadyPromoted).toBe(false);
    expect(rec.creates[0]).toMatchObject({
      title: 'Thread th1',
      column: 'ideas',
      position: 1, // After the existing Ideas card.
      sourceThreadId: 'th1',
    });
  });

  it('MANDATORY: a thread from any other board is refused — the roadmap tracks what was voted for', async () => {
    const { svc, rec } = stub([], [{ id: 'th2', slug: 'general-chat', categorySlug: 'general' }]);
    await expect(svc.promote('webmaster-1', 'th2')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    expect(rec.creates).toHaveLength(0);
  });

  it('MANDATORY: promoting twice answers with the EXISTING card, never a duplicate', async () => {
    const { svc, rec } = stub(
      [card('a', 'building', 0, { sourceThreadId: 'th1' })],
      [{ id: 'th1', slug: 'dark-mode-abc', categorySlug: 'feature-requests' }],
    );

    const result = await svc.promote('webmaster-1', 'th1');
    expect(result.alreadyPromoted).toBe(true);
    expect(result.card.id).toBe('a');
    expect(rec.creates).toHaveLength(0);
  });

  it('a thread the webmaster cannot see answers like no thread at all', async () => {
    const { svc } = stub([], []);
    await expect(svc.promote('webmaster-1', 'th-hidden')).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_VISIBLE,
    });
  });

  it('the board is recognised by NAME too, however the slug was re-cut — the publish resolution', async () => {
    const { svc, rec } = stub(
      [],
      [{ id: 'th3', slug: 'asks', categorySlug: 'asks', categoryName: 'Feature Requests' }],
    );
    await expect(svc.promote('webmaster-1', 'th3')).resolves.toMatchObject({
      alreadyPromoted: false,
    });
    expect(rec.creates).toHaveLength(1);
  });
});

describe('the thread page panel — cardForThread answers for ANY thread, server-resolved', () => {
  it('MANDATORY: a Feature Requests thread is promotable; its card rides along when it has one', async () => {
    const { svc } = stub(
      [card('a', 'building', 0, { sourceThreadId: 'th1' })],
      [
        { id: 'th1', slug: 'dark-mode-abc', categorySlug: 'feature-requests' },
        { id: 'th2', slug: 'voice-attack', categorySlug: 'feature-requests' },
      ],
    );

    // Promoted: the panel shows where it sits on the board.
    await expect(svc.cardForThread('webmaster-1', 'th1')).resolves.toEqual({
      promotable: true,
      card: { id: 'a', column: 'building' },
    });
    // Not yet promoted: the panel shows the promote button.
    await expect(svc.cardForThread('webmaster-1', 'th2')).resolves.toEqual({
      promotable: true,
      card: null,
    });
  });

  it('MANDATORY: a thread on any OTHER board gets promotable false — the page draws no panel', async () => {
    /*
     * The fix for the URL-literal comparison: the page now asks about every thread, and the
     * SERVER answers with the same slug-or-name resolution publish uses. A general-board
     * thread earns no panel however its URL reads.
     */
    const { svc } = stub([], [{ id: 'th4', slug: 'chat', categorySlug: 'general' }]);
    await expect(svc.cardForThread('webmaster-1', 'th4')).resolves.toEqual({
      promotable: false,
      card: null,
    });
  });

  it('a thread the caller cannot see answers exactly like a non-board thread', async () => {
    // Read through the CALLER's bound client: invisible and "not that board" are one answer,
    // so the panel's absence discloses nothing.
    const { svc } = stub([], []);
    await expect(svc.cardForThread('webmaster-1', 'th-hidden')).resolves.toEqual({
      promotable: false,
      card: null,
    });
  });

  it('the board is recognised by NAME here too — rename the slug and the panel survives', async () => {
    const { svc } = stub(
      [],
      [{ id: 'th5', slug: 'asks', categorySlug: 'asks', categoryName: 'Feature Requests' }],
    );
    await expect(svc.cardForThread('webmaster-1', 'th5')).resolves.toMatchObject({
      promotable: true,
    });
  });
});

describe('the board read', () => {
  it('MANDATORY: thread links resolve through the CALLER, and an invisible thread yields no link', async () => {
    const { svc, rec } = stub(
      [
        card('a', 'ideas', 0, { sourceThreadId: 'th-visible' }),
        card('b', 'ideas', 1, { sourceThreadId: 'th-hidden' }),
      ],
      [{ id: 'th-visible', slug: 'dark-mode-abc', categorySlug: 'feature-requests' }],
    );

    const board = await svc.board('member-1');

    expect(board.find((c) => c.id === 'a')?.threadLink).toBe(
      '/forum/feature-requests/dark-mode-abc',
    );
    // The card still shows — board content is not gated — but carries no address its reader
    // cannot open.
    expect(board.find((c) => c.id === 'b')?.threadLink).toBeNull();
    expect(rec.boundThreadQueries).toHaveLength(1);
  });
});
