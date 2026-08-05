import { describe, expect, it } from 'vitest';
import {
  FEATURE_REQUESTS_NAME,
  FEATURE_REQUESTS_SLUG,
  PUBLISH_LANDING_MS,
  SUGGESTION_MAX_CHARS,
  cleanSuggestionBody,
  featureRequestsWhere,
  isFeatureRequestsBoard,
  openingPostFor,
  reviewProblem,
  suggestionOutcome,
  titleFrom,
} from './suggestion-box.js';

/**
 * The box's rules, driven directly — the support-chat.spec shape. The cap and the state machine
 * are the correctness of the feature; the service applies them, this file exercises them.
 */

describe('the suggestion cap', () => {
  it('MANDATORY: refuses past 2000 characters, in a sentence that names both numbers', () => {
    const over = cleanSuggestionBody('a'.repeat(SUGGESTION_MAX_CHARS + 1));
    expect('problem' in over).toBe(true);
    if ('problem' in over) {
      expect(over.problem).toContain('2,001');
      expect(over.problem).toContain('2,000');
    }
  });

  it('accepts exactly the cap', () => {
    const at = cleanSuggestionBody('a'.repeat(SUGGESTION_MAX_CHARS));
    expect('body' in at).toBe(true);
  });

  it('refuses emptiness and non-strings with the same ask', () => {
    for (const raw of ['', '   ', undefined, null, 42, {}]) {
      const result = cleanSuggestionBody(raw);
      expect('problem' in result, JSON.stringify(raw)).toBe(true);
    }
  });

  it('normalises Windows line endings BEFORE measuring, so the cap measures what the member sees', () => {
    // 1000 lines of "a\r\n" is 2000 visible characters; raw it is 3000.
    const windows = 'a\r\n'.repeat(1000).trimEnd();
    const result = cleanSuggestionBody(windows);
    expect('body' in result).toBe(true);
  });
});

describe('the review state machine', () => {
  it('MANDATORY: `new` has exactly two exits, and both are open', () => {
    expect(reviewProblem('new', 'publish')).toBeNull();
    expect(reviewProblem('new', 'decline')).toBeNull();
  });

  it('MANDATORY: reviewed is reviewed — every second verdict is refused with a reason', () => {
    // Walked across all four stale combinations: the edge that drifts is the one nobody re-reads.
    for (const status of ['published', 'declined'] as const) {
      for (const action of ['publish', 'decline'] as const) {
        const problem = reviewProblem(status, action);
        expect(problem, `${status} -> ${action}`).not.toBeNull();
        expect(problem).toContain('already');
      }
    }
  });
});

/**
 * What the SENDER is told, which is not the stored status.
 *
 * ★ THE FACE THE TRANSIENT USED TO WEAR ★
 *
 * Publish claims the row — `published`, thread id NULL — before creating the thread, so the race
 * resolves to one winner before anything is minted. For the few milliseconds that takes, the
 * sender's list holds a `published` row with no link, and so does a suggestion whose thread
 * moderation removed, and so does a publish that broke halfway. Three situations, one chip, and
 * the reader's most natural reading of it was "they deleted my idea".
 *
 * The stored machine above is untouched — three states, no migration, no transient in the schema.
 * These are the four answers derived from what the row already carries.
 */
