/**
 * The suggestion box — the rules, with nothing else attached.
 *
 * ★ THE APPROVED DESIGN, BRIEFLY ★
 *
 * Members send the webmaster ideas from the support widget. Each one sits in a private inbox
 * until the webmaster PUBLISHES it — one click that turns it into a Feature Requests thread the
 * squadron votes on, crediting the sender by name — or DECLINES it, kindly. Either way the
 * sender is told personally.
 *
 * ★ PURE, LIKE support-chat.ts, AND FOR THE SAME REASON ★
 *
 * The body cap and the review state machine are the correctness of this feature, and a rule
 * that can only be exercised through a database is a rule nobody exercises. The service applies
 * these; the spec drives them directly.
 */

/**
 * The most one suggestion may carry.
 *
 * Half the support cap, deliberately: a suggestion is an idea, not an essay, and anything that
 * needs more room than this is a conversation — which the same widget already offers, one view
 * over. Enforced HERE, server-side; the composer's counter is a courtesy, not the control.
 */
export const SUGGESTION_MAX_CHARS = 2000;

/** Where the board that publishes suggestions lives. Resolved by slug at runtime, seeded by the
 *  suggestion_box_and_roadmap migration — never created on the fly (the forum-cc doctrine: a
 *  board appearing on everyone's forum must be a decision, not a side effect). */
export const FEATURE_REQUESTS_SLUG = 'feature-requests';

/** Cleans one suggestion body, or says what is wrong with it in a sentence a human can act on. */
export function cleanSuggestionBody(raw: unknown): { body: string } | { problem: string } {
  if (typeof raw !== 'string') return { problem: 'Write the suggestion first.' };
  // Windows line endings normalised so the cap measures what the member sees, not their OS.
  const body = raw.replace(/\r\n/g, '\n').trim();
  if (body === '') return { problem: 'Write the suggestion first.' };
  if (body.length > SUGGESTION_MAX_CHARS) {
    return {
      problem: `That suggestion is ${body.length.toLocaleString('en-GB')} characters, and the box holds ${SUGGESTION_MAX_CHARS.toLocaleString('en-GB')}. Trim it to the idea itself — there is room for detail once it is on the board.`,
    };
  }
  return { body };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE REVIEW STATE MACHINE
//
// Three states, and `new` has exactly two exits. Publish and decline are both strict and both
// one-way: reviewing an already-reviewed suggestion means the webmaster's screen is stale, and
// telling them so beats silently agreeing — the close/reopen doctrine from the support desk.
// There is deliberately no edge back to `new`: unpublishing is forum moderation's job, and
// un-declining would put words back in a queue their sender was already told about.
// ─────────────────────────────────────────────────────────────────────────────

export type SuggestionStatus = 'new' | 'published' | 'declined';

/** Why a suggestion may not be reviewed this way, or null when it may. Shown as written. */
export function reviewProblem(
  status: SuggestionStatus,
  action: 'publish' | 'decline',
): string | null {
  if (status === 'new') return null;
  if (status === 'published') {
    return action === 'publish'
      ? 'This suggestion is already published.'
      : 'This suggestion is already published — declining it now would contradict a live thread.';
  }
  return action === 'decline'
    ? 'This suggestion was already declined.'
    : 'This suggestion was already declined. The sender has been told; publishing it now would contradict that.';
}

/**
 * A thread title from a suggestion's own words.
 *
 * The first line, whitespace collapsed, clipped to fit the forum's 200-character ceiling with
 * room to spare. A suggestion too short to be a title falls back to naming its sender — which
 * is also the credit, so the fallback is never anonymous.
 */
export function titleFrom(body: string, senderName: string): string {
  const firstLine = body.split('\n')[0] ?? '';
  const flat = firstLine.replace(/\s+/g, ' ').trim();
  const clipped = flat.length > 100 ? `${flat.slice(0, 99).trimEnd()}…` : flat;
  return clipped.length >= 3 ? clipped : `Suggestion from ${senderName}`;
}

/**
 * The opening post of a published suggestion: the member's words, credited to them.
 *
 * The CREDIT is the design — "crediting the suggester". It leads the post rather than
 * footnoting it, and the sender's words ride as a quote so the webmaster's authorship of the
 * thread (a mechanical fact: only the webmaster can post here) never reads as authorship of the
 * idea. A closing line says what the board is for, because a reader arriving from the vote rail
 * should know what their vote does.
 */
export function openingPostFor(body: string, senderName: string): string {
  const quoted = body
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
  return `**Suggested by ${senderName}**, from the suggestion box.\n\n${quoted}\n\nVote this thread up to get it built — the roadmap is drawn from these boards.`;
}
