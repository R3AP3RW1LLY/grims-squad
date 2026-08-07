/**
 * Working out whose link somebody came through.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "a unique discord invite link for all members that are inara veriefied in our platform ... please
 * build me a cool recruit tracking system!"
 *
 * ★ DISCORD DOES NOT TELL YOU ★
 *
 * There is no "who invited this person" field, and no event carries it. The only technique that
 * works is counting: every invite has a `uses` number, so the bot remembers them all, and when
 * somebody joins it looks for the one that went up.
 *
 * That is exact for one arrival at a time and genuinely ambiguous for two at once. The entire value
 * of this function is that it distinguishes the cases instead of choosing — because a WRONG
 * attribution is worse than none. It awards points to somebody who did nothing, on a leaderboard,
 * publicly, while the member who actually recruited watches it happen.
 *
 * Pure, so the awkward cases can be argued with without a Discord guild: the race, the link minted
 * between refreshes, the invite that expired, the first join after a restart.
 */

/** Invite code to its use count, as a snapshot of the guild. */
export type InviteUses = ReadonlyMap<string, number>;

export type Attribution =
  /** Exactly one invite went up. `code` is whose link it was. */
  | { readonly outcome: 'attributed'; readonly code: string }
  /** More than one went up between snapshots — two people joined at once. */
  | { readonly outcome: 'ambiguous' }
  /** Nothing went up: a vanity URL, a widget invite, a bot-added member, or no snapshot yet. */
  | { readonly outcome: 'unknown' };

/**
 * Which invite was used, given the guild before and after.
 *
 * `before` is null when the bot has no snapshot — the first join after a restart, which is unknown
 * rather than an error.
 */
export function whoInvited(before: InviteUses | null, after: InviteUses): Attribution {
  if (before === null) return { outcome: 'unknown' };

  const used: string[] = [];

  for (const [code, uses] of after) {
    const was = before.get(code);

    if (was === undefined) {
      /*
       * A code that did not exist at the last snapshot. A member minted a link and somebody walked
       * through it before the refresh — so any use at all is a use since we last looked.
       *
       * Minting alone is not a join, which is why this is `> 0` and not `>= 0`: without that, every
       * new link would be read as an arrival and credit its owner for nothing.
       */
      if (uses > 0) used.push(code);
      continue;
    }

    // A jump of more than one is two arrivals through the SAME link. Which member to credit is not
    // in doubt — it is their link either way — so it attributes rather than giving up.
    if (uses > was) used.push(code);
  }

  /*
   * Invites that VANISHED are simply absent from this loop. They expired or were deleted, which is
   * not a join, and reading their disappearance as a negative must never be allowed to cancel out
   * the real answer sitting beside it.
   */

  if (used.length === 1) return { outcome: 'attributed', code: used[0] as string };
  if (used.length > 1) return { outcome: 'ambiguous' };
  return { outcome: 'unknown' };
}