describe('what a suggestion is to its sender', () => {
  const NOW = new Date('2026-08-04T12:00:00Z');
  const row = (over: Partial<Parameters<typeof suggestionOutcome>[0]> = {}) =>
    suggestionOutcome(
      {
        status: 'published',
        publishedThreadId: null,
        reviewedAt: NOW,
        threadLink: null,
        ...over,
      },
      NOW,
    );

  it('passes `new` and `declined` straight through — nothing about them is ambiguous', () => {
    expect(row({ status: 'new', reviewedAt: null })).toBe('new');
    expect(row({ status: 'declined' })).toBe('declined');
  });

  it('MANDATORY: a claim made this instant reads as IN PROGRESS, not as published', () => {
    // The exact shape `publish` leaves between the conditional claim and the thread stamp.
    expect(row({ reviewedAt: NOW })).toBe('publishing');
    expect(row({ reviewedAt: new Date(NOW.getTime() - 1_000) })).toBe('publishing');
  });

  it('MANDATORY: a thread that landed reads as published, with its link', () => {
    expect(
      row({ publishedThreadId: 'th1', threadLink: '/forum/feature-requests/dark-mode' }),
    ).toBe('published');
  });

  it('MANDATORY: published-but-removed still reads honestly, and NOT as in progress', () => {
    /*
     * The case the transient was being confused with. A thread id exists, so this was genuinely
     * published; the link is null because moderation removed the thread or the reader cannot see
     * the category. Age is irrelevant here — a removed thread reads the same a year later.
     */
    expect(row({ publishedThreadId: 'th1', threadLink: null })).toBe('published_thread_gone');
    expect(
      suggestionOutcome(
        { status: 'published', publishedThreadId: 'th1', reviewedAt: NOW, threadLink: null },
        NOW,
      ),
    ).toBe('published_thread_gone');
  });

  it('MANDATORY: a claim older than the window is a FAULT, said out loud', () => {
    /*
     * The double failure the publish path tolerates by design: creation threw AND the revert threw
     * too, so a `published` row with no thread persists. It used to render as an ordinary
     * published suggestion forever.
     */
    const old = new Date(NOW.getTime() - PUBLISH_LANDING_MS - 1_000);
    expect(row({ reviewedAt: old })).toBe('publish_incomplete');
    // And a claimed row with no review stamp at all — a shape nothing writes, and still not a lie.
    expect(row({ reviewedAt: null })).toBe('publish_incomplete');
  });

  it('the landing window is bounded on BOTH sides', () => {
    /*
     * An unbounded lower bound would let a stamp ahead of the reader's clock read as "landing"
     * forever. Not attacker-controlled — the server writes it — so the tolerance is symmetric,
     * which is what stops a second of drift turning a healthy publish into an alarm.
     */
    const farFuture = new Date(NOW.getTime() + PUBLISH_LANDING_MS + 1_000);
    expect(row({ reviewedAt: farFuture })).toBe('publish_incomplete');
    expect(row({ reviewedAt: new Date(NOW.getTime() + 1_000) })).toBe('publishing');
  });

  it('the window is generous, because the wrong error is the costly one', () => {
    // A slow publish reading as "going up" for a moment too long costs nothing. The reverse tells
    // a member their idea broke while it is going perfectly well.
    expect(PUBLISH_LANDING_MS).toBeGreaterThanOrEqual(10_000);
  });
});

describe('what a published suggestion becomes', () => {
  it('titles the thread from the first line, clipped to fit', () => {
    expect(titleFrom('Dark mode for the roster\nAnd more words below', 'Halsey')).toBe(
      'Dark mode for the roster',
    );

    const long = titleFrom('w'.repeat(300), 'Halsey');
    expect(long.length).toBeLessThanOrEqual(100);
    expect(long.endsWith('…')).toBe(true);
  });

  it('falls back to naming the sender when the words are too short to be a title', () => {
    expect(titleFrom('ok', 'Halsey')).toBe('Suggestion from Halsey');
  });

  it('MANDATORY: the opening post credits the sender by display name and carries their words', () => {
    const post = openingPostFor('Give the roster a dark mode.\n\nIt burns at night.', 'Halsey');
    expect(post).toContain('Suggested by Halsey');
    expect(post).toContain('> Give the roster a dark mode.');
    // Every line of the member's words rides as a quote, so the webmaster's mechanical
    // authorship of the thread never reads as authorship of the idea.
    expect(post).toContain('> It burns at night.');
  });
});

describe('one board resolution, two forms', () => {
  /*
   * Publish finds the board by QUERY (`featureRequestsWhere`); the promote panel and the
   * roadmap test a row already in hand (`isFeatureRequestsBoard`). Both must mean the same
   * thing, or the panel and the publish flow drift apart — which is exactly how the panel
   * once ended up comparing a URL literal.
   */
  it('MANDATORY: the predicate accepts the board by slug or by name, case-insensitively', () => {
    expect(isFeatureRequestsBoard({ slug: 'feature-requests', name: 'Feature Requests' })).toBe(true);
    expect(isFeatureRequestsBoard({ slug: 'Feature-Requests', name: 'Renamed' })).toBe(true);
    expect(isFeatureRequestsBoard({ slug: 'asks', name: 'FEATURE REQUESTS' })).toBe(true);
    expect(isFeatureRequestsBoard({ slug: 'general', name: 'General' })).toBe(false);
  });

  it('MANDATORY: the query form asks the database the SAME question', () => {
    /*
     * Asserted structurally: both clauses are case-insensitive equals on the same two
     * constants the predicate reads. A change to one form that forgets the other fails here.
     */
    expect(featureRequestsWhere()).toEqual({
      OR: [
        { slug: { equals: FEATURE_REQUESTS_SLUG, mode: 'insensitive' } },
        { name: { equals: FEATURE_REQUESTS_NAME, mode: 'insensitive' } },
      ],
    });
    // And the predicate is built from those same constants.
    expect(isFeatureRequestsBoard({ slug: FEATURE_REQUESTS_SLUG, name: 'x' })).toBe(true);
    expect(isFeatureRequestsBoard({ slug: 'x', name: FEATURE_REQUESTS_NAME })).toBe(true);
  });
});
