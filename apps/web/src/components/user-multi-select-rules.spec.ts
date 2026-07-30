import { describe, it, expect } from 'vitest';
import {
  type Candidate,
  MIN_QUERY,
  emptyStateFor,
  isCurrentResponse,
  labelFor,
  nextHighlight,
  shouldQuery,
  visibleCandidates,
} from './user-multi-select-rules';

/**
 * The access dropdown's behaviour, tested as functions.
 *
 * The interesting cases are the ones a rendered-component test tends to skip: a slow
 * response landing after a fast one, an arrow key at the end of the list, an empty
 * state that has to distinguish "keep typing" from "nobody matches".
 */

const cand = (over: Partial<Candidate> = {}): Candidate => ({
  userId: 'u1',
  handle: 'grim',
  displayName: 'Grim',
  alreadyHasAccess: false,
  ...over,
});

describe('shouldQuery', () => {
  it('MANDATORY: never sends an empty or one-character query', () => {
    /*
     * Matches the server's floor. An empty query would return the whole roster and a
     * one-character query a large slice of it — a roster leak dressed as convenience.
     * The server refuses both; this stops the request being made at all rather than
     * relying on that refusal.
     */
    for (const q of ['', ' ', '  ', 'a', ' a ']) {
      expect(shouldQuery(q), JSON.stringify(q)).toBe(false);
    }
  });

  it('sends once there are two real characters', () => {
    expect(shouldQuery('gr')).toBe(true);
    expect(shouldQuery('  gr  ')).toBe(true);
    expect(MIN_QUERY).toBe(2);
  });
});

describe('isCurrentResponse — the out-of-order guard', () => {
  it('MANDATORY: a stale response is discarded', () => {
    /*
     * ★ THE BUG THIS PREVENTS ★
     *
     * Type "gri" (request 1), then "grim" (request 2). If request 1 is slower it lands
     * SECOND and overwrites the results for a query the user has finished typing. The
     * list looks subtly wrong and is nearly impossible to reproduce on purpose.
     *
     * Debouncing does not fix it — it makes it rare, which is worse: rare enough to
     * survive testing, common enough to happen to somebody.
     */
    expect(isCurrentResponse(1, 2)).toBe(false);
  });

  it('applies the newest response', () => {
    expect(isCurrentResponse(2, 2)).toBe(true);
  });

  it('discards a response that somehow arrives from the future', () => {
    // Cannot happen if the counter is monotonic; asserted so that a refactor which
    // resets it fails here instead of applying results out of order.
    expect(isCurrentResponse(3, 2)).toBe(false);
  });
});

describe('nextHighlight', () => {
  it('wraps at both ends, so an arrow key is never a dead key', () => {
    expect(nextHighlight(2, 3, 'down')).toBe(0);
    expect(nextHighlight(0, 3, 'up')).toBe(2);
  });

  it('enters the list from either end', () => {
    expect(nextHighlight(-1, 3, 'down')).toBe(0);
    expect(nextHighlight(-1, 3, 'up')).toBe(2);
  });

  it('MANDATORY: an empty list highlights nothing rather than index 0', () => {
    // Returning 0 here would make Enter select `shown[0]` of an empty array — an
    // undefined read, and in a less careful component a crash.
    expect(nextHighlight(-1, 0, 'down')).toBe(-1);
    expect(nextHighlight(5, 0, 'up')).toBe(-1);
  });

  it('moves normally in the middle', () => {
    expect(nextHighlight(1, 5, 'down')).toBe(2);
    expect(nextHighlight(1, 5, 'up')).toBe(0);
  });
});

describe('visibleCandidates', () => {
  it('hides people already selected, who are visible as chips above', () => {
    const a = cand({ userId: 'a' });
    const b = cand({ userId: 'b' });
    expect(visibleCandidates([a, b], ['a'])).toEqual([b]);
  });

  it('MANDATORY: KEEPS somebody who already has access', () => {
    /*
     * Deliberate. Filtering them out would have an admin type a colleague's name, see
     * nothing, and conclude the search is broken — when the real answer is "they can
     * already read this". The row says so instead.
     */
    const has = cand({ userId: 'x', alreadyHasAccess: true });
    expect(visibleCandidates([has], [])).toEqual([has]);
  });
});

describe('emptyStateFor', () => {
  it('distinguishes "type something" from "keep typing"', () => {
    expect(emptyStateFor('', false, [])).toMatch(/Type a commander/);
    expect(emptyStateFor('a', false, [])).toMatch(/Keep typing/);
  });

  it('says it is searching', () => {
    expect(emptyStateFor('grim', true, [])).toBe('Searching…');
  });

  it('MANDATORY: "nobody matches" says what to do about it', () => {
    /*
     * "No matches" alone leaves an admin unsure whether the feature is broken or their
     * colleague simply has no account. The latter is the usual answer and is
     * actionable, so it is the one shown.
     */
    const msg = emptyStateFor('grim', false, []);
    expect(msg).toMatch(/website account/);
  });

  it('returns null when there are results to show', () => {
    expect(emptyStateFor('grim', false, [cand()])).toBeNull();
  });

  it('prefers the loading state over the no-results state', () => {
    // Otherwise the first frame of every search flashes "nobody matches" before the
    // response lands, which reads as a failure that then corrects itself.
    expect(emptyStateFor('grim', true, [])).toBe('Searching…');
  });
});

describe('labelFor', () => {
  it('shows the handle alone when the display name adds nothing', () => {
    expect(labelFor({ handle: 'grim', displayName: null })).toBe('grim');
    expect(labelFor({ handle: 'grim', displayName: '' })).toBe('grim');
    expect(labelFor({ handle: 'grim', displayName: '   ' })).toBe('grim');
    expect(labelFor({ handle: 'grim', displayName: 'grim' })).toBe('grim');
  });

  it('MANDATORY: always includes the handle, which is what disambiguates', () => {
    /*
     * Two members can share a display name and cannot share a handle. An admin
     * granting access to the officers' board has to be certain which person they
     * picked, so the unique identifier is always present.
     */
    expect(labelFor({ handle: 'grim', displayName: 'Grim Reaper' })).toBe('Grim Reaper (grim)');
  });
});
