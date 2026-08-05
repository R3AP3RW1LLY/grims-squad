import { describe, it, expect, vi } from 'vitest';
import { ErrorCode, Permission } from '@grims/shared';
import { ReviewQueueService } from './review-queue.service.js';

/**
 * The queue where held posts stop being held.
 *
 * ★ WHY IT SHIPPED WITH SCREENING RATHER THAN AFTER IT ★
 *
 * Screening holds posts. A queue nobody can work is just a way of deleting posts slowly — so the
 * thing that releases them is not a follow-up, it is the other half of the feature.
 */

const REVIEWER = Permission.AI_REVIEW;

function db(rows: Array<Record<string, unknown>> = []) {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    forumPost: {
      // The argument is declared so `mock.calls[0][0]` — which several tests assert on — types.
      findMany: vi.fn(async (_args?: Record<string, unknown>) => rows),
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r['id'] === where.id) ?? null,
      ),
      count: vi.fn(async () => rows.length),
      update: vi.fn(async (args: Record<string, unknown>) => {
        updates.push(args);
        return {};
      }),
    },
  };
}

const heldRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  threadId: 't1',
  bodyHtml: '<p>hello</p>',
  screenVerdict: null,
  createdAt: new Date('2026-07-30T10:00:00Z'),
  author: { handle: 'grim', displayName: 'Grim' },
  thread: { title: 'A thread', category: { slug: 'general' } },
  ...over,
});

describe('who may review', () => {
  it('MANDATORY: refuses somebody without AI_REVIEW', async () => {
    const svc = new ReviewQueueService();
    await expect(svc.held(db() as never, 0n)).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
    });
  });

  it('MANDATORY: holding OTHER permissions is not enough', async () => {
    /*
     * An equality on the masked value, not a truthiness test. A `&` that is merely non-zero would
     * let anybody holding any permission at all read the queue.
     */
    const svc = new ReviewQueueService();
    await expect(
      svc.held(db() as never, Permission.FORUM_MODERATE | Permission.MEMBER_MANAGE),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
  });

  it('allows a reviewer', async () => {
    const svc = new ReviewQueueService();
    await expect(svc.held(db([heldRow()]) as never, REVIEWER)).resolves.toHaveLength(1);
  });
});

describe('what the reviewer sees', () => {
  it('MANDATORY: distinguishes flagged from unavailable', async () => {
    /*
     * A reader cannot tell these apart — deliberately, so the outcome does not leak whether the
     * model objected. An officer working a backlog absolutely must: forty posts held because a GPU
     * was off is a completely different afternoon from forty the model flagged.
     */
    const flagged = await new ReviewQueueService().held(
      db([
        heldRow({
          screenVerdict: { verdict: 'flagged', categories: ['harassment'], reason: 'Insult' },
        }),
      ]) as never,
      REVIEWER,
    );
    expect(flagged[0]).toMatchObject({ reason: 'flagged', categories: ['harassment'] });

    const down = await new ReviewQueueService().held(
      db([heldRow({ screenVerdict: { verdict: 'unavailable', categories: [], reason: null } })]) as never,
      REVIEWER,
    );
    expect(down[0]?.reason).toBe('unavailable');
  });

  it('MANDATORY: a post with no verdict reads as unavailable, not flagged', async () => {
    /*
     * It was held because nothing judged it. Presenting that as "the model flagged this" puts an
     * accusation on a post nobody objected to — and the officer would review it accordingly.
     */
    const out = await new ReviewQueueService().held(db([heldRow()]) as never, REVIEWER);
    expect(out[0]?.reason).toBe('unavailable');
    expect(out[0]?.categories).toEqual([]);
  });

  it('carries the model reason for the reviewer', async () => {
    const out = await new ReviewQueueService().held(
      db([heldRow({ screenVerdict: { verdict: 'flagged', categories: [], reason: 'Why' } })]) as never,
      REVIEWER,
    );
    expect(out[0]?.modelReason).toBe('Why');
  });

  it('MANDATORY: oldest first, so the queue drains', async () => {
    /*
     * Newest-first quietly abandons the bottom of the queue: the post that has waited longest is
     * furthest from anybody's attention, and its author is the one most likely to have given up.
     */
    const client = db([heldRow()]);
    await new ReviewQueueService().held(client as never, REVIEWER);
    expect(client.forumPost.findMany.mock.calls[0]?.[0]).toMatchObject({
      orderBy: { createdAt: 'asc' },
    });
  });

  it('only lists posts that are actually held and not deleted', async () => {
    const client = db([heldRow()]);
    await new ReviewQueueService().held(client as never, REVIEWER);
    expect(client.forumPost.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { screenState: 'held', deletedAt: null },
    });
  });
});

describe('deciding', () => {
  it('releasing publishes the post and records who did it', async () => {
    const client = db([heldRow()]);
    await new ReviewQueueService().decide(client as never, 'p1', 'release', {
      userId: 'officer-1',
      mask: REVIEWER,
    });

    expect(client.updates[0]).toMatchObject({
      where: { id: 'p1' },
      data: { screenState: 'clear', reviewedBy: 'officer-1' },
    });
  });

  it('MANDATORY: refusing keeps the post rather than deleting it', async () => {
    /*
     * This is a decision a human made about somebody's writing, and "we removed it" has to survive
     * the member asking why. The row and the text stay.
     */
    const client = db([heldRow()]);
    await new ReviewQueueService().decide(client as never, 'p1', 'refuse', {
      userId: 'officer-1',
      mask: REVIEWER,
    });

    expect(client.updates[0]).toMatchObject({ data: { screenState: 'refused' } });
    expect(JSON.stringify(client.updates[0])).not.toContain('deletedAt');
  });

  it('MANDATORY: the reviewer is the session user, never a parameter', async () => {
    // A moderation decision with no name against it is one nobody can be asked about.
    const client = db([heldRow()]);
    await new ReviewQueueService().decide(client as never, 'p1', 'release', {
      userId: 'officer-1',
      mask: REVIEWER,
    });
    const data = (client.updates[0] as { data: Record<string, unknown> }).data;
    expect(data['reviewedBy']).toBe('officer-1');
    expect(data['reviewedAt']).toBeInstanceOf(Date);
  });

  it('MANDATORY: a post already decided is not-found, not a distinct error', async () => {
    /*
     * Two officers working the same queue means one decides a post the other is still reading.
     * A distinct "already decided" would be more precise and would also confirm the post exists to
     * anybody probing ids.
     */
    await expect(
      new ReviewQueueService().decide(db([]) as never, 'p1', 'release', {
        userId: 'o',
        mask: REVIEWER,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_NOT_VISIBLE });
  });

  it('MANDATORY: refuses a decision from somebody without AI_REVIEW', async () => {
    await expect(
      new ReviewQueueService().decide(db([heldRow()]) as never, 'p1', 'release', {
        userId: 'nobody',
        mask: 0n,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
  });
});
