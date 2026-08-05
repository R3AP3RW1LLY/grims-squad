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
  /** Everything put on the live stream — `suggestions` badge pokes and bell nudges alike. */
  events: Array<{ type: string; userId: string | null }>;
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
    events: [],
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
    /*
     * `createViaPublish`, DELIBERATELY — the publish flow is the single caller allowed through
     * a `threads_via_publish` board, and a stub exposing plain `create` would let this suite
     * go green while the service used the door forum.spec.ts proves is shut.
     */
    createViaPublish: async (
      _db: unknown,
      input: Record<string, unknown>,
      authorId: string,
    ) => {
      rec.threadInputs.push(input);
      rec.threadAuthors.push(authorId);
      return { id: 'th1', slug: 'dark-mode-abc123', held: over.held ?? false };
    },
  } as unknown as ThreadService;

  // A recording live service, so the badge pokes can be asserted rather than assumed.
  const live = {
    publish: (e: { type: string; userId: string | null }) => {
      rec.events.push(e);
    },
  } as never;

  return { svc: new SuggestionsService(db, acl, permissions, threads, live), rec };
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

  it('a landed suggestion pokes the `suggestions` badge, squadron-wide', async () => {
    // The webmaster's tab pill is the whole bell — no per-suggestion notifications exist.
    const { svc, rec } = stub({});
    await svc.submit('member-1', 'Dark mode for the roster');
    expect(rec.events).toContainEqual({ type: 'suggestions', userId: null });
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

  it('MANDATORY: claims the row FIRST — conditionally on still being new — then stamps the thread', async () => {
    /*
     * The order is the fix for the duplicate-thread race: the conditional claim resolves the
     * two-webmasters race BEFORE any thread exists, so the loser never creates one. The
     * thread id is stamped in a second write once the thread has landed.
     */
    const { svc, rec } = stub({});
    await svc.publish('webmaster-1', 's1');

    expect(rec.updates[0]).toMatchObject({
      where: { id: 's1', status: 'new' },
      data: { status: 'published', reviewedById: 'webmaster-1' },
    });
    // The claim carries NO thread id — nothing exists yet to name.
    expect(rec.updates[0]?.data['publishedThreadId']).toBeUndefined();
    expect(rec.updates[0]?.data['reviewedAt']).toBeInstanceOf(Date);

    expect(rec.updates[1]).toMatchObject({
      where: { id: 's1', status: 'published' },
      data: { publishedThreadId: 'th1' },
    });
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
    expect(rec.updates).toHaveLength(2); // Claim and stamp both land: the thread exists.
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

  it('MANDATORY: a racing colleague wins the conditional claim and the loser creates NOTHING', async () => {
    const { svc, rec } = stub({ updateCount: 0 });
    await expect(svc.publish('webmaster-1', 's1')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    // The whole point of claiming first: the loser is told before any thread exists, so the
    // race can no longer mint a duplicate for a moderator to clean up.
    expect(rec.threadInputs).toHaveLength(0);
    // And no bell for a publish that did not claim the row.
    expect(rec.notifications).toHaveLength(0);
  });

  it('MANDATORY: two concurrent publishes attempt exactly ONE thread creation', async () => {
    /*
     * The race itself, not a stand-in: both callers pass the pre-read (both see `new`), and
     * the stateful conditional update — the database's semantics, modelled honestly — lets
     * exactly one through. The other is refused BEFORE ThreadService is touched.
     */
    const { svc, rec } = stub({});
    let status = 'new';
    const db = (svc as unknown as { db: { suggestion: Record<string, unknown> } }).db;
    db.suggestion['updateMany'] = async (a: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      rec.updates.push(a);
      if (a.where['status'] === 'new') {
        if (status !== 'new') return { count: 0 }; // The claim: only one winner.
        status = 'published';
        return { count: 1 };
      }
      return { count: 1 }; // The stamp.
    };

    const results = await Promise.allSettled([
      svc.publish('webmaster-1', 's1'),
      svc.publish('webmaster-2', 's1'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    // ONE thread was ever attempted — the loser lost before creating anything.
    expect(rec.threadInputs).toHaveLength(1);
    expect(rec.notifications).toHaveLength(1);
  });

  it('MANDATORY: a thread creation failure RELEASES the claim — the suggestion is not stranded', async () => {
    const { svc, rec } = stub({});
    const threads = (svc as unknown as { threads: Record<string, unknown> }).threads;
    threads['createViaPublish'] = async () => {
      throw new Error('screening is down');
    };

    await expect(svc.publish('webmaster-1', 's1')).rejects.toThrow('screening is down');

    // The claim went on, and came off: back to `new`, review stamp cleared, queue intact.
    expect(rec.updates[0]).toMatchObject({
      where: { id: 's1', status: 'new' },
      data: { status: 'published' },
    });
    expect(rec.updates[1]).toMatchObject({
      where: { id: 's1', status: 'published', publishedThreadId: null, reviewedById: 'webmaster-1' },
      data: { status: 'new', reviewedAt: null, reviewedById: null },
    });
    // Nobody was told about a thread that never landed.
    expect(rec.notifications).toHaveLength(0);
  });

  it('MANDATORY: no Feature Requests board means a plain refusal — never a board invented here', async () => {
    const { svc, rec } = stub({ category: null });
    await expect(svc.publish('webmaster-1', 's1')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    expect(rec.threadInputs).toHaveLength(0);
    // And nothing was claimed: the board check precedes the claim, so a missing board never
    // takes a suggestion out of the queue.
    expect(rec.updates).toHaveLength(0);
  });

  it("a verdict pokes the `suggestions` badge — the queue shrank on every other webmaster's console", async () => {
    const { svc, rec } = stub({});
    await svc.publish('webmaster-1', 's1');
    expect(rec.events.filter((e) => e.type === 'suggestions')).toEqual([
      { type: 'suggestions', userId: null },
    ]);
  });
});

describe('the inbox badge', () => {
  it('is a bare count of what awaits a verdict', async () => {
    const { svc } = stub({});
    const wheres: Array<Record<string, unknown>> = [];
    const db = (svc as unknown as { db: { suggestion: Record<string, unknown> } }).db;
    db.suggestion['count'] = async (a: { where: Record<string, unknown> }) => {
      wheres.push(a.where);
      return 3;
    };

    await expect(svc.inboxBadge()).resolves.toEqual({ waiting: 3 });
    // Counted in the WHERE, never filtered after — the cheap read the tab re-runs on a nudge.
    expect(wheres).toEqual([{ status: 'new' }]);
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
    // And the queue shrank, so every other webmaster's badge is poked too.
    expect(rec.events).toContainEqual({ type: 'suggestions', userId: null });
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
