import { describe, expect, it } from 'vitest';
import { ErrorCode, Permission } from '@grims/shared';
import type { PrismaClient } from '@grims/db';
import type { AclDbService } from '../authz/acl-db.service.js';
import type { PermissionService } from '../authz/permission.service.js';
import type { ThreadService } from '../forum/thread.service.js';
import { SuggestionsService } from './suggestions.service.js';
import { SUGGESTION_MAX_CHARS } from './suggestion-box.js';

/**
 * The service, against recording stubs — the support.service.spec shape.
 *
 * ★ WHAT MATTERS HERE ★
 *
 * Publish creates the thread THROUGH ThreadService as the webmaster (never a second code path),
 * credits the sender in the opening post, stamps published_thread_id, and rings the sender's
 * bell; decline stamps the review and tells them kindly; the cap holds at the door; and a
 * member's list is scoped to them in the query itself.
 */

interface Recorded {
  suggestions: Array<Record<string, unknown>>;
  updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
  notifications: Array<Record<string, unknown>>;
  threadInputs: Array<Record<string, unknown>>;
  threadAuthors: string[];
}

const SENDER = { id: 'member-1', displayName: 'Halsey' };

function stub(over: {
  suggestionRow?: Record<string, unknown> | null;
  updateCount?: number;
  held?: boolean;
  category?: Record<string, unknown> | null;
}): { svc: SuggestionsService; rec: Recorded } {
  const rec: Recorded = {
    suggestions: [],
    updates: [],
    notifications: [],
    threadInputs: [],
    threadAuthors: [],
  };

  const db = {
    suggestion: {
      create: async (a: { data: Record<string, unknown> }) => {
        rec.suggestions.push(a.data);
        return { id: 's1' };
      },
      findFirst: async () =>
        over.suggestionRow === undefined
          ? { id: 's1', status: 'new', body: 'Dark mode for the roster', user: SENDER }
          : over.suggestionRow,
      findMany: async () => [],
      updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        rec.updates.push(a);
        return { count: over.updateCount ?? 1 };
      },
    },
    notification: {
      createMany: async (a: { data: Array<Record<string, unknown>> }) => {
        rec.notifications.push(...a.data);
        return { count: a.data.length };
      },
    },
  } as unknown as PrismaClient;

  const bound = {
    forumCategory: {
      findFirst: async () =>
        over.category === undefined
          ? { id: 'cat-fr', slug: 'feature-requests' }
          : over.category,
    },
    forumThread: { findMany: async () => [] },
  };
  const acl = { forCaller: async () => bound } as unknown as AclDbService;

  const permissions = {
    effectiveMask: async () => Permission.SITE_CONFIG,
  } as unknown as PermissionService;

  const threads = {
    create: async (
      _db: unknown,
      input: Record<string, unknown>,
      authorId: string,
    ) => {
      rec.threadInputs.push(input);
      rec.threadAuthors.push(authorId);
      return { id: 'th1', slug: 'dark-mode-abc123', held: over.held ?? false };
    },
  } as unknown as ThreadService;

  return { svc: new SuggestionsService(db, acl, permissions, threads), rec };
}

describe('the member door', () => {
  it('MANDATORY: the cap holds server-side — nothing over 2000 reaches the database', async () => {
    const { svc, rec } = stub({});
    await expect(svc.submit('member-1', 'a'.repeat(SUGGESTION_MAX_CHARS + 1))).rejects.toMatchObject(
      { code: ErrorCode.VALIDATION_FAILED },
    );
    expect(rec.suggestions).toHaveLength(0);
  });

  it('a clean suggestion lands, owned by the SESSION user', async () => {
    const { svc, rec } = stub({});
    const created = await svc.submit('member-1', 'Dark mode for the roster');
    expect(created.id).toBe('s1');
    expect(rec.suggestions[0]).toMatchObject({ userId: 'member-1' });
  });

  it("MANDATORY: a member's list is scoped to them in the query itself", async () => {
    const wheres: Array<Record<string, unknown>> = [];
    const { svc } = stub({});
    // Reach into the stub: findMany records its where.
    const db = (svc as unknown as { db: { suggestion: Record<string, unknown> } }).db;
    db.suggestion['findMany'] = async (a: { where: Record<string, unknown> }) => {
      wheres.push(a.where);
      return [];
    };

    await svc.listMine('member-1');
    expect(wheres).toEqual([{ userId: 'member-1' }]);
  });
});

