import type { PrismaClient } from '@grims/db';
import { TEACHABLE } from '@grims/shared';
import type { WritableRow } from './knowledge-writer.js';

/**
 * The squadron's own answers, as knowledge.
 *
 * ★ SQUADRON OWNER, 2026-07-31 ★
 *
 * "use upvoted and posts that have been checked as the answer to something as a way to train our
 * ai chat system."
 *
 * ★ THIS IS THE ONLY SOURCE THAT KNOWS ABOUT US ★
 *
 * Spansh knows where every station is and Coriolis knows what every module does. Neither knows how
 * THIS squadron runs a BGS week, which carrier does the Tritium runs, or what the answer was the
 * last four times somebody asked about Powerplay merits. That only exists in threads, and until
 * now it existed only for whoever scrolled far enough to find it.
 *
 * ★ TWO WAYS IN, AND THEY ARE NOT EQUALLY GOOD ★
 *
 * An accepted answer qualifies outright: somebody asked, somebody answered, and the person who
 * asked confirmed it worked. That is the strongest correctness signal a forum can produce.
 *
 * Score alone needs a much higher bar, because votes measure AGREEMENT rather than accuracy — and
 * on a squadron forum, agreement is cheap. A funny reply earns votes and teaches nothing. See
 * `TEACHABLE.minScore`.
 */

export interface ForumKnowledge {
  readonly rows: WritableRow[];
  readonly accepted: number;
  readonly upvoted: number;
}

interface PostRow {
  id: string;
  body: string;
  score: number;
  is_solution: boolean;
  thread_title: string;
  category_slug: string;
  thread_slug: string;
  created_at: Date;
}

export async function readForumKnowledge(db: PrismaClient): Promise<ForumKnowledge> {
  const rows = await db.$queryRawUnsafe<PostRow[]>(
    `SELECT p.id,
            /*
             * The TEXT, not the HTML. The assistant is given this to read, and handing it markup
             * means it quotes tags back at members — and burns context on <div> for no gain.
             * regexp_replace is crude and correct enough: bodies were sanitised on the way IN
             * (INV-035), so the tag set here is already closed and known.
             */
            regexp_replace(p.body_html, '<[^>]+>', ' ', 'g') AS body,
            p.score,
            p.is_solution,
            t.title AS thread_title,
            c.slug  AS category_slug,
            t.slug  AS thread_slug,
            p.created_at
       FROM forum_posts p
       JOIN forum_threads t   ON t.id = p.thread_id
       JOIN forum_categories c ON c.id = t.category_id
      WHERE p.deleted_at IS NULL
        -- Never anything the screener held. A post nobody has cleared must not become something
        -- the assistant repeats to the whole squadron.
        AND p.screen_state = 'clear'
        /*
         * ★ AND NEVER FROM A PRIVATE BOARD ★
         *
         * The officers' board and any category with a view permission are excluded outright. The
         * assistant answers everybody, and there is no per-member filtering downstream of this
         * table — so a single officer-only post ingested here leaks to a hundred and six people
         * the first time somebody asks the right question.
         *
         * A NULL view_perm is the schema's way of saying "anybody may read this board". The
         * COALESCE is not redundant defensiveness: a board could be created with an explicit zero
         * mask meaning the same thing, and treating those two as different would silently exclude
         * a public board from the assistant's knowledge with no error anywhere.
         *
         * (No backticks in this comment. It lives inside a template literal, and a stray one ends
         *  the SQL string mid-sentence — which is exactly what happened when it was first written.)
         */
        AND COALESCE(c.view_perm, 0) = 0
        AND (p.is_solution = true OR p.score >= $1)`,
    TEACHABLE.minScore,
  );

  const out: WritableRow[] = [];
  let accepted = 0;
  let upvoted = 0;

  for (const r of rows) {
    const body = r.body.replace(/\s+/g, ' ').trim();
    // A one-word "this" with five upvotes is agreement, not an answer.
    if (body.length < 40) continue;

    if (r.is_solution) accepted += 1;
    else upvoted += 1;

    out.push({
      source: 'forum',
      kind: r.is_solution ? 'accepted-answer' : 'top-post',
      extKey: r.id,
      name: r.thread_title,
      data: {
        threadTitle: r.thread_title,
        // A link, so an answer can be traced back to the conversation it came from. An assistant
        // that cannot say where it got something is one nobody can check.
        url: `/forum/${r.category_slug}/${r.thread_slug}`,
        score: r.score,
        accepted: r.is_solution,
        postedAt: r.created_at,
      },
      /*
       * The question and the answer TOGETHER.
       *
       * The answer alone is frequently meaningless — "yes, but only in open" is a perfect reply
       * and a useless fact. The thread title is the question it answers, and retrieving one
       * without the other is how a correct answer becomes a wrong one.
       */
      text:
        `${r.thread_title}\n\n${body}\n\n` +
        (r.is_solution
          ? '(Accepted as the answer by the member who asked.)'
          : `(Squadron forum post, ${r.score} net votes.)`),
      coords: null,
    });
  }

  return { rows: out, accepted, upvoted };
}
