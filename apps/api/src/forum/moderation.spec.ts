import { describe, it, expect, vi } from 'vitest';
import { ErrorCode, Permission } from '@grims/shared';
import { ModerationService } from './moderation.service.js';
import { PostService } from './post.service.js';
import type { AclBoundClient } from '../authz/acl-db.service.js';
import type { ReindexQueue } from './reindex.port.js';

/**
 * Moderation (P2.6, INV-009).
 *
 * ★ TWO THINGS ARE BEING TESTED, AND THE SECOND IS THE ONE THAT MATTERS ★
 *
 * That the actions work, and that they are AUDITED. INV-009 asks for an audit row with actor,
 * action, target and before/after on every privileged action — and the easy way to satisfy a
 * schema while answering no question is to write a label into both `before` and `after`. So the
 * assertions below are about the CONTENT of those columns, not their presence.
 */

const MODERATOR = Permission.FORUM_MODERATE;

interface Recorded {
  moderation: Array<Record<string, unknown>>;
  audit: Array<Record<string, unknown>>;
  updates: Array<Record<string, unknown>>;
}

function stubDb(over: Record<string, unknown> = {}): { db: AclBoundClient; rec: Recorded } {
  const rec: Recorded = { moderation: [], audit: [], updates: [] };

  const db = {
    forumThread: {
      findFirst: async () => ({ id: 't1', isLocked: false, isPinned: false, authorId: 'author-1' }),
      update: vi.fn(async (a: { data: Record<string, unknown> }) => {
        rec.updates.push(a.data);
        return {};
      }),
    },
    user: {
      findUnique: async () => ({ id: 'target-1', status: 'active' }),
      update: vi.fn(async (a: { data: Record<string, unknown> }) => {
        rec.updates.push(a.data);
        return {};
      }),
    },
    moderationAction: {
      create: (a: { data: Record<string, unknown> }) => {
        rec.moderation.push(a.data);
        return a;
      },
      findMany: async () => [],
    },
    auditLog: {
      create: (a: { data: Record<string, unknown> }) => {
        rec.audit.push(a.data);
        return a;
      },
    },
    $transaction: async (ops: unknown[]) => ops,
    ...over,
  };

  return { db: db as unknown as AclBoundClient, rec };
}

describe('INV-009 — every action is audited, with REAL before and after', () => {
  it('MANDATORY @INV-009: locking writes an audit row whose diff is the actual change', async () => {
    /*
     * The temptation is `before: {action:'lock'}, after: {action:'lock'}` — schema satisfied,
     * question unanswered. A reviewer needs to see what CHANGED, including the case where a
     * moderator locked something already locked, which is exactly what somebody claiming "I never
     * touched it" would produce.
     */
    const { db, rec } = stubDb();
    await new ModerationService().setLocked(db, 't1', true, 'mod-1', MODERATOR, 'Off topic');

    expect(rec.audit).toHaveLength(1);
    expect(rec.audit[0]).toMatchObject({
      actorId: 'mod-1',
      action: 'moderation.lock',
      targetType: 'thread',
      targetId: 't1',
      before: { isLocked: false },
      after: { isLocked: true },
    });
  });

  it('MANDATORY @INV-009: EVERY action writes exactly one audit row', async () => {
    /*
     * Walked rather than spot-checked. An action added later that forgets the audit row is exactly
     * the regression INV-009 exists to prevent, and a test naming four of seven would not catch it.
     */
    const svc = new ModerationService();
    const cases: Array<[string, () => Promise<unknown>]> = [];

    for (const [name, run] of [
      ['lock', (d: AclBoundClient) => svc.setLocked(d, 't1', true, 'mod-1', MODERATOR, 'reason')],
      ['unlock', (d: AclBoundClient) => svc.setLocked(d, 't1', false, 'mod-1', MODERATOR, 'reason')],
      ['pin', (d: AclBoundClient) => svc.setPinned(d, 't1', true, 'mod-1', MODERATOR, 'reason')],
      ['unpin', (d: AclBoundClient) => svc.setPinned(d, 't1', false, 'mod-1', MODERATOR, 'reason')],
      ['warn', (d: AclBoundClient) => svc.warn(d, 'target-1', 'mod-1', MODERATOR, 'reason')],
      ['mute', (d: AclBoundClient) => svc.mute(d, 'target-1', 24, 'mod-1', MODERATOR, 'reason')],
      ['ban', (d: AclBoundClient) => svc.ban(d, 'target-1', 'mod-1', MODERATOR, 'reason', null)],
      ['unban', (d: AclBoundClient) => svc.unban(d, 'target-1', 'mod-1', MODERATOR, 'reason')],
    ] as const) {
      const { db, rec } = stubDb();
      await run(db);

      expect(rec.audit, name).toHaveLength(1);
      expect(rec.moderation, name).toHaveLength(1);
      expect(rec.audit[0]?.['action'], name).toBe(`moderation.${name}`);
      // The diff is populated on every one of them.
      expect(rec.audit[0]?.['before'], name).toBeDefined();
      expect(rec.audit[0]?.['after'], name).toBeDefined();
      cases.push([name, async () => undefined]);
    }

    expect(cases).toHaveLength(8);
  });

  it('MANDATORY: the moderation record and the audit row are ONE transaction', async () => {
    /*
     * A moderation record without an audit row is invisible to a security review; an audit row
     * without a moderation record leaves a muted member with no explanation. Neither may exist
     * alone.
     */
    const transaction = vi.fn(async (ops: unknown[]) => ops);
    const { db } = stubDb({ $transaction: transaction });

    await new ModerationService().warn(db, 'target-1', 'mod-1', MODERATOR, 'Being unpleasant');

    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction.mock.calls[0]?.[0]).toHaveLength(2);
  });
});