describe('publish — one click, one real thread, one credited sender', () => {
  it('MANDATORY: creates the thread through ThreadService AS the webmaster, crediting the sender', async () => {
    const { svc, rec } = stub({});
    const result = await svc.publish('webmaster-1', 's1');

    // Through the one thread-creation path, authored by the webmaster's own account.
    expect(rec.threadAuthors).toEqual(['webmaster-1']);
    const input = rec.threadInputs[0] as { title: string; body: string; categoryId: string };
    expect(input.categoryId).toBe('cat-fr');
    // The opening post carries the suggestion text and credits the suggester by display name.
    expect(input.body).toContain('Suggested by Halsey');
    expect(input.body).toContain('Dark mode for the roster');
    expect(input.title).toBe('Dark mode for the roster');

    expect(result.threadLink).toBe('/forum/feature-requests/dark-mode-abc123');
    expect(result.held).toBe(false);
  });

  it('MANDATORY: stamps published_thread_id, the verdict and the reviewer — conditionally on still being new', async () => {
    const { svc, rec } = stub({});
    await svc.publish('webmaster-1', 's1');

    expect(rec.updates[0]).toMatchObject({
      where: { id: 's1', status: 'new' },
      data: { status: 'published', reviewedById: 'webmaster-1', publishedThreadId: 'th1' },
    });
    expect(rec.updates[0]?.data['reviewedAt']).toBeInstanceOf(Date);
  });

  it("MANDATORY: rings the sender's bell — kind suggestion.published, linking the thread", async () => {
    const { svc, rec } = stub({});
    await svc.publish('webmaster-1', 's1');

    expect(rec.notifications).toHaveLength(1);
    expect(rec.notifications[0]).toMatchObject({
      userId: 'member-1',
      kind: 'suggestion.published',
      link: '/forum/feature-requests/dark-mode-abc123',
    });
  });

  it('a HELD opening post publishes the row but rings no bell — the link would land on an empty page', async () => {
    const { svc, rec } = stub({ held: true });
    const result = await svc.publish('webmaster-1', 's1');

    expect(result.held).toBe(true);
    expect(rec.updates).toHaveLength(1); // The stamp still lands: the thread exists.
    expect(rec.notifications).toHaveLength(0);
  });

  it('MANDATORY: an already-reviewed suggestion is refused with a stale-screen sentence', async () => {
    const { svc } = stub({
      suggestionRow: { id: 's1', status: 'published', body: 'x', user: SENDER },
    });
    await expect(svc.publish('webmaster-1', 's1')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
  });

  it('a racing colleague wins the conditional stamp and the loser is told, not doubled', async () => {
    const { svc, rec } = stub({ updateCount: 0 });
    await expect(svc.publish('webmaster-1', 's1')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    // No bell for a publish that did not claim the row.
    expect(rec.notifications).toHaveLength(0);
  });

  it('MANDATORY: no Feature Requests board means a plain refusal — never a board invented here', async () => {
    const { svc, rec } = stub({ category: null });
    await expect(svc.publish('webmaster-1', 's1')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    expect(rec.threadInputs).toHaveLength(0);
  });
});

describe('decline — reviewed, told, box still open', () => {
  it('MANDATORY: stamps the verdict and notifies the sender kindly', async () => {
    const { svc, rec } = stub({});
    await svc.decline('webmaster-1', 's1');

    expect(rec.updates[0]).toMatchObject({
      where: { id: 's1', status: 'new' },
      data: { status: 'declined', reviewedById: 'webmaster-1' },
    });
    expect(rec.notifications[0]).toMatchObject({
      userId: 'member-1',
      kind: 'suggestion.declined',
    });
    // Honest, and kind: read by a person, not taken up, and the box has not closed on them.
    expect(String(rec.notifications[0]?.['body'])).toContain('send the next one');
  });

  it('declining the declined is a stale screen, and says so', async () => {
    const { svc } = stub({
      suggestionRow: { id: 's1', status: 'declined', body: 'x', user: SENDER },
    });
    await expect(svc.decline('webmaster-1', 's1')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
  });
});
