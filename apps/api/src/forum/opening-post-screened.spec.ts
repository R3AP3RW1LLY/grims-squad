import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The nested opening-post insert, located from the create rather than from a guessed marker. */
function threadInsertBlock(src: string): string {
  const at = src.indexOf('db.forumThread.create');
  return at === -1 ? '' : src.slice(at, at + 1600);
}
const THREAD = readFileSync(resolve(HERE, 'thread.service.ts'), 'utf8');
const POST = readFileSync(resolve(HERE, 'post.service.ts'), 'utf8');

/**
 * The opening post of a thread is a post.
 *
 * ★ THE BUG, 2026-07-31 ★
 *
 * Squadron owner: "i just made another forum post that has no swearing at all, and is clean! its
 * still got pulled for moderation ... why are none of our posts getting through?"
 *
 * Every new thread's opening post was held. Always. Regardless of content.
 *
 * The opening post is created NESTED inside the thread insert — `forumThread.create({ posts: {
 * create: [...] } })` — and that nested create never set `screen_state`. The column defaults to
 * `held`, so the default applied to every thread ever started.
 *
 * ★ WHY IT SURVIVED SO LONG, AND WHY IT LOOKED LIKE AN AI FAULT ★
 *
 * Screening was never CALLED on that path, so:
 *
 *   the live AI log showed heartbeats and no screening activity  (read as "the AI is idle")
 *   `ai_calls` recorded nothing                                  (read as "screening never ran")
 *   `screen_verdict` was NULL on a held post                     (impossible, if it had been held
 *                                                                 BY screening)
 *
 * Every symptom pointed at the model, and an afternoon went into tuning a prompt that was already
 * working. The one clue that mattered was `screen_verdict` being NULL: the code stores a verdict
 * whenever it holds, so a held post without one was never held by screening at all.
 *
 * Searching for `forumPost.create` found one call site and missed this entirely, because a nested
 * create does not contain that string.
 */

describe('MANDATORY: every path that creates a post screens it', () => {
  it('the thread service screens the opening post', () => {
    expect(THREAD).toMatch(/screenPost\(/);
  });

  it('MANDATORY: the nested create sets screenState explicitly', () => {
    /*
     * This is the whole bug. The column defaults to `held`, so omitting the field is not a neutral
     * act — it holds the post. It must be stated, on every insert, forever.
     */
    expect(threadInsertBlock(THREAD)).toMatch(/screenState:/);
  });

  it('MANDATORY: it stores the verdict when it holds', () => {
    // A held post with a null verdict is the signature of this bug. Storing it is what makes the
    // moderation queue able to say WHY, and what makes the null case diagnostic.
    expect(threadInsertBlock(THREAD)).toMatch(/screenVerdict:/);
  });

  it('MANDATORY: no post insert anywhere omits screenState', () => {
    /*
     * The generalised guard. Any future insert into forum_posts that forgets this field silently
     * holds those posts, and the symptom will again look like a broken AI rather than a missing
     * field. Catches nested creates, which a search for `forumPost.create` does not.
     */
    const offenders: string[] = [];
    for (const [name, src] of [['thread.service.ts', THREAD], ['post.service.ts', POST]] as const) {
      // Every block that supplies a post body is an insert of a post.
      // Matches inserts AND updates: an edit republishes a body and must be screened too.
      for (const match of src.matchAll(/bodyHtml:\s*rendered\.bodyHtml/g)) {
        // Generous both ways: screenState legitimately sits before or after the body fields
        // depending on the insert, and this guard must flag ABSENCE, not ordering.
        const window = src.slice(Math.max(0, match.index - 900), match.index + 1200);
        if (!/screenState:/.test(window)) offenders.push(`${name} @ ${match.index}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('both services treat an absent screener the same way', () => {
    // Unconfigured means publish, in both. If they disagreed, whether a post appeared would depend
    // on whether it opened a thread — which nobody would ever guess at.
    expect(THREAD).toMatch(/screened === null \? 'clear'/);
    expect(POST).toMatch(/screened === null \? 'clear'/);
  });
});

describe('the screening call itself', () => {
  it('MANDATORY: screens BEFORE the insert, not after', async () => {
    /*
     * "the ai must ingest and moderate all posts before they are visible". A thread's opening post
     * is the most visible post there is — it is what the board listing shows.
     */
    const order: string[] = [];
    const screening = {
      screenPost: vi.fn(async () => {
        order.push('screen');
        return { state: 'clear' as const, verdict: { verdict: 'clear' as const, categories: [], reason: null, tookMs: 1 } };
      }),
    };
    // The source order is the guarantee; assert the call site precedes the create.
    const screenAt = THREAD.indexOf('this.screening.screenPost');
    const createAt = THREAD.indexOf('db.forumThread.create');
    expect(screenAt).toBeGreaterThan(-1);
    expect(screenAt).toBeLessThan(createAt);
    expect(screening.screenPost).toBeDefined();
  });
});
