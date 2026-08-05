import { describe, expect, it, beforeEach } from 'vitest';
import { CorpusService } from './corpus.service.js';
import { AppError, ErrorCode } from '@grims/shared';
import type { PrismaClient } from '@grims/db';

/**
 * The review queue — the half of "Help Train the Bot" that did not exist.
 *
 * ★ WHY THIS FILE OPENS WITH A COMPLAINT ★
 *
 * Squadron owner, 2026-08-05: "where do admins approve images that are submitted on the
 * /gmsd-ai/train page? i can not find it at all and we need this working! ... we have images
 * waiting to be approved!"
 *
 * Everything about the design was already in place. `AI_TRAINING`'s own definition read "webmaster
 * + AI_TRAINING holders approve". The schema carried `state`, `reviewNote`, `reviewedBy` and
 * `reviewedAt`, and its index comment read "the review queue: everything waiting, oldest first".
 * The uploader told members an officer would look at what they sent.
 *
 * There was no route, no service method and no page. So submissions accumulated in `pending` where
 * nothing on the platform could list them, and every test passed, because nothing tested for the
 * absence of a feature.
 *
 * These tests are about the RULES the queue has to keep, which is where it can quietly go wrong
 * once it exists.
 */

interface Row {
  id: string;
  state: string;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

/** A Prisma stand-in narrow enough to be honest about what the service actually calls. */
function fakeDb(rows: Row[]) {
  return {
    trainingImage: {
      async findMany({ where, orderBy, take }: any) {
        const matched = rows
          .filter((r) => r.state === where.state)
          .sort((a, b) =>
            orderBy.createdAt === 'asc'
              ? a.createdAt.getTime() - b.createdAt.getTime()
              : b.createdAt.getTime() - a.createdAt.getTime(),
          )
          .slice(0, take ?? rows.length);

        return matched.map((r) => ({
          id: r.id,
          uploadId: `upload-${r.id}`,
          category: 'ships',
          description: 'A Krait Mk II docked at an orbis starport, night side.',
          shipType: null,
          notes: null,
          createdAt: r.createdAt,
          user: { handle: 'cmdr', displayName: 'Cmdr', cmdrVerifications: [] },
        }));
      },
      async count({ where }: any) {
        return rows.filter((r) => r.state === where.state).length;
      },
      async updateMany({ where, data }: any) {
        const hit = rows.filter(
          (r) => r.id === where.id && (where.state === undefined || r.state === where.state),
        );
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      },
    },
  } as unknown as PrismaClient;
}

const at = (iso: string): Date => new Date(iso);

describe('the training image review queue', () => {
  let rows: Row[];
  let service: CorpusService;

  beforeEach(() => {
    rows = [
      { id: 'newest', state: 'pending', reviewNote: null, reviewedBy: null, reviewedAt: null, createdAt: at('2026-08-05T00:00:00Z') },
      { id: 'oldest', state: 'pending', reviewNote: null, reviewedBy: null, reviewedAt: null, createdAt: at('2026-08-01T00:00:00Z') },
      { id: 'middle', state: 'pending', reviewNote: null, reviewedBy: null, reviewedAt: null, createdAt: at('2026-08-03T00:00:00Z') },
      { id: 'done', state: 'approved', reviewNote: null, reviewedBy: 'someone', reviewedAt: at('2026-08-04T00:00:00Z'), createdAt: at('2026-07-01T00:00:00Z') },
      { id: 'gone', state: 'withdrawn', reviewNote: null, reviewedBy: null, reviewedAt: null, createdAt: at('2026-07-02T00:00:00Z') },
    ];
    service = new CorpusService(fakeDb(rows));
  });

  it('MANDATORY: lists only what is pending', () => {
    /*
     * An approved image is not a decision anybody has to make again, and a withdrawn one is the
     * member's own choice which a reviewer must never be invited to overturn.
     */
    return service.queue().then((q) => {
      expect(q.map((r) => r.id)).not.toContain('done');
      expect(q.map((r) => r.id)).not.toContain('gone');
      expect(q).toHaveLength(3);
    });
  });

  it('MANDATORY: oldest first, so the queue cannot starve its own tail', async () => {
    /*
     * Newest-first starves the bottom: on any day the reviewer does not reach the end, the SAME
     * submissions are the ones skipped, and somebody who offered an image on a busy day waits for
     * ever while later ones sail past. Oldest first bounds the wait by the queue, not by luck.
     */
    const q = await service.queue();
    expect(q.map((r) => r.id)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('the waiting count is what the tab badge shows, and counts only pending', async () => {
    expect(await service.waiting()).toBe(3);
  });

  it('MANDATORY: a rejection without a reason is refused', async () => {
    /*
     * The schema said it first, on `reviewNote`: "a rejection with no reason teaches them nothing
     * and they will submit the same thing again." Enforced in the SERVICE rather than only in the
     * form, because a form is one caller and the rule is about the data.
     */
    await expect(service.review('officer', 'oldest', 'rejected', null)).rejects.toThrow(AppError);
    await expect(service.review('officer', 'oldest', 'rejected', '   ')).rejects.toThrow(AppError);

    // And the row did not move.
    expect(rows.find((r) => r.id === 'oldest')?.state).toBe('pending');
  });

  it('an approval needs no reason — there is nothing to explain about yes', async () => {
    await service.review('officer', 'oldest', 'approved', null);

    const row = rows.find((r) => r.id === 'oldest');
    expect(row?.state).toBe('approved');
    expect(row?.reviewNote).toBeNull();
    expect(row?.reviewedBy).toBe('officer');
    expect(row?.reviewedAt).toBeInstanceOf(Date);
  });

  it('a rejection keeps the reason, trimmed, against the row the member reads', async () => {
    await service.review('officer', 'middle', 'rejected', '  the caption describes a different ship  ');

    const row = rows.find((r) => r.id === 'middle');
    expect(row?.state).toBe('rejected');
    expect(row?.reviewNote).toBe('the caption describes a different ship');
    expect(row?.reviewedBy).toBe('officer');
  });

  it('MANDATORY: two officers cannot both decide the same image', async () => {
    /*
     * The `state: 'pending'` in the filter is the whole concurrency story. Both officers opened
     * the queue and saw this row; the first to decide wins, and the second is told so rather than
     * silently overwriting a colleague's judgement.
     */
    await service.review('first', 'newest', 'approved', null);

    await expect(service.review('second', 'newest', 'rejected', 'no')).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_VISIBLE,
    });

    // The first officer's decision stands.
    expect(rows.find((r) => r.id === 'newest')?.reviewedBy).toBe('first');
    expect(rows.find((r) => r.id === 'newest')?.state).toBe('approved');
  });

  it('MANDATORY: a withdrawn submission cannot be reviewed back into the pool', async () => {
    /*
     * Withdrawal is the member's, and it means "do not train on this". A reviewer approving it
     * afterwards would override consent — which is exactly the thing the withdrawal path exists
     * to honour.
     */
    await expect(service.review('officer', 'gone', 'approved', null)).rejects.toThrow(AppError);
    expect(rows.find((r) => r.id === 'gone')?.state).toBe('withdrawn');
  });
});
