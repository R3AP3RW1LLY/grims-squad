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

/** The board's human name, the publish flow's fallback when the slug has been re-cut. */
export const FEATURE_REQUESTS_NAME = 'feature requests';

/**
 * ★ ONE RESOLUTION, TWO FORMS ★
 *
 * Publish finds the board by QUERY; the thread page's promote panel and the roadmap's promote
 * route ask the same question of a row already IN HAND. Both derive from the same two
 * constants above, so "is this the Feature Requests board" cannot quietly mean two different
 * things — the drift that had the panel comparing a URL literal while publish matched slug OR
 * name, case-insensitively.
 */

/** The Prisma WHERE that finds the board — slug or name, case-insensitive. */
export function featureRequestsWhere(): {
  OR: Array<{ slug?: { equals: string; mode: 'insensitive' }; name?: { equals: string; mode: 'insensitive' } }>;
} {
  return {
    OR: [
      { slug: { equals: FEATURE_REQUESTS_SLUG, mode: 'insensitive' } },
      { name: { equals: FEATURE_REQUESTS_NAME, mode: 'insensitive' } },
    ],
  };
}

/** The same test, for a category row already fetched. */
export function isFeatureRequestsBoard(category: {
  readonly slug: string;
  readonly name: string;
}): boolean {
  return (
    category.slug.toLowerCase() === FEATURE_REQUESTS_SLUG ||
    category.name.toLowerCase() === FEATURE_REQUESTS_NAME
  );
}

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

// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE SENDER IS TOLD
//
// ★ THE TRANSIENT SHAPE, AND WHY IT IS DERIVED RATHER THAN STORED ★
//
// Publish claims the row — `published`, thread id still NULL — BEFORE creating the thread, so two
// webmasters racing the same suggestion resolve to one winner before either mints anything. That
// claim is correct and stays exactly as it is. Its cost is a few milliseconds in which the
// sender's own list holds a `published` row with no link.
//
// A `published` row with no link is ALSO what a moderation-removed thread looks like, and what a
// double failure (creation threw, the revert threw too) leaves behind for good. Three different
// situations wearing one face, one of which reads as "the squadron deleted your idea" while the
// thread is still being written.
//
// A fourth STORED status — `publishing` — would need an enum value, a migration, and a state
// machine edge that exists for a few milliseconds and can be orphaned by a crash between the two
// writes. It would put a transient of the WRITE path into the schema, where it would then have to
// be reasoned about by every reader forever.
//
// So the stored machine keeps its three states and the READER gets an honest answer computed from
// what is already on the row: the claim's own timestamp says whether the thread is still landing.
// Nothing about the race safety or the failure revert changes; only what the sender is shown.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How long a claimed-but-threadless suggestion reads as still landing.
 *
 * Generous on purpose. The real gap is one thread creation — sanitising, screening and a couple of
 * writes, so milliseconds — and this is measured against a clock the reader may be several seconds
 * behind. Erring long means a slow publish reads as "going up now" for a moment too many; erring
 * short means it reads as "something went wrong" while it is going perfectly well, which is the
 * mistake worth avoiding.
 */
export const PUBLISH_LANDING_MS = 30_000;

/**
 * What a suggestion IS, to the person who sent it.
 *
 * Not the stored status: it is the stored status plus the two facts that disambiguate it — does a
 * thread id exist, and can this reader reach the thread. `new` and `declined` pass through
 * unchanged because nothing about them is ambiguous.
 *
 *   publishing           claimed seconds ago, thread still being created. In progress.
 *   published            on the board, and here is the link.
 *   published_thread_gone  on the board, but the thread is not there for this reader — removed by
 *                          moderation, or in a category they cannot see.
 *   publish_incomplete   claimed long ago and no thread ever landed. The double failure the
 *                        publish path tolerates by design, said out loud instead of disguised.
 */
export type SuggestionOutcome =
  | 'new'
  | 'publishing'
  | 'published'
  | 'published_thread_gone'
  | 'publish_incomplete'
  | 'declined';

/**
 * Which of those a row is, right now.
 *
 * `threadLink` is passed in rather than looked up: it is resolved through the READER'S own bound
 * client, so "gone" means gone as far as this person is concerned, which is the only honest
 * meaning available here.
 */
export function suggestionOutcome(
  row: {
    readonly status: SuggestionStatus;
    readonly publishedThreadId: string | null;
    readonly reviewedAt: Date | null;
    readonly threadLink: string | null;
  },
  now: Date = new Date(),
): SuggestionOutcome {
  if (row.status !== 'published') return row.status;

  if (row.publishedThreadId !== null) {
    return row.threadLink === null ? 'published_thread_gone' : 'published';
  }

  // Claimed, nothing stamped yet. Either the thread is landing this instant, or it never did.
  if (row.reviewedAt === null) return 'publish_incomplete';

  /*
   * Bounded BOTH ways, like the step-up window and for a related reason: an unbounded lower bound
   * would let a timestamp ahead of the reader's clock read as "landing" forever. This one is not
   * attacker-controlled — the server stamps it — so the tolerance is symmetric rather than zero,
   * which is what stops a second of clock drift turning a healthy publish into an alarm.
   */
  const age = now.getTime() - row.reviewedAt.getTime();
  return age > -PUBLISH_LANDING_MS && age < PUBLISH_LANDING_MS ? 'publishing' : 'publish_incomplete';
}

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
