/**
 * The decisions behind the access dropdown, separated from the widget that renders
 * them.
 *
 * ★ WHY THIS IS A SEPARATE FILE ★
 *
 * Squadron owner, 2026-07-29: "a multi select dropdown that is searchable and
 * autocompletable". Every interesting thing about that sentence is a rule rather
 * than markup — when to query, what to do with a slower response that arrives after
 * a faster one, which keystroke does what, whether the highlighted row wraps. Those
 * are testable as functions and painful to test through a rendered component, and
 * the ones that get skipped in a component test are exactly the ones users hit.
 */

/** A person the dropdown can offer. Mirrors the API's `GranteeCandidate`. */
export interface Candidate {
  readonly userId: string;
  readonly handle: string;
  readonly displayName: string | null;
  /** They can already read the thread, so a grant would change nothing. */
  readonly alreadyHasAccess: boolean;
}

/**
 * Shortest query worth sending.
 *
 * Matches the server's own floor. One character returns a large slice of the roster
 * and an empty query returns all of it, which is a roster leak dressed as
 * convenience — so the server refuses both, and this stops the request being made at
 * all rather than relying on that refusal.
 */
export const MIN_QUERY = 2;

/**
 * How long to wait after the last keystroke.
 *
 * 200ms is under the ~250ms at which typing starts to feel laggy, and long enough
 * that "cmdr" is one request instead of four.
 */
export const DEBOUNCE_MS = 200;

/** Should this query go to the server at all? */
export function shouldQuery(raw: string): boolean {
  return raw.trim().length >= MIN_QUERY;
}

/**
 * What the box should say when it is not showing results.
 *
 * Returns null when results should be shown instead. Every branch says what to do
 * next rather than only what is wrong — "No matches" alone leaves somebody wondering
 * whether the feature is broken or their colleague simply is not a member.
 */
export function emptyStateFor(
  raw: string,
  loading: boolean,
  results: readonly Candidate[],
): string | null {
  if (!shouldQuery(raw)) {
    return raw.trim() === ''
      ? 'Type a commander name or handle.'
      : `Keep typing — ${MIN_QUERY} characters at least.`;
  }
  if (loading) return 'Searching…';
  if (results.length === 0) {
    return 'Nobody active matches that. They need a website account before they can be given access.';
  }
  return null;
}

/**
 * Is this response still the one we want?
 *
 * ★ THE OUT-OF-ORDER BUG THIS EXISTS TO PREVENT ★
 *
 * Type "gri", then "grim". Two requests are in flight. If "gri" is slower — a
 * different connection, a retried TCP segment, a cold query plan — it lands SECOND
 * and overwrites the results for "grim". The user sees matches for a query they have
 * already finished typing, and the list looks subtly wrong in a way that is almost
 * impossible to reproduce deliberately.
 *
 * Debouncing does not fix this. It makes it rarer, which is worse: rare enough to
 * survive testing and common enough to happen to somebody.
 *
 * A monotonic sequence number does fix it. Each request takes the next number, and a
 * response is applied only if no later request has already been issued.
 */
export function isCurrentResponse(responseSeq: number, latestSeq: number): boolean {
  return responseSeq === latestSeq;
}

/** Where the arrow keys move the highlight. */
export function nextHighlight(
  current: number,
  count: number,
  direction: 'up' | 'down',
): number {
  if (count === 0) return -1;
  /*
   * Wraps at both ends. Down from the last row goes to the first, which is what a
   * short list wants — the alternative is an arrow key that silently does nothing and
   * reads as a dead keyboard.
   */
  if (current < 0) return direction === 'down' ? 0 : count - 1;
  const step = direction === 'down' ? 1 : -1;
  return (current + step + count) % count;
}

/**
 * Candidates worth showing, given who is already selected.
 *
 * Selected people are removed rather than shown greyed out: they are already visible
 * as chips directly above, and listing them twice invites clicking the row that does
 * nothing.
 *
 * Somebody who `alreadyHasAccess` is KEPT, deliberately — with the flag intact so the
 * row can say so. Hiding them would make an admin type a name, get nothing, and
 * conclude the search is broken; telling them "already has access" answers the actual
 * question.
 */
export function visibleCandidates(
  results: readonly Candidate[],
  selectedIds: readonly string[],
): Candidate[] {
  const taken = new Set(selectedIds);
  return results.filter((c) => !taken.has(c.userId));
}

/** How a person is written in a chip and in a result row. */
export function labelFor(c: Pick<Candidate, 'handle' | 'displayName'>): string {
  /*
   * Handle always shown, display name only when it adds something. Two members can
   * share a display name and cannot share a handle, so the handle is what makes the
   * row unambiguous — and an admin granting access to the officers' board needs to be
   * certain which person they picked.
   */
  if (c.displayName === null || c.displayName.trim() === '' || c.displayName === c.handle) {
    return c.handle;
  }
  return `${c.displayName} (${c.handle})`;
}
