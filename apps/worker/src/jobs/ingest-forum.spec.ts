import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@grims/db';
import { readForumKnowledge } from './ingest-forum.js';

/**
 * The squadron's own answers, as knowledge.
 *
 * ★ THE SQL IS THE SAFETY, AND THE SQL IS NOT WHAT THESE TEST ★
 *
 * Two of the three guarantees here live in the WHERE clause — held posts and private boards are
 * excluded before a row is ever built — so a unit test with a fake database cannot prove them. It
 * can prove the shaping, which is where the subtler mistake lives: an answer separated from its
 * question is a correct sentence that means something else.
 *
 * The exclusions are asserted against the query text instead. Crude, and it catches the edit that
 * removes them.
 */

function fakeDb(rows: unknown[]): { db: PrismaClient; sql: string[] } {
  const sql: string[] = [];
  const db = {
    $queryRawUnsafe: async (q: string) => {
      sql.push(q);
      return rows;
    },
  } as unknown as PrismaClient;
  return { db, sql };
}

const post = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  body: '<p>Use a Guardian FSD booster and take the neutron route. It cuts the trip roughly in half.</p>',
  score: 0,
  is_solution: true,
  thread_title: 'Fastest way to Colonia?',
  category_slug: 'general',
  thread_slug: 'fastest-way-to-colonia',
  created_at: new Date('2026-07-20T10:00:00Z'),
  ...over,
});

describe('what qualifies', () => {
  it('MANDATORY: never reads a held post or a private board', () => {
    /*
     * ★ THE TWO LEAKS THIS GUARDS ★
     *
     * A held post is one nobody has cleared, and the assistant repeating it publishes it to
     * everybody. A post from the officers' board is worse: there is no per-member filtering
     * downstream of the knowledge table, so a single officer-only row reaches a hundred and six
     * people the first time somebody asks the right question.
     */
    const { db, sql } = fakeDb([]);
    void readForumKnowledge(db);

    return Promise.resolve().then(() => {
      const q = sql[0] ?? '';
      expect(q).toContain("screen_state = 'clear'");
      expect(q).toContain('view_perm');
      expect(q).toContain('deleted_at IS NULL');
    });
  });

  it('counts accepted answers and highly-rated posts separately', async () => {
    // They are different signals and the training page should be able to say so: an accepted
    // answer is confirmed correct, a popular post is agreed with.
    const { db } = fakeDb([
      post({ id: 'a', is_solution: true }),
      post({ id: 'b', is_solution: false, score: 9 }),
    ]);

    const r = await readForumKnowledge(db);

    expect(r.accepted).toBe(1);
    expect(r.upvoted).toBe(1);
    expect(r.rows.map((x) => x.kind)).toEqual(['accepted-answer', 'top-post']);
  });

  it('drops a post too short to be an answer', async () => {
    // "this" with five upvotes is agreement, not an answer, and teaching the assistant to repeat
    // it is worse than teaching it nothing.
    const { db } = fakeDb([post({ body: '<p>this</p>', score: 12, is_solution: false })]);

    expect((await readForumKnowledge(db)).rows).toHaveLength(0);
  });
});

describe('what each row says', () => {
  it('MANDATORY: carries the question with the answer', async () => {
    /*
     * ★ WHY THIS IS THE MOST IMPORTANT ASSERTION IN THE FILE ★
     *
     * An answer alone is frequently meaningless — "yes, but only in open" is a perfect reply and a
     * useless fact. Retrieved without the question it answers, a correct answer becomes a wrong
     * one, and it will be stated with complete confidence.
     */
    const { db } = fakeDb([post()]);

    const text = (await readForumKnowledge(db)).rows[0]?.text ?? '';

    expect(text).toContain('Fastest way to Colonia?');
    expect(text).toContain('Guardian FSD booster');
  });

  it('strips the markup IN THE QUERY, because the assistant reads this', async () => {
    /*
     * ★ ASSERTED AGAINST THE SQL, NOT THE RESULT — AND THE FIRST VERSION GOT THIS WRONG ★
     *
     * The stripping is a regexp_replace in the SELECT, so the rows this function receives are
     * already plain text. A test that fed HTML to the fake and expected the tags gone was testing
     * a step that does not happen in TypeScript — it failed, correctly, and the code was fine.
     *
     * Handing the assistant markup would make it quote tags back at members and spend context on
     * <div>. Doing it in SQL is safe because bodies were sanitised on the way IN (INV-035), so the
     * tag set is already closed and known.
     */
    const { db, sql } = fakeDb([post()]);
    await readForumKnowledge(db);

    expect(sql[0]).toContain('regexp_replace(p.body_html');
  });

  it('says WHICH signal qualified it', async () => {
    // The assistant can then answer "somebody confirmed this worked" rather than implying every
    // stored post carries the same weight.
    const { db } = fakeDb([post({ is_solution: true })]);
    const { db: db2 } = fakeDb([post({ id: 'b', is_solution: false, score: 9 })]);

    expect((await readForumKnowledge(db)).rows[0]?.text).toContain('Accepted as the answer');
    expect((await readForumKnowledge(db2)).rows[0]?.text).toContain('9 net votes');
  });

  it('links back to the thread', async () => {
    // An assistant that cannot say where it got something is one nobody can check.
    const { db } = fakeDb([post()]);

    const data = (await readForumKnowledge(db)).rows[0]?.data as { url: string };
    expect(data.url).toBe('/forum/general/fastest-way-to-colonia');
  });
});
