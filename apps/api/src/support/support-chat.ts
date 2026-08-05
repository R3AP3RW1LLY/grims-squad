import { createHash, randomBytes } from 'node:crypto';

/**
 * Help & Support — the rules of the chat, with nothing else attached.
 *
 * ★ THE APPROVED DESIGN, BRIEFLY ★
 *
 * The chat is usable by EVERYONE, signed-out guests included. GMSD AI answers first, from the
 * help corpus, in the `ai` seat Wave 1 reserved for exactly this; the officers answer as
 * themselves the moment anybody asks for a person — or the moment they simply reply. Who is
 * answering is the `SupportHandledBy` state below.
 *
 * ★ PURE, LIKE device-link.ts, AND FOR THE SAME REASON ★
 *
 * The guest token discipline and the conversation state machine are the security and the
 * correctness of this feature, and a rule that can only be exercised through a database is a
 * rule nobody exercises. The service applies these; the spec drives them directly.
 */

/**
 * The most one message may carry.
 *
 * Long enough to describe any problem anybody has ever had with a website; short enough that the
 * cap is never met by accident. Enforced HERE, server-side — the composer's counter is a
 * courtesy, not the control.
 */
export const MESSAGE_MAX_CHARS = 4000;

/** A guest's name is display only. Sixty characters is a name; more is a message. */
export const GUEST_NAME_MAX_CHARS = 60;

/** A subject is a headline, not the question itself. */
export const SUBJECT_MAX_CHARS = 120;

/**
 * How fast one guest conversation may fill.
 *
 * The repo's limiter shape (see DAILY_UPLOAD_LIMIT): a rolling window counted from rows, not a
 * bucket that resets on a boundary it can be gamed around. Ten messages a minute is far above
 * any honest typing speed and far below what a loop produces.
 */
export const GUEST_POST_WINDOW_MS = 60_000;
export const GUEST_POSTS_PER_WINDOW = 10;

/**
 * How many guest conversations may START, site-wide, per rolling hour.
 *
 * Guests have no identity to count against — that is what makes them guests — so the only
 * honest window is the site's. This is not a security boundary; it bounds the damage from a
 * script or an accidental loop, exactly like the upload quota. A hundred an hour is far above
 * what a hundred-member squadron's front door has ever seen, and a genuine visitor who somehow
 * meets it can still sign in with Discord and use the member door.
 */
export const GUEST_START_WINDOW_MS = 60 * 60_000;
export const GUEST_STARTS_PER_WINDOW = 100;

/**
 * A fresh guest token. 32 bytes, like the device token, and prefixed so a leaked string in a
 * log or a pastebin is recognisable as ours.
 */
export function newGuestToken(): string {
  return `gsup_${randomBytes(32).toString('base64url')}`;
}

/** Stored as a hash, never in the clear — the same rule as device tokens and recovery codes. */
export function hashGuestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Cleans one message body, or says what is wrong with it in a sentence a human can act on.
 *
 * Plain text end to end. The transcript renders it as text, never as markup, so there is
 * nothing to sanitise — only to bound.
 */
export function cleanMessageBody(raw: unknown): { body: string } | { problem: string } {
  if (typeof raw !== 'string') return { problem: 'Write a message first.' };
  // Windows line endings normalised so the cap measures what the member sees, not their OS.
  const body = raw.replace(/\r\n/g, '\n').trim();
  if (body === '') return { problem: 'Write a message first.' };
  if (body.length > MESSAGE_MAX_CHARS) {
    return {
      problem: `That message is ${body.length.toLocaleString('en-GB')} characters, and the most one message can carry is ${MESSAGE_MAX_CHARS.toLocaleString('en-GB')}. Split it in two.`,
    };
  }
  return { body };
}

/** What a guest asked to be called. Display only; it authenticates nothing. */
export function cleanGuestName(raw: unknown): { name: string } | { problem: string } {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { problem: 'Tell us what to call you first.' };
  }
  return { name: raw.trim().slice(0, GUEST_NAME_MAX_CHARS) };
}

/** A subject is welcome and bounded. Empty becomes null: the opening message speaks for itself. */
export function cleanSubject(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const subject = raw.trim().slice(0, SUBJECT_MAX_CHARS);
  return subject === '' ? null : subject;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE STATE MACHINE
//
// Two states, and every edge written down. Posting is only legal into an open conversation —
// for everybody, officers included, because a closed conversation that some doors can still
// write into is not closed. Close and reopen are officer acts, strict rather than idempotent:
// closing a closed conversation is a stale screen, and telling the officer so beats silently
// agreeing with them.
// ─────────────────────────────────────────────────────────────────────────────

export type SupportStatus = 'open' | 'closed';

/**
 * Who answers the next requester message — the owner's ruling made a state: AI ANSWERS FIRST,
 * HUMAN ON DEMAND.
 *
 * Every conversation starts at 'ai'. The flip to 'officer' is ONE-WAY, and there are exactly
 * three edges onto it:
 *
 *   the requester presses "Talk to an officer"   a system line says so in the transcript
 *   any officer replies                          a human took over; the AI does not talk over them
 *   the AI could not take its turn               silent — the requester is never shown an error
 *                                                for a model being off, they simply get a person
 *
 * There is deliberately no edge back to 'ai': a conversation a person has joined must never be
 * handed back to a model mid-thread.
 */
export type SupportHandledBy = 'ai' | 'officer';

/**
 * What the room says when the requester asks for a person.
 *
 * A `system` line, like close and reopen: the hand-off is the desk's act, not a sentence in
 * anybody's voice. It states what happens next, because the person who pressed the button is
 * watching this exact spot for the answer.
 */
export const OFFICER_HANDOFF_LINE = 'An officer will pick this up and reply right here.';

/** Why a message may not be posted, or null when it may. One sentence, shown as written. */
export function postingProblem(status: SupportStatus): string | null {
  if (status === 'closed') {
    return 'This conversation is closed. Start a new one and we will pick it up from there.';
  }
  return null;
}

/** The close/reopen edges. A refusal means the screen was stale, and says so. */
export function transitionProblem(status: SupportStatus, action: 'close' | 'reopen'): string | null {
  if (action === 'close' && status === 'closed') return 'This conversation is already closed.';
  if (action === 'reopen' && status === 'open') return 'This conversation is already open.';
  return null;
}

/**
 * What the room says when an officer closes or reopens.
 *
 * A `system` message, deliberately: the state change is the desk's act, not a sentence in the
 * officer's voice, and it must not wear their face in the transcript.
 */
export function systemLineFor(action: 'close' | 'reopen'): string {
  return action === 'close' ? 'This conversation was closed.' : 'This conversation was reopened.';
}