describe('a reason is required, and the member is shown it', () => {
  it('MANDATORY: refuses an action with no reason', async () => {
    /*
     * A moderation record with no reason is useless to the next moderator and unanswerable to the
     * member it is about. A nullable column would be filled with "." within a week, so it is
     * enforced at the boundary.
     */
    const svc = new ModerationService();
    for (const reason of [undefined, '', '  ', 'x', 42]) {
      const { db } = stubDb();
      await expect(
        svc.warn(db, 'target-1', 'mod-1', MODERATOR, reason),
        String(reason),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    }
  });

  it('the refusal says the member will see it', async () => {
    const { db } = stubDb();
    await expect(
      new ModerationService().warn(db, 'target-1', 'mod-1', MODERATOR, ''),
    ).rejects.toThrow(/member will be shown/i);
  });
});

describe('only a moderator', () => {
  it('MANDATORY: every action refuses a non-moderator', async () => {
    const svc = new ModerationService();
    const { db } = stubDb();

    for (const [name, run] of [
      ['lock', () => svc.setLocked(db, 't1', true, 'u', 0n, 'r')],
      ['pin', () => svc.setPinned(db, 't1', true, 'u', 0n, 'r')],
      ['warn', () => svc.warn(db, 'target-1', 'u', 0n, 'r')],
      ['mute', () => svc.mute(db, 'target-1', 1, 'u', 0n, 'r')],
      ['ban', () => svc.ban(db, 'target-1', 'u', 0n, 'r', null)],
      ['unban', () => svc.unban(db, 'target-1', 'u', 0n, 'r')],
      ['history', () => svc.historyFor(db, 'target-1', 0n)],
    ] as const) {
      await expect(run(), name).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
    }
  });
});

describe('mutes expire and bans do not', () => {
  it('MANDATORY: a mute demands a duration', async () => {
    /*
     * A mute with no end is a ban wearing a smaller word, and the difference matters to the person
     * it lands on. Requiring a duration is what stops "temporary" sanctions quietly becoming
     * permanent because nobody remembered to lift them.
     */
    const svc = new ModerationService();
    for (const hours of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 24 * 91]) {
      const { db } = stubDb();
      await expect(
        svc.mute(db, 'target-1', hours, 'mod-1', MODERATOR, 'reason'),
        String(hours),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    }
  });

  it('says a long mute should be called a ban', async () => {
    /*
     * The message teaches the distinction rather than just refusing the number.
     *
     * A VALID reason is passed deliberately: the reason check runs first, so a one-character reason
     * would fail on that instead and this test would pass for the wrong reason — which it did until
     * the assertion caught it.
     */
    const { db } = stubDb();
    await expect(
      new ModerationService().mute(db, 'target-1', 24 * 91, 'mod-1', MODERATOR, 'Persistent spam'),
    ).rejects.toThrow(/should be called one/i);
  });

  it('an EXPIRED mute is no longer in force', async () => {
    const { db } = stubDb({
      moderationAction: {
        create: (a: unknown) => a,
        findMany: async () => [
          {
            action: 'mute',
            reason: 'old',
            expiresAt: new Date(Date.now() - 60_000),
            appealThreadId: null,
          },
        ],
      },
    });

    expect(await new ModerationService().activeSanction(db, 'u1')).toBeNull();
  });

  it('a LIVE mute is in force, and carries its end time', async () => {
    const expiresAt = new Date(Date.now() + 3_600_000);
    const { db } = stubDb({
      moderationAction: {
        create: (a: unknown) => a,
        findMany: async () => [
          { action: 'mute', reason: 'Spamming', expiresAt, appealThreadId: null },
        ],
      },
    });

    const sanction = await new ModerationService().activeSanction(db, 'u1');
    expect(sanction).toMatchObject({ action: 'mute', reason: 'Spamming' });
    expect(sanction?.expiresAt).toBe(expiresAt.toISOString());
  });

  it('MANDATORY: an unban clears the sanction, and the history survives', async () => {
    /*
     * Recorded as its own action rather than by deleting the ban — a moderation history that can be
     * erased by the next action is not a history.
     */
    const { db } = stubDb({
      moderationAction: {
        create: (a: unknown) => a,
        findMany: async () => [
          { action: 'unban', reason: 'Appeal upheld', expiresAt: null, appealThreadId: null },
        ],
      },
    });

    expect(await new ModerationService().activeSanction(db, 'u1')).toBeNull();
  });

  it('a ban sets the account status, which is what actually removes access', async () => {
    /*
     * `computeEffectiveMask` returns NO_PERMISSIONS for a banned account, so this one field is what
     * removes their access everywhere. The moderation row explains it; the status enforces it.
     */
    const { db, rec } = stubDb();
    await new ModerationService().ban(db, 'target-1', 'mod-1', MODERATOR, 'Repeated abuse', 'appeal-1');

    expect(rec.updates).toContainEqual({ status: 'banned' });
    expect(rec.moderation[0]).toMatchObject({ appealThreadId: 'appeal-1' });
  });
});

describe('a mute actually stops posting', () => {
  const openThread = {
    id: 't1',
    isLocked: false,
    category: { postPerm: { toFixed: () => '8' }, isLocked: false },
  };

  function postDb() {
    return {
      forumThread: { findFirst: async () => openThread, update: vi.fn(async () => ({})) },
      forumPost: { create: vi.fn(async () => ({ id: 'p1', bodyHtml: '<p>x</p>', editCount: 0 })) },
    } as unknown as AclBoundClient;
  }

  const queue: ReindexQueue = { enqueue: async () => undefined };

  it('MANDATORY: a muted member is refused, and told why and until when', async () => {
    /*
     * P2.6's acceptance is explicit: "a muted user cannot post and is told why and until when". A
     * member told only "forbidden" will ask an officer, who will have to go and look it up.
     */
    const expiresAt = new Date(Date.now() + 3_600_000);
    const moderation = {
      assertMayPost: async () => {
        await new ModerationService().assertMayPost(
          {
            moderationAction: {
              findMany: async () => [
                { action: 'mute', reason: 'Spamming links', expiresAt, appealThreadId: null },
              ],
            },
          } as unknown as AclBoundClient,
          'u1',
        );
      },
    };

    const svc = new PostService(queue, moderation as never);

    await expect(
      svc.create(postDb(), 't1', 'hello', 'u1', 8n),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });

    await expect(svc.create(postDb(), 't1', 'hello', 'u1', 8n)).rejects.toThrow(/Spamming links/);
    await expect(svc.create(postDb(), 't1', 'hello', 'u1', 8n)).rejects.toThrow(/lifts on/i);
  });

  it('MANDATORY: the mute is checked AFTER the board permission', async () => {
    /*
     * Ordering, deliberately. Telling a non-officer they are "muted" from the officers' board would
     * be both wrong and confusing — they cannot post there regardless, and that is what they should
     * be told.
     */
    const assertMayPost = vi.fn(async () => undefined);
    const svc = new PostService(queue, { assertMayPost } as never);

    // Mask 0 fails the board's postPerm of 8.
    await expect(svc.create(postDb(), 't1', 'hi', 'u1', 0n)).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
    });

    expect(assertMayPost).not.toHaveBeenCalled();
  });

  it('an unsanctioned member posts normally', async () => {
    const svc = new PostService(queue, { assertMayPost: async () => undefined } as never);
    await expect(svc.create(postDb(), 't1', 'hello', 'u1', 8n)).resolves.toMatchObject({ id: 'p1' });
  });
});
