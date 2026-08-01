import { createHash, randomBytes, randomInt } from 'node:crypto';

/**
 * Linking the companion app to an account.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "COMPANION Discord login; remove key generator"
 *
 * The old flow made the member handle a live credential: press a button, get a `gsq_…` token shown
 * once, select it, copy it, alt-tab, paste it into a password box. Every step is a chance to put a
 * working credential somewhere it should not be, and the most likely place is a chat message asking
 * for help with the step before.
 *
 * ★ THE SHAPE, AND WHY IT IS THIS ONE ★
 *
 * A desktop app cannot hold a client secret and has no trustworthy redirect target — a loopback
 * listener can be raced by anything else on the machine. So the app never performs the OAuth
 * exchange. It asks for a link, shows a short code, and waits. The member approves that code in
 * their own browser, in the Discord session they already have. The app then collects the result
 * exactly once.
 *
 * This is the device authorisation grant, and the two secrets are split deliberately:
 *
 *   the CODE     is shown to a human and is useless on its own — approving it requires a
 *                signed-in browser session, so knowing it grants nothing.
 *   the SECRET   never leaves the app, and is the only thing that can collect the token.
 *
 * Neither one alone is enough, which is what makes it safe to print the code on screen.
 */

/**
 * How long a member has to approve.
 *
 * Ten minutes. Long enough to find the browser, sign in with Discord and read the page; short
 * enough that a code left on a screen in a shared room is not still live in the morning.
 */
export const LINK_TTL_MS = 10 * 60 * 1000;

/** How long the app may take to collect after approval, before the token is discarded. */
export const COLLECT_TTL_MS = 5 * 60 * 1000;

/**
 * The alphabet the code is drawn from.
 *
 * ★ AMBIGUOUS CHARACTERS REMOVED, ON PURPOSE ★
 *
 * This is read off one screen and typed into another, sometimes from a laptop propped next to a
 * desktop. `0/O`, `1/I/L` and `5/S` are the pairs people get wrong, and a member who mistypes gets
 * "that code is not valid" with no way to tell whether they misread it or the link expired.
 *
 * The first version of this list dropped 0, 1, I, L and O and kept 5 and S — the spec caught it.
 * 28 characters over 8 positions is still 3.7e11 codes, against a ten-minute window.
 */
const ALPHABET = '2346789ABCDEFGHJKMNPQRTVWXYZ';

/** Characters per group, and how many groups. `K7M2-QP4X` reads and types better than 8 in a row. */
const GROUP = 4;
const GROUPS = 2;

/**
 * A fresh code.
 *
 * `randomInt` rather than `Math.random`: this is a credential-adjacent value, and the predictable
 * one is exactly the mistake that makes a "safe to display" code unsafe.
 */
export function newCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g += 1) {
    let out = '';
    for (let i = 0; i < GROUP; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(out);
  }
  return groups.join('-');
}

/** The secret only the app holds. 32 bytes, like the device token. */
export function newPollSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Stored as a hash, never in the clear — the same rule as the device token. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Normalises what a member typed.
 *
 * They will paste it with the hyphen, without it, in lower case, or with a trailing space from a
 * double-click selection. Every one of those is the right code, and rejecting them teaches members
 * that the feature is fragile.
 */
export function normaliseCode(raw: string): string {
  const bare = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (bare.length !== GROUP * GROUPS) return '';
  const groups: string[] = [];
  for (let i = 0; i < bare.length; i += GROUP) groups.push(bare.slice(i, i + GROUP));
  return groups.join('-');
}

/** What a poll should be told, given the row's state. */
export type PollState =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'approved'; token: string }
  /** Already collected, or collected too late. The app must not retry either. */
  | { status: 'gone' };

export interface LinkRow {
  readonly approvedAt: Date | null;
  readonly expiresAt: Date;
  readonly collectedAt: Date | null;
  readonly tokenOnce: string | null;
}

/**
 * Decides what one poll gets back.
 *
 * ★ PURE, BECAUSE THE ORDER OF THESE CHECKS IS THE SECURITY ★
 *
 * Approved-but-expired must not hand over a token; collected must never hand it over twice; and an
 * unapproved link must not report anything about whether the code exists. Getting that ordering
 * wrong produces a system that works perfectly in every manual test and hands out a second token to
 * whoever polls again.
 */
export function pollState(row: LinkRow, now: Date): PollState {
  // Collected already. Once, and only once — a token that can be fetched twice is a token that can
  // be fetched by whoever asks second.
  if (row.collectedAt !== null) return { status: 'gone' };

  if (row.approvedAt === null) {
    // Never approved, and the window has closed.
    return now >= row.expiresAt ? { status: 'expired' } : { status: 'pending' };
  }

  /*
   * Approved, but the app never came back. The token is dropped rather than held indefinitely: an
   * approval nobody collected is most likely a member who approved something they did not start.
   */
  if (now.getTime() - row.approvedAt.getTime() > COLLECT_TTL_MS) return { status: 'gone' };

  if (row.tokenOnce === null || row.tokenOnce === '') return { status: 'gone' };

  return { status: 'approved', token: row.tokenOnce };
}

/** Whether a link may still be approved by a member. */
export function canApprove(row: { approvedAt: Date | null; expiresAt: Date }, now: Date): boolean {
  // Approving twice would mint a second device for one request, and the app can only collect one —
  // so the second would exist, count against the device limit, and never be used by anything.
  return row.approvedAt === null && now < row.expiresAt;
}
