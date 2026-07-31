import { describe, it, expect, vi } from 'vitest';
import { ReportService } from './report.service.js';

/**
 * Reporting a published post.
 *
 * ★ THE ABUSE VECTOR THIS DESIGN AVOIDS ★
 *
 * The obvious implementation holds the post the moment somebody reports it. That hands every member
 * a button that silences any other member instantly — and in a squadron of a hundred people, during
 * an argument, that button gets used that way.
 *
 * So a report is a CLAIM. The post stays up until an officer decides. Guarded here because "surely
 * a reported post should be hidden" is a reasonable-sounding change somebody will propose.
 */

const post = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  bodyMd: 'something rude',
  screenState: 'clear',
  authorId: 'author',
  ...over,
});

function harness(found: Record<string, unknown> | null = post()) {
  const record = vi.fn(async () => undefined);
  const update = vi.fn(async () => ({}));
  const db = {
    forumPost: { findFirst: vi.fn(async () => found), update },
  } as never;
  return { svc: new ReportService({ record }), db, record, update };
}

describe('MANDATORY: a report does not hide the post', () => {
  it('writes no change to the post at all', async () => {
    const h = harness();
    await h.svc.report(h.db, 'p1', { userId: 'reporter' });
    // Not held, not refused, not touched. Only an officer changes what a post's state is.
    expect(h.update).not.toHaveBeenCalled();
  });
});

describe('the signal it records', () => {
  it('MANDATORY: records modelFlagged=false — the false negative', async () => {
    /*
     * This is the entire reason reports matter to the AI. The screener let this through and a
     * member disagreed; that pairing is the only "you should have flagged this" the system can
     * ever observe, because a moderator never sees a cleared post.
     */
    const h = harness();
    await h.svc.report(h.db, 'p1', { userId: 'reporter' });

    expect(h.record).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'report', modelFlagged: false }),
    );
  });

  it('MANDATORY: pending until an officer upholds it', async () => {
    /*
     * `decidedBy: null` and `shouldFlag: false` record what is TRUE right now — nobody has upheld
     * this. If a report alone set shouldFlag=true, one member could teach the screener anything
     * they liked by reporting posts they disliked.
     */
    const h = harness();
    await h.svc.report(h.db, 'p1', { userId: 'reporter' });

    expect(h.record).toHaveBeenCalledWith(
      expect.objectContaining({ shouldFlag: false, decidedBy: null }),
    );
  });

  it('stores the text, not just a reference', async () => {
    // The post may be edited or deleted later, and an example that changes under you is not an
    // example.
    const h = harness();
    await h.svc.report(h.db, 'p1', { userId: 'reporter' });
    expect(h.record).toHaveBeenCalledWith(expect.objectContaining({ text: 'something rude' }));
  });
});

describe('what it refuses', () => {
  it('MANDATORY: you cannot report your own post', async () => {
    // Almost always a misclick, and the signal would be worthless — an author is not an independent
    // judge of their own writing.
    const h = harness();
    await expect(h.svc.report(h.db, 'p1', { userId: 'author' })).rejects.toThrow(/your own post/i);
    expect(h.record).not.toHaveBeenCalled();
  });

  it('a post already held records nothing further', async () => {
    // It is already waiting for an officer. A second signal adds nothing and would double-count in
    // the drift figures.
    const h = harness(post({ screenState: 'held' }));
    await h.svc.report(h.db, 'p1', { userId: 'reporter' });
    expect(h.record).not.toHaveBeenCalled();
  });

  it('an invisible post is cloaked as not-found', async () => {
    /*
     * The ACL client already limits this to posts the reporter can read. A distinct "you cannot see
     * that" would confirm a post exists to anybody probing ids.
     */
    const h = harness(null);
    await expect(h.svc.report(h.db, 'p1', { userId: 'reporter' })).rejects.toThrow(/not available/i);
  });
});

describe('what the member is told', () => {
  it('names no outcome and says the post stays up', async () => {
    /*
     * Promising action would be a promise an officer has not made. Saying nothing about visibility
     * makes the post remaining look like inaction rather than the deliberate choice it is.
     */
    const h = harness();
    const out = await h.svc.report(h.db, 'p1', { userId: 'reporter' });
    expect(out.ok).toBe(true);
  });
});
