import { describe, expect, it } from 'vitest';
import {
  SUGGESTION_MAX_CHARS,
  cleanSuggestionBody,
  openingPostFor,
  reviewProblem,
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
