import { describe, it, expect, beforeEach } from 'vitest';
import { AppError, ErrorCode, XP_AWARDS } from '@grims/shared';
import type { AclBoundClient } from '../authz/acl-db.service.js';
import { VoteService, xpFor } from './vote.service.js';

/**
 * Voting.
 *
 * ★ THE FAILURES HERE ARE ALL SILENT ★
 *
 * Every way this can be wrong produces a number that is merely incorrect — no error, no log, no
 * symptom until somebody notices their score does not match what they did. So the tests are about
 * the ARITHMETIC of transitions, which is where that kind of wrongness lives.
 */

/**
 * A stand-in for the caller's ACL-bound client.
 *
 * Only the four operations the service performs. Deliberately not a full Prisma double: a fake
 * that can do everything hides the fact that this service touches very little, and the surface it
 * touches is the thing worth pinning.
 */
interface XpRow {
  userId: string;
  reason: string;
  amount: number;
  subject: string | null;
}

class FakeDb {
  votes = new Map<string, 1 | -1>();
  xp: XpRow[] = [];
  /** Null stands for "not visible to this member" — deleted, held, or in a category they cannot read. */
  author: string | null = 'author-1';
  score = 0;

  forumPost = {
    findFirst: async () => (this.author === null ? null : { authorId: this.author }),
    update: async ({ data }: { data: { score: { increment: number } } }) => {
      this.score += data.score.increment;
      return { score: this.score };
    },
  };

  forumVote = {
    findUnique: async ({ where }: { where: { postId_userId: { postId: string; userId: string } } }) => {
      const v = this.votes.get(`${where.postId_userId.postId}:${where.postId_userId.userId}`);
      return v === undefined ? null : { value: v };
    },
    upsert: async ({ create }: { create: { postId: string; userId: string; value: 1 | -1 } }) => {
      this.votes.set(`${create.postId}:${create.userId}`, create.value);
    },
    delete: async ({ where }: { where: { postId_userId: { postId: string; userId: string } } }) => {
      this.votes.delete(`${where.postId_userId.postId}:${where.postId_userId.userId}`);
    },
  };

  xpEvent = {
    createMany: async ({ data }: { data: XpRow[] }) => {
      this.xp.push(...data);
    },
  };

  // The service wraps its writes in a transaction; the fake runs the callback against itself.
  $transaction = async <T>(fn: (tx: FakeDb) => Promise<T>): Promise<T> => fn(this);

  get client(): AclBoundClient {
    return this as unknown as AclBoundClient;
  }
}

let db: FakeDb;
let svc: VoteService;

beforeEach(() => {
  db = new FakeDb();
  svc = new VoteService();
});

describe('the button is not the state', () => {
  it('casts a vote when there was none', async () => {
    const r = await svc.press(db.client, 'p1', 'voter', 1);

    expect(r.myVote).toBe(1);
    expect(r.score).toBe(1);
  });

  it('withdraws when the member presses the arrow they already chose', async () => {
    /*
     * The client sends "they pressed up" and nothing else. It does not reliably know what they
     * voted last — a second tab, a stale page, a back button — so the SERVER decides what the
     * press means from what is stored.
     */
    await svc.press(db.client, 'p1', 'voter', 1);
    const r = await svc.press(db.client, 'p1', 'voter', 1);

    expect(r.myVote).toBeNull();
    expect(r.score).toBe(0);
  });

  it('swings by two when a vote flips', async () => {
    // +1 to -1 is a two-point move, not a one-point one. Getting this wrong leaves every flipped
    // post permanently one point high, and nothing ever errors.
    await svc.press(db.client, 'p1', 'voter', 1);
    const r = await svc.press(db.client, 'p1', 'voter', -1);

    expect(r.myVote).toBe(-1);
    expect(r.score).toBe(-1);
  });
});

describe('what the author earns', () => {
  it('awards the author when upvoted', async () => {
    await svc.press(db.client, 'p1', 'voter', 1);

    expect(db.xp).toEqual([
      { userId: 'author-1', reason: 'postUpvoted', amount: XP_AWARDS.postUpvoted, subject: 'p1' },
    ]);
  });

  it('MANDATORY: removes the award when the upvote is withdrawn', async () => {
    await svc.press(db.client, 'p1', 'voter', 1);
    await svc.press(db.client, 'p1', 'voter', 1);

    expect(db.xp).toEqual([
      { userId: 'author-1', reason: 'postUpvoted', amount: XP_AWARDS.postUpvoted, subject: 'p1' },
      { userId: 'author-1', reason: 'postUpvoted', amount: -XP_AWARDS.postUpvoted, subject: 'p1' },
    ]);
  });

  it('MANDATORY: a flip both removes the old award and applies the new one', () => {
    /*
     * ★ THE BUG THIS EXISTS FOR ★
     *
     * An implementation that only applies the penalty on a flip leaves the author permanently
     * ahead by the full upvote. Nothing throws. Nothing logs. The totals are simply wrong, for
     * everyone, forever.
     */
    expect(xpFor('p1', 1, -1)).toEqual([
      { reason: 'postUpvoted', amount: -XP_AWARDS.postUpvoted, subject: 'p1' },
      { reason: 'postDownvoted', amount: XP_AWARDS.postDownvoted, subject: 'p1' },
    ]);
  });

  it('writes nothing when nothing changed', () => {
    // A ledger full of +10/-10 pairs from somebody toggling a vote is unreadable, and being able
    // to read it is the whole reason it is a ledger rather than a counter.
    expect(xpFor('p1', null, null)).toEqual([]);
  });

  it('covers all nine transitions without producing a zero entry', () => {
    for (const before of [null, 1, -1] as const) {
      for (const after of [null, 1, -1] as const) {
        for (const e of xpFor('p1', before, after)) expect(e.amount).not.toBe(0);
      }
    }
  });
});

describe('what is refused', () => {
  it('MANDATORY: refuses a self-vote', async () => {
    /*
     * Everyone may vote — the owner decided that. This is narrower: a self-vote is not an opinion
     * about a post, it is a member adding to their own score, and allowing it would make
     * experience a measure of how much somebody has posted.
     */
    await expect(svc.press(db.client, 'p1', 'author-1', 1)).rejects.toThrow(AppError);
  });

  it('MANDATORY: answers NOT_VISIBLE for a post that is not there', async () => {
    /*
     * INV-024. A held post, a deleted post and a nonexistent post must answer identically, or this
     * endpoint becomes a way to enumerate them by watching which ids error differently.
     */
    db.author = null;

    await expect(svc.press(db.client, 'nope', 'voter', 1)).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_VISIBLE,
    });
  });
});
